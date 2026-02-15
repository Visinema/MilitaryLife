import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import type { ActionResult, DecisionResult } from '@mls/shared/game-types';
import { BRANCH_CONFIG } from './branch-config.js';
import { buildCeremonyReport } from './ceremony.js';
import {
  advanceGameDays,
  applyDecisionEffects,
  applyDeploymentAction,
  applyTrainingAction,
  autoResumeIfExpired,
  buildSnapshot,
  evaluatePromotionAlgorithm,
  generateMission,
  maybeQueueDecisionEvent,
  pauseState,
  resumeState,
  scheduleNextEventDay,
  snapshotStateForLog,
  synchronizeProgress,
  tryPromotion
} from './engine.js';
import {
  ensureSingleActiveSession,
  getEventById,
  getProfileIdByUserId,
  insertDecisionLog,
  listDecisionLogs,
  lockGameStateByProfileId,
  type DbEventOption,
  type DbGameStateRow,
  updateGameState
} from './repo.js';
import { attachAuth } from '../auth/service.js';

interface LockedStateContext {
  client: PoolClient;
  state: DbGameStateRow;
  nowMs: number;
  profileId: string;
}

interface StateCheckpoint {
  activeSessionId: string | null;
  serverReferenceTimeMs: number;
  currentDay: number;
  pausedAtMs: number | null;
  pauseReason: DbGameStateRow['pause_reason'];
  pauseToken: string | null;
  pauseExpiresAtMs: number | null;
  rankIndex: number;
  moneyCents: number;
  morale: number;
  health: number;
  promotionPoints: number;
  daysInRank: number;
  nextEventDay: number;
  lastMissionDay: number;
  academyTier: number;
  lastTravelPlace: string | null;
  certificateInventory: DbGameStateRow['certificate_inventory'];
  divisionFreedomScore: number;
  preferredDivision: string | null;
  pendingEventId: number | null;
  pendingEventPayload: DbGameStateRow['pending_event_payload'];
}

function createStateCheckpoint(state: DbGameStateRow): StateCheckpoint {
  return {
    activeSessionId: state.active_session_id,
    serverReferenceTimeMs: state.server_reference_time_ms,
    currentDay: state.current_day,
    pausedAtMs: state.paused_at_ms,
    pauseReason: state.pause_reason,
    pauseToken: state.pause_token,
    pauseExpiresAtMs: state.pause_expires_at_ms,
    rankIndex: state.rank_index,
    moneyCents: state.money_cents,
    morale: state.morale,
    health: state.health,
    promotionPoints: state.promotion_points,
    daysInRank: state.days_in_rank,
    nextEventDay: state.next_event_day,
    lastMissionDay: state.last_mission_day,
    academyTier: state.academy_tier,
    lastTravelPlace: state.last_travel_place,
    certificateInventory: state.certificate_inventory,
    divisionFreedomScore: state.division_freedom_score,
    preferredDivision: state.preferred_division,
    pendingEventId: state.pending_event_id,
    pendingEventPayload: state.pending_event_payload
  };
}

function hasStateChanged(state: DbGameStateRow, checkpoint: StateCheckpoint): boolean {
  return (
    state.active_session_id !== checkpoint.activeSessionId ||
    state.server_reference_time_ms !== checkpoint.serverReferenceTimeMs ||
    state.current_day !== checkpoint.currentDay ||
    state.paused_at_ms !== checkpoint.pausedAtMs ||
    state.pause_reason !== checkpoint.pauseReason ||
    state.pause_token !== checkpoint.pauseToken ||
    state.pause_expires_at_ms !== checkpoint.pauseExpiresAtMs ||
    state.rank_index !== checkpoint.rankIndex ||
    state.money_cents !== checkpoint.moneyCents ||
    state.morale !== checkpoint.morale ||
    state.health !== checkpoint.health ||
    state.promotion_points !== checkpoint.promotionPoints ||
    state.days_in_rank !== checkpoint.daysInRank ||
    state.next_event_day !== checkpoint.nextEventDay ||
    state.last_mission_day !== checkpoint.lastMissionDay ||
    state.academy_tier !== checkpoint.academyTier ||
    state.last_travel_place !== checkpoint.lastTravelPlace ||
    state.certificate_inventory !== checkpoint.certificateInventory ||
    state.division_freedom_score !== checkpoint.divisionFreedomScore ||
    state.preferred_division !== checkpoint.preferredDivision ||
    state.pending_event_id !== checkpoint.pendingEventId ||
    state.pending_event_payload !== checkpoint.pendingEventPayload
  );
}

