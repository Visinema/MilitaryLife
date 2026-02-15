import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { AcademyCertificate, ActionResult, DecisionResult, GameSnapshot } from '@mls/shared/game-types';
import type { PauseReason } from '@mls/shared/constants';
import { clamp, roll, sampleGeometricGap, sampleWeighted } from '../../utils/random.js';
import { computeAge, computeGameDay, toInGameDate } from './time.js';
import { BRANCH_CONFIG } from './branch-config.js';
import { COUNTRY_CONFIG } from './country-config.js';
import { fetchCandidateEvents, type DbCandidateEvent, type DbGameStateRow } from './repo.js';

function randBetween(min: number, max: number): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

type EquipmentQuality = 'POOR' | 'STANDARD' | 'ADVANCED' | 'ELITE';
type PromotionRecommendation = 'STRONG_RECOMMEND' | 'RECOMMEND' | 'HOLD' | 'NOT_RECOMMENDED';

export interface PromotionAlgorithmResult {
  approved: boolean;
  serviceYears: number;
  minimumServiceYears: number;
  meritPoints: number;
  minimumMeritPoints: number;
  vacancyAvailabilityPercent: number;
  vacancyPassed: boolean;
  recommendation: PromotionRecommendation;
  rejectionLetter: string | null;
}

export interface GeneratedMission {
  terrain: 'JUNGLE' | 'URBAN' | 'DESERT';
  objective: 'ESCORT' | 'DEFEND' | 'RECON';
  enemyStrength: number;
  difficultyRating: number;
  equipmentQuality: EquipmentQuality;
  rewardMultiplier: number;
}

function getEquipmentQuality(state: DbGameStateRow): EquipmentQuality {
  const score = state.rank_index * 24 + Math.floor(state.money_cents / 120_000) + state.health;
  if (score >= 190) return 'ELITE';
  if (score >= 145) return 'ADVANCED';
  if (score >= 95) return 'STANDARD';
  return 'POOR';
}

function equipmentModifier(quality: EquipmentQuality): number {
  if (quality === 'ELITE') return 1.35;
  if (quality === 'ADVANCED') return 1.15;
  if (quality === 'STANDARD') return 1;
  return 0.85;
}

function rankInfluence(state: DbGameStateRow): number {
  return 1 + state.rank_index * 0.08;
}


function computeCertificatePromotionBoost(state: DbGameStateRow): { chanceBoost: number; roleUnlocks: string[] } {
  const certificates = Array.isArray(state.certificate_inventory) ? state.certificate_inventory : [];
  if (certificates.length === 0) {
    return { chanceBoost: 0, roleUnlocks: [] };
  }

  const highestTier = certificates.reduce((max, cert) => Math.max(max, Number(cert?.tier ?? 0)), 0);
  const hasEliteGrade = certificates.some((cert) => cert?.grade === 'A' || cert?.grade === 'B');
  const chanceBoost = clamp((highestTier >= 2 ? 0.08 : 0.04) + (hasEliteGrade ? 0.04 : 0.01), 0.02, 0.14);

  const roleUnlocks = [
    'Division Staff Planner',
    'Task Force Coordinator',
    ...(highestTier >= 2 ? ['Strategic Command Staff', 'Joint Operations Controller'] : [])
  ];

  return { chanceBoost, roleUnlocks };
}

