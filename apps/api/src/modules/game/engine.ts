import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ActionResult, DecisionResult, GameSnapshot } from '@mls/shared/game-types';
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

export function autoResumeIfExpired(state: DbGameStateRow, nowMs: number): boolean {
  if (!state.paused_at_ms || !state.pause_expires_at_ms) {
    return false;
  }

  if (nowMs <= state.pause_expires_at_ms) {
    return false;
  }

  // Keep decision lock active until user resolves pending decision.
  // Auto-resuming here causes stale "No matching pending decision" conflicts on Event Frame.
  if (state.pause_reason === 'DECISION' && state.pending_event_id) {
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
  if (state.rank_index >= 6) return false;

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
  if (!canPromote(state)) {
    return false;
  }

  const country = COUNTRY_CONFIG[state.country];
  const reqPoints = country.promotionMinPoints[state.rank_index] ?? 0;

  let promote = false;

  if (state.country === 'US') {
    const chance = clamp(
      0.25 + (state.promotion_points - reqPoints) * 0.01 + state.morale * 0.001 + state.health * 0.001,
      0.25,
      0.9
    );
    promote = roll(chance);
  } else {
    promote = state.promotion_points >= reqPoints + 8 || roll(0.2);
  }

  if (!promote) {
    return false;
  }

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

  const countryChance = COUNTRY_CONFIG[state.country].dailyEventProbability;
  const branchModifier = BRANCH_CONFIG[state.branch].eventChanceModifier;
  const chance = clamp(countryChance * branchModifier, 0.05, 0.55);

  let shouldTrigger = false;
  for (let day = state.next_event_day; day <= state.current_day; day += 1) {
    if (roll(chance)) {
      shouldTrigger = true;
      break;
    }
  }

  if (!shouldTrigger) {
    state.next_event_day = state.current_day + 1;
    return false;
  }

  const candidates = await fetchCandidateEvents(client, state.profile_id, state.country, state.branch, state.rank_index);
  const eligible = candidates.filter((event) => state.current_day - event.last_seen_day >= event.cooldown_days);

  if (eligible.length === 0) {
    state.next_event_day = state.current_day + sampleGeometricGap(chance, 2, 8);
    return false;
  }

  const picked = sampleWeighted<DbCandidateEvent>(eligible.map((event) => ({ item: event, weight: event.base_weight })));

  if (!picked) {
    state.next_event_day = state.current_day + sampleGeometricGap(chance, 2, 8);
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
    options: (payload.options ?? []).map((option, index) => ({
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

export function buildSnapshot(state: DbGameStateRow, nowMs: number): GameSnapshot {
  const gameDay = state.current_day;
  return {
    serverNowMs: nowMs,
    serverReferenceTimeMs: state.server_reference_time_ms,
    gameDay,
    inGameDate: toInGameDate(gameDay),
    age: computeAge(state.start_age, gameDay),
    country: state.country,
    branch: state.branch,
    rankCode: snapshotRankCode(state),
    moneyCents: state.money_cents,
    morale: state.morale,
    health: state.health,
    paused: Boolean(state.paused_at_ms),
    pauseReason: state.pause_reason,
    pauseToken: state.pause_token,
    pauseExpiresAtMs: state.pause_expires_at_ms,
    lastMissionDay: state.last_mission_day,
    pendingDecision: normalizePendingDecisionPayload(state)
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
  missionType: 'PATROL' | 'SUPPORT'
): Pick<ActionResult, 'details'> {
  const branchConfig = BRANCH_CONFIG[state.branch];
  const profile = missionType === 'PATROL' ? branchConfig.deployment.patrol : branchConfig.deployment.support;

  const injured = roll(profile.injuryChance);
  const succeeded = roll(profile.successChance);

  const reward = succeeded ? randBetween(profile.rewardCents[0], profile.rewardCents[1]) : randBetween(200, 700);
  const healthLoss = injured ? randBetween(profile.healthLoss[0], profile.healthLoss[1]) : randBetween(0, 2);
  const moraleLoss = injured ? randBetween(profile.moraleLoss[0], profile.moraleLoss[1]) : randBetween(0, 2);
  const points = succeeded
    ? randBetween(profile.promotionPoints[0], profile.promotionPoints[1])
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
      promotionPoints: points
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
  const chance = clamp(
    COUNTRY_CONFIG[state.country].dailyEventProbability * BRANCH_CONFIG[state.branch].eventChanceModifier,
    0.05,
    0.55
  );
  state.next_event_day = state.current_day + sampleGeometricGap(chance, 2, 8);
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
    lastMissionDay: state.last_mission_day
  };
}