async function getProfileIdOrNull(client: PoolClient, request: FastifyRequest): Promise<string | null> {
  if (request.auth?.profileId) {
    return request.auth.profileId;
  }

  if (!request.auth?.userId) {
    return null;
  }

  return getProfileIdByUserId(client, request.auth.userId);
}

async function withLockedState(
  request: FastifyRequest,
  reply: FastifyReply,
  options: { queueEvents: boolean },
  execute: (ctx: LockedStateContext) => Promise<{ payload: unknown; statusCode?: number }>
): Promise<void> {
  await attachAuth(request);

  if (!request.auth) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  const client = await request.server.db.connect();
  try {
    await client.query('BEGIN');

    const profileId = await getProfileIdOrNull(client, request);
    if (!profileId) {
      await client.query('ROLLBACK');
      reply.code(404).send({ error: 'Profile not found' });
      return;
    }

    if (!request.auth.sessionId) {
      await client.query('ROLLBACK');
      reply.code(401).send({ error: 'Invalid session' });
      return;
    }

    const sessionGuard = await ensureSingleActiveSession(client, profileId, request.auth.sessionId);
    if (sessionGuard === 'conflict') {
      await client.query('ROLLBACK');
      reply.code(409).send({ error: 'Another active session is controlling this profile' });
      return;
    }

    const state = await lockGameStateByProfileId(client, profileId);
    if (!state) {
      await client.query('ROLLBACK');
      reply.code(404).send({ error: 'Game state not found' });
      return;
    }

    const nowMs = Date.now();
    const initialStateCheckpoint = createStateCheckpoint(state);
    autoResumeIfExpired(state, nowMs);
    synchronizeProgress(state, nowMs);

    if (options.queueEvents && !state.paused_at_ms && !state.pending_event_id) {
      await maybeQueueDecisionEvent(client, state, nowMs, request.server.env.PAUSE_TIMEOUT_MINUTES);
    }

    const result = await execute({ client, state, nowMs, profileId });

    if (hasStateChanged(state, initialStateCheckpoint)) {
      await updateGameState(client, state);
    }
    await client.query('COMMIT');

    reply.code(result.statusCode ?? 200).send(result.payload);
  } catch (err) {
    await client.query('ROLLBACK');
    request.log.error(err, 'game-service-failure');
    throw err;
  } finally {
    client.release();
  }
}

export async function getSnapshot(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withLockedState(
    request,
    reply,
    { queueEvents: true },
    async ({ state, nowMs }) => ({ payload: { snapshot: buildSnapshot(state, nowMs) } })
  );
}

export async function pauseGame(
  request: FastifyRequest,
  reply: FastifyReply,
  reason: 'DECISION' | 'MODAL' | 'SUBPAGE'
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    if (state.pause_reason === 'DECISION' && state.pause_token) {
      return {
        payload: {
          pauseToken: state.pause_token,
          pauseExpiresAtMs: state.pause_expires_at_ms,
          snapshot: buildSnapshot(state, nowMs)
        }
      };
    }

    const pauseToken = pauseState(state, reason, nowMs, request.server.env.PAUSE_TIMEOUT_MINUTES);
    return {
      payload: {
        pauseToken,
        pauseExpiresAtMs: state.pause_expires_at_ms,
        snapshot: buildSnapshot(state, nowMs)
      }
    };
  });
}

export async function resumeGame(request: FastifyRequest, reply: FastifyReply, pauseToken: string): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    if (!state.paused_at_ms) {
      return { payload: { snapshot: buildSnapshot(state, nowMs) } };
    }

    if (!state.pause_token || state.pause_token !== pauseToken) {
      return { payload: { error: 'Invalid pause token' }, statusCode: 409 };
    }

    resumeState(state, nowMs);
    synchronizeProgress(state, nowMs);

    return { payload: { snapshot: buildSnapshot(state, nowMs) } };
  });
}