export function evaluatePromotionAlgorithm(state: DbGameStateRow): PromotionAlgorithmResult {
  const maxRankIndex = BRANCH_CONFIG[state.branch].ranks.length - 1;
  if (state.rank_index >= maxRankIndex) {
    return {
      approved: false,
      serviceYears: Number((state.current_day / 365).toFixed(2)),
      minimumServiceYears: 999,
      meritPoints: state.promotion_points,
      minimumMeritPoints: 999,
      vacancyAvailabilityPercent: 0,
      vacancyPassed: false,
      recommendation: 'HOLD',
      rejectionLetter: 'Promotion Board Notice: You have reached the top available rank bracket for this branch.'
    };
  }

  const country = COUNTRY_CONFIG[state.country];
  const minimumServiceYears = Number(((country.promotionMinDays[state.rank_index] ?? 9999) / 365).toFixed(2));
  const minimumMeritPoints = country.promotionMinPoints[state.rank_index] ?? 9999;
  const serviceYears = Number((state.current_day / 365).toFixed(2));
  const meritPoints = state.promotion_points;

  const serviceOk = serviceYears >= minimumServiceYears;
  const meritOk = meritPoints >= minimumMeritPoints;
  const targetRankIndex = state.rank_index + 1;
  const requiresOfficerAcademy = targetRankIndex >= 2;
  const requiresHighCommandAcademy = targetRankIndex >= 4;
  const officerAcademyOk = !requiresOfficerAcademy || state.academy_tier >= 1;
  const highCommandAcademyOk = !requiresHighCommandAcademy || state.academy_tier >= 2;

  const certificateBoost = computeCertificatePromotionBoost(state);
  const vacancyChance = clamp(
    0.28 + state.morale * 0.003 + state.health * 0.002 + state.rank_index * 0.015 + certificateBoost.chanceBoost,
    0.12,
    0.95
  );
  const vacancyAvailabilityPercent = Math.round(vacancyChance * 100);
  const vacancyPassed = roll(vacancyChance);

  const approved = serviceOk && meritOk && vacancyPassed && officerAcademyOk && highCommandAcademyOk;

  const serviceRatio = serviceYears / Math.max(minimumServiceYears, 0.1);
  const meritRatio = meritPoints / Math.max(minimumMeritPoints, 1);
  const score = serviceRatio * 0.45 + meritRatio * 0.45 + vacancyChance * 0.1;
  const recommendation: PromotionRecommendation =
    score >= 1.25 ? 'STRONG_RECOMMEND' : score >= 1.02 ? 'RECOMMEND' : score >= 0.82 ? 'HOLD' : 'NOT_RECOMMENDED';

  const rejectionReasons: string[] = [];
  if (!serviceOk) rejectionReasons.push(`service years (${serviceYears}/${minimumServiceYears})`);
  if (!meritOk) rejectionReasons.push(`merit points (${meritPoints}/${minimumMeritPoints})`);
  if (!vacancyPassed) rejectionReasons.push(`vacancy availability (${vacancyAvailabilityPercent}%)`);
  if (!officerAcademyOk) rejectionReasons.push('Military Academy Officer certification');
  if (!highCommandAcademyOk) rejectionReasons.push('Military Academy High Command certification');

  const rejectionLetter = approved
    ? null
    : `Promotion Board Notice: Promotion request cannot be approved this cycle due to ${
        rejectionReasons.join(', ') || 'administrative restrictions'
      }. Certificate benefit bonus applied: +${Math.round(certificateBoost.chanceBoost * 100)}% vacancy chance. Please continue service and re-apply in a future board session.`;

  return {
    approved,
    serviceYears,
    minimumServiceYears,
    meritPoints,
    minimumMeritPoints,
    vacancyAvailabilityPercent,
    vacancyPassed,
    recommendation,
    rejectionLetter
  };
}

export function generateMission(state: DbGameStateRow): GeneratedMission {
  const terrains: GeneratedMission['terrain'][] = ['JUNGLE', 'URBAN', 'DESERT'];
  const objectives: GeneratedMission['objective'][] = ['ESCORT', 'DEFEND', 'RECON'];
  const terrain = terrains[randBetween(0, terrains.length - 1)] ?? 'URBAN';
  const objective = objectives[randBetween(0, objectives.length - 1)] ?? 'DEFEND';

  const equipmentQuality = getEquipmentQuality(state);
  const rankPower = rankInfluence(state);
  const equipmentPower = equipmentModifier(equipmentQuality);

  const enemyStrengthBase = randBetween(1, 10);
  const enemyStrength = clamp(Math.round(enemyStrengthBase + state.rank_index * 0.6), 1, 10);
  const difficultyRating = clamp(Math.round(enemyStrength * (1.15 + state.rank_index * 0.05) / equipmentPower), 1, 12);
  const rewardMultiplier = Number(clamp(0.85 + difficultyRating * 0.07 + rankPower * 0.08 + equipmentPower * 0.06, 0.9, 2.8).toFixed(2));

  return {
    terrain,
    objective,
    enemyStrength,
    difficultyRating,
    equipmentQuality,
    rewardMultiplier
  };
}

export function autoResumeIfExpired(state: DbGameStateRow, nowMs: number): boolean {
  if (!state.paused_at_ms || !state.pause_expires_at_ms) {
    return false;
  }

  if (nowMs <= state.pause_expires_at_ms) {
    return false;
  }

  // Keep mandatory locks active until fully resolved.
  if (state.pause_reason === 'DECISION' && state.pending_event_id) {
    return false;
  }

  const ceremonyCycleDay = state.current_day >= 12 ? Math.floor(state.current_day / 12) * 12 : 0;
  if (state.pause_reason === 'SUBPAGE' && ceremonyCycleDay >= 12 && state.ceremony_completed_day < ceremonyCycleDay) {
    return false;
  }

  resumeState(state, nowMs);
  return true;
}

