import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import type {
  CeremonyCycleV5,
  MissionInstanceV5,
  NpcCareerPlanState,
  NpcCareerStage,
  NpcCareerStrategyMode,
  NpcRuntimeState,
  WorldDelta
} from '@mls/shared/game-types';
import { GAME_MS_PER_DAY } from '@mls/shared/constants';
import { buildNpcRegistry } from '@mls/shared/npc-registry';
import { REGISTERED_DIVISIONS } from '@mls/shared/division-registry';
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
  getRecruitmentPipelineApplication,
  insertAssignmentHistory,
  insertRankHistory,
  insertMailboxMessage,
  insertLifecycleEvent,
  insertSocialTimelineEvent,
  listActiveWorldProfilesForTick,
  listDivisionQuotaStates,
  listDueCommandChainOrdersForPenalty,
  listNpcCareerPlans,
  listCurrentNpcRuntime,
  listDueRecruitmentQueueForUpdate,
  listNpcTraitMemoryProfiles,
  listRecentLifecycleEvents,
  listRecruitmentQueue,
  lockCurrentNpcsForUpdate,
  lockV5World,
  pruneWorldDeltas,
  queueNpcReplacement,
  reserveDivisionQuotaSlot,
  updateNpcAssignmentCurrent,
  upsertNpcCareerPlan,
  upsertRecruitmentPipelineApplication,
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