function hasCommandAccess(state: DbGameStateRow): boolean {
  const ranks = BRANCH_CONFIG[state.branch].ranks;
  const currentRank = (ranks[state.rank_index] ?? '').toLowerCase();
  const captainIndex = ranks.findIndex((rank) => {
    const lowered = rank.toLowerCase();
    return lowered.includes('captain') || lowered.includes('kapten');
  });

  if (captainIndex >= 0) {
    return state.rank_index >= captainIndex;
  }

  return currentRank.includes('major') || currentRank.includes('colonel') || currentRank.includes('general') || state.rank_index >= 8;
}

function ensureNoPendingDecision(state: DbGameStateRow): string | null {
  if (!state.pending_event_id) return null;
  return 'Resolve pending decision before taking actions';
}

export async function runTraining(
  request: FastifyRequest,
  reply: FastifyReply,
  intensity: 'LOW' | 'MEDIUM' | 'HIGH'
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const pendingError = ensureNoPendingDecision(state);
    if (pendingError) {
      return { statusCode: 409, payload: { error: pendingError, snapshot: buildSnapshot(state, nowMs) } };
    }

    const action = applyTrainingAction(state, intensity);
    const promoted = tryPromotion(state);

    const snapshot = buildSnapshot(state, nowMs);
    const payload: ActionResult = {
      type: 'TRAINING',
      snapshot,
      details: {
        ...action.details,
        promoted,
        rankCode: snapshot.rankCode
      }
    };

    return { payload };
  });
}

export async function runDeployment(
  request: FastifyRequest,
  reply: FastifyReply,
  missionType: 'PATROL' | 'SUPPORT',
  missionDurationDays = 2
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const pendingError = ensureNoPendingDecision(state);
    if (pendingError) {
      const snapshot = buildSnapshot(state, nowMs);
      const payload: ActionResult = {
        type: 'DEPLOYMENT',
        snapshot,
        details: {
          blocked: true,
          reason: pendingError,
          rankCode: snapshot.rankCode
        }
      };
      return { payload };
    }

    const missionCooldownDays = 10;
    const daysSinceLastMission = Math.max(0, state.current_day - state.last_mission_day);
    if (daysSinceLastMission < missionCooldownDays) {
      const waitDays = missionCooldownDays - daysSinceLastMission;
      const snapshot = buildSnapshot(state, nowMs);
      const payload: ActionResult = {
        type: 'DEPLOYMENT',
        snapshot,
        details: {
          blocked: true,
          reason: `Mission assignment not ready. Next assignment available in ${waitDays} in-game day(s).`,
          daysUntilNextMission: waitDays,
          rankCode: snapshot.rankCode
        }
      };
      return { payload };
    }

    const mission = generateMission(state);
    const action = applyDeploymentAction(state, missionType, mission);
    const advancedDays = advanceGameDays(state, missionDurationDays);
    state.last_mission_day = state.current_day;
    const promoted = tryPromotion(state);

    const snapshot = buildSnapshot(state, nowMs);
    const payload: ActionResult = {
      type: 'DEPLOYMENT',
      snapshot,
      details: {
        ...action.details,
        promoted,
        rankCode: snapshot.rankCode,
        missionDurationDays,
        advancedDays,
        nextMissionInDays: missionCooldownDays,
        terrain: mission.terrain,
        objective: mission.objective,
        enemyStrength: mission.enemyStrength,
        difficultyRating: mission.difficultyRating,
        equipmentQuality: mission.equipmentQuality,
        promotionRecommendation: promoted ? 'PROMOTION_CONFIRMED' : evaluatePromotionAlgorithm(state).recommendation
      }
    };

    return { payload };
  });
}

export async function runCareerReview(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withLockedState(request, reply, { queueEvents: true }, async ({ state, nowMs }) => {
    const pendingError = ensureNoPendingDecision(state);
    if (pendingError) {
      return { statusCode: 409, payload: { error: pendingError, snapshot: buildSnapshot(state, nowMs) } };
    }

    const promotionEvaluation = evaluatePromotionAlgorithm(state);
    const promoted = tryPromotion(state);
    if (!promoted) {
      state.morale = Math.max(0, state.morale - 1);
    }

    const snapshot = buildSnapshot(state, nowMs);
    const payload: ActionResult = {
      type: 'CAREER_REVIEW',
      snapshot,
      details: {
        promoted,
        rankCode: snapshot.rankCode,
        promotionRecommendation: promotionEvaluation.recommendation,
        serviceYears: promotionEvaluation.serviceYears,
        minimumServiceYears: promotionEvaluation.minimumServiceYears,
        meritPoints: promotionEvaluation.meritPoints,
        minimumMeritPoints: promotionEvaluation.minimumMeritPoints,
        vacancyAvailabilityPercent: promotionEvaluation.vacancyAvailabilityPercent,
        rejectionLetter: promoted ? null : promotionEvaluation.rejectionLetter
      }
    };

    return { payload };
  });
}

