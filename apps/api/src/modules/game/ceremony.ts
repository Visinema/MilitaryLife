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
  if (gameDay < 15) return 15;
  return Math.floor(gameDay / 15) * 15;
}

function scoreNpc(ceremonyDayValue: number, slot: number, morale: number, health: number): number {
  const growth = Math.floor(ceremonyDayValue / 3);
  const personality = (slot * 17 + ceremonyDayValue * 7) % 35;
  return 45 + growth + personality + Math.floor((morale + health) / 12);
}

function scorePlayer(state: DbGameStateRow): number {
  const base = 40 + state.rank_index * 5;
  const readiness = Math.floor((state.morale + state.health) / 3);
  const service = Math.floor(state.current_day / 4);
  return base + readiness + service;
}

function readOwnership(state: DbGameStateRow, name: string): { medals: Set<string>; ribbons: Set<string> } {
  if (name === state.player_name) {
    return {
      medals: new Set(state.player_medals),
      ribbons: new Set(state.player_ribbons)
    };
  }

  const history = state.npc_award_history[name] ?? { medals: [], ribbons: [] };
  return {
    medals: new Set(Array.isArray(history.medals) ? history.medals : []),
    ribbons: new Set(Array.isArray(history.ribbons) ? history.ribbons : [])
  };
}

function pickUniqueAward(state: DbGameStateRow, candidateName: string, seed: number): { medalName: string; ribbonName: string } | null {
  const owned = readOwnership(state, candidateName);
  const medalStart = seed % MEDALS.length;
  const ribbonStart = seed % RIBBONS.length;

  let medalName: string | null = null;
  for (let i = 0; i < MEDALS.length; i += 1) {
    const value = MEDALS[(medalStart + i) % MEDALS.length];
    if (!owned.medals.has(value)) {
      medalName = value;
      break;
    }
  }

  let ribbonName: string | null = null;
  for (let i = 0; i < RIBBONS.length; i += 1) {
    const value = RIBBONS[(ribbonStart + i) % RIBBONS.length];
    if (!owned.ribbons.has(value)) {
      ribbonName = value;
      break;
    }
  }

  if (!medalName || !ribbonName) return null;
  return { medalName, ribbonName };
}

