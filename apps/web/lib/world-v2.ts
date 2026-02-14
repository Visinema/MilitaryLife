import type { GameSnapshot } from '@mls/shared/game-types';

export type NpcStatus = 'ACTIVE' | 'INJURED' | 'KIA' | 'RESERVE';

export const WORLD_V2_VERSION = '2.2.0';

export interface NpcV2Profile {
  id: string;
  slot: number;
  name: string;
  branch: string;
  rank: string;
  role: string;
  division: string;
  subdivision: string;
  medals: string[];
  ribbons: string[];
  status: NpcStatus;
  commandPower: number;
  joinedOnDay: number;
  lastSeenOnDay: number;
  relationScore: number;
  behaviorTag: 'DISCIPLINED' | 'AGGRESSIVE' | 'SUPPORTIVE' | 'STRATEGIST';
}

export interface WorldV2State {
  player: {
    branchLabel: string;
    rankTrack: 'ENLISTED' | 'WARRANT' | 'OFFICER';
    uniformTone: string;
    medals: string[];
    ribbons: string[];
    commandAuthority: number;
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
  };
}

const FIRST_NAMES = ['Arif', 'Maya', 'Rizal', 'Nadia', 'Bima', 'Alya', 'Reno', 'Sinta', 'Dimas', 'Raka', 'Fikri', 'Tara'];
const LAST_NAMES = ['Pratama', 'Wijaya', 'Santoso', 'Halim', 'Nugroho', 'Putri', 'Saputra', 'Wardani', 'Kurniawan', 'Prameswari'];
const DIVISIONS = ['Infantry', 'Engineering', 'Signals', 'Medical', 'Logistics', 'Special Ops'];
const SUBDIVISIONS = ['Recon', 'Cyber', 'Support', 'Training', 'Forward Command', 'Rapid Response'];
const MEDALS = ['Gallantry Star', 'Meritorious Service', 'Campaign Medal', 'Unit Commendation', 'Leadership Medal'];
const RIBBONS = ['Valor Ribbon', 'Service Ribbon', 'Readiness Ribbon', 'Expeditionary Ribbon', 'Long Service Ribbon'];

function toBranchLabel(branch: string) {
  return branch.replace('US_', 'US ').replace('ID_', 'ID ').replaceAll('_', ' ');
}

function rankTrack(rankCode: string): WorldV2State['player']['rankTrack'] {
  if (rankCode.startsWith('O')) return 'OFFICER';
  if (rankCode.startsWith('WO')) return 'WARRANT';
  return 'ENLISTED';
}

function uniformTone(branch: string) {
  if (branch.includes('NAVY') || branch.includes('AL')) return '#415266';
  return '#4f6159';
}

function seeded(snapshot: GameSnapshot, i: number) {
  return snapshot.gameDay * 97 + snapshot.age * 13 + snapshot.rankCode.length * 7 + i * 17;
}

function pick<T>(source: T[], n: number) {
  return source[Math.abs(n) % source.length];
}

function medalsFor(snapshot: GameSnapshot) {
  const items: string[] = [];
  if (snapshot.gameDay > 60) items.push('Long Service Medal');
  if (snapshot.health >= 85) items.push('Readiness Medal');
  if (snapshot.morale >= 80) items.push('Leadership Commendation');
  if (snapshot.moneyCents > 1_500_000) items.push('Logistics Efficiency');
  if (!items.length) items.push('Initial Entry Ribbon');
  return items;
}

function statusFromRoll(roll: number): NpcStatus {
  if (roll < 68) return 'ACTIVE';
  if (roll < 84) return 'INJURED';
  if (roll < 95) return 'RESERVE';
  return 'KIA';
}


function behaviorTag(seedValue: number): NpcV2Profile['behaviorTag'] {
  const roll = Math.abs(seedValue) % 4;
  if (roll === 0) return 'DISCIPLINED';
  if (roll === 1) return 'AGGRESSIVE';
  if (roll === 2) return 'SUPPORTIVE';
  return 'STRATEGIST';
}