export async function runMilitaryAcademy(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: {
    tier: 1 | 2;
    answers: number[] | null;
    preferredDivision?: 'INFANTRY' | 'INTEL' | 'LOGISTICS' | 'CYBER';
  }
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const pendingError = ensureNoPendingDecision(state);
    if (pendingError) {
      return { statusCode: 409, payload: { error: pendingError, snapshot: buildSnapshot(state, nowMs) } };
    }

    const { tier, answers, preferredDivision } = payload;

    const correctMap = tier === 2 ? [4, 2, 3, 1, 4] : [2, 3, 1, 4, 2];
    const hasInteractiveAnswers = Array.isArray(answers) && answers.length === 5;

    let score = 0;
    if (hasInteractiveAnswers) {
      const normalizedAnswers = (answers as number[]).slice(0, 5);
      for (let i = 0; i < correctMap.length; i += 1) {
        if (normalizedAnswers[i] === correctMap[i]) {
          score += 20;
        }
      }
    } else {
      const legacyBase = Math.round((state.morale * 0.45 + state.health * 0.35 + Math.min(100, state.promotion_points * 2) * 0.2));
      score = Math.max(40, Math.min(100, legacyBase));
    }

    const passThreshold = tier === 2 ? 80 : 60;
    if (score < passThreshold) {
      state.morale = Math.max(0, state.morale - 2);
      return {
        payload: {
          type: 'MILITARY_ACADEMY',
          snapshot: buildSnapshot(state, nowMs),
          details: {
            passed: false,
            score,
            passThreshold,
            message: hasInteractiveAnswers
              ? 'Assessment not passed. Repeat academy training phase.'
              : 'Legacy academy check did not pass threshold. Open training phase for full assessment.'
          }
        }
      };
    }

    const fee = tier === 2 ? 3200 : 1800;
    const moraleBoost = tier === 2 ? 5 : 3;
    const healthBoost = tier === 2 ? 2 : 1;
    const pointsBoost = tier === 2 ? 8 : 5;

    state.money_cents = Math.max(0, state.money_cents - fee);
    state.morale = Math.min(100, state.morale + moraleBoost);
    state.health = Math.min(100, state.health + healthBoost);
    state.promotion_points += pointsBoost;
    state.academy_tier = Math.max(state.academy_tier, tier);

    const lieutenantIndex = BRANCH_CONFIG[state.branch].ranks.findIndex((rank) => {
      const lowered = rank.toLowerCase();
      return (lowered.includes('lieutenant') || lowered.includes('letnan')) && !lowered.includes('jendral') && !lowered.includes('general');
    });

    if (lieutenantIndex >= 0 && state.rank_index < lieutenantIndex) {
      state.rank_index = lieutenantIndex;
      state.days_in_rank = 0;
    }

    const freedomIncrement = Math.max(10, Math.floor(score / 2));
    state.division_freedom_score = Math.min(100, state.division_freedom_score + freedomIncrement);

    const allowedDivisions =
      state.division_freedom_score >= 80
        ? ['INFANTRY', 'INTEL', 'LOGISTICS', 'CYBER']
        : state.division_freedom_score >= 60
          ? ['INFANTRY', 'INTEL', 'LOGISTICS']
          : state.division_freedom_score >= 40
            ? ['INFANTRY', 'LOGISTICS']
            : ['INFANTRY'];

    const divisionRoleUnlocks =
      state.division_freedom_score >= 80
        ? ['Division Commander Track', 'Joint Task Force Chief', 'Strategic Operations Staff']
        : state.division_freedom_score >= 60
          ? ['Brigade Operations Officer', 'Division Staff Planner']
          : ['Company Ops Lead'];

    state.preferred_division = preferredDivision && allowedDivisions.includes(preferredDivision) ? preferredDivision : allowedDivisions[0];

    const grade: 'A' | 'B' | 'C' | 'D' = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : 'D';
    const freedomLevel: 'LIMITED' | 'STANDARD' | 'ADVANCED' | 'ELITE' =
      state.division_freedom_score >= 80
        ? 'ELITE'
        : state.division_freedom_score >= 60
          ? 'ADVANCED'
          : state.division_freedom_score >= 40
            ? 'STANDARD'
            : 'LIMITED';

    const certificate = {
      id: `${state.profile_id}-${Date.now()}-${tier}`,
      tier,
      academyName: tier === 2 ? 'Grand Staff Military Academy' : 'Officer Foundation Military Academy',
      score,
      grade,
      divisionFreedomLevel: freedomLevel,
      trainerName: tier === 2 ? 'Lt. Gen. Arman Wibisono' : 'Col. Andi Pratama',
      issuedAtDay: state.current_day,
      message: 'Congratulations on your successful completion of the academy assessment phase.',
      assignedDivision: state.preferred_division ?? "INFANTRY"
    };

    const existing = Array.isArray(state.certificate_inventory) ? state.certificate_inventory : [];
    state.certificate_inventory = [certificate, ...existing].slice(0, 20);

    const snapshot = buildSnapshot(state, nowMs);
    const actionPayload: ActionResult = {
      type: 'MILITARY_ACADEMY',
      snapshot,
      details: {
        passed: true,
        certificate,
        academyTier: state.academy_tier,
        fee,
        moraleBoost,
        healthBoost,
        pointsBoost,
        divisionFreedomScore: state.division_freedom_score,
        allowedDivisions,
        assessmentMode: hasInteractiveAnswers ? 'INTERACTIVE' : 'LEGACY_COMPAT',
        certificateBenefits: {
          divisionRoleUnlocks,
          promotionChanceBonusPercent: tier === 2 ? 12 : 7
        }
      }
    };

    return { payload: actionPayload };
  });
}

