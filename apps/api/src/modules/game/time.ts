import { GAME_MS_PER_DAY, IN_GAME_START_DATE } from '@mls/shared/constants';

export function computeGameDay(nowMs: number, serverReferenceTimeMs: number): number {
  return Math.max(0, Math.floor((nowMs - serverReferenceTimeMs) / GAME_MS_PER_DAY));
}

export function toInGameDate(gameDay: number): string {
  const date = new Date(`${IN_GAME_START_DATE}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + gameDay);
  return date.toISOString().slice(0, 10);
}

export function computeAge(startAge: number, gameDay: number): number {
  return startAge + Math.floor(gameDay / 365);
}
