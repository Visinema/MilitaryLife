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
  applyLegacyGovernanceDelta,
  appendWorldDelta,
  buildSnapshotV5,
  fulfillRecruitmentQueueItem,
  getCurrentCeremony,
  getLatestSocialTimelineEventByType,
  getLegacyGovernanceSnapshot,
  getLatestMission,
  insertMailboxMessage,
  insertLifecycleEvent,
  insertSocialTimelineEvent,
  listActiveWorldProfilesForTick,
  listDueCommandChainOrdersForPenalty,
  listCurrentNpcRuntime,
  listDueRecruitmentQueueForUpdate,
  listRecentLifecycleEvents,
  listRecruitmentQueue,
  lockCurrentNpcsForUpdate,
  lockV5World,
  pruneWorldDeltas,
  queueNpcReplacement,
  upsertCourtCaseV2,
  updateCommandChainOrderStatus,
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

const TASK_POOL = ['training', 'patrol', 'logistics', 'medical-support', 'intel-review', 'academy-drill'] as const;
type NpcTask = (typeof TASK_POOL)[number];

function chooseTaskByUtility(npc: NpcRuntimeState, missionPressure: number, seed: number): NpcTask {
  let selected: NpcTask = 'training';
  let bestScore = -Infinity;

  for (const task of TASK_POOL) {
    const bias = ((seed + task.length * 17 + npc.slotNo * 7) % 13) - 6;
    const fatiguePenalty = npc.fatigue * 0.45;
    const traumaPenalty = npc.trauma * 0.32;
    let utility = 0;

    if (task === 'training') {
      utility = npc.competence * 0.62 + npc.intelligence * 0.3 - fatiguePenalty * 0.35 + bias;
    } else if (task === 'patrol') {
      utility = npc.loyalty * 0.54 + npc.leadership * 0.36 + missionPressure * 6 - traumaPenalty * 0.2 + bias;
    } else if (task === 'logistics') {
      utility = npc.support * 0.58 + npc.competence * 0.34 + missionPressure * 3 - fatiguePenalty * 0.22 + bias;
    } else if (task === 'medical-support') {
      utility = npc.support * 0.48 + npc.resilience * 0.35 + npc.loyalty * 0.2 - traumaPenalty * 0.12 + bias;
    } else if (task === 'intel-review') {
      utility = npc.intelligence * 0.7 + npc.competence * 0.32 - fatiguePenalty * 0.18 + bias;
    } else {
      utility = npc.leadership * 0.44 + npc.intelligence * 0.32 + npc.competence * 0.2 - fatiguePenalty * 0.28 + bias;
    }

    const riskPenalty = npc.betrayalRisk * 0.22 + npc.integrityRisk * 0.18;
    utility -= riskPenalty * (task === 'logistics' ? 0.35 : 0.2);

    if (utility > bestScore) {
      bestScore = utility;
      selected = task;
    }
  }

  return selected;
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

function computeRaiderCadenceDays(threatScore: number): number {
  if (threatScore >= 75) return 7;
  if (threatScore >= 50) return 9;
  return 11;
}

function computeRaiderThreatScore(input: {
  nationalStability: number;
  militaryStability: number;
  corruptionRisk: number;
  averageIntegrityRisk: number;
  averageBetrayalRisk: number;
}): number {
  const instability = ((100 - input.nationalStability) + (100 - input.militaryStability)) / 2;
  return clamp(
    Math.round(
      instability * 0.32 +
        input.corruptionRisk * 0.34 +
        input.averageIntegrityRisk * 0.16 +
        input.averageBetrayalRisk * 0.18
    ),
    0,
    100
  );
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
  let governanceNationalDelta = 0;
  let governanceMilitaryDelta = 0;
  let governanceFundDeltaCents = 0;
  let governanceCorruptionDelta = 0;

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
    const task = chooseTaskByUtility(npc, activeMissionPressure, seed + currentDay + npc.slotNo);
    const fatigueGain = 2 + (seed % 4) + activeMissionPressure + Math.max(0, noise);
    const xpGain = 1 + (seed % 3) + (task === 'training' ? 1 : 0);
    const promotionGain = 1 + Math.floor((npc.leadership + npc.resilience + (seed % 20)) / 70);

    npc.lastTask = task;
    npc.xp += xpGain;
    npc.promotionPoints += promotionGain;
    npc.competence = clamp(
      npc.competence + (task === 'training' ? 2 : task === 'intel-review' ? 1 : 0) - (npc.fatigue >= 86 ? 1 : 0),
      0,
      100
    );
    npc.intelligence = clamp(
      npc.intelligence + (task === 'intel-review' ? 2 : task === 'academy-drill' ? 1 : 0) - (npc.trauma >= 80 ? 1 : 0),
      0,
      100
    );
    npc.loyalty = clamp(
      npc.loyalty + (task === 'patrol' || task === 'medical-support' ? 1 : 0) - (activeMissionPressure >= 4 ? 1 : 0),
      0,
      100
    );
    npc.fatigue = clamp(npc.fatigue + fatigueGain - (npc.status === 'RESERVE' ? 4 : 0), 0, 100);
    npc.trauma = clamp(npc.trauma + (npc.fatigue > 80 ? 2 : 0) + Math.max(0, Math.floor(noise / 3)), 0, 100);
    npc.relationToPlayer = clamp(npc.relationToPlayer + (task.includes('support') ? 1 : 0), 0, 100);
    const integrityPressure =
      (100 - npc.loyalty) * 0.12 +
      npc.trauma * 0.08 +
      npc.fatigue * 0.06 +
      (task === 'logistics' ? 2 : 0) +
      activeMissionPressure * 0.7;
    npc.integrityRisk = clamp(Math.round(npc.integrityRisk + integrityPressure - npc.competence * 0.035), 0, 100);
    const betrayalPressure =
      npc.integrityRisk * 0.18 +
      (100 - npc.loyalty) * 0.22 +
      npc.trauma * 0.09 +
      (task === 'patrol' ? -1 : 1);
    npc.betrayalRisk = clamp(Math.round(npc.betrayalRisk + betrayalPressure - npc.intelligence * 0.03), 0, 100);
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

    if (npc.betrayalRisk >= 85 || npc.integrityRisk >= 88) {
      const caseId = `risk-${profileId.slice(0, 8)}-${npc.npcId}-${currentDay}`;
      const caseType = npc.betrayalRisk >= 92 ? 'DEMOTION' : 'SANCTION';
      await upsertCourtCaseV2(client, {
        profileId,
        caseId,
        caseType,
        targetType: 'NPC',
        targetNpcId: npc.npcId,
        requestedDay: currentDay,
        status: 'PENDING',
        verdict: null,
        decisionDay: null,
        details: {
          source: 'NPC_RISK_MODEL',
          betrayalRisk: npc.betrayalRisk,
          integrityRisk: npc.integrityRisk,
          task
        }
      });
      await insertMailboxMessage(client, {
        messageId: `mail-risk-${profileId.slice(0, 8)}-${npc.npcId}-${currentDay}`,
        profileId,
        senderType: 'SYSTEM',
        senderNpcId: null,
        subject: `Investigasi Internal: ${npc.name}`,
        body: `Risk threshold terlampaui (integrity=${npc.integrityRisk}, betrayal=${npc.betrayalRisk}). Case ${caseId} dibuka.`,
        category: 'SANCTION',
        relatedRef: caseId,
        createdDay: currentDay
      });
      await insertSocialTimelineEvent(client, {
        profileId,
        actorType: 'NPC',
        actorNpcId: npc.npcId,
        eventType: 'RISK_THRESHOLD_TRIGGERED',
        title: `Risk Trigger ${npc.name}`,
        detail: `Integrity/Betrayal melewati ambang. Court case ${caseId} dibuat.`,
        eventDay: currentDay,
        meta: {
          caseId,
          integrityRisk: npc.integrityRisk,
          betrayalRisk: npc.betrayalRisk
        }
      });
      governanceMilitaryDelta -= npc.betrayalRisk >= 92 ? 2 : 1;
      governanceCorruptionDelta += npc.integrityRisk >= 92 ? 2 : 1;
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

  const dueCommandOrders = await listDueCommandChainOrdersForPenalty(client, profileId, currentDay, 20);
  if (dueCommandOrders.length > 0) {
    for (const order of dueCommandOrders) {
      const priorityPenalty = order.priority === 'HIGH' ? 5 : order.priority === 'MEDIUM' ? 3 : 2;
      morale = clamp(morale - priorityPenalty, 0, 100);
      commandAuthority = clamp(commandAuthority - (priorityPenalty + 1), 0, 100);
      governanceMilitaryDelta -= priorityPenalty >= 5 ? 3 : 2;
      governanceNationalDelta -= 1;
      governanceCorruptionDelta += 1;
      await updateCommandChainOrderStatus(client, {
        profileId,
        orderId: order.orderId,
        status: 'BREACHED',
        completedDay: currentDay,
        penaltyApplied: true
      });

      await insertMailboxMessage(client, {
        messageId: `mail-chain-break-${order.orderId}-${currentDay}`,
        profileId,
        senderType: 'SYSTEM',
        senderNpcId: null,
        subject: `Chain Break: ${order.orderId}`,
        body: `Order command-chain melewati due day (${order.ackDueDay}) dan dikenakan penalty command.`,
        category: 'SANCTION',
        relatedRef: order.orderId,
        createdDay: currentDay
      });
      await insertSocialTimelineEvent(client, {
        profileId,
        actorType: 'PLAYER',
        actorNpcId: null,
        eventType: 'COMMAND_CHAIN_BREAK',
        title: 'Command Chain Break',
        detail: `Order ${order.orderId} breached. Penalty morale/authority diterapkan.`,
        eventDay: currentDay,
        meta: {
          orderId: order.orderId,
          priority: order.priority,
          ackDueDay: order.ackDueDay
        }
      });

      if (order.targetNpcId) {
        const caseId = `chain-break-${profileId.slice(0, 8)}-${order.targetNpcId}-${currentDay}`;
        await upsertCourtCaseV2(client, {
          profileId,
          caseId,
          caseType: 'SANCTION',
          targetType: 'NPC',
          targetNpcId: order.targetNpcId,
          requestedDay: currentDay,
          status: 'PENDING',
          verdict: null,
          decisionDay: null,
          details: {
            source: 'COMMAND_CHAIN_BREAK',
            orderId: order.orderId,
            dueDay: order.ackDueDay
          }
        });
      }
    }
  }

  const activeOrReserveNpcs = npcs.filter((item) => item.status !== 'KIA');
  const averageIntegrityRisk =
    activeOrReserveNpcs.length === 0
      ? 0
      : activeOrReserveNpcs.reduce((sum, npc) => sum + npc.integrityRisk, 0) / activeOrReserveNpcs.length;
  const averageBetrayalRisk =
    activeOrReserveNpcs.length === 0
      ? 0
      : activeOrReserveNpcs.reduce((sum, npc) => sum + npc.betrayalRisk, 0) / activeOrReserveNpcs.length;

  const governance = await getLegacyGovernanceSnapshot(client, profileId);
  const raiderThreatScore = computeRaiderThreatScore({
    nationalStability: governance.nationalStability,
    militaryStability: governance.militaryStability,
    corruptionRisk: governance.corruptionRisk,
    averageIntegrityRisk,
    averageBetrayalRisk
  });
  const raiderCadenceDays = computeRaiderCadenceDays(raiderThreatScore);
  const latestRaiderAttack = await getLatestSocialTimelineEventByType(client, profileId, 'RAIDER_ATTACK');
  const nextRaiderAttackDay =
    latestRaiderAttack && latestRaiderAttack.eventDay >= 0
      ? latestRaiderAttack.eventDay + raiderCadenceDays
      : currentDay + 3;

  if (currentDay >= nextRaiderAttackDay && activeOrReserveNpcs.length > 0) {
    const casualtyTarget =
      raiderThreatScore >= 82
        ? Math.min(4, 2 + Math.floor(Math.random() * 3))
        : raiderThreatScore >= 65
          ? Math.min(3, 1 + Math.floor(Math.random() * 2))
          : Math.min(2, 1 + Math.floor(Math.random() * 2));
    const casualtyCandidates = [...activeOrReserveNpcs]
      .sort((a, b) => {
        const scoreA = a.fatigue * 0.55 + a.trauma * 0.35 + (100 - a.resilience) * 0.1;
        const scoreB = b.fatigue * 0.55 + b.trauma * 0.35 + (100 - b.resilience) * 0.1;
        return scoreB - scoreA;
      })
      .slice(0, casualtyTarget);

    const casualtyMeta: Array<{ npcId: string; name: string; slotNo: number; dueDay: number }> = [];
    for (const npc of casualtyCandidates) {
      npc.status = 'KIA';
      npc.deathDay = currentDay;
      npc.lastTask = 'raider-casualty';
      await updateNpcRuntimeState(client, profileId, npc, currentDay);
      changedNpcIds.add(npc.npcId);
      changedNpcStates.push({ ...npc, updatedAtMs: nowMs });

      await insertLifecycleEvent(client, {
        profileId,
        npcId: npc.npcId,
        eventType: 'KIA',
        day: currentDay,
        details: {
          source: 'RAIDER_ATTACK',
          threatScore: raiderThreatScore
        }
      });

      const dueDay = currentDay + 2 + (npc.slotNo % 5);
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
        details: {
          source: 'RAIDER_ATTACK',
          dueDay,
          generationNext: npc.generation + 1
        }
      });
      casualtyMeta.push({
        npcId: npc.npcId,
        name: npc.name,
        slotNo: npc.slotNo,
        dueDay
      });
    }

    const casualtyCount = casualtyMeta.length;
    morale = clamp(morale - (2 + casualtyCount * 2 + (raiderThreatScore >= 75 ? 2 : 0)), 0, 100);
    health = clamp(health - (1 + casualtyCount), 0, 100);
    commandAuthority = clamp(commandAuthority - (2 + casualtyCount), 0, 100);

    governanceNationalDelta -= 1 + Math.floor(casualtyCount / 2);
    governanceMilitaryDelta -= 2 + casualtyCount;
    governanceFundDeltaCents -= casualtyCount * (raiderThreatScore >= 75 ? 4_500 : 3_000);
    governanceCorruptionDelta += raiderThreatScore >= 75 ? 2 : 1;

    const attackSeverity = raiderThreatScore >= 75 ? 'HIGH' : raiderThreatScore >= 50 ? 'MEDIUM' : 'LOW';
    await insertMailboxMessage(client, {
      messageId: `mail-raider-${profileId.slice(0, 8)}-${currentDay}`,
      profileId,
      senderType: 'SYSTEM',
      senderNpcId: null,
      subject: `Peringatan Raider (${attackSeverity})`,
      body: `Serangan raider day ${currentDay}. Casualty: ${casualtyCount}. Replacement queue aktif.`,
      category: 'SANCTION',
      relatedRef: `raider-${currentDay}`,
      createdDay: currentDay
    });
    await insertSocialTimelineEvent(client, {
      profileId,
      actorType: 'PLAYER',
      actorNpcId: null,
      eventType: 'RAIDER_ATTACK',
      title: `Raider Attack ${attackSeverity}`,
      detail: `Serangan raider dengan ${casualtyCount} casualty. Next cadence ${raiderCadenceDays} hari.`,
      eventDay: currentDay,
      meta: {
        severity: attackSeverity,
        threatScore: raiderThreatScore,
        cadenceDays: raiderCadenceDays,
        casualties: casualtyMeta,
        nextAttackDay: currentDay + raiderCadenceDays
      }
    });
  }

  if (averageBetrayalRisk >= 70) {
    governanceMilitaryDelta -= 1;
    governanceCorruptionDelta += 1;
  } else if (averageBetrayalRisk <= 35 && averageIntegrityRisk <= 35) {
    governanceNationalDelta += 1;
    governanceMilitaryDelta += 1;
    governanceCorruptionDelta -= 1;
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

  if (
    governanceNationalDelta !== 0 ||
    governanceMilitaryDelta !== 0 ||
    governanceFundDeltaCents !== 0 ||
    governanceCorruptionDelta !== 0
  ) {
    await applyLegacyGovernanceDelta(client, {
      profileId,
      nationalDelta: governanceNationalDelta,
      militaryDelta: governanceMilitaryDelta,
      fundDeltaCents: governanceFundDeltaCents,
      corruptionDelta: governanceCorruptionDelta
    });
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

