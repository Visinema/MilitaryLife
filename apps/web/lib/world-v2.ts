import type { GameSnapshot } from '@mls/shared/game-types';
import { buildNpcRegistry, MAX_ACTIVE_NPCS } from '@mls/shared/npc-registry';

export type NpcStatus = 'ACTIVE' | 'INJURED' | 'KIA' | 'RESERVE';
export type RibbonPattern = 'SOLID' | 'CENTER_STRIPE' | 'TRI_BAND' | 'CHEVRON' | 'CHECKER' | 'DIAGONAL';

export const WORLD_V2_VERSION = '3.2.0';
const MAX_NPCS = MAX_ACTIVE_NPCS;

export interface RibbonStyle {
  id: string;
  name: string;
  colors: [string, string, string];
  pattern: RibbonPattern;
  unlockedBy: string;
  influenceBuff: number;
}

export interface NpcV2Profile {
  id: string;
  slot: number;
  name: string;
  branch: string;
  rank: string;
  role: string;
  division: string;
  subdivision: string;
  unit: string;
  medals: string[];
  ribbons: RibbonStyle[];
  status: NpcStatus;
  commandPower: number;
  joinedOnDay: number;
  lastSeenOnDay: number;
  relationScore: number;
  behaviorTag: 'DISCIPLINED' | 'AGGRESSIVE' | 'SUPPORTIVE' | 'STRATEGIST';
  progressionScore: number;
}

export interface WorldV2State {
  player: {
    branchLabel: string;
    rankLabel: string;
    uniformTone: string;
    medals: string[];
    ribbons: RibbonStyle[];
    commandAuthority: number;
    influenceRecord: number;
    position: string;
  };
  roster: NpcV2Profile[];
  hierarchy: NpcV2Profile[];
  stats: {
    active: number;
    injured: number;
    reserve: number;
    kia: number;
    replacementsThisCycle: number;
  };
  missionBrief: {
    title: string;
    objective: string;
    sanctions: string;
    commandRule: string;
    recruitmentWindow: string;
    mandatoryAssignmentEveryDays: number;
    raiderThreatLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    raiderTeam: Array<{ name: string; readiness: number; role: string; division: string; unit: string }>;
  };
}

const UNIVERSAL_RANKS = ['Recruit', 'Private', 'Corporal', 'Sergeant', 'Staff Sergeant', 'Warrant Officer', 'Lieutenant', 'Captain', 'Major', 'Colonel', 'Brigadier General', 'Major General', 'Lieutenant General', 'General'] as const;

type UniversalRank = (typeof UNIVERSAL_RANKS)[number];

interface RibbonDefinition extends RibbonStyle {
  playerUnlock: (snapshot: GameSnapshot) => boolean;
  npcThreshold: number;
}