export async function runTravel(
  request: FastifyRequest,
  reply: FastifyReply,
  place: 'BASE_HQ' | 'BORDER_OUTPOST' | 'LOGISTICS_HUB' | 'TACTICAL_TOWN'
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const pendingError = ensureNoPendingDecision(state);
    if (pendingError) {
      return { statusCode: 409, payload: { error: pendingError, snapshot: buildSnapshot(state, nowMs) } };
    }

    const effects = {
      BASE_HQ: { cost: 300, morale: 2, health: 1, points: 1 },
      BORDER_OUTPOST: { cost: 800, morale: 1, health: -1, points: 3 },
      LOGISTICS_HUB: { cost: 450, morale: 1, health: 0, points: 2 },
      TACTICAL_TOWN: { cost: 650, morale: 3, health: 1, points: 2 }
    }[place];

    state.money_cents = Math.max(0, state.money_cents - effects.cost);
    state.morale = Math.max(0, Math.min(100, state.morale + effects.morale));
    state.health = Math.max(0, Math.min(100, state.health + effects.health));
    state.promotion_points += effects.points;
    state.last_travel_place = place;
    advanceGameDays(state, 1);

    const snapshot = buildSnapshot(state, nowMs);
    const payload: ActionResult = {
      type: 'TRAVEL',
      snapshot,
      details: {
        place,
        travelCost: effects.cost,
        moraleDelta: effects.morale,
        healthDelta: effects.health,
        promotionPointDelta: effects.points,
        etaDays: 1
      }
    };

    return { payload };
  });
}

export async function chooseDecision(
  request: FastifyRequest,
  reply: FastifyReply,
  eventId: number,
  optionId: string
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs, client, profileId }) => {
    if (!state.pending_event_id || state.pending_event_id !== eventId) {
      return {
        payload: {
          result: null,
          conflict: true,
          reason: state.pending_event_id ? 'Pending decision changed on server' : 'No pending decision available',
          snapshot: buildSnapshot(state, nowMs)
        }
      };
    }

    const event = await getEventById(client, eventId);
    if (!event) {
      return { statusCode: 404, payload: { error: 'Event not found' } };
    }

    const selected = event.options.find((option: DbEventOption) => option.id === optionId);
    if (!selected) {
      return { statusCode: 400, payload: { error: 'Invalid option selected' } };
    }

    const before = snapshotStateForLog(state);
    const applied = applyDecisionEffects(state, selected.effects ?? {});
    const promoted = tryPromotion(state);

    state.pending_event_id = null;
    state.pending_event_payload = null;
    scheduleNextEventDay(state);

    resumeState(state, nowMs);
    synchronizeProgress(state, nowMs);

    const after = snapshotStateForLog(state);

    await insertDecisionLog(client, {
      profileId,
      eventId,
      gameDay: state.current_day,
      selectedOption: optionId,
      consequences: applied,
      stateBefore: before,
      stateAfter: after
    });

    const decisionResult: DecisionResult = {
      applied,
      promoted,
      newRankCode: BRANCH_CONFIG[state.branch].ranks[state.rank_index] ?? 'UNKNOWN'
    };

    return {
      payload: {
        result: decisionResult,
        snapshot: buildSnapshot(state, nowMs)
      }
    };
  });
}