function sanitizePositionTitle(input: string): { base: string; tier: 0 | 1 | 2 } {
  const compact = input.replace(/\s+/g, ' ').trim();
  if (!compact) return { base: 'Operations Officer', tier: 0 };

  const hasLead = /\blead\b/i.test(compact);
  const hasSenior = /\bsenior\b/i.test(compact);
  const base = compact
    .replace(/\blead\b/gi, '')
    .replace(/\bsenior\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Operations Officer';

  if (hasLead) return { base, tier: 2 };
  if (hasSenior) return { base, tier: 1 };
  return { base, tier: 0 };
}

function bumpPosition(current: string, promotionGain: number): string {
  const parsed = sanitizePositionTitle(current);
  let targetTier: 0 | 1 | 2 = parsed.tier;

  if (promotionGain >= 5) {
    targetTier = parsed.tier >= 1 ? 2 : 1;
  } else if (promotionGain >= 3) {
    targetTier = parsed.tier === 0 ? 1 : parsed.tier;
  }

  if (targetTier === 2) return `Lead ${parsed.base}`;
  if (targetTier === 1) return `Senior ${parsed.base}`;
  return parsed.base;
}

function canonicalNpcName(name: string): string {
  const compact = name.replace(/\s+/g, ' ').trim();
  return compact.replace(/\s*\[S\d+\]$/i, '').trim();
}

function deduplicateNpcNames(npcs: NpcRuntimeState[]): Set<string> {
  const byBase = new Map<string, NpcRuntimeState[]>();
  for (const npc of npcs) {
    const base = canonicalNpcName(npc.name);
    const key = base.toLowerCase();
    const rows = byBase.get(key) ?? [];
    rows.push(npc);
    byBase.set(key, rows);
  }

  const changed = new Set<string>();
  for (const rows of byBase.values()) {
    if (rows.length <= 1) continue;
    for (const npc of rows) {
      const base = canonicalNpcName(npc.name);
      const nextName = `${base} [S${npc.slotNo}]`;
      if (npc.name !== nextName) {
        npc.name = nextName;
        changed.add(npc.npcId);
      }
    }
  }

  return changed;
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

const ACADEMY_DAYS_BY_TIER: Record<1 | 2 | 3, number> = {
  1: 4,
  2: 5,
  3: 6
};

function academyDaysForTier(tier: number): number {
  if (tier >= 3) return ACADEMY_DAYS_BY_TIER[3];
  if (tier <= 1) return ACADEMY_DAYS_BY_TIER[1];
  return ACADEMY_DAYS_BY_TIER[2];
}

function strategyTier(mode: NpcCareerStrategyMode): 1 | 2 | 3 {
  if (mode === 'RUSH_T1') return 1;
  if (mode === 'DEEP_T3') return 3;
  return 2;
}

function requirementLabelForDivision(division: string): 'STANDARD' | 'ADVANCED' | 'ELITE' {
  const token = division.toLowerCase();
  if (token.includes('judge') || token.includes('court') || token.includes('cyber') || token.includes('air defense')) {
    return 'ELITE';
  }
  if (token.includes('armored') || token.includes('special') || token.includes('signal')) {
    return 'ADVANCED';
  }
  return 'STANDARD';
}

function minimumAcademyTierForDivision(division: string): 1 | 2 | 3 {
  const requirement = requirementLabelForDivision(division);
  if (requirement === 'ELITE') return 3;
  if (requirement === 'ADVANCED') return 2;
  return 1;
}

type PlannerTraitProfile = {
  ambition: number;
  discipline: number;
  integrity: number;
  sociability: number;
  memory: unknown[];
};

function fallbackTraitProfile(npc: NpcRuntimeState): PlannerTraitProfile {
  return {
    ambition: clamp(Math.round((npc.leadership + npc.intelligence) / 2), 0, 100),
    discipline: clamp(Math.round((npc.resilience + npc.competence) / 2), 0, 100),
    integrity: clamp(Math.round(100 - npc.integrityRisk), 0, 100),
    sociability: clamp(Math.round((npc.relationToPlayer + npc.loyalty) / 2), 0, 100),
    memory: []
  };
}

function chooseStrategyMode(npc: NpcRuntimeState, traits: PlannerTraitProfile): NpcCareerStrategyMode {
  const ambitionPressure = traits.ambition + Math.round((100 - npc.betrayalRisk) * 0.18);
  if (ambitionPressure >= 74 && traits.discipline <= 48) return 'RUSH_T1';
  if (traits.ambition + traits.discipline + traits.integrity >= 212) return 'DEEP_T3';
  return 'BALANCED_T2';
}

function chooseDesiredDivision(
  npc: NpcRuntimeState,
  traits: PlannerTraitProfile,
  strategyMode: NpcCareerStrategyMode
): string {
  const choices = REGISTERED_DIVISIONS.map((item) => item.name);
  let bestDivision = choices[0] ?? 'Special Operations Division';
  let bestScore = -Infinity;

  for (const division of choices) {
    const requiredTier = minimumAcademyTierForDivision(division);
    const strategyBias =
      strategyMode === 'DEEP_T3'
        ? requiredTier * 8
        : strategyMode === 'RUSH_T1'
          ? (4 - requiredTier) * 8
          : 5;
    const baseReadiness =
      npc.intelligence * 0.24 +
      npc.competence * 0.25 +
      npc.leadership * 0.2 +
      traits.ambition * 0.16 +
      traits.discipline * 0.15;
    const integrityBoost = traits.integrity * 0.06 - npc.integrityRisk * 0.07 - npc.betrayalRisk * 0.05;
    const seed = hashSeed(`${npc.npcId}:${division}:${strategyMode}`);
    const deterministicJitter = (seed % 13) - 6;
    const score = baseReadiness + strategyBias + integrityBoost + deterministicJitter;
    if (score > bestScore) {
      bestScore = score;
      bestDivision = division;
    }
  }

  return bestDivision;
}

function plannerPriority(npc: NpcRuntimeState, plan: NpcCareerPlanState, currentDay: number): number {
  const stageWeight: Record<NpcCareerStage, number> = {
    CIVILIAN_START: 160,
    ACADEMY: 130,
    DIVISION_PIPELINE: 180,
    IN_DIVISION: 60,
    MUTATION_PIPELINE: 190
  };
  const dueBonus = plan.nextActionDay <= currentDay ? 800 : Math.max(0, 180 - (plan.nextActionDay - currentDay) * 20);
  return (
    dueBonus +
    stageWeight[plan.careerStage] +
    npc.academyTier * 12 +
    npc.promotionPoints * 0.04 -
    npc.fatigue * 0.15
  );
}

function planMeta(input: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!input) return {};
  return { ...input };
}

function readMetaNumber(meta: Record<string, unknown>, key: string): number | null {
  const value = meta[key];
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Math.trunc(Number(value));
  return null;
}

function writeMetaNumber(meta: Record<string, unknown>, key: string, value: number | null): void {
  if (value == null) {
    delete meta[key];
    return;
  }
  meta[key] = Math.trunc(value);
}

function toNpcCareerPlanFromRuntime(npc: NpcRuntimeState): NpcCareerPlanState {
  return {
    npcId: npc.npcId,
    strategyMode: npc.strategyMode,
    careerStage: npc.careerStage,
    desiredDivision: npc.desiredDivision,
    targetTier: strategyTier(npc.strategyMode),
    nextActionDay: 0,
    lastActionDay: null,
    lastApplicationId: null,
    meta: {}
  };
}

function deterministicTryoutScore(
  npc: NpcRuntimeState,
  traits: PlannerTraitProfile,
  division: string,
  currentDay: number
): number {
  const seed = hashSeed(`${npc.npcId}:${division}:${currentDay}:TRYOUT`);
  const jitter = (seed % 17) - 8;
  const base =
    npc.intelligence * 0.34 +
    npc.competence * 0.28 +
    npc.leadership * 0.19 +
    traits.discipline * 0.19 -
    npc.fatigue * 0.12;
  return clamp(Math.round(base + jitter), 25, 100);
}

function deterministicFinalScore(
  npc: NpcRuntimeState,
  traits: PlannerTraitProfile,
  tryoutScore: number
): number {
  const stability =
    npc.leadership * 0.3 +
    npc.resilience * 0.22 +
    npc.loyalty * 0.22 +
    traits.integrity * 0.18 +
    (100 - npc.integrityRisk) * 0.08;
  const academyBonus = npc.academyTier * 4;
  return Number(clamp(tryoutScore * 0.62 + stability * 0.28 + academyBonus, 0, 100).toFixed(2));
}

export function computeNpcRankIndexFromProgress(input: {
  xp: number;
  promotionPoints: number;
  leadership: number;
  competence: number;
  resilience: number;
  academyTier: number;
}): number {
  const weightedScore =
    input.promotionPoints * 0.42 +
    input.xp * 0.08 +
    input.leadership * 0.3 +
    input.competence * 0.2 +
    input.resilience * 0.15 +
    clamp(input.academyTier, 0, 3) * 15;
  return clamp(Math.floor(weightedScore / 55), 0, 13);
}

async function runNpcCareerPlanner(
  client: PoolClient,
  profileId: string,
  currentDay: number,
  npcs: NpcRuntimeState[],
  budgetOps: number
): Promise<Set<string>> {
  const plannerUpdatedIds = new Set<string>();
  const activeNpcs = npcs.filter((item) => item.status !== 'KIA');
  if (activeNpcs.length === 0) return plannerUpdatedIds;

  const cappedBudget = clamp(budgetOps, 1, Math.min(48, activeNpcs.length));
  const npcIds = activeNpcs.map((item) => item.npcId);
  const [traits, plans, quotaBoard] = await Promise.all([
    listNpcTraitMemoryProfiles(client, profileId, npcIds),
    listNpcCareerPlans(client, profileId, { npcIds, limit: npcIds.length + 8 }),
    listDivisionQuotaStates(client, profileId)
  ]);
  const traitById = new Map(traits.map((item) => [item.npcId, item]));
  const planById = new Map(plans.map((item) => [item.npcId, item]));
  const quotaByDivision = new Map(quotaBoard.map((item) => [item.division, item]));

  const candidates = [...activeNpcs]
    .map((npc) => {
      const plan = planById.get(npc.npcId) ?? toNpcCareerPlanFromRuntime(npc);
      return { npc, plan, priority: plannerPriority(npc, plan, currentDay) };
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, cappedBudget);

  for (const candidate of candidates) {
    const npc = candidate.npc;
    const existingPlan = candidate.plan;
    const traitsForNpc = traitById.get(npc.npcId) ?? fallbackTraitProfile(npc);
    const strategyMode = chooseStrategyMode(npc, traitsForNpc);
    const meta = planMeta(existingPlan.meta);
    let plan: NpcCareerPlanState = {
      ...existingPlan,
      strategyMode,
      targetTier: strategyTier(strategyMode),
      meta
    };
    let npcChanged = false;
    let planChanged =
      !planById.has(npc.npcId) ||
      existingPlan.strategyMode !== strategyMode ||
      existingPlan.targetTier !== strategyTier(strategyMode);
    let assignmentChanged = false;
    const oldDivision = npc.division;
    const oldPosition = npc.position;

    if (!plan.desiredDivision && npc.division.toLowerCase() !== 'nondivisi') {
      plan.desiredDivision = npc.division;
      planChanged = true;
    }

    if (plan.nextActionDay > currentDay) {
      if (planChanged) {
        await upsertNpcCareerPlan(client, { profileId, ...plan });
      }
      continue;
    }

    if (plan.careerStage === 'CIVILIAN_START') {
      const desired = chooseDesiredDivision(npc, traitsForNpc, strategyMode);
      plan = {
        ...plan,
        desiredDivision: desired,
        careerStage: 'ACADEMY',
        targetTier: Math.max(strategyTier(strategyMode), minimumAcademyTierForDivision(desired)) as 1 | 2 | 3,
        nextActionDay: currentDay,
        lastActionDay: currentDay
      };
      planChanged = true;
    }

    if (plan.careerStage === 'ACADEMY') {
      const targetTier = Math.max(
        plan.targetTier,
        plan.desiredDivision ? minimumAcademyTierForDivision(plan.desiredDivision) : 1
      ) as 1 | 2 | 3;
      plan.targetTier = targetTier;
      if (npc.academyTier >= targetTier) {
        plan.careerStage = npc.division.toLowerCase() === 'nondivisi' ? 'DIVISION_PIPELINE' : 'IN_DIVISION';
        plan.nextActionDay = currentDay;
        plan.lastActionDay = currentDay;
        writeMetaNumber(meta, 'academyStartDay', null);
        writeMetaNumber(meta, 'academyTargetTier', null);
        planChanged = true;
      } else {
        const startDay = readMetaNumber(meta, 'academyStartDay');
        const metaTier = readMetaNumber(meta, 'academyTargetTier');
        if (startDay == null || metaTier !== targetTier) {
          writeMetaNumber(meta, 'academyStartDay', currentDay);
          writeMetaNumber(meta, 'academyTargetTier', targetTier);
          plan.nextActionDay = currentDay + academyDaysForTier(targetTier);
          plan.lastActionDay = currentDay;
          npc.lastTask = `academy-training-t${targetTier}`;
          planChanged = true;
          npcChanged = true;
        } else if (currentDay >= startDay + academyDaysForTier(targetTier)) {
          npc.academyTier = targetTier as 0 | 1 | 2 | 3;
          npc.lastTask = `academy-graduated-t${targetTier}`;
          plan.careerStage = npc.division.toLowerCase() === 'nondivisi' ? 'DIVISION_PIPELINE' : 'IN_DIVISION';
          plan.nextActionDay = currentDay;
          plan.lastActionDay = currentDay;
          writeMetaNumber(meta, 'academyStartDay', null);
          writeMetaNumber(meta, 'academyTargetTier', null);
          planChanged = true;
          npcChanged = true;

          await insertLifecycleEvent(client, {
            profileId,
            npcId: npc.npcId,
            eventType: 'ACADEMY_PASS',
            day: currentDay,
            details: { source: 'NPC_CAREER_PLANNER', tier: targetTier }
          });
          await insertSocialTimelineEvent(client, {
            profileId,
            actorType: 'NPC',
            actorNpcId: npc.npcId,
            eventType: 'NPC_ACADEMY_MILESTONE',
            title: `Academy Tier ${targetTier} Completed`,
            detail: `${npc.name} menyelesaikan academy tier ${targetTier}.`,
            eventDay: currentDay,
            meta: { npcId: npc.npcId, tier: targetTier }
          });
          await insertMailboxMessage(client, {
            messageId: `mail-npc-academy-${npc.npcId}-${currentDay}`,
            profileId,
            senderType: 'NPC',
            senderNpcId: npc.npcId,
            subject: `Academy Milestone: ${npc.name}`,
            body: `${npc.name} menyelesaikan academy tier ${targetTier} dan siap ke tahap berikutnya.`,
            category: 'GENERAL',
            relatedRef: npc.npcId,
            createdDay: currentDay
          });
        }
      }
    }

    if (plan.careerStage === 'IN_DIVISION') {
      if (strategyMode === 'DEEP_T3' && npc.academyTier < 3) {
        plan.careerStage = 'ACADEMY';
        plan.targetTier = 3;
        plan.nextActionDay = currentDay;
        plan.lastActionDay = currentDay;
        planChanged = true;
      } else {
        const currentTier = minimumAcademyTierForDivision(npc.division);
        const eligibleMutationTargets = [...quotaByDivision.values()].filter((item) => {
          const tier = minimumAcademyTierForDivision(item.division);
          return (
            item.division !== npc.division &&
            item.status === 'OPEN' &&
            item.quotaRemaining > 0 &&
            tier > currentTier &&
            npc.academyTier >= tier
          );
        });
        if (eligibleMutationTargets.length > 0) {
          eligibleMutationTargets.sort((a, b) => {
            const seedA = hashSeed(`${npc.npcId}:${a.division}:MUTATION`);
            const seedB = hashSeed(`${npc.npcId}:${b.division}:MUTATION`);
            const scoreA = minimumAcademyTierForDivision(a.division) * 10 + (seedA % 7);
            const scoreB = minimumAcademyTierForDivision(b.division) * 10 + (seedB % 7);
            return scoreB - scoreA;
          });
          const target = eligibleMutationTargets[0]?.division ?? plan.desiredDivision;
          if (target) {
            plan.desiredDivision = target;
            plan.targetTier = Math.max(plan.targetTier, minimumAcademyTierForDivision(target)) as 1 | 2 | 3;
            plan.careerStage = 'MUTATION_PIPELINE';
            plan.nextActionDay = currentDay;
            plan.lastActionDay = currentDay;
            plan.lastApplicationId = null;
            planChanged = true;
          }
        }
      }
    }

    if (plan.careerStage === 'DIVISION_PIPELINE' || plan.careerStage === 'MUTATION_PIPELINE') {
      const pipelineKind = plan.careerStage;
      const desiredDivision = plan.desiredDivision ?? chooseDesiredDivision(npc, traitsForNpc, strategyMode);
      plan.desiredDivision = desiredDivision;
      const requiredTier = minimumAcademyTierForDivision(desiredDivision);
      if (npc.academyTier < requiredTier) {
        plan.careerStage = 'ACADEMY';
        plan.targetTier = Math.max(requiredTier, strategyTier(strategyMode)) as 1 | 2 | 3;
        plan.nextActionDay = currentDay;
        plan.lastActionDay = currentDay;
        planChanged = true;
      } else {
        let application =
          plan.lastApplicationId != null
            ? await getRecruitmentPipelineApplication(client, profileId, plan.lastApplicationId)
            : null;

        if (application && (application.holderType !== 'NPC' || application.npcId !== npc.npcId)) {
          application = null;
          plan.lastApplicationId = null;
          planChanged = true;
        }

        if (
          application &&
          (application.status === 'ANNOUNCEMENT_ACCEPTED' || application.status === 'ANNOUNCEMENT_REJECTED')
        ) {
          application = null;
          plan.lastApplicationId = null;
          planChanged = true;
        }

        if (!application) {
          const applicationId = `rapnpc-${profileId.slice(0, 8)}-${npc.slotNo}-${currentDay}-${randomUUID().slice(0, 6)}`;
          application = await upsertRecruitmentPipelineApplication(client, {
            profileId,
            applicationId,
            holderType: 'NPC',
            npcId: npc.npcId,
            holderName: npc.name,
            division: desiredDivision,
            status: 'REGISTRATION',
            registeredDay: currentDay,
            tryoutDay: null,
            selectionDay: null,
            announcementDay: null,
            tryoutScore: 0,
            finalScore: 0,
            note: pipelineKind === 'MUTATION_PIPELINE' ? 'NPC_MUTATION_REGISTRATION' : 'NPC_DIVISION_REGISTRATION'
          });
          plan.lastApplicationId = application.applicationId;
          plan.nextActionDay = currentDay + 1;
          plan.lastActionDay = currentDay;
          planChanged = true;
          await insertSocialTimelineEvent(client, {
            profileId,
            actorType: 'NPC',
            actorNpcId: npc.npcId,
            eventType: pipelineKind === 'MUTATION_PIPELINE' ? 'NPC_MUTATION_REGISTERED' : 'NPC_DIVISION_REGISTERED',
            title: pipelineKind === 'MUTATION_PIPELINE' ? 'Mutation Pipeline Registered' : 'Division Pipeline Registered',
            detail: `${npc.name} mendaftar ke ${desiredDivision}.`,
            eventDay: currentDay,
            meta: { npcId: npc.npcId, division: desiredDivision, applicationId: application.applicationId }
          });
          await insertMailboxMessage(client, {
            messageId: `mail-npc-reg-${npc.npcId}-${currentDay}`,
            profileId,
            senderType: 'NPC',
            senderNpcId: npc.npcId,
            subject: `NPC Pipeline Registration: ${npc.name}`,
            body: `${npc.name} mendaftar ke ${desiredDivision} (Day 1/4).`,
            category: 'GENERAL',
            relatedRef: application.applicationId,
            createdDay: currentDay
          });
        } else if (application.status === 'REGISTRATION') {
          const requiredDay = application.registeredDay + 1;
          if (currentDay >= requiredDay) {
            const tryoutScore = deterministicTryoutScore(npc, traitsForNpc, desiredDivision, currentDay);
            application = await upsertRecruitmentPipelineApplication(client, {
              profileId,
              ...application,
              status: 'TRYOUT',
              tryoutDay: currentDay,
              tryoutScore,
              note: pipelineKind === 'MUTATION_PIPELINE' ? 'NPC_MUTATION_TRYOUT' : 'NPC_DIVISION_TRYOUT'
            });
            plan.lastActionDay = currentDay;
            plan.nextActionDay = application.registeredDay + 2;
            planChanged = true;
          } else {
            plan.nextActionDay = requiredDay;
            planChanged = true;
          }
        } else if (application.status === 'TRYOUT') {
          const requiredDay = application.registeredDay + 2;
          if (currentDay >= requiredDay) {
            const finalScore = deterministicFinalScore(npc, traitsForNpc, application.tryoutScore);
            application = await upsertRecruitmentPipelineApplication(client, {
              profileId,
              ...application,
              status: 'SELECTION',
              selectionDay: currentDay,
              finalScore,
              note: pipelineKind === 'MUTATION_PIPELINE' ? 'NPC_MUTATION_SELECTION' : 'NPC_DIVISION_SELECTION'
            });
            plan.lastActionDay = currentDay;
            plan.nextActionDay = application.registeredDay + 3;
            planChanged = true;
          } else {
            plan.nextActionDay = requiredDay;
            planChanged = true;
          }
        } else if (application.status === 'SELECTION') {
          const requiredDay = application.registeredDay + 3;
          if (currentDay >= requiredDay) {
            const meetsScore = application.finalScore >= 68;
            const quotaDecision = meetsScore
              ? await reserveDivisionQuotaSlot(client, {
                  profileId,
                  division: desiredDivision,
                  currentDay
                })
              : { accepted: false as const, reason: 'QUOTA_FULL' as const, quota: null as null };
            const accepted = meetsScore && quotaDecision.accepted;
            const announced = await upsertRecruitmentPipelineApplication(client, {
              profileId,
              ...application,
              status: accepted ? 'ANNOUNCEMENT_ACCEPTED' : 'ANNOUNCEMENT_REJECTED',
              announcementDay: currentDay,
              note: accepted
                ? 'NPC_PIPELINE_ANNOUNCEMENT_ACCEPTED'
                : meetsScore
                  ? `NPC_PIPELINE_ANNOUNCEMENT_REJECTED_${quotaDecision.reason}`
                  : 'NPC_PIPELINE_ANNOUNCEMENT_REJECTED_SCORE'
            });
            plan.lastApplicationId = announced.applicationId;
            plan.lastActionDay = currentDay;

            if (accepted) {
              const newDivision = desiredDivision;
              const newPosition = 'Probationary Officer';
              npc.division = newDivision;
              npc.unit = `${newDivision} Intake Unit`;
              npc.position = newPosition;
              npc.lastTask = pipelineKind === 'MUTATION_PIPELINE' ? 'mutation-assigned' : 'division-intake';
              plan.careerStage = 'IN_DIVISION';
              plan.nextActionDay = currentDay + 2;
              npcChanged = true;
              assignmentChanged = true;
              await updateNpcAssignmentCurrent(client, {
                profileId,
                npcId: npc.npcId,
                division: npc.division,
                unit: npc.unit,
                position: npc.position
              });
              await insertAssignmentHistory(client, {
                profileId,
                actorType: 'NPC',
                npcId: npc.npcId,
                oldDivision,
                newDivision: npc.division,
                oldPosition,
                newPosition: npc.position,
                reason:
                  pipelineKind === 'MUTATION_PIPELINE'
                    ? 'NPC_MUTATION_PIPELINE_ACCEPTED'
                    : 'NPC_RECRUITMENT_PIPELINE_ACCEPTED',
                changedDay: currentDay
              });
            } else if (!meetsScore && npc.academyTier < 3) {
              plan.careerStage = 'ACADEMY';
              plan.targetTier = Math.max(requiredTier, Math.min(3, npc.academyTier + 1)) as 1 | 2 | 3;
              plan.nextActionDay = currentDay;
            } else {
              plan.nextActionDay = currentDay + 2;
            }
            planChanged = true;

            await insertSocialTimelineEvent(client, {
              profileId,
              actorType: 'NPC',
              actorNpcId: npc.npcId,
              eventType:
                pipelineKind === 'MUTATION_PIPELINE'
                  ? accepted
                    ? 'NPC_MUTATION_ACCEPTED'
                    : 'NPC_MUTATION_REJECTED'
                  : accepted
                    ? 'NPC_DIVISION_ACCEPTED'
                    : 'NPC_DIVISION_REJECTED',
              title: accepted ? 'NPC Pipeline Accepted' : 'NPC Pipeline Rejected',
              detail: accepted
                ? `${npc.name} diterima ke ${desiredDivision}.`
                : `${npc.name} belum diterima ke ${desiredDivision}.`,
              eventDay: currentDay,
              meta: {
                npcId: npc.npcId,
                division: desiredDivision,
                finalScore: application.finalScore,
                accepted
              }
            });
            await insertMailboxMessage(client, {
              messageId: `mail-npc-ann-${npc.npcId}-${currentDay}`,
              profileId,
              senderType: 'NPC',
              senderNpcId: npc.npcId,
              subject: accepted ? `NPC Accepted: ${npc.name}` : `NPC Rejected: ${npc.name}`,
              body: accepted
                ? `${npc.name} diterima di ${desiredDivision} melalui pipeline 4 tahap.`
                : `${npc.name} belum lolos di ${desiredDivision}.`,
              category: accepted ? 'MUTATION' : 'GENERAL',
              relatedRef: announced.applicationId,
              createdDay: currentDay
            });

            if (quotaDecision.accepted && quotaDecision.quota) {
              quotaByDivision.set(quotaDecision.quota.division, quotaDecision.quota);
            }
          } else {
            plan.nextActionDay = requiredDay;
            planChanged = true;
          }
        }
      }
    }

    if (planChanged) {
      await upsertNpcCareerPlan(client, { profileId, ...plan });
      npc.strategyMode = plan.strategyMode;
      npc.careerStage = plan.careerStage;
      npc.desiredDivision = plan.desiredDivision;
      plannerUpdatedIds.add(npc.npcId);
    }

    if (npcChanged || assignmentChanged) {
      await updateNpcRuntimeState(client, profileId, npc, currentDay);
      plannerUpdatedIds.add(npc.npcId);
    }
  }

  return plannerUpdatedIds;
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
  const renamedNpcIds = deduplicateNpcNames(npcs);
  const changedNpcStates: NpcRuntimeState[] = [];
  const changedNpcIds = new Set<string>();

  for (const npc of npcs) {
    const identityRenamed = renamedNpcIds.has(npc.npcId);
    if (npc.status === 'KIA' && !identityRenamed) continue;

    if (npc.status === 'KIA') {
      await updateNpcRuntimeState(client, profileId, npc, currentDay);
      changedNpcIds.add(npc.npcId);
      changedNpcStates.push({ ...npc, updatedAtMs: nowMs });
      continue;
    }

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
    const computedRankIndex = computeNpcRankIndexFromProgress({
      xp: npc.xp,
      promotionPoints: npc.promotionPoints,
      leadership: npc.leadership,
      competence: npc.competence,
      resilience: npc.resilience,
      academyTier: npc.academyTier
    });
    if (computedRankIndex !== npc.rankIndex) {
      await insertRankHistory(client, {
        profileId,
        actorType: 'NPC',
        npcId: npc.npcId,
        oldRankIndex: npc.rankIndex,
        newRankIndex: computedRankIndex,
        reason: 'NPC_PROGRESS_AUTO_RANK',
        changedDay: currentDay
      });
      npc.rankIndex = computedRankIndex;
    }

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
      const replacedName = `${shortName} [S${item.slotNo}]`;

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

  const plannerBudget = clamp(Math.floor((options?.maxNpcOps ?? V5_MAX_NPCS) / 4), 8, 48);
  const plannerUpdatedIds = await runNpcCareerPlanner(client, profileId, currentDay, npcs, plannerBudget);
  if (plannerUpdatedIds.size > 0) {
    const npcById = new Map(npcs.map((item) => [item.npcId, item]));
    for (const npcId of plannerUpdatedIds) {
      const latest = npcById.get(npcId);
      if (!latest) continue;
      changedNpcIds.add(npcId);
      changedNpcStates.push({ ...latest, updatedAtMs: nowMs });
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
  const latestChangedStateById = new Map<string, NpcRuntimeState>();
  for (const state of changedNpcStates) {
    latestChangedStateById.set(state.npcId, state);
  }
  const mergedChangedStates = Array.from(latestChangedStateById.values());

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
    activeNpcCount: mergedChangedStates.filter((item) => item.status === 'ACTIVE').length,
    changedNpcIds: Array.from(changedNpcIds),
    changedNpcStates: mergedChangedStates,
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

