import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import type { ActionResult, DecisionResult } from '@mls/shared/game-types';
import { BRANCH_CONFIG } from './branch-config.js';
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

function captureStateSignature(state: DbGameStateRow): string {
  return JSON.stringify([
    state.active_session_id,
    state.server_reference_time_ms,
    state.current_day,
    state.paused_at_ms,
    state.pause_reason,
    state.pause_token,
    state.pause_expires_at_ms,
    state.rank_index,
    state.money_cents,
    state.morale,
    state.health,
    state.promotion_points,
    state.days_in_rank,
    state.next_event_day,
    state.last_mission_day,
    state.pending_event_id,
    state.pending_event_payload
  ]);
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
    const initialStateSignature = captureStateSignature(state);
    autoResumeIfExpired(state, nowMs);
    synchronizeProgress(state, nowMs);

    if (options.queueEvents) {
      await maybeQueueDecisionEvent(client, state, nowMs, request.server.env.PAUSE_TIMEOUT_MINUTES);
    }

    const result = await execute({ client, state, nowMs, profileId });

    if (captureStateSignature(state) !== initialStateSignature) {
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
