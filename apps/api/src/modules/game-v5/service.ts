import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MissionInstanceV5, NpcRuntimeStatus } from '@mls/shared/game-types';
import { attachAuth } from '../auth/service.js';
import { mergeDeltas, runSchedulerTick, runWorldTick } from './engine.js';
import {
  buildSnapshotV5,
  clearV5World,
  completeAcademyEnrollment,
  completeCeremonyCycle,
  ensureV5World,
  getCurrentCeremony,
  getLatestMission,
  getNpcRuntimeById,
  getProfileBaseByUserId,
  insertAcademyEnrollment,
  insertMissionPlan,
  listCertifications,
  listCurrentNpcRuntime,
  listRecentLifecycleEvents,
  listWorldDeltasSince,
  lockCurrentNpcsForUpdate,
  lockV5World,
  queueNpcReplacement,
  resolveMission,
  setSessionActiveUntil,
  updateNpcRuntimeState,
  updateWorldCore,
  upsertCertification
} from './repo.js';

interface V5Context {
  client: import('pg').PoolClient;
  profileId: string;
  userId: string;
  nowMs: number;
}

async function withV5Context(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: (ctx: V5Context) => Promise<{ statusCode?: number; payload: unknown }>
): Promise<void> {
  await attachAuth(request);
  if (!request.auth?.userId) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  const client = await request.server.db.connect();
  try {
    await client.query('BEGIN');
    const profile = await getProfileBaseByUserId(client, request.auth.userId);
    if (!profile) {
      await client.query('ROLLBACK');
      reply.code(404).send({ error: 'Profile not found' });
      return;
    }

    const nowMs = Date.now();
    await ensureV5World(client, profile, nowMs);

    const result = await handler({
      client,
      profileId: profile.profileId,
      userId: request.auth.userId,
      nowMs
    });

    await client.query('COMMIT');
    reply.code(result.statusCode ?? 200).send(result.payload);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function gradeFromScore(score: number): 'A' | 'B' | 'C' | 'D' {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  return 'D';
}

function certTierFromCode(code: string): 1 | 2 | 3 {
  const normalized = code.toUpperCase();
  if (normalized.includes('ELITE') || normalized.includes('STRATEGIC')) return 3;
  if (normalized.includes('HIGH') || normalized.includes('COMMAND') || normalized.includes('CYBER') || normalized.includes('TRIBUNAL')) return 2;
  return 1;
}

export async function startSessionV5(request: FastifyRequest, reply: FastifyReply, payload: { resetWorld?: boolean }): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, userId, nowMs }) => {
    if (payload.resetWorld) {
      await clearV5World(client, profileId);
      const profile = await getProfileBaseByUserId(client, userId);
      if (!profile) {
        return { statusCode: 404, payload: { error: 'Profile not found' } };
      }
      await ensureV5World(client, profile, nowMs);
    }

    await setSessionActiveUntil(client, profileId, nowMs, 30_000);
    await runWorldTick(client, profileId, nowMs, { maxNpcOps: 80 });
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);

    return {
      payload: {
        started: true,
        resetApplied: Boolean(payload.resetWorld),
        snapshot
      }
    };
  });
}

export async function heartbeatSessionV5(request: FastifyRequest, reply: FastifyReply, payload: { sessionTtlMs?: number }): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    await setSessionActiveUntil(client, profileId, nowMs, payload.sessionTtlMs ?? 30_000);
    await runWorldTick(client, profileId, nowMs, { maxNpcOps: 120 });
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { ok: true, snapshot } };
  });
}

export async function syncSessionV5(request: FastifyRequest, reply: FastifyReply, sinceVersion?: number): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    await setSessionActiveUntil(client, profileId, nowMs, 30_000);
    const tickResult = await runWorldTick(client, profileId, nowMs, { maxNpcOps: 160 });
    const snapshot = tickResult.snapshot ?? (await buildSnapshotV5(client, profileId, nowMs));

    if (!snapshot) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    if (!sinceVersion || sinceVersion <= 0 || sinceVersion > snapshot.stateVersion) {
      return {
        payload: {
          fullSync: true,
          snapshot,
          delta: null
        }
      };
    }

    const deltas = await listWorldDeltasSince(client, profileId, sinceVersion);
    const merged = mergeDeltas(sinceVersion, deltas);
    if (!merged) {
      return {
        payload: {
          fullSync: false,
          snapshot,
          delta: null
        }
      };
    }

    const farBehind = snapshot.stateVersion - sinceVersion > 100;
    if (farBehind || deltas.length >= 70) {
      return {
        payload: {
          fullSync: true,
          snapshot,
          delta: null
        }
      };
    }

    return {
      payload: {
        fullSync: false,
        snapshot,
        delta: merged
      }
    };
  });
}

