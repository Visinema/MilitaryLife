export const GAME_MS_PER_DAY = 4_000;
export const IN_GAME_START_DATE = '2026-01-01';
export const GAME_UI_VERSION = '4.1';

export const COUNTRIES = ['US'] as const;
export type CountryCode = (typeof COUNTRIES)[number];

export const BRANCHES = ['US_ARMY', 'US_NAVY'] as const;
export type BranchCode = (typeof BRANCHES)[number];

export const PAUSE_REASONS = ['DECISION', 'MODAL', 'SUBPAGE'] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];