export function pauseState(state: DbGameStateRow, reason: PauseReason, nowMs: number, timeoutMinutes: number): string {
  if (state.paused_at_ms && state.pause_token) {
    return state.pause_token;
  }

  const token = randomUUID();
  state.paused_at_ms = nowMs;
  state.pause_reason = reason;
  state.pause_token = token;
  state.pause_expires_at_ms = nowMs + timeoutMinutes * 60_000;
  return token;
}

export function resumeState(state: DbGameStateRow, resumeNowMs: number): void {
  if (!state.paused_at_ms) {
    return;
  }

  const pausedDuration = Math.max(0, resumeNowMs - state.paused_at_ms);
  state.server_reference_time_ms += pausedDuration;
  state.paused_at_ms = null;
  state.pause_reason = null;
  state.pause_token = null;
  state.pause_expires_at_ms = null;
}

export function synchronizeProgress(state: DbGameStateRow, nowMs: number): number {
  const effectiveNow = state.paused_at_ms ?? nowMs;
  const targetDay = computeGameDay(effectiveNow, state.server_reference_time_ms);
  const elapsed = Math.max(0, targetDay - state.current_day);

  if (elapsed === 0) {
    return 0;
  }

  const branchConfig = BRANCH_CONFIG[state.branch];
  const salary = branchConfig.salaryPerDayCents[state.rank_index] ?? branchConfig.salaryPerDayCents.at(-1) ?? 0;

  state.current_day = targetDay;
  state.money_cents += salary * elapsed;
  state.days_in_rank += elapsed;
  return elapsed;
}


export function advanceGameDays(state: DbGameStateRow, days: number): number {
  const elapsed = Math.max(0, Math.floor(days));
  if (elapsed === 0) {
    return 0;
  }

  const branchConfig = BRANCH_CONFIG[state.branch];
  const salary = branchConfig.salaryPerDayCents[state.rank_index] ?? branchConfig.salaryPerDayCents.at(-1) ?? 0;

  state.current_day += elapsed;
  state.money_cents += salary * elapsed;
  state.days_in_rank += elapsed;
  return elapsed;
}

function canPromote(state: DbGameStateRow): boolean {
  const maxRankIndex = BRANCH_CONFIG[state.branch].ranks.length - 1;
  if (state.rank_index >= maxRankIndex) return false;

  const country = COUNTRY_CONFIG[state.country];
  const reqDays = country.promotionMinDays[state.rank_index] ?? 9999;
  const reqPoints = country.promotionMinPoints[state.rank_index] ?? 9999;

  if (state.days_in_rank < reqDays || state.promotion_points < reqPoints) {
    return false;
  }

  if (state.country === 'US') {
    return state.morale >= 55 && state.health >= 55;
  }

  return state.morale >= 60 && state.health >= 60;
}

export function tryPromotion(state: DbGameStateRow): boolean {
  const evaluation = evaluatePromotionAlgorithm(state);
  if (!evaluation.approved) {
    return false;
  }

  const country = COUNTRY_CONFIG[state.country];
  const reqPoints = country.promotionMinPoints[state.rank_index] ?? 0;

  state.rank_index += 1;
  state.days_in_rank = 0;
  state.promotion_points = Math.max(0, state.promotion_points - reqPoints);
  state.morale = clamp(state.morale + 2, 0, 100);
  return true;
}

function fallbackImpactScope(option: { effects?: { money?: number; morale?: number; promotionPoints?: number } }): 'SELF' | 'ORGANIZATION' {
  return (option.effects?.promotionPoints ?? 0) + (option.effects?.morale ?? 0) >= 4 || Math.abs(option.effects?.money ?? 0) >= 1200
    ? 'ORGANIZATION'
    : 'SELF';
}

function fallbackEffectPreview(option: {
  effects?: { money?: number; morale?: number; health?: number; promotionPoints?: number };
}): string {
  return `Δ$${Math.round((option.effects?.money ?? 0) / 100)} · M ${option.effects?.morale ?? 0} · H ${option.effects?.health ?? 0} · P ${option.effects?.promotionPoints ?? 0}`;
}