export async function runCommandAction(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { action: 'PLAN_MISSION' | 'ISSUE_SANCTION' | 'ISSUE_PROMOTION'; targetNpcId?: string; note?: string }
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const pendingError = ensureNoPendingDecision(state);
    if (pendingError) {
      return { statusCode: 409, payload: { error: pendingError, snapshot: buildSnapshot(state, nowMs) } };
    }

    const canAccessCommand = hasCommandAccess(state);
    if (!canAccessCommand) {
      const currentRank = BRANCH_CONFIG[state.branch].ranks[state.rank_index] ?? 'UNKNOWN';
      return {
        statusCode: 403,
        payload: {
          error: `Command access requires Captain/Kapten rank or higher. Current rank: ${currentRank}` ,
          snapshot: buildSnapshot(state, nowMs)
        }
      };
    }

    const { action, targetNpcId, note } = payload;
    const normalizedNote = note?.trim() ?? '';

    if (action === 'PLAN_MISSION') {
      state.promotion_points += 4;
      state.morale = Math.min(100, state.morale + 1);
      state.next_event_day = Math.max(state.current_day + 2, state.next_event_day);
    }

    if (action === 'ISSUE_SANCTION') {
      state.morale = Math.max(0, state.morale - 1);
      state.promotion_points += 2;
    }

    if (action === 'ISSUE_PROMOTION') {
      state.morale = Math.min(100, state.morale + 2);
      state.promotion_points += 5;
    }

    const snapshot = buildSnapshot(state, nowMs);
    const result: ActionResult = {
      type: 'COMMAND',
      snapshot,
      details: {
        action,
        targetNpcId: targetNpcId ?? null,
        note: normalizedNote,
        commandAccess: true,
        issuedByRank: snapshot.rankCode,
        effect: {
          morale: snapshot.morale,
          promotionPoints: state.promotion_points,
          nextEventDay: state.next_event_day
        }
      }
    };

    return { payload: result };
  });
}

export async function restartWorldFromZero(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs, client, profileId }) => {
    state.server_reference_time_ms = nowMs;
    state.current_day = 0;
    state.paused_at_ms = null;
    state.pause_reason = null;
    state.pause_token = null;
    state.pause_expires_at_ms = null;
    state.rank_index = 0;
    state.money_cents = 0;
    state.morale = 70;
    state.health = 80;
    state.promotion_points = 0;
    state.days_in_rank = 0;
    state.next_event_day = 3;
    state.last_mission_day = -10;
    state.academy_tier = 0;
    state.last_travel_place = null;
    state.certificate_inventory = [];
    state.division_freedom_score = 0;
    state.preferred_division = null;
    state.pending_event_id = null;
    state.pending_event_payload = null;

    await client.query('DELETE FROM decision_logs WHERE profile_id = $1', [profileId]);

    return {
      payload: {
        ok: true,
        snapshot: buildSnapshot(state, nowMs)
      }
    };
  });
}


function npcHash(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 9973;
  }
  return hash;
}

