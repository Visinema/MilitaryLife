export const UNIVERSAL_RANK_LABELS = [
  'Recruit',
  'Private',
  'Corporal',
  'Sergeant',
  'Staff Sergeant',
  'Warrant Officer',
  'Lieutenant',
  'Captain',
  'Major',
  'Colonel',
  'Brigadier General',
  'Major General',
  'Lieutenant General',
  'General'
] as const;

export type UniversalRankLabel = (typeof UNIVERSAL_RANK_LABELS)[number];

export function clampUniversalRankIndex(rankIndex: number): number {
  if (!Number.isFinite(rankIndex)) return 0;
  return Math.max(0, Math.min(UNIVERSAL_RANK_LABELS.length - 1, Math.trunc(rankIndex)));
}

export function universalRankLabelFromIndex(rankIndex: number): UniversalRankLabel {
  return UNIVERSAL_RANK_LABELS[clampUniversalRankIndex(rankIndex)] ?? 'Recruit';
}