export function buildWorldV2(snapshot: GameSnapshot): WorldV2State {
  const playerMedals = medalsFor(snapshot);
  const playerRibbons = playerMedals.map((_, i) => pick(RIBBONS, seeded(snapshot, i)));

  // NPC identity rotates in waves to simulate recruits replacing old NPCs over time.
  const cycleLength = 45;
  const cycle = Math.floor(snapshot.gameDay / cycleLength);
  const replacementsThisCycle = (snapshot.gameDay % cycleLength) % 7;

  const roster: NpcV2Profile[] = Array.from({ length: 18 }, (_, slot) => {
    const waveOffset = Math.floor((slot + cycle + replacementsThisCycle) / 6);
    const identitySeed = seeded(snapshot, slot) + waveOffset * 29;
    const status = statusFromRoll(Math.abs(identitySeed) % 100);

    const joinedOnDay = Math.max(1, cycle * cycleLength - waveOffset * 6 + slot);
    const lastSeenOnDay = status === 'KIA' ? snapshot.gameDay - ((slot % 4) + 1) : snapshot.gameDay;

    return {
      id: `npc-slot-${slot}-wave-${waveOffset}`,
      slot,
      name: `${pick(FIRST_NAMES, identitySeed)} ${pick(LAST_NAMES, identitySeed * 3)}`,
      branch: toBranchLabel(snapshot.branch),
      rank: slot < 2 ? 'Colonel' : slot < 6 ? 'Major' : slot < 12 ? 'Captain' : 'Sergeant',
      role: slot === 0 ? 'Theater Commander' : slot === 1 ? 'Deputy Commander' : slot < 6 ? 'Division Commander' : 'Field Commander',
      division: pick(DIVISIONS, identitySeed),
      subdivision: pick(SUBDIVISIONS, identitySeed * 2),
      medals: [pick(MEDALS, identitySeed), pick(MEDALS, identitySeed + 2)],
      ribbons: [pick(RIBBONS, identitySeed), pick(RIBBONS, identitySeed + 1)],
      status,
      commandPower: Math.max(10, 100 - slot * 4),
      joinedOnDay,
      lastSeenOnDay,
      relationScore: 35 + (Math.abs(identitySeed) % 60),
      behaviorTag: behaviorTag(identitySeed)
    };
  });

  const hierarchy = [...roster].filter((npc) => npc.status !== 'KIA').sort((a, b) => b.commandPower - a.commandPower).slice(0, 8);

  const stats = {
    active: roster.filter((npc) => npc.status === 'ACTIVE').length,
    injured: roster.filter((npc) => npc.status === 'INJURED').length,
    reserve: roster.filter((npc) => npc.status === 'RESERVE').length,
    kia: roster.filter((npc) => npc.status === 'KIA').length,
    replacementsThisCycle
  };

  return {
    player: {
      branchLabel: toBranchLabel(snapshot.branch),
      rankTrack: rankTrack(snapshot.rankCode),
      uniformTone: uniformTone(snapshot.branch),
      medals: playerMedals,
      ribbons: playerRibbons,
      commandAuthority: Math.min(100, 40 + snapshot.gameDay / 5)
    },
    roster,
    hierarchy,
    stats,
    missionBrief: {
      title: `Operation Iron Network v${WORLD_V2_VERSION}`,
      objective: 'Stabilize supply corridors, rotate command safely, and keep multi-division NPC units synchronized.',
      sanctions: 'Commanders can issue warning, duty restriction, and promotion hold for failed orders or insubordination.',
      commandRule: 'Hierarchy authority flows from theater to division/subdivision leads with morale impact on non-compliance.',
      recruitmentWindow: snapshot.morale > 72 ? 'Special recruitment open (Tier-1 & specialist tracks).' : 'Standard recruitment only.'
    }
  };
}