export async function runSocialInteraction(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { npcId: string; interaction: 'MENTOR' | 'SUPPORT' | 'BOND' | 'DEBRIEF'; note?: string }
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const pendingError = ensureNoPendingDecision(state);
    if (pendingError) {
      return { statusCode: 409, payload: { error: pendingError, snapshot: buildSnapshot(state, nowMs) } };
    }

    const { npcId, interaction, note } = payload;
    const seed = npcHash(npcId) + state.current_day * 7 + state.rank_index * 13;
    const variance = (seed % 5) - 2;
    const readinessFactor = Math.round((state.morale + state.health) / 40);

    const baseline = {
      MENTOR: { morale: 3, health: 0, points: 3, money: -120 },
      SUPPORT: { morale: 2, health: 1, points: 2, money: -80 },
      BOND: { morale: 4, health: 0, points: 1, money: -160 },
      DEBRIEF: { morale: 1, health: 0, points: 4, money: -60 }
    }[interaction];

    const moraleDelta = Math.max(-3, Math.min(7, baseline.morale + Math.floor(variance / 2) + (readinessFactor > 4 ? 1 : 0)));
    const healthDelta = Math.max(-2, Math.min(3, baseline.health + (seed % 3 === 0 ? 1 : 0)));
    const pointsDelta = Math.max(1, baseline.points + (seed % 4 === 0 ? 1 : 0) + (readinessFactor >= 5 ? 1 : 0));
    const moneyDelta = baseline.money + (interaction === 'DEBRIEF' ? 20 : 0);

    state.morale = Math.max(0, Math.min(100, state.morale + moraleDelta));
    state.health = Math.max(0, Math.min(100, state.health + healthDelta));
    state.promotion_points = Math.max(0, state.promotion_points + pointsDelta);
    state.money_cents = Math.max(0, state.money_cents + moneyDelta);

    const snapshot = buildSnapshot(state, nowMs);
    const result: ActionResult = {
      type: 'SOCIAL_INTERACTION',
      snapshot,
      details: {
        npcId,
        interaction,
        note: note?.trim() ?? null,
        effect: {
          moraleDelta,
          healthDelta,
          promotionPointsDelta: pointsDelta,
          moneyDelta
        },
        summary: `${interaction} completed with ${npcId}. Team cohesion and readiness updated.`
      }
    };

    return { payload: result };
  });
}

export async function getDecisionLogs(
  request: FastifyRequest,
  reply: FastifyReply,
  query: { cursor?: number; limit: number }
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ client, profileId }) => {
    const logs = await listDecisionLogs(client, profileId, query.cursor, query.limit);
    const nextCursor = logs.length === query.limit ? logs[logs.length - 1].id : null;

    return {
      payload: {
        items: logs,
        nextCursor
      }
    };
  });
}

export async function getGameConfig(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async () => {
    return {
      payload: {
        branches: BRANCH_CONFIG,
        generatedAt: Date.now()
      }
    };
  });
}

export async function getCeremonyReport(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state }) => {
    return { payload: { ceremony: buildCeremonyReport(state) } };
  });
}

export async function getCurrentSnapshotForSubPage(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withLockedState(
    request,
    reply,
    { queueEvents: false },
    async ({ state, nowMs }) => ({ payload: { snapshot: buildSnapshot(state, nowMs) } })
  );
}

export async function getNpcBackgroundActivity(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const snapshot = buildSnapshot(state, nowMs);
    const activity = Array.from({ length: 18 }, (_, i) => {
      const cycleSeed = snapshot.gameDay * 37 + i * 11 + snapshot.age + snapshot.morale;
      const op = ['training', 'deployment', 'career-review', 'resupply', 'medical', 'intel'][cycleSeed % 6];
      const impact = ['morale+', 'health+', 'funds+', 'promotion+', 'coordination+', 'readiness+'][(cycleSeed + 3) % 6];
      return {
        npcId: `npc-${i + 1}`,
        lastTickDay: Math.max(1, snapshot.gameDay - (i % 3)),
        operation: op,
        result: `${op} completed (${impact})`,
        readiness: Math.max(25, Math.min(100, snapshot.health + ((cycleSeed % 19) - 9))),
        morale: Math.max(20, Math.min(100, snapshot.morale + ((cycleSeed % 15) - 7))),
        rankInfluence: Math.max(1, snapshot.rankCode.length + (i % 4)),
        promotionRecommendation: (['STRONG_RECOMMEND', 'RECOMMEND', 'HOLD', 'NOT_RECOMMENDED'] as const)[cycleSeed % 4],
        notificationLetter:
          cycleSeed % 4 === 3
            ? `Administrative Letter: NPC-${i + 1} promotion request postponed due to vacancy constraints.`
            : null
      };
    });

    return { payload: { generatedAt: nowMs, items: activity } };
  });
}
