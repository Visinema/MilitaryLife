import type { Pool, PoolClient } from 'pg';
import type {
  CeremonyCycleV5,
  MissionInstanceV5,
  NpcRuntimeState,
  WorldDelta
} from '@mls/shared/game-types';
import { GAME_MS_PER_DAY } from '@mls/shared/constants';
import { buildNpcRegistry } from '@mls/shared/npc-registry';
import {
  V5_MAX_NPCS,
  appendWorldDelta,
  buildSnapshotV5,
  fulfillRecruitmentQueueItem,
  getCurrentCeremony,
  getLatestMission,
  insertLifecycleEvent,
  listActiveWorldProfilesForTick,
  listCurrentNpcRuntime,
  listDueRecruitmentQueueForUpdate,
  listRecentLifecycleEvents,
  listRecruitmentQueue,
  lockCurrentNpcsForUpdate,
  lockV5World,
  pruneWorldDeltas,
  queueNpcReplacement,
  updateNpcRuntimeState,
  updateWorldCore,
  upsertCeremonyPending
} from './repo.js';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

let adaptiveNpcBudget = Math.min(V5_MAX_NPCS, 120);
let lastSchedulerDurationMs = 0;
let lastTickPressure: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

function clampAdaptiveBudget(value: number): number {
  return Math.max(64, Math.min(V5_MAX_NPCS, Math.round(value)));
}