const RIBBON_DEFINITIONS: RibbonDefinition[] = [
  { id: 'founders-thread', name: 'Founder\'s Thread', colors: ['#2547c8', '#ffffff', '#2547c8'], pattern: 'CENTER_STRIPE', unlockedBy: 'Awal karier', influenceBuff: 1, playerUnlock: () => true, npcThreshold: 5 },
  { id: 'discipline-band', name: 'Discipline Band', colors: ['#1e3a2f', '#9fd3a7', '#1e3a2f'], pattern: 'TRI_BAND', unlockedBy: 'Morale ≥ 72', influenceBuff: 2, playerUnlock: (s) => s.morale >= 72, npcThreshold: 14 },
  { id: 'resilience-stripe', name: 'Resilience Stripe', colors: ['#5f2a2a', '#f1a98b', '#5f2a2a'], pattern: 'CENTER_STRIPE', unlockedBy: 'Health ≥ 82', influenceBuff: 2, playerUnlock: (s) => s.health >= 82, npcThreshold: 18 },
  { id: 'logistics-grid', name: 'Logistics Grid', colors: ['#3a2e1f', '#d0b276', '#3a2e1f'], pattern: 'CHECKER', unlockedBy: 'Money ≥ 750k', influenceBuff: 2, playerUnlock: (s) => s.moneyCents >= 750_000, npcThreshold: 24 },
  { id: 'campaign-trace', name: 'Campaign Trace', colors: ['#4b4f5f', '#8fa3ff', '#4b4f5f'], pattern: 'DIAGONAL', unlockedBy: 'Game day ≥ 15', influenceBuff: 1, playerUnlock: (s) => s.gameDay >= 15, npcThreshold: 10 },
  { id: 'frontline-chevron', name: 'Frontline Chevron', colors: ['#26412e', '#f4f7f4', '#26412e'], pattern: 'CHEVRON', unlockedBy: 'Game day ≥ 30', influenceBuff: 2, playerUnlock: (s) => s.gameDay >= 30, npcThreshold: 28 },
  { id: 'rapid-response', name: 'Rapid Response', colors: ['#153668', '#78b5ff', '#153668'], pattern: 'SOLID', unlockedBy: 'Morale ≥ 78 & Health ≥ 78', influenceBuff: 3, playerUnlock: (s) => s.morale >= 78 && s.health >= 78, npcThreshold: 30 },
  { id: 'signal-lock', name: 'Signal Lock', colors: ['#1f3f47', '#63d2d6', '#1f3f47'], pattern: 'CENTER_STRIPE', unlockedBy: 'Game day ≥ 45', influenceBuff: 2, playerUnlock: (s) => s.gameDay >= 45, npcThreshold: 33 },
  { id: 'night-watch', name: 'Night Watch', colors: ['#1a1c37', '#7e84d9', '#1a1c37'], pattern: 'TRI_BAND', unlockedBy: 'Game day ≥ 60', influenceBuff: 3, playerUnlock: (s) => s.gameDay >= 60, npcThreshold: 38 },
  { id: 'strategist-mark', name: 'Strategist Mark', colors: ['#2e2f21', '#d7d274', '#2e2f21'], pattern: 'DIAGONAL', unlockedBy: 'Rank code length ≥ 3', influenceBuff: 2, playerUnlock: (s) => s.rankCode.length >= 3, npcThreshold: 35 },
  { id: 'border-shield', name: 'Border Shield', colors: ['#2f3024', '#95a86f', '#2f3024'], pattern: 'CENTER_STRIPE', unlockedBy: 'Game day ≥ 75', influenceBuff: 3, playerUnlock: (s) => s.gameDay >= 75, npcThreshold: 40 },
  { id: 'air-sea-bridge', name: 'Air-Sea Bridge', colors: ['#2f3d56', '#79c4ff', '#2f3d56'], pattern: 'CHECKER', unlockedBy: 'Game day ≥ 90', influenceBuff: 3, playerUnlock: (s) => s.gameDay >= 90, npcThreshold: 45 },
  { id: 'field-mentor', name: 'Field Mentor', colors: ['#453220', '#f0cf91', '#453220'], pattern: 'CHEVRON', unlockedBy: 'Morale ≥ 84', influenceBuff: 3, playerUnlock: (s) => s.morale >= 84, npcThreshold: 48 },
  { id: 'iron-ledger', name: 'Iron Ledger', colors: ['#2f2f2f', '#b9b9b9', '#2f2f2f'], pattern: 'SOLID', unlockedBy: 'Money ≥ 1.5M', influenceBuff: 4, playerUnlock: (s) => s.moneyCents >= 1_500_000, npcThreshold: 55 },
  { id: 'vanguard-seal', name: 'Vanguard Seal', colors: ['#2f2038', '#b78ced', '#2f2038'], pattern: 'TRI_BAND', unlockedBy: 'Game day ≥ 120', influenceBuff: 4, playerUnlock: (s) => s.gameDay >= 120, npcThreshold: 58 },
  { id: 'joint-command', name: 'Joint Command', colors: ['#1d3d3b', '#79e1d9', '#1d3d3b'], pattern: 'CHEVRON', unlockedBy: 'Morale ≥ 88 & Health ≥ 86', influenceBuff: 4, playerUnlock: (s) => s.morale >= 88 && s.health >= 86, npcThreshold: 62 },
  { id: 'steadfast-honor', name: 'Steadfast Honor', colors: ['#3d1f1f', '#ff928f', '#3d1f1f'], pattern: 'CENTER_STRIPE', unlockedBy: 'Health ≥ 90', influenceBuff: 4, playerUnlock: (s) => s.health >= 90, npcThreshold: 64 },
  { id: 'theater-master', name: 'Theater Master', colors: ['#2e2d18', '#f4ec96', '#2e2d18'], pattern: 'DIAGONAL', unlockedBy: 'Game day ≥ 150', influenceBuff: 5, playerUnlock: (s) => s.gameDay >= 150, npcThreshold: 70 },
  { id: 'alliance-banner', name: 'Alliance Banner', colors: ['#173b5f', '#c8e8ff', '#173b5f'], pattern: 'TRI_BAND', unlockedBy: 'Game day ≥ 180', influenceBuff: 5, playerUnlock: (s) => s.gameDay >= 180, npcThreshold: 74 },
  { id: 'legacy-halo', name: 'Legacy Halo', colors: ['#3d2c14', '#f5c56d', '#3d2c14'], pattern: 'CHECKER', unlockedBy: 'Game day ≥ 240', influenceBuff: 6, playerUnlock: (s) => s.gameDay >= 240, npcThreshold: 82 }
];

