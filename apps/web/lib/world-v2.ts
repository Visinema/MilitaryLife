import type { GameSnapshot } from '@mls/shared/game-types';
import { buildNpcRegistry, MAX_ACTIVE_NPCS } from '@mls/shared/npc-registry';
import { REGISTERED_DIVISIONS } from '@mls/shared/division-registry';

export type NpcStatus = 'ACTIVE' | 'INJURED' | 'KIA' | 'RESERVE';
export type RibbonPattern = 'SOLID' | 'CENTER_STRIPE' | 'TRI_BAND' | 'CHEVRON' | 'CHECKER' | 'DIAGONAL';

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

function toBranchLabel(branch: string) {
  return branch.replace('US_', 'US ').replaceAll('_', ' ');
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
  const lawBoost = snapshot.militaryLawCurrent?.rules?.npcCommandDrift ?? 0;
  const progressionScore = Math.floor(tenure * 0.22 + relationScore * 0.8 + (snapshot.morale + snapshot.health) * 0.15 + influenceRecord * 0.75 + lawBoost);
  const commandPower = Math.max(12, Math.min(100, 18 + progressionScore - slot * 1.4 + lawBoost * 0.6));
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
    division: identity.division || REGISTERED_DIVISIONS[0]?.name || 'Unassigned Division',
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
  const history = snapshot.npcAwardHistory ?? {};
  for (const [npcName, row] of Object.entries(history)) {
    const medals = Array.isArray(row?.medals) ? row.medals : [];
    const ribbons = Array.isArray(row?.ribbons) ? row.ribbons : [];
    const length = Math.min(medals.length, ribbons.length);
    if (length === 0) continue;
    const merged = Array.from({ length }, (_, idx) => ({
      medalName: medals[idx] ?? 'Meritorious Service Medal',
      ribbonName: ribbons[idx] ?? 'Ribbon-2'
    }));
    awardsByNpc.set(npcName, merged);
  }

  for (const item of snapshot.ceremonyRecentAwards ?? []) {
    const isPlayerAward = item.npcName === snapshot.playerName && item.position === snapshot.playerPosition;
    if (isPlayerAward) continue;

    const row = awardsByNpc.get(item.npcName) ?? [];
    row.push({ medalName: item.medalName, ribbonName: item.ribbonName });
    awardsByNpc.set(item.npcName, row.slice(-12));
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
      commandAuthority: Math.min(100, 40 + snapshot.gameDay / 5 + influenceRecord * 0.8 + (snapshot.militaryLawCurrent?.rules?.promotionPointMultiplierPct ?? 100) / 50),
      influenceRecord,
      position: snapshot.playerPosition
    },
    roster,
    hierarchy,
    stats,
    missionBrief: {
      title: 'Operation Readiness Grid',
      objective: 'Stabilize supply corridors with realistic pacing and persistent smart-NPC progression.',
      sanctions: 'Commanders can issue warning, duty restriction, and promotion hold for failed orders or insubordination.',
      commandRule: `Hierarchy authority mengikuti Military Law v${snapshot.militaryLawCurrent?.version ?? 0} dengan batas masa jabatan Chief ${snapshot.militaryLawCurrent?.rules?.chiefOfStaffTermLimitDays ?? 0} hari.`,
      recruitmentWindow: snapshot.morale > 72 ? 'Special recruitment open (Tier-1 & specialist tracks).' : 'Standard recruitment only.',
      mandatoryAssignmentEveryDays: 10,
      raiderThreatLevel: raider.raiderThreatLevel,
      raiderTeam: raider.team
    }
  };
}