export function getAdaptiveTickMetrics(): {
  adaptiveBudget: number;
  lastSchedulerDurationMs: number;
  tickPressure: 'LOW' | 'MEDIUM' | 'HIGH';
} {
  return {
    adaptiveBudget: adaptiveNpcBudget,
    lastSchedulerDurationMs,
    tickPressure: lastTickPressure
  };
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function runtimeNoise(maxAbs = 6): number {
  if (Math.random() > 0.15) return 0;
  return Math.floor(Math.random() * (maxAbs * 2 + 1)) - maxAbs;
}

function chooseTask(seed: number): string {
  const tasks = ['training', 'patrol', 'logistics', 'medical-support', 'intel-review', 'academy-drill'];
  return tasks[Math.abs(seed) % tasks.length] ?? 'training';
}

function bumpPosition(current: string, promotionGain: number): string {
  if (promotionGain < 3) return current;
  if (current.includes('Officer')) return current.replace('Officer', 'Senior Officer');
  if (current.includes('Senior')) return current.replace('Senior', 'Lead');
  return `Senior ${current}`;
}

function missionPenaltyFactor(mission: MissionInstanceV5 | null): number {
  if (!mission || mission.status !== 'ACTIVE') return 0;
  if (mission.dangerTier === 'EXTREME') return 6;
  if (mission.dangerTier === 'HIGH') return 4;
  if (mission.dangerTier === 'MEDIUM') return 2;
  return 1;
}

function buildCycleAwards(
  npcs: NpcRuntimeState[],
  ceremonyDay: number
): CeremonyCycleV5['awards'] {
  const ranked = [...npcs]
    .filter((item) => item.status !== 'KIA')
    .sort((a, b) => {
      const scoreA = a.promotionPoints + a.leadership + a.resilience - a.fatigue;
      const scoreB = b.promotionPoints + b.leadership + b.resilience - b.fatigue;
      return scoreB - scoreA;
    })
    .slice(0, 5);

  return ranked.map((npc, idx) => ({
    orderNo: idx + 1,
    npcId: npc.npcId,
    recipientName: npc.name,
    medal: idx === 0 ? 'Star of Command V5' : idx < 3 ? 'Joint Merit Medal V5' : 'Readiness Medal V5',
    ribbon: idx === 0 ? 'Command Ribbon Gold' : 'Command Ribbon Steel',
    reason: `Ceremony Day ${ceremonyDay}: leadership ${npc.leadership}, resilience ${npc.resilience}, fatigue ${npc.fatigue}.`
  }));
}

export async function runWorldTick(
  client: PoolClient,
  profileId: string,
  nowMs: number,
  options?: { maxNpcOps?: number }
): Promise<{ advanced: boolean; delta: WorldDelta | null; snapshot: Awaited<ReturnType<typeof buildSnapshotV5>> }> {
  const world = await lockV5World(client, profileId);
  if (!world) {
    return { advanced: false, delta: null, snapshot: null };
  }

  const elapsedMs = Math.max(0, nowMs - world.lastTickMs);
  const rawDayGain = Math.floor((elapsedMs * world.gameTimeScale) / GAME_MS_PER_DAY);
  const dayGain = Math.min(3, rawDayGain);

  if (dayGain <= 0) {
    const snapshot = await buildSnapshotV5(client, profileId, nowMs);
    return { advanced: false, delta: null, snapshot };
  }

  const currentDay = world.currentDay + dayGain;
  const progressedTickMs = world.lastTickMs + Math.floor((dayGain * GAME_MS_PER_DAY) / world.gameTimeScale);
  const mission = await getLatestMission(client, profileId);
  const activeMissionPressure = missionPenaltyFactor(mission);

  let moneyCents = world.moneyCents;
  let morale = world.morale;
  let health = world.health;
  const rankIndex = world.rankIndex;
  let assignment = world.assignment;
  let commandAuthority = world.commandAuthority;

  moneyCents += dayGain * (1200 + rankIndex * 170);
  morale = clamp(morale - Math.floor(dayGain / 2) + 1 - Math.floor(activeMissionPressure / 2), 0, 100);
  health = clamp(health - Math.floor(dayGain / 3) - Math.floor(activeMissionPressure / 3), 0, 100);
  commandAuthority = clamp(commandAuthority + (morale >= 60 ? 1 : -1) + (health >= 60 ? 1 : 0), 0, 100);

  const npcs = await lockCurrentNpcsForUpdate(client, profileId, Math.min(options?.maxNpcOps ?? V5_MAX_NPCS, V5_MAX_NPCS));
  const changedNpcStates: NpcRuntimeState[] = [];
  const changedNpcIds = new Set<string>();

  for (const npc of npcs) {
    if (npc.status === 'KIA') continue;

    const seed = hashSeed(`${profileId}:${npc.npcId}:${currentDay}`);
    const noise = runtimeNoise(7);
    const task = chooseTask(seed + currentDay + npc.slotNo);
    const fatigueGain = 2 + (seed % 4) + activeMissionPressure + Math.max(0, noise);
    const xpGain = 1 + (seed % 3) + (task === 'training' ? 1 : 0);
    const promotionGain = 1 + Math.floor((npc.leadership + npc.resilience + (seed % 20)) / 70);

    npc.lastTask = task;
    npc.xp += xpGain;
    npc.promotionPoints += promotionGain;
    npc.fatigue = clamp(npc.fatigue + fatigueGain - (npc.status === 'RESERVE' ? 4 : 0), 0, 100);
    npc.trauma = clamp(npc.trauma + (npc.fatigue > 80 ? 2 : 0) + Math.max(0, Math.floor(noise / 3)), 0, 100);
    npc.relationToPlayer = clamp(npc.relationToPlayer + (task.includes('support') ? 1 : 0), 0, 100);
    npc.position = bumpPosition(npc.position, promotionGain);

    const injuryRisk = (npc.fatigue + npc.trauma + activeMissionPressure * 8 + (seed % 35) + noise) / 2;
    const kiaRisk = (npc.fatigue + npc.trauma + activeMissionPressure * 14 + (seed % 50) + noise) / 3;

    if (npc.status !== 'INJURED' && injuryRisk >= 75) {
      npc.status = 'INJURED';
      await insertLifecycleEvent(client, {
        profileId,
        npcId: npc.npcId,
        eventType: 'DISCIPLINARY',
        day: currentDay,
        details: { type: 'INJURY', task }
      });
    } else if (npc.status === 'INJURED' && npc.fatigue <= 45 && npc.trauma <= 35) {
      npc.status = 'ACTIVE';
      await insertLifecycleEvent(client, {
        profileId,
        npcId: npc.npcId,
        eventType: 'ACADEMY_PASS',
        day: currentDay,
        details: { recovered: true }
      });
    }

    const wouldDie = kiaRisk >= 72;
    if (wouldDie) {
      npc.status = 'KIA';
      npc.deathDay = currentDay;
      await insertLifecycleEvent(client, {
        profileId,
        npcId: npc.npcId,
        eventType: 'KIA',
        day: currentDay,
        details: { task, fatigue: npc.fatigue, trauma: npc.trauma }
      });

      const dueDay = currentDay + 2 + ((seed + npc.slotNo) % 6);
      await queueNpcReplacement(client, {
        profileId,
        slotNo: npc.slotNo,
        generationNext: npc.generation + 1,
        enqueuedDay: currentDay,
        dueDay,
        replacedNpcId: npc.npcId
      });
      await insertLifecycleEvent(client, {
        profileId,
        npcId: npc.npcId,
        eventType: 'REPLACEMENT_QUEUED',
        day: currentDay,
        details: { dueDay, generationNext: npc.generation + 1 }
      });
    }

    await updateNpcRuntimeState(client, profileId, npc, currentDay);
    changedNpcIds.add(npc.npcId);
    changedNpcStates.push({ ...npc, updatedAtMs: nowMs });
  }

  const dueQueue = await listDueRecruitmentQueueForUpdate(client, profileId, currentDay, 8);
  if (dueQueue.length > 0) {
    const identityRegistry = buildNpcRegistry(world.branch, V5_MAX_NPCS);
    for (const item of dueQueue) {
      const identity = identityRegistry[item.slotNo - 1];
      const npcId = `npc-${item.slotNo}-g${item.generationNext}`;
      const shortName = (identity?.name ?? `NPC ${item.slotNo}`).replace(/\s+/g, ' ').trim();
      const replacedName = `${shortName} G${item.generationNext}`;

      await fulfillRecruitmentQueueItem(client, {
        profileId,
        queueId: item.id,
        slotNo: item.slotNo,
        generationNext: item.generationNext,
        npcId,
        name: replacedName,
        division: identity?.division ?? 'General Command',
        unit: identity?.unit ?? 'Unit',
        position: identity?.position ?? 'Operations Officer',
        joinedDay: currentDay
      });

      await insertLifecycleEvent(client, {
        profileId,
        npcId,
        eventType: 'REPLACEMENT_JOINED',
        day: currentDay,
        details: { slotNo: item.slotNo, generation: item.generationNext }
      });
      changedNpcIds.add(npcId);
    }
  }

  const cycleDay = currentDay >= 15 ? currentDay - (currentDay % 15) : 0;
  const currentCeremony = await getCurrentCeremony(client, profileId);
  if (cycleDay >= 15 && (!currentCeremony || currentCeremony.ceremonyDay < cycleDay)) {
    const latestNpcList = await listCurrentNpcRuntime(client, profileId, { limit: V5_MAX_NPCS });
    const awards = buildCycleAwards(latestNpcList.items, cycleDay);
    const kiaCount = latestNpcList.items.filter((item) => item.status === 'KIA').length;

    await upsertCeremonyPending(client, {
      profileId,
      cycleId: `cycle-${profileId.slice(0, 8)}-${cycleDay}`,
      ceremonyDay: cycleDay,
      summary: {
        attendance: latestNpcList.items.filter((item) => item.status !== 'KIA').length,
        kiaMemorialCount: kiaCount,
        commandRotationApplied: awards.length > 0
      },
      awards
    });
  }

  if (morale >= 78 && health >= 75 && assignment !== 'Command Rotation HQ') {
    assignment = 'Command Rotation HQ';
  }

  const nextStateVersion = world.stateVersion + 1;
  await updateWorldCore(client, {
    profileId,
    stateVersion: nextStateVersion,
    lastTickMs: progressedTickMs,
    currentDay,
    moneyCents,
    morale,
    health,
    rankIndex,
    assignment,
    commandAuthority
  });

  const updatedMission = await getLatestMission(client, profileId);
  const pendingCeremony = await getCurrentCeremony(client, profileId);
  const queue = await listRecruitmentQueue(client, profileId);
  const recentEvents = await listRecentLifecycleEvents(client, profileId, 15);

  const delta: WorldDelta = {
    fromVersion: world.stateVersion,
    toVersion: nextStateVersion,
    currentDay,
    player: {
      moneyCents,
      morale,
      health,
      rankIndex,
      assignment,
      commandAuthority
    },
    activeNpcCount: changedNpcStates.filter((item) => item.status === 'ACTIVE').length,
    changedNpcIds: Array.from(changedNpcIds),
    changedNpcStates,
    activeMission: updatedMission,
    pendingCeremony: pendingCeremony?.status === 'PENDING' ? pendingCeremony : null,
    recruitmentQueue: queue,
    recentLifecycleEvents: recentEvents
  };

  await appendWorldDelta(client, profileId, nextStateVersion, delta);
  await pruneWorldDeltas(client, profileId, 140);

  const snapshot = await buildSnapshotV5(client, profileId, nowMs);
  return { advanced: true, delta, snapshot };
}

export function mergeDeltas(sinceVersion: number, deltas: WorldDelta[]): WorldDelta | null {
  if (deltas.length === 0) return null;

  const changedMap = new Map<string, NpcRuntimeState>();
  const changedIds = new Set<string>();
  const queueMap = new Map<number, WorldDelta['recruitmentQueue'][number]>();
  const eventMap = new Map<number, WorldDelta['recentLifecycleEvents'][number]>();

  for (const delta of deltas) {
    for (const state of delta.changedNpcStates) changedMap.set(state.npcId, state);
    for (const id of delta.changedNpcIds) changedIds.add(id);
    for (const item of delta.recruitmentQueue) queueMap.set(item.slotNo, item);
    for (const event of delta.recentLifecycleEvents) eventMap.set(event.id, event);
  }

  const first = deltas[0];
  const last = deltas[deltas.length - 1] ?? first;

  return {
    fromVersion: sinceVersion,
    toVersion: last.toVersion,
    currentDay: last.currentDay,
    player: last.player,
    activeNpcCount: last.activeNpcCount,
    changedNpcIds: Array.from(changedIds),
    changedNpcStates: Array.from(changedMap.values()),
    activeMission: last.activeMission,
    pendingCeremony: last.pendingCeremony,
    recruitmentQueue: Array.from(queueMap.values()),
    recentLifecycleEvents: Array.from(eventMap.values())
      .sort((a, b) => b.id - a.id)
      .slice(0, 20)
  };
}

export async function runSchedulerTick(pool: Pool, nowMs: number): Promise<number> {
  const client = await pool.connect();
  let processed = 0;
  const schedulerStart = Date.now();
  try {
    await client.query('BEGIN');
    const profiles = await listActiveWorldProfilesForTick(client, nowMs, 12);
    for (const profileId of profiles) {
      const profileStart = Date.now();
      const result = await runWorldTick(client, profileId, nowMs, { maxNpcOps: adaptiveNpcBudget });
      if (result.advanced) processed += 1;
      const profileDurationMs = Date.now() - profileStart;
      if (profileDurationMs > 145) {
        adaptiveNpcBudget = clampAdaptiveBudget(adaptiveNpcBudget - 10);
      } else if (profileDurationMs < 75) {
        adaptiveNpcBudget = clampAdaptiveBudget(adaptiveNpcBudget + 6);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  lastSchedulerDurationMs = Date.now() - schedulerStart;
  if (lastSchedulerDurationMs >= 220) {
    lastTickPressure = 'HIGH';
    adaptiveNpcBudget = clampAdaptiveBudget(adaptiveNpcBudget - 8);
  } else if (lastSchedulerDurationMs >= 120) {
    lastTickPressure = 'MEDIUM';
  } else {
    lastTickPressure = 'LOW';
    adaptiveNpcBudget = clampAdaptiveBudget(adaptiveNpcBudget + 4);
  }

  return processed;
}