function toBranchLabel(branch: string) {
  return branch.replace('US_', 'US ').replace('ID_', 'ID ').replaceAll('_', ' ');
}

function universalRankFromScore(score: number): UniversalRank {
  const idx = Math.max(0, Math.min(UNIVERSAL_RANKS.length - 1, Math.floor(score / 10)));
  return UNIVERSAL_RANKS[idx] ?? 'Recruit';
}

function roleFromUniversalRank(rank: UniversalRank, slot: number): string {
  if (rank === 'General' || rank === 'Lieutenant General') return slot === 0 ? 'Theater Commander' : 'Deputy Commander';
  if (rank === 'Major General' || rank === 'Brigadier General' || rank === 'Colonel') return 'Division Commander';
  if (rank === 'Major' || rank === 'Captain') return 'Task Group Commander';
  if (rank === 'Lieutenant' || rank === 'Warrant Officer') return 'Sector Leader';
  return 'Field Commander';
}

function uniformTone(branch: string) {
  if (branch.includes('NAVY') || branch.includes('AL')) return '#415266';
  return '#4f6159';
}

function seeded(snapshot: GameSnapshot, i: number) {
  return snapshot.age * 13 + snapshot.rankCode.length * 7 + i * 17;
}

function pick<T>(source: T[], n: number) {
  return source[Math.abs(n) % source.length];
}

function behaviorTag(seedValue: number): NpcV2Profile['behaviorTag'] {
  const roll = Math.abs(seedValue) % 4;
  if (roll === 0) return 'DISCIPLINED';
  if (roll === 1) return 'AGGRESSIVE';
  if (roll === 2) return 'SUPPORTIVE';
  return 'STRATEGIST';
}