function eventRollChance(state: DbGameStateRow): number {
  const baseChance = COUNTRY_CONFIG[state.country].dailyEventProbability * BRANCH_CONFIG[state.branch].eventChanceModifier;
  return clamp(baseChance * 0.45, 0.02, 0.25);
}

export async function maybeQueueDecisionEvent(
  client: PoolClient,
  state: DbGameStateRow,
  nowMs: number,
  pauseTimeoutMinutes: number
): Promise<boolean> {
  if (state.pending_event_id) {
    return false;
  }

  if (state.current_day < state.next_event_day) {
    return false;
  }

  const chance = eventRollChance(state);

  let shouldTrigger = false;
  for (let day = state.next_event_day; day <= state.current_day; day += 1) {
    if (roll(chance)) {
      shouldTrigger = true;
      break;
    }
  }

  if (!shouldTrigger) {
    state.next_event_day = state.current_day + sampleGeometricGap(chance, 3, 14);
    return false;
  }

  const candidates = await fetchCandidateEvents(client, state.profile_id, state.country, state.branch, state.rank_index);
  const eligible = candidates.filter((event) => state.current_day - event.last_seen_day >= event.cooldown_days);

  if (eligible.length === 0) {
    state.next_event_day = state.current_day + sampleGeometricGap(chance, 3, 14);
    return false;
  }

  const picked = sampleWeighted<DbCandidateEvent>(eligible.map((event) => ({ item: event, weight: event.base_weight })));

  if (!picked) {
    state.next_event_day = state.current_day + sampleGeometricGap(chance, 3, 14);
    return false;
  }

  state.pending_event_id = picked.id;
  const chancePercent = Math.round(chance * 100);
  state.pending_event_payload = {
    title: picked.title,
    description: picked.description,
    chancePercent,
    conditionLabel: `Rank ${snapshotRankCode(state)} · Day ${state.current_day} · Readiness ${state.health}/${state.morale}`,
    options: picked.options.map((option) => ({
      id: option.id,
      label: option.label,
      impactScope: fallbackImpactScope(option),
      effectPreview: fallbackEffectPreview(option)
    }))
  };

  pauseState(state, 'DECISION', nowMs, pauseTimeoutMinutes);
  return true;
}

function snapshotRankCode(state: DbGameStateRow): string {
  return BRANCH_CONFIG[state.branch].ranks[state.rank_index] ?? BRANCH_CONFIG[state.branch].ranks.at(-1) ?? 'UNKNOWN';
}

function normalizePendingDecisionPayload(state: DbGameStateRow): GameSnapshot['pendingDecision'] {
  if (!state.pending_event_id || !state.pending_event_payload) {
    return null;
  }

  const payload = state.pending_event_payload as {
    title?: string;
    description?: string;
    chancePercent?: number;
    conditionLabel?: string;
    options?: Array<{
      id?: string;
      label?: string;
      impactScope?: 'SELF' | 'ORGANIZATION';
      effectPreview?: string;
    }>;
  };

  const normalized: NonNullable<GameSnapshot['pendingDecision']> = {
    eventId: state.pending_event_id,
    title: payload.title ?? 'Operational Event',
    description: payload.description ?? 'Unexpected field update requires your decision.',
    chancePercent: Number.isFinite(payload.chancePercent) ? Math.max(1, Math.min(100, Number(payload.chancePercent))) : 35,
    conditionLabel:
      payload.conditionLabel?.trim() ??
      `Rank ${snapshotRankCode(state)} · Day ${state.current_day} · Readiness ${state.health}/${state.morale}`,
    options: (Array.isArray(payload.options) ? payload.options : []).map((option, index) => ({
      id: option.id ?? `option-${index + 1}`,
      label: option.label ?? `Option ${index + 1}`,
      impactScope: option.impactScope === 'ORGANIZATION' ? 'ORGANIZATION' : 'SELF',
      effectPreview: option.effectPreview ?? 'Effect summary unavailable'
    }))
  };

  state.pending_event_payload = {
    title: normalized.title,
    description: normalized.description,
    chancePercent: normalized.chancePercent,
    conditionLabel: normalized.conditionLabel,
    options: normalized.options
  };

  return normalized;
}

function normalizeCertificateInventory(rawValue: unknown): AcademyCertificate[] {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue
    .filter((item): item is AcademyCertificate => {
      return Boolean(
        item &&
          typeof item === 'object' &&
          typeof (item as { id?: unknown }).id === 'string' &&
          typeof (item as { academyName?: unknown }).academyName === 'string' &&
          typeof (item as { score?: unknown }).score === 'number' &&
          typeof (item as { trainerName?: unknown }).trainerName === 'string'
      );
    })
    .slice(0, 20);
}

