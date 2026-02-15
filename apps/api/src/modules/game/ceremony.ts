import { buildNpcRegistry, MAX_ACTIVE_NPCS } from '@mls/shared/npc-registry';
import type { CeremonyReport, CeremonyRecipient } from '@mls/shared/game-types';
import type { DbGameStateRow } from './repo.js';

const MEDALS = [
  'Distinguished Service Medal',
  'Meritorious Service Medal',
  'Combat Readiness Medal',
  'Joint Commendation Medal',
  'Leadership Ribbon'
];

const RIBBONS = ['Ribbon-1', 'Ribbon-2', 'Ribbon-3', 'Ribbon-4', 'Ribbon-5'];

function ceremonyDay(gameDay: number): number {
  if (gameDay < 12) return 12;
  return Math.floor(gameDay / 12) * 12;
}

function scoreNpc(ceremonyDayValue: number, slot: number, morale: number, health: number): number {
  const growth = Math.floor(ceremonyDayValue / 3);
  const personality = (slot * 17 + ceremonyDayValue * 7) % 35;
  return 45 + growth + personality + Math.floor((morale + health) / 12);
}

function scorePlayer(state: DbGameStateRow): number {
  return 40 + state.rank_index * 6 + Math.floor((state.morale + state.health) / 3) + Math.floor(state.current_day / 4);
}

function findOwnedAwards(state: DbGameStateRow, personName: string): { medals: Set<string>; ribbons: Set<string> } {
  if (personName === state.player_name) {
    return {
      medals: new Set(state.player_medals),
      ribbons: new Set(state.player_ribbons)
    };
  }

  const owned = state.ceremony_recent_awards.filter((item) => item.npcName === personName);
  return {
    medals: new Set(owned.map((item) => item.medalName)),
    ribbons: new Set(owned.map((item) => item.ribbonName))
  };
}

function pickUniqueAward(state: DbGameStateRow, recipientName: string, orderSeed: number): { medalName: string; ribbonName: string } | null {
  const owned = findOwnedAwards(state, recipientName);
  const medalName = MEDALS.find((medal, idx) => !owned.medals.has(medal) && (idx + orderSeed) % MEDALS.length >= 0) ?? null;
  const ribbonName = RIBBONS.find((ribbon, idx) => !owned.ribbons.has(ribbon) && (idx + orderSeed) % RIBBONS.length >= 0) ?? null;

  if (!medalName || !ribbonName) {
    return null;
  }

  return { medalName, ribbonName };
}

export function buildCeremonyReport(state: DbGameStateRow): CeremonyReport {
  const currentCeremonyDay = ceremonyDay(state.current_day);
  const previousCeremonyDay = Math.max(12, currentCeremonyDay - 12);
  const registry = buildNpcRegistry(state.branch, MAX_ACTIVE_NPCS);

  const ranked = registry
    .map((npc) => ({
      ...npc,
      competenceScore: scoreNpc(currentCeremonyDay, npc.slot, state.morale, state.health)
    }))
    .sort((a, b) => b.competenceScore - a.competenceScore);

  const previousRanked = registry
    .map((npc) => ({
      ...npc,
      competenceScore: scoreNpc(previousCeremonyDay, npc.slot, state.morale, state.health)
    }))
    .sort((a, b) => b.competenceScore - a.competenceScore);

  const chief = ranked[0];
  const previousChief = previousRanked[0];

  const highPerformers = ranked.filter((npc) => npc.competenceScore >= chief.competenceScore - 8).length + (scorePlayer(state) >= chief.competenceScore - 6 ? 1 : 0);
  const recentAwardSaturation = Math.min(6, Math.floor((state.ceremony_recent_awards.length + state.player_medals.length) / 3));
  const baseQuota = Math.round(chief.competenceScore / 24 + state.morale / 35);
  const quota = Math.max(2, Math.min(10, baseQuota + Math.floor(highPerformers / 5) - recentAwardSaturation));

  const candidatePool: Array<{
    name: string;
    division: string;
    unit: string;
    position: string;
    competenceScore: number;
  }> = [
    ...ranked.slice(1).map((npc) => ({
      name: npc.name,
      division: npc.division,
      unit: npc.unit,
      position: npc.position,
      competenceScore: npc.competenceScore
    })),
    {
      name: state.player_name,
      division: 'Player Command Division',
      unit: state.branch,
      position: state.player_position,
      competenceScore: scorePlayer(state)
    }
  ].sort((a, b) => b.competenceScore - a.competenceScore);

  const recipients: CeremonyRecipient[] = [];
  for (const candidate of candidatePool) {
    if (recipients.length >= quota) break;
    const award = pickUniqueAward(state, candidate.name, recipients.length + 1);
    if (!award) continue;

    recipients.push({
      order: recipients.length + 1,
      npcName: candidate.name,
      division: candidate.division,
      unit: candidate.unit,
      position: candidate.position,
      medalName: award.medalName,
      ribbonName: award.ribbonName,
      reason: `Performance score ${candidate.competenceScore} selected by Chief-of-Staff AI quota optimizer.`
    });
  }

  const playerAward = recipients.find((item) => item.npcName === state.player_name && item.position === state.player_position) ?? null;

  const logs = [
    `Ceremony starts on Day ${currentCeremonyDay}. All ${MAX_ACTIVE_NPCS + 1} personnel are assembled for formation and readiness brief.`,
    `Chief of Staff ${chief.name} opens ceremony. Quota AI calculated ${quota} slots from competence, saturation, and active achievements.`,
    'Medal ribbon session is executed sequentially, one recipient at a time, with live command log updates.',
    playerAward
      ? `Player ${playerAward.npcName} enters recipient queue and receives ${playerAward.medalName} with ${playerAward.ribbonName}.`
      : `Player ${state.player_name} is not selected this cycle due to ranking and quota dynamics.`,
    'Ceremony closes with branch-wide directives for next 12-day operational cycle.'
  ];

  return {
    ceremonyDay: currentCeremonyDay,
    attendance: MAX_ACTIVE_NPCS + 1,
    medalQuota: quota,
    chiefOfStaff: {
      name: chief.name,
      competenceScore: chief.competenceScore,
      previousChiefName: previousChief?.name ?? null,
      replacedPreviousChief: Boolean(previousChief && previousChief.name !== chief.name)
    },
    logs,
    recipients,
    playerAward: playerAward
      ? {
          playerName: playerAward.npcName,
          medalName: playerAward.medalName,
          ribbonName: playerAward.ribbonName,
          reason: playerAward.reason
        }
      : null
  };
}