export async function listNpcsV5(
  request: FastifyRequest,
  reply: FastifyReply,
  query: { status?: NpcRuntimeStatus; cursor?: number; limit?: number }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId }) => {
    const roster = await listCurrentNpcRuntime(client, profileId, query);
    return {
      payload: {
        items: roster.items,
        nextCursor: roster.nextCursor
      }
    };
  });
}

export async function getNpcDetailV5(request: FastifyRequest, reply: FastifyReply, npcId: string): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId }) => {
    const npc = await getNpcRuntimeById(client, profileId, npcId);
    if (!npc) {
      return { statusCode: 404, payload: { error: 'NPC not found' } };
    }

    const events = await listRecentLifecycleEvents(client, profileId, 30);
    const certifications = await listCertifications(client, profileId, { holderType: 'NPC', npcId });

    return {
      payload: {
        npc,
        lifecycleEvents: events.filter((item) => item.npcId === npcId),
        certifications
      }
    };
  });
}

export async function planMissionV5(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: {
    missionType: MissionInstanceV5['missionType'];
    dangerTier: MissionInstanceV5['dangerTier'];
    strategy: string;
    objective: string;
    prepChecklist: string[];
    participantNpcIds: string[];
  }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const latest = await getLatestMission(client, profileId);
    if (latest && latest.status === 'ACTIVE') {
      return { statusCode: 409, payload: { error: 'Active mission already exists', mission: latest } };
    }

    const chainQuality = Math.max(45, Math.min(95, 55 + (payload.strategy.length % 30) + payload.prepChecklist.length * 2));
    const logisticReadiness = Math.max(40, Math.min(95, 50 + (payload.objective.length % 25) + payload.prepChecklist.length * 3));

    const world = await lockV5World(client, profileId);
    const issuedDay = world?.currentDay ?? Math.max(0, Math.floor(nowMs / 1000) % 1000000);

    const mission = await insertMissionPlan(client, {
      profileId,
      missionType: payload.missionType,
      dangerTier: payload.dangerTier,
      issuedDay,
      strategy: payload.strategy,
      objective: payload.objective,
      prepChecklist: payload.prepChecklist,
      chainQuality,
      logisticReadiness,
      participantNpcIds: payload.participantNpcIds
    });

    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { mission, snapshot } };
  });
}

export async function executeMissionV5(request: FastifyRequest, reply: FastifyReply, payload: { missionId: string; playerParticipates?: boolean }): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    const mission = await getLatestMission(client, profileId);
    if (!mission || mission.status !== 'ACTIVE' || mission.missionId !== payload.missionId) {
      return { statusCode: 409, payload: { error: 'Mission not active' } };
    }

    const plan = mission.plan;
    const planQuality = (plan?.chainQuality ?? 55) + (plan?.logisticReadiness ?? 55);
    const dangerPenalty = { LOW: 10, MEDIUM: 20, HIGH: 30, EXTREME: 40 }[mission.dangerTier];
    const playerBonus = payload.playerParticipates ? 8 : 0;
    const successScore = Math.max(1, Math.min(99, planQuality / 2 + playerBonus - dangerPenalty + Math.floor(Math.random() * 20) - 10));
    const success = successScore >= 52;
    const casualties = success ? Math.floor(Math.random() * 2) : Math.floor(Math.random() * 4);

    const execution = {
      success,
      successScore,
      casualties,
      moraleDelta: success ? 6 : -7,
      healthDelta: success ? -2 : -6,
      fundDeltaCents: success ? 13_000 : -7_000
    };

    const resolved = await resolveMission(client, { profileId, missionId: mission.missionId, execution });
    if (!resolved) {
      return { statusCode: 404, payload: { error: 'Mission not found' } };
    }

    let morale = Math.max(0, Math.min(100, world.morale + execution.moraleDelta));
    let health = Math.max(0, Math.min(100, world.health + execution.healthDelta));
    const moneyCents = world.moneyCents + execution.fundDeltaCents;

    if (casualties > 0) {
      const npcRows = await lockCurrentNpcsForUpdate(client, profileId, 80);
      const candidates = npcRows.filter((item) => item.status !== 'KIA').slice(0, casualties);
      for (const npc of candidates) {
        npc.status = 'KIA';
        npc.deathDay = world.currentDay;
        npc.lastTask = 'mission-casualty';
        await updateNpcRuntimeState(client, profileId, npc, world.currentDay);
        await queueNpcReplacement(client, {
          profileId,
          slotNo: npc.slotNo,
          generationNext: npc.generation + 1,
          enqueuedDay: world.currentDay,
          dueDay: world.currentDay + 2 + (npc.slotNo % 5),
          replacedNpcId: npc.npcId
        });
      }
      morale = Math.max(0, morale - casualties * 2);
      health = Math.max(0, health - casualties);
    }

    await updateWorldCore(client, {
      profileId,
      stateVersion: world.stateVersion + 1,
      lastTickMs: nowMs,
      currentDay: world.currentDay,
      moneyCents,
      morale,
      health,
      rankIndex: world.rankIndex,
      assignment: world.assignment,
      commandAuthority: Math.max(0, Math.min(100, world.commandAuthority + (success ? 2 : -2)))
    });

    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { mission: resolved, snapshot } };
  });
}