function getDivisionAccessProfile(state: DbGameStateRow): GameSnapshot['divisionAccess'] {
  const division = state.preferred_division ?? 'INFANTRY';
  const score = state.division_freedom_score;
  const accessLevel: 'LIMITED' | 'STANDARD' | 'ADVANCED' | 'ELITE' =
    score >= 80 ? 'ELITE' : score >= 60 ? 'ADVANCED' : score >= 40 ? 'STANDARD' : 'LIMITED';

  const divisionBenefitsMap: Record<'INFANTRY' | 'INTEL' | 'LOGISTICS' | 'CYBER', string[]> = {
    INFANTRY: ['Combat stamina +8%', 'Assault mission reward +12%'],
    INTEL: ['Intel quality +15%', 'Decision risk preview lebih akurat'],
    LOGISTICS: ['Supply loss -18%', 'Biaya operasi harian -10%'],
    CYBER: ['Recon digital +20%', 'Counter-disruption bonus +12%']
  };

  const safeDivision = (['INFANTRY', 'INTEL', 'LOGISTICS', 'CYBER'].includes(division) ? division : 'INFANTRY') as 'INFANTRY' | 'INTEL' | 'LOGISTICS' | 'CYBER';
  const dangerousMissionUnlocked = state.academy_tier >= 2 && score >= 60 && state.rank_index >= 6;

  return {
    division: safeDivision,
    accessLevel,
    benefits: divisionBenefitsMap[safeDivision],
    dangerousMissionUnlocked
  };
}

export function buildSnapshot(state: DbGameStateRow, nowMs: number): GameSnapshot {
  const gameDay = state.current_day;
  const currentCeremonyDay = gameDay >= 12 ? Math.floor(gameDay / 12) * 12 : 0;
  const ceremonyDue = currentCeremonyDay >= 12 && state.ceremony_completed_day < currentCeremonyDay;
  const normalizedCertificates = normalizeCertificateInventory(state.certificate_inventory);
  return {
    serverNowMs: nowMs,
    serverReferenceTimeMs: state.server_reference_time_ms,
    gameDay,
    inGameDate: toInGameDate(gameDay),
    age: computeAge(state.start_age, gameDay),
    playerName: state.player_name,
    country: state.country,
    branch: state.branch,
    rankCode: snapshotRankCode(state),
    rankIndex: state.rank_index,
    moneyCents: state.money_cents,
    morale: state.morale,
    health: state.health,
    paused: Boolean(state.paused_at_ms),
    pauseReason: state.pause_reason,
    pauseToken: state.pause_token,
    pauseExpiresAtMs: state.pause_expires_at_ms,
    lastMissionDay: state.last_mission_day,
    academyTier: state.academy_tier,
    academyCertifiedOfficer: state.academy_tier >= 1,
    academyCertifiedHighOfficer: state.academy_tier >= 2,
    lastTravelPlace: state.last_travel_place,
    certificates: normalizedCertificates,
    divisionFreedomScore: state.division_freedom_score,
    preferredDivision: state.preferred_division,
    divisionAccess: getDivisionAccessProfile(state),
    pendingDecision: normalizePendingDecisionPayload(state),
    ceremonyDue,
    nextCeremonyDay: gameDay < 12 ? 12 : gameDay % 12 === 0 ? gameDay + 12 : gameDay + (12 - (gameDay % 12)),
    ceremonyCompletedDay: state.ceremony_completed_day,
    ceremonyRecentAwards: state.ceremony_recent_awards,
    playerMedals: state.player_medals,
    playerRibbons: state.player_ribbons
  };
}

function clampStats(state: DbGameStateRow): void {
  state.morale = clamp(state.morale, 0, 100);
  state.health = clamp(state.health, 0, 100);
  state.money_cents = Math.max(0, state.money_cents);
  state.promotion_points = Math.max(0, state.promotion_points);
}