function ribbonFromAwardName(name: string, idx: number): RibbonStyle {
  const palettes: Array<[string, string, string]> = [
    ['#2f3d56', '#79c4ff', '#2f3d56'],
    ['#26412e', '#f4f7f4', '#26412e'],
    ['#5f2a2a', '#f1a98b', '#5f2a2a'],
    ['#2f2038', '#b78ced', '#2f2038']
  ];
  const patterns: RibbonPattern[] = ['CENTER_STRIPE', 'TRI_BAND', 'CHEVRON', 'SOLID'];

  return {
    id: `ceremony-ribbon-${idx}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    colors: palettes[idx % palettes.length] as [string, string, string],
    pattern: patterns[idx % patterns.length] ?? 'CENTER_STRIPE',
    unlockedBy: 'Nominasi Upacara',
    influenceBuff: 2
  };
}

function buildPlayerRibbons(snapshot: GameSnapshot): RibbonStyle[] {
  const awarded = Array.isArray(snapshot.playerRibbons) ? snapshot.playerRibbons : [];
  return awarded.map((name, idx) => ribbonFromAwardName(name, idx));
}

function playerRankScore(snapshot: GameSnapshot, influenceRecord: number): number {
  return snapshot.gameDay * 0.28 + snapshot.morale * 0.3 + snapshot.health * 0.25 + influenceRecord * 2.2;
}

function buildNpcForSlot(snapshot: GameSnapshot, identity: ReturnType<typeof buildNpcRegistry>[number], influenceRecord: number, awardsByNpc: Map<string, Array<{ medalName: string; ribbonName: string }>>, casualtyBySlot: Map<number, { role: string }>): NpcV2Profile {
  const slot = identity.slot;
  const baseSeed = seeded(snapshot, slot * 3 + 11);
  const generation = 0;
  const joinedOnDay = Math.max(1, slot * 2);
  const generationSeed = baseSeed + 101;
  const fallen = casualtyBySlot.get(slot);
  const status: NpcStatus = fallen ? 'KIA' : 'ACTIVE';
  const tenure = Math.max(1, snapshot.gameDay - joinedOnDay);
  const relationScore = 38 + (Math.abs(generationSeed) % 58);
  const progressionScore = Math.floor(tenure * 0.22 + relationScore * 0.8 + (snapshot.morale + snapshot.health) * 0.15 + influenceRecord * 0.75);
  const commandPower = Math.max(12, Math.min(100, 18 + progressionScore - slot * 1.4));
  const rank = universalRankFromScore(progressionScore * 0.35 + commandPower * 0.55);
  const npcName = identity.name;
  const ceremonyAwards = awardsByNpc.get(npcName) ?? [];
  const medals = ceremonyAwards.map((award) => award.medalName).slice(-6);
  const ribbons = ceremonyAwards.map((award, idx) => ribbonFromAwardName(award.ribbonName, slot * 10 + idx)).slice(-6);

  return {
    id: `npc-slot-${slot}-gen-${generation}`,
    slot,
    name: npcName,
    branch: toBranchLabel(snapshot.branch),
    rank,
    role: fallen ? `Fallen (${fallen.role})` : identity.position || roleFromUniversalRank(rank, slot),
    division: identity.division || 'Infantry Division',
    subdivision: identity.subdivision || 'Recon',
    unit: identity.unit || '1st Brigade',
    medals,
    ribbons,
    status,
    commandPower,
    joinedOnDay,
    lastSeenOnDay: Math.max(joinedOnDay, snapshot.gameDay - 1),
    relationScore,
    behaviorTag: behaviorTag(generationSeed),
    progressionScore
  };
}


function buildHierarchyWithQuota(roster: NpcV2Profile[]): NpcV2Profile[] {
  const sorted = [...roster].sort((a, b) => b.commandPower - a.commandPower);
  const perDivision = new Map<string, number>();
  const perUnit = new Map<string, number>();
  const maxPerDivision = 8;
  const maxPerUnit = 5;
  const picked: NpcV2Profile[] = [];

  for (const npc of sorted) {
    const divisionCount = perDivision.get(npc.division) ?? 0;
    const unitCount = perUnit.get(npc.unit) ?? 0;
    if (divisionCount >= maxPerDivision || unitCount >= maxPerUnit) continue;

    picked.push(npc);
    perDivision.set(npc.division, divisionCount + 1);
    perUnit.set(npc.unit, unitCount + 1);
    if (picked.length >= MAX_NPCS) break;
  }

  if (picked.length < Math.min(MAX_NPCS, sorted.length)) {
    for (const npc of sorted) {
      if (picked.some((item) => item.id === npc.id)) continue;
      picked.push(npc);
      if (picked.length >= MAX_NPCS) break;
    }
  }

  return picked;
}

function buildRaiderTeam(hierarchy: NpcV2Profile[], snapshot: GameSnapshot) {
  const candidates = [...hierarchy].sort((a, b) => b.progressionScore - a.progressionScore).slice(0, 6);
  const team = candidates.map((npc, idx) => ({
    name: npc.name,
    readiness: Math.min(100, npc.commandPower + (snapshot.gameDay % (idx + 3))),
    role: idx === 0 ? 'Raider Lead' : idx < 3 ? 'Breach Team' : 'Support Raider',
    division: npc.division,
    unit: npc.unit
  }));
  const avg = team.length ? Math.round(team.reduce((sum, item) => sum + item.readiness, 0) / team.length) : 0;
  const raiderThreatLevel: 'LOW' | 'MEDIUM' | 'HIGH' = avg >= 78 ? 'HIGH' : avg >= 56 ? 'MEDIUM' : 'LOW';
  return { team, raiderThreatLevel };
}

export function buildWorldV2(snapshot: GameSnapshot): WorldV2State {
  const playerRibbons = buildPlayerRibbons(snapshot);
  const playerMedals = Array.isArray(snapshot.playerMedals) ? snapshot.playerMedals.slice(-6) : [];
  const influenceRecord = playerRibbons.reduce((sum, ribbon) => sum + ribbon.influenceBuff, 0);

  const awardsByNpc = new Map<string, Array<{ medalName: string; ribbonName: string }>>();
  for (const item of snapshot.ceremonyRecentAwards ?? []) {
    const isPlayerAward = item.npcName === snapshot.playerName && item.position === snapshot.playerPosition;
    if (isPlayerAward) continue;

    const row = awardsByNpc.get(item.npcName) ?? [];
    row.push({ medalName: item.medalName, ribbonName: item.ribbonName });
    awardsByNpc.set(item.npcName, row);
  }
  const casualtyBySlot = new Map((snapshot.raiderCasualties ?? []).map((item) => [item.slot, { role: item.role }]));
  const registry = buildNpcRegistry(snapshot.branch, MAX_NPCS);
  const roster = registry.map((identity) => buildNpcForSlot(snapshot, identity, influenceRecord, awardsByNpc, casualtyBySlot));
  const hierarchy = buildHierarchyWithQuota(roster.filter((npc) => npc.status !== 'KIA'));

  const stats = {
    active: roster.filter((npc) => npc.status === 'ACTIVE').length,
    injured: 0,
    reserve: 0,
    kia: roster.filter((npc) => npc.status === 'KIA').length,
    replacementsThisCycle: 0
  };
  const raider = buildRaiderTeam(hierarchy, snapshot);

  return {
    player: {
      branchLabel: toBranchLabel(snapshot.branch),
      rankLabel: snapshot.rankCode,
      uniformTone: uniformTone(snapshot.branch),
      medals: playerMedals,
      ribbons: playerRibbons.slice(0, 12),
      commandAuthority: Math.min(100, 40 + snapshot.gameDay / 5 + influenceRecord * 0.8),
      influenceRecord,
      position: snapshot.playerPosition
    },
    roster,
    hierarchy,
    stats,
    missionBrief: {
      title: `Operation Iron Network v${WORLD_V2_VERSION}`,
      objective: 'Stabilize supply corridors with realistic pacing and persistent smart-NPC progression.',
      sanctions: 'Commanders can issue warning, duty restriction, and promotion hold for failed orders or insubordination.',
      commandRule: 'Hierarchy authority flows from theater to division/subdivision leads with morale impact on non-compliance.',
      recruitmentWindow: snapshot.morale > 72 ? 'Special recruitment open (Tier-1 & specialist tracks).' : 'Standard recruitment only.',
      mandatoryAssignmentEveryDays: 10,
      raiderThreatLevel: raider.raiderThreatLevel,
      raiderTeam: raider.team
    }
  };
}