export async function getCurrentCeremonyV5(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const ceremony = await getCurrentCeremony(client, profileId);
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { ceremony, snapshot } };
  });
}

export async function completeCeremonyV5(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const ceremony = await getCurrentCeremony(client, profileId);
    if (!ceremony || ceremony.status !== 'PENDING') {
      return { statusCode: 409, payload: { error: 'No pending ceremony' } };
    }

    const done = await completeCeremonyCycle(client, profileId, ceremony.cycleId, nowMs);
    const world = await lockV5World(client, profileId);
    if (world) {
      await updateWorldCore(client, {
        profileId,
        stateVersion: world.stateVersion + 1,
        lastTickMs: nowMs,
        currentDay: world.currentDay,
        moneyCents: world.moneyCents + 6_000,
        morale: Math.min(100, world.morale + 8),
        health: Math.min(100, world.health + 2),
        rankIndex: world.rankIndex,
        assignment: world.assignment,
        commandAuthority: Math.min(100, world.commandAuthority + 3)
      });
    }

    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { ceremony: done, snapshot } };
  });
}

export async function enrollAcademyV5(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { enrolleeType: 'PLAYER' | 'NPC'; npcId?: string; track: string; tier: number }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    const enrollmentId = await insertAcademyEnrollment(client, {
      profileId,
      enrolleeType: payload.enrolleeType,
      npcId: payload.npcId ?? null,
      track: payload.track,
      tier: payload.tier,
      startedDay: world.currentDay
    });

    const score = Math.max(0, Math.min(100, 55 + payload.tier * 8 + (payload.track.length % 12) + Math.floor(Math.random() * 25)));
    const passed = score >= 68;

    await completeAcademyEnrollment(client, {
      profileId,
      enrollmentId,
      score,
      passed,
      completedDay: world.currentDay
    });

    if (passed) {
      const certCode = `${payload.track}_T${payload.tier}_CERT`;
      const certTier = certTierFromCode(certCode);
      await upsertCertification(client, {
        profileId,
        certId: `cert-${payload.enrolleeType.toLowerCase()}-${payload.npcId ?? 'player'}-${world.currentDay}-${payload.track.toLowerCase()}`,
        holderType: payload.enrolleeType,
        npcId: payload.enrolleeType === 'NPC' ? payload.npcId ?? null : null,
        certCode,
        track: payload.track,
        tier: certTier,
        grade: gradeFromScore(score),
        issuedDay: world.currentDay,
        expiresDay: world.currentDay + 540,
        valid: true,
        sourceEnrollmentId: enrollmentId
      });
    }

    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { enrollmentId, passed, score, snapshot } };
  });
}

export async function submitCertificationExamV5(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { holderType: 'PLAYER' | 'NPC'; npcId?: string; certCode: string; score: number }
): Promise<void> {
  await withV5Context(request, reply, async ({ client, profileId, nowMs }) => {
    const world = await lockV5World(client, profileId);
    if (!world) {
      return { statusCode: 404, payload: { error: 'World not found' } };
    }

    const tier = certTierFromCode(payload.certCode);
    const grade = gradeFromScore(payload.score);
    const passed = payload.score >= 70;

    await upsertCertification(client, {
      profileId,
      certId: `exam-${payload.holderType.toLowerCase()}-${payload.npcId ?? 'player'}-${payload.certCode.toLowerCase()}-${world.currentDay}`,
      holderType: payload.holderType,
      npcId: payload.holderType === 'NPC' ? payload.npcId ?? null : null,
      certCode: payload.certCode,
      track: payload.certCode.split('_')[0] ?? 'GENERAL',
      tier,
      grade,
      issuedDay: world.currentDay,
      expiresDay: world.currentDay + (tier >= 2 ? 720 : 480),
      valid: passed,
      sourceEnrollmentId: null
    });

    const certifications = await listCertifications(client, profileId, {
      holderType: payload.holderType,
      npcId: payload.holderType === 'NPC' ? payload.npcId : undefined
    });

    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { payload: { passed, grade, certifications, snapshot } };
  });
}

export function registerV5TickScheduler(app: FastifyInstance): void {
  let timer: NodeJS.Timeout | null = null;

  app.addHook('onReady', async () => {
    timer = setInterval(() => {
      const nowMs = Date.now();
      runSchedulerTick(app.db, nowMs).catch((error) => {
        app.log.error({ err: error }, 'v5-scheduler-tick-failed');
      });
    }, 400);
  });

  app.addHook('onClose', async () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });
}