export function applyTrainingAction(
  state: DbGameStateRow,
  intensity: 'LOW' | 'MEDIUM' | 'HIGH'
): Pick<ActionResult, 'details'> {
  const config = {
    LOW: { cost: 500, health: 1, morale: 2, points: 2, injuryChance: 0.01 },
    MEDIUM: { cost: 1000, health: 2, morale: 1, points: 4, injuryChance: 0.03 },
    HIGH: { cost: 1600, health: 3, morale: -1, points: 6, injuryChance: 0.06 }
  }[intensity];

  state.money_cents -= config.cost;
  state.health += config.health;
  state.morale += config.morale;
  state.promotion_points += config.points;

  let injury = false;
  if (roll(config.injuryChance)) {
    injury = true;
    state.health -= randBetween(4, 9);
    state.morale -= randBetween(2, 5);
  }

  clampStats(state);

  return {
    details: {
      intensity,
      injury,
      costCents: config.cost
    }
  };
}

export function applyDeploymentAction(
  state: DbGameStateRow,
  missionType: 'PATROL' | 'SUPPORT',
  mission: GeneratedMission
): Pick<ActionResult, 'details'> {
  const branchConfig = BRANCH_CONFIG[state.branch];
  const profile = missionType === 'PATROL' ? branchConfig.deployment.patrol : branchConfig.deployment.support;

  const successChance = clamp(profile.successChance + mission.rewardMultiplier * 0.03 - mission.difficultyRating * 0.02, 0.08, 0.95);
  const injuryChance = clamp(profile.injuryChance + mission.difficultyRating * 0.015 - mission.rewardMultiplier * 0.01, 0.01, 0.7);

  const injured = roll(injuryChance);
  const succeeded = roll(successChance);

  const baseReward = succeeded ? randBetween(profile.rewardCents[0], profile.rewardCents[1]) : randBetween(200, 700);
  const reward = Math.round(baseReward * mission.rewardMultiplier);
  const healthLoss = injured ? randBetween(profile.healthLoss[0], profile.healthLoss[1]) + Math.floor(mission.difficultyRating / 4) : randBetween(0, 2);
  const moraleLoss = injured ? randBetween(profile.moraleLoss[0], profile.moraleLoss[1]) + Math.floor(mission.difficultyRating / 5) : randBetween(0, 2);
  const points = succeeded
    ? randBetween(profile.promotionPoints[0], profile.promotionPoints[1]) + Math.floor(mission.difficultyRating / 2)
    : randBetween(0, Math.max(profile.promotionPoints[1] - 2, 1));

  state.money_cents += reward;
  state.health -= healthLoss;
  state.morale -= moraleLoss;
  state.promotion_points += points;

  clampStats(state);

  return {
    details: {
      missionType,
      succeeded,
      injured,
      rewardCents: reward,
      healthLoss,
      moraleLoss,
      promotionPoints: points,
      terrain: mission.terrain,
      objective: mission.objective,
      enemyStrength: mission.enemyStrength,
      difficultyRating: mission.difficultyRating,
      equipmentQuality: mission.equipmentQuality,
      rewardMultiplier: mission.rewardMultiplier
    }
  };
}

export function applyDecisionEffects(
  state: DbGameStateRow,
  effects: { money?: number; morale?: number; health?: number; promotionPoints?: number }
): DecisionResult['applied'] {
  const moneyDelta = effects.money ?? 0;
  const moraleDelta = effects.morale ?? 0;
  const healthDelta = effects.health ?? 0;
  const promotionPointDelta = effects.promotionPoints ?? 0;

  state.money_cents += moneyDelta;
  state.morale += moraleDelta;
  state.health += healthDelta;
  state.promotion_points += promotionPointDelta;
  clampStats(state);

  return {
    moneyDelta,
    moraleDelta,
    healthDelta,
    promotionPointDelta
  };
}

export function scheduleNextEventDay(state: DbGameStateRow): void {
  const chance = eventRollChance(state);
  state.next_event_day = state.current_day + sampleGeometricGap(chance, 3, 14);
}

export function snapshotStateForLog(state: DbGameStateRow): Record<string, unknown> {
  return {
    currentDay: state.current_day,
    serverReferenceTimeMs: state.server_reference_time_ms,
    rankIndex: state.rank_index,
    moneyCents: state.money_cents,
    morale: state.morale,
    health: state.health,
    promotionPoints: state.promotion_points,
    daysInRank: state.days_in_rank,
    nextEventDay: state.next_event_day,
    pendingEventId: state.pending_event_id,
    pauseReason: state.pause_reason,
    lastMissionDay: state.last_mission_day,
    academyTier: state.academy_tier,
    lastTravelPlace: state.last_travel_place,
    divisionFreedomScore: state.division_freedom_score,
    preferredDivision: state.preferred_division
  };
}
