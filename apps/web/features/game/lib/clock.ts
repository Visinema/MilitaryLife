import type { GameSnapshot } from '@mls/shared/game-types';
import { GAME_MS_PER_DAY } from '@mls/shared/constants';

export function deriveLiveGameDay(snapshot: GameSnapshot, clockOffsetMs: number): number {
  if (snapshot.paused) {
    return snapshot.gameDay;
  }

  const serverNow = Date.now() + clockOffsetMs;
  const scale = Number.isFinite(snapshot.gameTimeScale) && snapshot.gameTimeScale > 0 ? snapshot.gameTimeScale : 1;
  const elapsedMs = Math.max(0, serverNow - snapshot.serverReferenceTimeMs);
  const computed = Math.floor((elapsedMs / GAME_MS_PER_DAY) * scale);
  return Math.max(snapshot.gameDay, computed);
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(cents / 100);
}

export function inGameDateFromDay(day: number): string {
  const base = new Date('2026-01-01T00:00:00.000Z');
  base.setUTCDate(base.getUTCDate() + day);
  return base.toISOString().slice(0, 10);
}