export function buildCeremonyReport(state: DbGameStateRow): CeremonyReport {
  const currentCeremonyDay = ceremonyDay(state.current_day);
  const previousCeremonyDay = Math.max(15, currentCeremonyDay - 15);
  const registry = buildNpcRegistry(state.branch, MAX_ACTIVE_NPCS);

  const ranked = registry
    .map((npc: { slot: number; name: string; division: string; unit: string; position: string }) => ({
      ...npc,
      competenceScore: scoreNpc(currentCeremonyDay, npc.slot, state.morale, state.health)
    }))
    .sort((a: { competenceScore: number }, b: { competenceScore: number }) => b.competenceScore - a.competenceScore);

  const previousRanked = registry
    .map((npc: { slot: number; name: string; division: string; unit: string; position: string }) => ({
      ...npc,
      competenceScore: scoreNpc(previousCeremonyDay, npc.slot, state.morale, state.health)
    }))
    .sort((a: { competenceScore: number }, b: { competenceScore: number }) => b.competenceScore - a.competenceScore);

  const chief = ranked[0];
  const previousChief = previousRanked[0];

  const candidatePool = [
    ...ranked.slice(1).map((npc) => ({
      name: npc.name,
      division: npc.division,
      unit: npc.unit,
      position: npc.position,
      competenceScore: npc.competenceScore
    })),
    {
      name: state.player_name,
      division: ranked[1]?.division ?? 'Infantry Division',
      unit: ranked[1]?.unit ?? '1st Brigade',
      position: state.player_position,
      competenceScore: scorePlayer(state)
    }
  ].sort((a: { competenceScore: number }, b: { competenceScore: number }) => b.competenceScore - a.competenceScore);

  const missionParticipants = new Set((state.active_mission?.participants ?? []).map((item) => item.name));
  const hasMissionPrestasi = state.last_mission_day > 0 && state.current_day - state.last_mission_day <= 30;
  const highPerformers = candidatePool.filter((x) => x.competenceScore >= chief.competenceScore - 6).length;
  const awardSaturation = Math.min(8, Math.floor((Object.keys(state.npc_award_history).length + state.player_medals.length) / 2));
  const strictnessPenalty = state.morale < 68 ? 1 : 0;
  const baseQuota = Math.floor(chief.competenceScore / 28);
  const quota = hasMissionPrestasi ? Math.max(1, Math.min(8, baseQuota + Math.floor(highPerformers / 6) - awardSaturation - strictnessPenalty)) : 0;

  const missionStatsPool = (state.active_mission?.participantStats ?? []).slice();
  const missionStatsLeaderByField = [
    { field: 'tactical', label: 'tactical execution' },
    { field: 'support', label: 'support logistics' },
    { field: 'leadership', label: 'leadership command' },
    { field: 'resilience', label: 'resilience under fire' }
  ].map((entry) => {
    const rankedByField = missionStatsPool
      .slice()
      .sort((a, b) => (Number((b as Record<string, unknown>)[entry.field]) || 0) - (Number((a as Record<string, unknown>)[entry.field]) || 0));
    return {
      field: entry.field,
      label: entry.label,
      winner: rankedByField[0] ?? null,
      winnerScore: Number((rankedByField[0] as Record<string, unknown> | undefined)?.[entry.field]) || 0
    };
  });

  const recipients: CeremonyRecipient[] = [];
  const awarded = new Set<string>();
  if (hasMissionPrestasi) {
    for (const leader of missionStatsLeaderByField) {
      if (!leader.winner) continue;
      if (awarded.has(leader.winner.name)) continue;
      if (recipients.length >= quota) break;
      const candidate = candidatePool.find((item) => item.name === leader.winner?.name);
      if (!candidate) continue;
      const award = pickUniqueAward(state, candidate.name, recipients.length + currentCeremonyDay);
      if (!award) continue;

      recipients.push({
        order: recipients.length + 1,
        npcName: candidate.name,
        division: candidate.division,
        unit: candidate.unit,
        position: candidate.position,
        medalName: award.medalName,
        ribbonName: award.ribbonName,
        reason: `Kontributor misi tertinggi pada bidang ${leader.label} (${leader.winnerScore}) dengan total skor ${leader.winner.total}.`
      });
      awarded.add(candidate.name);
    }

    for (const candidate of candidatePool) {
      if (recipients.length >= quota) break;
      if (awarded.has(candidate.name)) continue;
      const award = pickUniqueAward(state, candidate.name, recipients.length + currentCeremonyDay);
      if (!award) continue;
      if (candidate.competenceScore < chief.competenceScore - 16) continue;
      const isMissionParticipant = missionParticipants.has(candidate.name);
      if (!isMissionParticipant && candidate.name !== state.player_name) continue;

      recipients.push({
        order: recipients.length + 1,
        npcName: candidate.name,
        division: candidate.division,
        unit: candidate.unit,
        position: candidate.position,
        medalName: award.medalName,
        ribbonName: award.ribbonName,
        reason: `Performa misi + komando ${candidate.competenceScore} menjaga stabilitas operasi pada siklus ini.`
      });
      awarded.add(candidate.name);
    }
  }

  const logs = [
    `Ceremony starts on Day ${currentCeremonyDay}. All ${MAX_ACTIVE_NPCS + 1} personnel are assembled for formation and readiness brief.`,
    `Chief of Staff ${chief.name} sets dynamic quota ${quota} from competence, saturation, and excellence threshold.`,
    hasMissionPrestasi ? 'Mission achievement detected. Medal board activated for this ceremony cycle.' : 'No mission achievement in active window. Medal board locked: impossible to grant medals this cycle.',
    'Award session runs sequentially for one unified category of personnel (player and NPC progression share the same board).',
    `Recipients selected: ${recipients.length}. Tidak semua personel/partisipan otomatis mendapat prestasi atau pita medali tiap siklus.`,
    `Deteksi misi aktif: ${state.active_mission ? `${state.active_mission.missionType} (${state.active_mission.status})` : 'tidak ada'}.`,
    `Peserta misi terdeteksi: ${missionParticipants.size > 0 ? Array.from(missionParticipants).join(', ') : 'tidak ada'}.`,
    `Pemenang kontribusi per bidang: ${missionStatsLeaderByField.filter((item) => item.winner).map((item) => `${item.label}=${item.winner?.name}`).join(', ') || 'belum ada data kontribusi'}.`,
    'Ceremony closes with branch-wide directives for next 15-day operational cycle.'
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
    recipients
  };
}
