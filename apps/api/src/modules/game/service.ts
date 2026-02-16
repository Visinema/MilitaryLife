import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import type {
  AcademyCertificate,
  ActionResult,
  CeremonyRecipient,
  CertificationRecordV5,
  DecisionResult,
  GameSnapshot,
  GameSnapshotV5,
  MedalCatalogItem,
  MilitaryLawEntry,
  NewsItem,
  NewsType,
  RaiderCasualty
} from '@mls/shared/game-types';
import { buildNpcRegistry, MAX_ACTIVE_NPCS } from '@mls/shared/npc-registry';
import { GAME_MS_PER_DAY } from '@mls/shared/constants';
import type { BranchCode, CountryCode } from '@mls/shared/constants';
import { BRANCH_CONFIG } from './branch-config.js';
import { buildCeremonyReport } from './ceremony.js';
import {
  advanceGameDays,
  applyDecisionEffects,
  applyDeploymentAction,
  applyTrainingAction,
  autoResumeIfExpired,
  buildSnapshot,
  evaluatePromotionAlgorithm,
  generateMission,
  maybeQueueDecisionEvent,
  pauseState,
  resumeState,
  scheduleNextEventDay,
  snapshotStateForLog,
  synchronizeProgress,
  tryPromotion
} from './engine.js';
import {
  ensureSingleActiveSession,
  getEventById,
  getProfileIdByUserId,
  insertDecisionLog,
  listDecisionLogs,
  lockGameStateByProfileId,
  type DbEventOption,
  type DbGameStateRow,
  updateGameState
} from './repo.js';
import { attachAuth } from '../auth/service.js';
import { buildSnapshotV5, clearV5World, ensureV5World, listCertifications } from '../game-v5/repo.js';

interface LockedStateContext {
  client: PoolClient;
  state: DbGameStateRow;
  nowMs: number;
  profileId: string;
}


type RecruitmentTrack = {
  id: string;
  name: string;
  division: string;
  minRankIndex: number;
  needOfficerCert: boolean;
  needHighCommandCert: boolean;
  rolePool: string[];
  requiredCertificationCount: number;
  exam: Array<{ id: string; answer: string }>;
};

const RECRUITMENT_TRACKS: RecruitmentTrack[] = [
  { id: 'special-forces', name: 'Special Forces Task Group', division: 'Special Operations Division', minRankIndex: 5, needOfficerCert: true, needHighCommandCert: false, rolePool: ['Assault Lead', 'Deep Recon Officer', 'Breach Controller'], requiredCertificationCount: 2, exam: [{ id: 'sf-1', answer: 'Noise discipline' }, { id: 'sf-2', answer: 'Pre-brief exfil corridor' }, { id: 'sf-3', answer: 'Recon → isolate → breach' }, { id: 'sf-4', answer: 'Objective success + low casualty' }] },
  { id: 'military-police-division', name: 'Military Police Division', division: 'Military Police HQ', minRankIndex: 4, needOfficerCert: true, needHighCommandCert: false, rolePool: ['Provost Operations Officer', 'Base Law Commander', 'Escort Security Officer'], requiredCertificationCount: 2, exam: [{ id: 'mp-1', answer: 'Secure scene and record' }, { id: 'mp-2', answer: 'Incident resolution quality' }, { id: 'mp-3', answer: 'Route security + custody protocol' }, { id: 'mp-4', answer: 'Preserve chain of custody' }] },
  { id: 'armored-division', name: 'Armored Division', division: 'Armored Command', minRankIndex: 5, needOfficerCert: true, needHighCommandCert: false, rolePool: ['Armored Operations Officer', 'Tank Battalion XO', 'Mechanized Readiness Officer'], requiredCertificationCount: 2, exam: [{ id: 'ar-1', answer: 'Maintain fuel + flank security' }, { id: 'ar-2', answer: 'When disabled armor blocks lane' }, { id: 'ar-3', answer: 'Operational tanks + repair time' }, { id: 'ar-4', answer: 'Recon + air-defense cover' }] },
  { id: 'air-defense-division', name: 'Air Defense Division', division: 'Air Defense HQ', minRankIndex: 5, needOfficerCert: true, needHighCommandCert: true, rolePool: ['Air Defense Controller', 'Radar Director', 'Counter-UAV Ops Officer'], requiredCertificationCount: 3, exam: [{ id: 'ad-1', answer: 'Detect → classify → engage' }, { id: 'ad-2', answer: 'Intercept rate + false positive low' }, { id: 'ad-3', answer: 'Layered EW + missile discipline' }, { id: 'ad-4', answer: 'Validated inbound threat' }] },
  { id: 'engineering-command', name: 'Combat Engineering Command', division: 'Engineer Command HQ', minRankIndex: 4, needOfficerCert: true, needHighCommandCert: false, rolePool: ['Combat Engineer Planner', 'Field Construction Officer', 'EOD Coordination Officer'], requiredCertificationCount: 2, exam: [{ id: 'en-1', answer: 'Mobility corridor first' }, { id: 'en-2', answer: 'Build speed + safety compliance' }, { id: 'en-3', answer: 'Deploy secondary span protocol' }, { id: 'en-4', answer: 'Isolate + identify + neutralize' }] },
  { id: 'medical-support-division', name: 'Medical Support Division', division: 'Medical Command HQ', minRankIndex: 3, needOfficerCert: true, needHighCommandCert: false, rolePool: ['Forward Medical Officer', 'Triage Command Officer', 'Recovery Planning Officer'], requiredCertificationCount: 2, exam: [{ id: 'md-1', answer: 'Life-saving first by severity' }, { id: 'md-2', answer: 'Survival rate + evacuation speed' }, { id: 'md-3', answer: 'Activate surge protocol' }, { id: 'md-4', answer: 'Daily bio-monitor screening' }] },
  { id: 'signal-cyber-corps', name: 'Signal & Cyber Corps', division: 'Signal Cyber HQ', minRankIndex: 6, needOfficerCert: true, needHighCommandCert: true, rolePool: ['Cyber Incident Commander', 'Signal Security Officer', 'SOC Mission Coordinator'], requiredCertificationCount: 3, exam: [{ id: 'cy-1', answer: 'Contain and isolate segment' }, { id: 'cy-2', answer: 'Uptime + breach containment time' }, { id: 'cy-3', answer: 'Primary comm compromised' }, { id: 'cy-4', answer: 'Risk-based priority with rollback plan' }] },
  { id: 'military-judge-corps', name: 'Military Judge Corps', division: 'Military Court Division', minRankIndex: 6, needOfficerCert: true, needHighCommandCert: true, rolePool: ['Associate Military Judge', 'Panel Military Judge', 'Chief Clerk of Court'], requiredCertificationCount: 4, exam: [{ id: 'mj-1', answer: 'Evidence integrity and due process' }, { id: 'mj-2', answer: 'Chain of command accountability' }, { id: 'mj-3', answer: 'Proportional sanction recommendation' }, { id: 'mj-4', answer: 'Impartial review with legal basis' }] }
];



const REGISTERED_DIVISION_NAMES = Array.from(new Set(RECRUITMENT_TRACKS.map((track) => track.division)));

const MILITARY_LAW_CHIEF_TERM_OPTIONS = [
  { id: 'TERM_42', label: '42 Hari', value: 42, promotionDelta: -8, driftDelta: -4 },
  { id: 'TERM_54', label: '54 Hari', value: 54, promotionDelta: -3, driftDelta: -2 },
  { id: 'TERM_60', label: '60 Hari', value: 60, promotionDelta: 0, driftDelta: 0 },
  { id: 'TERM_72', label: '72 Hari', value: 72, promotionDelta: 4, driftDelta: 1 },
  { id: 'TERM_90', label: '90 Hari', value: 90, promotionDelta: 8, driftDelta: 2 }
] as const;

const MILITARY_LAW_CABINET_OPTIONS = [
  { id: 'CABINET_5', label: '5 Kursi', value: 5, promotionDelta: -3, driftDelta: -2 },
  { id: 'CABINET_6', label: '6 Kursi', value: 6, promotionDelta: 0, driftDelta: 0 },
  { id: 'CABINET_7', label: '7 Kursi', value: 7, promotionDelta: 2, driftDelta: 1 },
  { id: 'CABINET_8', label: '8 Kursi', value: 8, promotionDelta: 4, driftDelta: 2 },
  { id: 'CABINET_9', label: '9 Kursi', value: 9, promotionDelta: 6, driftDelta: 3 }
] as const;

const MILITARY_LAW_OPTIONAL_POST_OPTIONS = [
  {
    id: 'POSTS_MINIMAL',
    label: 'Minimal Command Posts',
    posts: ['Chief Compliance Officer'],
    promotionDelta: -2,
    driftDelta: -2
  },
  {
    id: 'POSTS_BALANCED',
    label: 'Balanced Command Posts',
    posts: ['Inspector General', 'Strategic Cyber Marshal'],
    promotionDelta: 0,
    driftDelta: 0
  },
  {
    id: 'POSTS_EXPEDITIONARY',
    label: 'Expeditionary Command Posts',
    posts: ['Expeditionary Commander', 'Raider Response Chancellor', 'Logistics War Comptroller'],
    promotionDelta: 5,
    driftDelta: 4
  },
  {
    id: 'POSTS_OVERSIGHT',
    label: 'Civil Oversight Posts',
    posts: ['Civil Liaison Marshal', 'Budget Oversight Secretary'],
    promotionDelta: -1,
    driftDelta: 1
  }
] as const;

type MilitaryLawDraftSelection = {
  chiefTermOptionId: (typeof MILITARY_LAW_CHIEF_TERM_OPTIONS)[number]['id'];
  cabinetOptionId: (typeof MILITARY_LAW_CABINET_OPTIONS)[number]['id'];
  optionalPostOptionId: (typeof MILITARY_LAW_OPTIONAL_POST_OPTIONS)[number]['id'];
};

function fallbackSelection(): MilitaryLawDraftSelection {
  return {
    chiefTermOptionId: 'TERM_60',
    cabinetOptionId: 'CABINET_6',
    optionalPostOptionId: 'POSTS_BALANCED'
  };
}

function selectionFromCurrentLaw(state: DbGameStateRow): MilitaryLawDraftSelection {
  const current = state.military_law_current?.articleSelection;
  if (current) {
    return {
      chiefTermOptionId: current.chiefTermOptionId,
      cabinetOptionId: current.cabinetOptionId,
      optionalPostOptionId: current.optionalPostOptionId
    };
  }
  return fallbackSelection();
}

function applyArticleVoteToSelection(
  base: MilitaryLawDraftSelection,
  payload:
    | { articleKey: 'chiefTerm'; optionId: MilitaryLawDraftSelection['chiefTermOptionId']; rationale?: string }
    | { articleKey: 'cabinet'; optionId: MilitaryLawDraftSelection['cabinetOptionId']; rationale?: string }
    | { articleKey: 'optionalPosts'; optionId: MilitaryLawDraftSelection['optionalPostOptionId']; rationale?: string }
): MilitaryLawDraftSelection {
  if (payload.articleKey === 'chiefTerm') {
    return { ...base, chiefTermOptionId: payload.optionId };
  }

  if (payload.articleKey === 'cabinet') {
    return { ...base, cabinetOptionId: payload.optionId };
  }

  return { ...base, optionalPostOptionId: payload.optionId };
}

function buildMilitaryLawArticleOptions() {
  return {
    chiefTerm: MILITARY_LAW_CHIEF_TERM_OPTIONS.map((item) => ({ id: item.id, label: item.label, valueDays: item.value })),
    cabinet: MILITARY_LAW_CABINET_OPTIONS.map((item) => ({ id: item.id, label: item.label, seatCount: item.value })),
    optionalPosts: MILITARY_LAW_OPTIONAL_POST_OPTIONS.map((item) => ({ id: item.id, label: item.label, posts: item.posts }))
  };
}

function findChiefTermOption(id: MilitaryLawDraftSelection['chiefTermOptionId']) {
  return MILITARY_LAW_CHIEF_TERM_OPTIONS.find((item) => item.id === id) ?? MILITARY_LAW_CHIEF_TERM_OPTIONS[2];
}

function findCabinetOption(id: MilitaryLawDraftSelection['cabinetOptionId']) {
  return MILITARY_LAW_CABINET_OPTIONS.find((item) => item.id === id) ?? MILITARY_LAW_CABINET_OPTIONS[1];
}

function findOptionalPostsOption(id: MilitaryLawDraftSelection['optionalPostOptionId']) {
  return MILITARY_LAW_OPTIONAL_POST_OPTIONS.find((item) => item.id === id) ?? MILITARY_LAW_OPTIONAL_POST_OPTIONS[1];
}

function mlcEligibleMembers(state: DbGameStateRow): number {
  const base = 4 + Math.floor(state.current_day / 14);
  const rankFactor = state.rank_index >= 9 ? 2 : state.rank_index >= 7 ? 1 : 0;
  return Math.max(5, Math.min(MAX_ACTIVE_NPCS, base + rankFactor));
}

function isLmcEligibleRank(state: DbGameStateRow): boolean {
  const ranks = BRANCH_CONFIG[state.branch].ranks;
  const currentRank = (ranks[state.rank_index] ?? '').toLowerCase();
  return currentRank.includes('major') || currentRank.includes('mayor') || currentRank.includes('colonel') || currentRank.includes('kolonel') || currentRank.includes('general') || state.rank_index >= 7;
}

function computeCouncilVoteDistribution(state: DbGameStateRow, members: number, initiatedByPlayer: boolean): { votesFor: number; votesAgainst: number } {
  const stabilityMomentum = (state.national_stability + state.military_stability) / 2;
  const trustBonus = initiatedByPlayer ? Math.min(14, Math.max(0, state.rank_index - 4) * 2) : 8;
  const supportPct = Math.max(52, Math.min(89, Math.round(52 + stabilityMomentum * 0.22 + trustBonus - state.corruption_risk * 0.15)));
  const votesFor = Math.max(Math.floor(members / 2) + 1, Math.round((members * supportPct) / 100));
  return {
    votesFor: Math.min(members, votesFor),
    votesAgainst: Math.max(0, members - votesFor)
  };
}

function scheduledSelectionForDay(day: number): MilitaryLawDraftSelection {
  return {
    chiefTermOptionId: MILITARY_LAW_CHIEF_TERM_OPTIONS[Math.max(0, day) % MILITARY_LAW_CHIEF_TERM_OPTIONS.length]?.id ?? 'TERM_60',
    cabinetOptionId: MILITARY_LAW_CABINET_OPTIONS[Math.max(0, day + 1) % MILITARY_LAW_CABINET_OPTIONS.length]?.id ?? 'CABINET_6',
    optionalPostOptionId: MILITARY_LAW_OPTIONAL_POST_OPTIONS[Math.max(0, day + 2) % MILITARY_LAW_OPTIONAL_POST_OPTIONS.length]?.id ?? 'POSTS_BALANCED'
  };
}

function composeCustomRules(selection: MilitaryLawDraftSelection): MilitaryLawEntry['rules'] {
  const chiefTerm = findChiefTermOption(selection.chiefTermOptionId);
  const cabinet = findCabinetOption(selection.cabinetOptionId);
  const optionalPosts = findOptionalPostsOption(selection.optionalPostOptionId);

  const promotionPointMultiplierPct = Math.max(80, Math.min(130, 100 + chiefTerm.promotionDelta + cabinet.promotionDelta + optionalPosts.promotionDelta));
  const npcCommandDrift = Math.max(-8, Math.min(8, chiefTerm.driftDelta + cabinet.driftDelta + optionalPosts.driftDelta));

  return {
    cabinetSeatCount: cabinet.value,
    chiefOfStaffTermLimitDays: chiefTerm.value,
    optionalPosts: [...optionalPosts.posts],
    promotionPointMultiplierPct,
    npcCommandDrift
  };
}

function composeMilitaryLawEntry(
  state: DbGameStateRow,
  selection: MilitaryLawDraftSelection,
  votesFor: number,
  votesAgainst: number,
  initiatedBy: string
): MilitaryLawEntry {
  const chiefTerm = findChiefTermOption(selection.chiefTermOptionId);
  const cabinet = findCabinetOption(selection.cabinetOptionId);
  const optionalPosts = findOptionalPostsOption(selection.optionalPostOptionId);
  const previousVersion = state.military_law_current?.version ?? 0;

  return {
    version: previousVersion + 1,
    presetId: 'CUSTOM',
    title: `Custom Military Law v${previousVersion + 1}`,
    summary: `Chief ${chiefTerm.value} hari, kabinet ${cabinet.value} kursi, paket jabatan ${optionalPosts.label}.`,
    enactedDay: state.current_day,
    votesFor,
    votesAgainst,
    councilMembers: votesFor + votesAgainst,
    initiatedBy,
    articleSelection: selection,
    rules: composeCustomRules(selection)
  };
}

function enactMilitaryLawByNpc(state: DbGameStateRow, selection: MilitaryLawDraftSelection, nowDay: number): MilitaryLawEntry {
  const members = mlcEligibleMembers(state);
  const { votesFor, votesAgainst } = computeCouncilVoteDistribution(state, members, false);
  const enacted = composeMilitaryLawEntry(state, selection, votesFor, votesAgainst, `Highrank NPC Council Day-${nowDay}`);
  state.military_law_current = enacted;
  state.military_law_logs = [...state.military_law_logs, enacted].slice(-40);
  state.national_stability = clampScore(state.national_stability + (enacted.rules.npcCommandDrift >= 0 ? 2 : -1));
  state.military_stability = clampScore(state.military_stability + (enacted.rules.npcCommandDrift >= 0 ? 3 : 1));
  state.promotion_points = Math.max(0, Math.round(state.promotion_points * (enacted.rules.promotionPointMultiplierPct / 100)));
  return enacted;
}

function maybeAutoGovernMilitaryLaw(state: DbGameStateRow): void {
  if (!state.military_law_current) {
    if (state.current_day >= 3) {
      enactMilitaryLawByNpc(state, scheduledSelectionForDay(state.current_day), state.current_day);
    }
    return;
  }

  const activeLaw = state.military_law_current;
  const npcReviewIntervalDays = Math.max(18, Math.min(45, activeLaw.rules.chiefOfStaffTermLimitDays));
  if (state.current_day - activeLaw.enactedDay >= npcReviewIntervalDays) {
    enactMilitaryLawByNpc(state, scheduledSelectionForDay(state.current_day), state.current_day);
  }
}

function militaryLawCouncilStatus(state: DbGameStateRow): {
  canPlayerVote: boolean;
  meetingActive: boolean;
  meetingDay: number;
  totalMeetingDays: number;
  scheduledSelection: MilitaryLawDraftSelection | null;
  note: string;
} {
  if (state.military_law_current) {
    return {
      canPlayerVote: isLmcEligibleRank(state),
      meetingActive: false,
      meetingDay: 3,
      totalMeetingDays: 3,
      scheduledSelection: null,
      note: 'Military Law aktif. Perubahan dapat diajukan per pasal oleh pejabat minimal Major.'
    };
  }

  const meetingDay = Math.min(3, Math.max(1, state.current_day + 1));
  const scheduledSelection = scheduledSelectionForDay(state.current_day);
  return {
    canPlayerVote: isLmcEligibleRank(state),
    meetingActive: state.current_day < 3,
    meetingDay,
    totalMeetingDays: 3,
    scheduledSelection,
    note: state.current_day < 3
      ? `Rapat NPC highrank sedang berlangsung (${meetingDay}/3 hari) untuk konfigurasi pasal terjadwal.`
      : 'Rapat NPC highrank telah selesai untuk konfigurasi pasal terjadwal.'
  };
}

function evaluateMilitaryLawVoteAccess(state: DbGameStateRow): { ok: true } | { ok: false; statusCode: 403 | 409; error: string } {
  if (!isLmcEligibleRank(state)) {
    return {
      ok: false,
      statusCode: 403,
      error: 'Perubahan Military Law hanya dapat diajukan oleh rank Major atau lebih tinggi.'
    };
  }

  if (!state.military_law_current && state.current_day < 3) {
    return {
      ok: false,
      statusCode: 409,
      error: 'Rapat NPC highrank untuk Military Law awal sedang berlangsung 3 hari. Tunggu hingga rapat selesai.'
    };
  }

  return { ok: true };
}

function computeMilitaryLawVotes(state: DbGameStateRow): { members: number; votesFor: number; votesAgainst: number } {
  const members = mlcEligibleMembers(state);
  const stabilityBias = Math.max(-0.08, Math.min(0.08, (state.military_stability - 50) / 500));
  const confidenceBias = Math.max(-0.05, Math.min(0.05, (state.morale - 50) / 600));
  const approvalRatio = Math.max(0.52, Math.min(0.82, 0.6 + stabilityBias + confidenceBias));
  const votesFor = Math.max(Math.ceil(members * approvalRatio), Math.floor(members / 2) + 1);
  return {
    members,
    votesFor,
    votesAgainst: Math.max(0, members - votesFor)
  };
}


function academyAllowedDivisions(divisionFreedomScore: number): string[] {
  if (divisionFreedomScore >= 80) return REGISTERED_DIVISION_NAMES;
  if (divisionFreedomScore >= 60) return REGISTERED_DIVISION_NAMES.slice(0, Math.max(6, REGISTERED_DIVISION_NAMES.length - 1));
  if (divisionFreedomScore >= 40) return REGISTERED_DIVISION_NAMES.slice(0, Math.max(4, Math.ceil(REGISTERED_DIVISION_NAMES.length / 2)));
  return REGISTERED_DIVISION_NAMES.slice(0, 3);
}

const MEDAL_CATALOG: MedalCatalogItem[] = [
  {
    code: 'STAR_OF_VALOR',
    name: 'Star of Valor',
    description: 'Aksi heroik pada misi berbahaya dengan dampak strategis tinggi.',
    minimumMissionSuccess: 3,
    minimumDangerTier: 'HIGH',
    criteria: ['Mission success rate > 80%', 'No critical misconduct', 'Contributed in high/ extreme risk operations']
  },
  {
    code: 'JOINT_COMMAND_CROSS',
    name: 'Joint Command Cross',
    description: 'Koordinasi lintas divisi dengan efisiensi tinggi dan casualty rendah.',
    minimumMissionSuccess: 2,
    minimumDangerTier: 'MEDIUM',
    criteria: ['Joint operation executed', 'Casualties below threshold', 'Stable military morale']
  },
  {
    code: 'TRIBUNAL_INTEGRITY_MEDAL',
    name: 'Tribunal Integrity Medal',
    description: 'Ketegasan penegakan disiplin militer tanpa bias.',
    minimumMissionSuccess: 1,
    minimumDangerTier: 'LOW',
    criteria: ['Successful court case resolution', 'Zero corruption flag during review cycle', 'Integrity score maintained']
  },
  {
    code: 'RAIDER_SUPPRESSION_RIBBON',
    name: 'Raider Suppression Ribbon',
    description: 'Kontribusi pada penanggulangan raider internal.',
    minimumMissionSuccess: 2,
    minimumDangerTier: 'HIGH',
    criteria: ['Counter-raider objective completed', 'Base infrastructure loss minimized', 'Team readiness maintained']
  }
];

interface StateCheckpoint {
  activeSessionId: string | null;
  serverReferenceTimeMs: number;
  currentDay: number;
  pausedAtMs: number | null;
  pauseReason: DbGameStateRow['pause_reason'];
  pauseToken: string | null;
  pauseExpiresAtMs: number | null;
  gameTimeScale: 1 | 3;
  rankIndex: number;
  moneyCents: number;
  morale: number;
  health: number;
  promotionPoints: number;
  daysInRank: number;
  nextEventDay: number;
  lastMissionDay: number;
  academyTier: number;
  lastTravelPlace: string | null;
  certificateInventory: DbGameStateRow['certificate_inventory'];
  divisionFreedomScore: number;
  preferredDivision: string | null;
  ceremonyCompletedDay: number;
  ceremonyRecentAwards: DbGameStateRow['ceremony_recent_awards'];
  playerMedals: DbGameStateRow['player_medals'];
  playerRibbons: DbGameStateRow['player_ribbons'];
  playerPosition: string;
  playerDivision: string;
  npcAwardHistory: DbGameStateRow['npc_award_history'];
  raiderLastAttackDay: number;
  raiderCasualties: DbGameStateRow['raider_casualties'];
  nationalStability: number;
  militaryStability: number;
  militaryFundCents: number;
  fundSecretaryNpc: string | null;
  corruptionRisk: number;
  courtPendingCases: DbGameStateRow['court_pending_cases'];
  militaryLawCurrent: DbGameStateRow['military_law_current'];
  militaryLawLogs: DbGameStateRow['military_law_logs'];
  pendingEventId: number | null;
  pendingEventPayload: DbGameStateRow['pending_event_payload'];
  missionCallIssuedDay: number;
  activeMission: DbGameStateRow['active_mission'];
}

function createStateCheckpoint(state: DbGameStateRow): StateCheckpoint {
  return {
    activeSessionId: state.active_session_id,
    serverReferenceTimeMs: state.server_reference_time_ms,
    currentDay: state.current_day,
    pausedAtMs: state.paused_at_ms,
    pauseReason: state.pause_reason,
    pauseToken: state.pause_token,
    pauseExpiresAtMs: state.pause_expires_at_ms,
    gameTimeScale: state.game_time_scale,
    rankIndex: state.rank_index,
    moneyCents: state.money_cents,
    morale: state.morale,
    health: state.health,
    promotionPoints: state.promotion_points,
    daysInRank: state.days_in_rank,
    nextEventDay: state.next_event_day,
    lastMissionDay: state.last_mission_day,
    academyTier: state.academy_tier,
    lastTravelPlace: state.last_travel_place,
    certificateInventory: state.certificate_inventory,
    divisionFreedomScore: state.division_freedom_score,
    preferredDivision: state.preferred_division,
    ceremonyCompletedDay: state.ceremony_completed_day,
    ceremonyRecentAwards: state.ceremony_recent_awards,
    playerMedals: state.player_medals,
    playerRibbons: state.player_ribbons,
    playerPosition: state.player_position,
    playerDivision: state.player_division,
    npcAwardHistory: state.npc_award_history,
    raiderLastAttackDay: state.raider_last_attack_day,
    raiderCasualties: state.raider_casualties,
    nationalStability: state.national_stability,
    militaryStability: state.military_stability,
    militaryFundCents: state.military_fund_cents,
    fundSecretaryNpc: state.fund_secretary_npc,
    corruptionRisk: state.corruption_risk,
    courtPendingCases: state.court_pending_cases,
    militaryLawCurrent: state.military_law_current,
    militaryLawLogs: state.military_law_logs,
    pendingEventId: state.pending_event_id,
    pendingEventPayload: state.pending_event_payload,
    missionCallIssuedDay: state.mission_call_issued_day,
    activeMission: state.active_mission
  };
}

function hasStateChanged(state: DbGameStateRow, checkpoint: StateCheckpoint): boolean {
  return (
    state.active_session_id !== checkpoint.activeSessionId ||
    state.server_reference_time_ms !== checkpoint.serverReferenceTimeMs ||
    state.current_day !== checkpoint.currentDay ||
    state.paused_at_ms !== checkpoint.pausedAtMs ||
    state.pause_reason !== checkpoint.pauseReason ||
    state.pause_token !== checkpoint.pauseToken ||
    state.pause_expires_at_ms !== checkpoint.pauseExpiresAtMs ||
    state.game_time_scale !== checkpoint.gameTimeScale ||
    state.rank_index !== checkpoint.rankIndex ||
    state.money_cents !== checkpoint.moneyCents ||
    state.morale !== checkpoint.morale ||
    state.health !== checkpoint.health ||
    state.promotion_points !== checkpoint.promotionPoints ||
    state.days_in_rank !== checkpoint.daysInRank ||
    state.next_event_day !== checkpoint.nextEventDay ||
    state.last_mission_day !== checkpoint.lastMissionDay ||
    state.academy_tier !== checkpoint.academyTier ||
    state.last_travel_place !== checkpoint.lastTravelPlace ||
    state.certificate_inventory !== checkpoint.certificateInventory ||
    state.division_freedom_score !== checkpoint.divisionFreedomScore ||
    state.preferred_division !== checkpoint.preferredDivision ||
    state.ceremony_completed_day !== checkpoint.ceremonyCompletedDay ||
    state.ceremony_recent_awards !== checkpoint.ceremonyRecentAwards ||
    state.player_medals !== checkpoint.playerMedals ||
    state.player_ribbons !== checkpoint.playerRibbons ||
    state.player_position !== checkpoint.playerPosition ||
    state.player_division !== checkpoint.playerDivision ||
    state.npc_award_history !== checkpoint.npcAwardHistory ||
    state.raider_last_attack_day !== checkpoint.raiderLastAttackDay ||
    state.raider_casualties !== checkpoint.raiderCasualties ||
    state.national_stability !== checkpoint.nationalStability ||
    state.military_stability !== checkpoint.militaryStability ||
    state.military_fund_cents !== checkpoint.militaryFundCents ||
    state.fund_secretary_npc !== checkpoint.fundSecretaryNpc ||
    state.corruption_risk !== checkpoint.corruptionRisk ||
    state.court_pending_cases !== checkpoint.courtPendingCases ||
    state.military_law_current !== checkpoint.militaryLawCurrent ||
    state.military_law_logs !== checkpoint.militaryLawLogs ||
    state.pending_event_id !== checkpoint.pendingEventId ||
    state.pending_event_payload !== checkpoint.pendingEventPayload ||
    state.mission_call_issued_day !== checkpoint.missionCallIssuedDay ||
    state.active_mission !== checkpoint.activeMission
  );
}

async function getProfileIdOrNull(client: PoolClient, request: FastifyRequest): Promise<string | null> {
  if (request.auth?.profileId) {
    return request.auth.profileId;
  }

  if (!request.auth?.userId) {
    return null;
  }

  return getProfileIdByUserId(client, request.auth.userId);
}

async function withLockedState(
  request: FastifyRequest,
  reply: FastifyReply,
  options: { queueEvents: boolean },
  execute: (ctx: LockedStateContext) => Promise<{ payload: unknown; statusCode?: number }>
): Promise<void> {
  await attachAuth(request);

  if (!request.auth) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  const client = await request.server.db.connect();
  try {
    await client.query('BEGIN');

    const profileId = await getProfileIdOrNull(client, request);
    if (!profileId) {
      await client.query('ROLLBACK');
      reply.code(404).send({ error: 'Profile not found' });
      return;
    }

    if (!request.auth.sessionId) {
      await client.query('ROLLBACK');
      reply.code(401).send({ error: 'Invalid session' });
      return;
    }

    const sessionGuard = await ensureSingleActiveSession(client, profileId, request.auth.sessionId);
    if (sessionGuard === 'conflict') {
      await client.query('ROLLBACK');
      reply.code(409).send({ error: 'Another active session is controlling this profile' });
      return;
    }

    const state = await lockGameStateByProfileId(client, profileId);
    if (!state) {
      await client.query('ROLLBACK');
      reply.code(404).send({ error: 'Game state not found' });
      return;
    }

    const nowMs = Date.now();
    const initialStateCheckpoint = createStateCheckpoint(state);
    autoResumeIfExpired(state, nowMs);
    synchronizeProgress(state, nowMs);
    maybeIssueMissionCall(state, nowMs, request.server.env.PAUSE_TIMEOUT_MINUTES);
    enforceMissionCallPause(state, nowMs, request.server.env.PAUSE_TIMEOUT_MINUTES);
    enforceCeremonyPause(state, nowMs, request.server.env.PAUSE_TIMEOUT_MINUTES);

    if (options.queueEvents && !state.paused_at_ms && !state.pending_event_id) {
      await maybeQueueDecisionEvent(client, state, nowMs, request.server.env.PAUSE_TIMEOUT_MINUTES);
    }

    const result = await execute({ client, state, nowMs, profileId });

    if (hasStateChanged(state, initialStateCheckpoint)) {
      await updateGameState(client, state);
    }
    await client.query('COMMIT');

    reply.code(result.statusCode ?? 200).send(result.payload);
  } catch (err) {
    await client.query('ROLLBACK');
    request.log.error(err, 'game-service-failure');
    throw err;
  } finally {
    client.release();
  }
}

const BRANCH_COUNTRY_MAP: Record<BranchCode, CountryCode> = {
  US_ARMY: 'US',
  US_NAVY: 'US'
};

function inferCountryFromBranch(branch: BranchCode): CountryCode {
  return BRANCH_COUNTRY_MAP[branch];
}

function splitAssignment(assignment: string): { division: string; position: string } {
  const parts = assignment.split('-').map((item) => item.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { division: parts[0] ?? 'Nondivisi', position: parts.slice(1).join(' - ') };
  }
  return { division: assignment || 'Nondivisi', position: assignment || 'Staff Officer' };
}

function academyTierFromCertification(cert: CertificationRecordV5): 1 | 2 | 3 {
  const match = cert.certCode.toUpperCase().match(/(?:^|_)T([123])(?:_|$)/);
  if (match) {
    const value = Number(match[1]);
    if (value >= 3) return 3;
    if (value <= 1) return 1;
    return 2;
  }
  if (cert.tier >= 3) return 3;
  if (cert.tier <= 1) return 1;
  return 2;
}

function academyScoreFromGrade(grade: CertificationRecordV5['grade'], tier: 1 | 2 | 3): number {
  const base = grade === 'A' ? 94 : grade === 'B' ? 86 : grade === 'C' ? 77 : 66;
  return Math.max(0, Math.min(100, base + (tier - 1) * 2));
}

function academyLabelFromCertification(cert: CertificationRecordV5, tier: 1 | 2 | 3): string {
  const track = cert.track.toUpperCase();
  const trackLabel =
    track === 'HIGH_COMMAND' ? 'High Command' :
    track === 'SPECIALIST' ? 'Specialist' :
    track === 'TRIBUNAL' ? 'Tribunal' :
    track === 'CYBER' ? 'Cyber' :
    'Officer';
  const code = cert.certCode.toUpperCase();
  if (code.includes('DIPLOMA')) return `Diploma Academy ${trackLabel} T${tier}`;
  if (code.includes('ADV_CERT') || code.includes('EXTRA_CERT')) return `Sertifikasi Lanjutan ${trackLabel} T${tier}`;
  return `Sertifikasi ${trackLabel} T${tier}`;
}

function mapV5CertificationsToLegacyInventory(certifications: CertificationRecordV5[]): AcademyCertificate[] {
  return certifications
    .filter((item) => item.valid && item.holderType === 'PLAYER')
    .sort((a, b) => {
      if (b.issuedDay !== a.issuedDay) return b.issuedDay - a.issuedDay;
      if (b.tier !== a.tier) return b.tier - a.tier;
      return b.certCode.localeCompare(a.certCode);
    })
    .map((item) => {
      const tier = academyTierFromCertification(item);
      const track = item.track.toUpperCase();
      const assignedDivision =
        track === 'HIGH_COMMAND' ? 'Strategic Command' :
        track === 'SPECIALIST' ? 'Specialist Corps' :
        track === 'TRIBUNAL' ? 'Military Tribunal' :
        track === 'CYBER' ? 'Cyber Command' :
        'Officer Corps';
      const divisionFreedomLevel: AcademyCertificate['divisionFreedomLevel'] =
        tier >= 3 ? (item.grade === 'A' ? 'ELITE' : 'ADVANCED') :
        tier === 2 ? (item.grade === 'A' || item.grade === 'B' ? 'ADVANCED' : 'STANDARD') :
        (item.grade === 'A' ? 'STANDARD' : 'LIMITED');
      return {
        id: item.certId,
        tier,
        academyName: academyLabelFromCertification(item, tier),
        score: academyScoreFromGrade(item.grade, tier),
        grade: item.grade,
        divisionFreedomLevel,
        trainerName: 'Military Academy Board V5',
        issuedAtDay: item.issuedDay,
        message: item.valid
          ? `${item.certCode} valid hingga day ${item.expiresDay}.`
          : `${item.certCode} tidak valid.`,
        assignedDivision
      };
    });
}

function mapV5SnapshotToLegacy(snapshot: GameSnapshotV5, nowMs: number, certificates: AcademyCertificate[] = []): GameSnapshot {
  const worldDay = snapshot.world.currentDay;
  const gameTimeScale: 1 | 3 = snapshot.world.gameTimeScale === 3 ? 3 : 1;
  const serverReferenceTimeMs = snapshot.serverNowMs - Math.floor((worldDay * GAME_MS_PER_DAY) / gameTimeScale);
  const ceremonyCycleDay = worldDay >= 15 ? worldDay - (worldDay % 15) : 0;
  const ceremonyDue = Boolean(snapshot.pendingCeremony && snapshot.pendingCeremony.status === 'PENDING');
  const nextCeremonyDay = worldDay < 15 ? 15 : worldDay % 15 === 0 ? worldDay + 15 : worldDay + (15 - (worldDay % 15));
  const assignment = splitAssignment(snapshot.player.assignment);
  const branchConfig = BRANCH_CONFIG[snapshot.player.branch];
  const rankCode = branchConfig?.ranks[snapshot.player.rankIndex] ?? branchConfig?.ranks.at(-1) ?? 'UNKNOWN';
  const governance = snapshot.expansion?.governanceSummary;
  const raiderThreat = snapshot.expansion?.raiderThreat;
  const courtCases = snapshot.expansion?.openCourtCases ?? [];

  return {
    serverNowMs: nowMs,
    serverReferenceTimeMs,
    gameDay: worldDay,
    inGameDate: `Day ${worldDay}`,
    age: 18 + Math.floor(worldDay / 365),
    playerName: snapshot.player.playerName,
    country: inferCountryFromBranch(snapshot.player.branch),
    branch: snapshot.player.branch,
    rankCode,
    rankIndex: snapshot.player.rankIndex,
    moneyCents: snapshot.player.moneyCents,
    morale: snapshot.player.morale,
    health: snapshot.player.health,
    paused: false,
    pauseReason: null,
    pauseToken: null,
    pauseExpiresAtMs: null,
    gameTimeScale,
    lastMissionDay: snapshot.activeMission?.issuedDay ?? 0,
    academyTier: snapshot.expansion?.academyBatch?.tier ?? 0,
    academyCertifiedOfficer: (snapshot.expansion?.academyBatch?.tier ?? 0) >= 1,
    academyCertifiedHighOfficer: (snapshot.expansion?.academyBatch?.tier ?? 0) >= 2,
    lastTravelPlace: null,
    certificates,
    divisionFreedomScore: 0,
    preferredDivision: assignment.division,
    divisionAccess: null,
    pendingDecision: null,
    missionCallDue: false,
    missionCallIssuedDay: null,
    activeMission: null,
    ceremonyDue,
    nextCeremonyDay,
    ceremonyCompletedDay: ceremonyDue ? Math.max(0, ceremonyCycleDay - 15) : ceremonyCycleDay,
    ceremonyRecentAwards: (snapshot.pendingCeremony?.awards ?? []).map((award) => ({
      order: award.orderNo,
      npcName: award.recipientName,
      division: 'N/A',
      unit: 'N/A',
      position: 'N/A',
      medalName: award.medal,
      ribbonName: award.ribbon,
      reason: award.reason
    })),
    playerMedals: [],
    playerRibbons: [],
    npcAwardHistory: {},
    playerPosition: assignment.position,
    playerDivision: assignment.division,
    raiderLastAttackDay: raiderThreat?.lastAttackDay ?? 0,
    raiderCasualties: [],
    nationalStability: governance?.nationalStability ?? 72,
    militaryStability: governance?.militaryStability ?? 70,
    militaryFundCents: governance?.militaryFundCents ?? 250_000,
    fundSecretaryNpc: null,
    secretaryVacancyDays: 0,
    secretaryEscalationRisk: 'LOW',
    corruptionRisk: governance?.corruptionRisk ?? 18,
    pendingCourtCases: courtCases.map((item) => ({
      id: item.caseId,
      day: item.requestedDay,
      title: `${item.caseType} ${item.targetType}`,
      severity: item.caseType === 'DISMISSAL' ? 'HIGH' : item.caseType === 'DEMOTION' ? 'MEDIUM' : 'LOW',
      status: item.status,
      requestedBy: 'SYSTEM'
    })),
    militaryLawCurrent: null,
    militaryLawLogs: [],
    mlcEligibleMembers: snapshot.expansion?.councils?.length ?? 0
  };
}

async function buildV5BackedLegacySnapshot(request: FastifyRequest, nowMs: number): Promise<GameSnapshot | null> {
  if (!request.auth?.userId) return null;

  const client = await request.server.db.connect();
  try {
    await client.query('BEGIN');
    const profileId = await getProfileIdByUserId(client, request.auth.userId);
    if (!profileId) {
      await client.query('ROLLBACK');
      return null;
    }

    const profileRow = await client.query<{ player_name: string; branch: BranchCode }>(
      `SELECT name AS player_name, branch::text AS branch FROM profiles WHERE id = $1 LIMIT 1`,
      [profileId]
    );
    const profile = profileRow.rows[0];
    if (!profile) {
      await client.query('ROLLBACK');
      return null;
    }

    await ensureV5World(client, { profileId, playerName: profile.player_name, branch: profile.branch }, nowMs);
    const playerCerts = await listCertifications(client, profileId, { holderType: 'PLAYER' });
    const certificateInventory = mapV5CertificationsToLegacyInventory(playerCerts);
    const v5Snapshot = await buildSnapshotV5(client, profileId, nowMs);
    await client.query('COMMIT');
    return v5Snapshot ? mapV5SnapshotToLegacy(v5Snapshot, nowMs, certificateInventory) : null;
  } catch (error) {
    await client.query('ROLLBACK');
    request.log.error(error, 'legacy-snapshot-v5-fallback-failed');
    return null;
  } finally {
    client.release();
  }
}

export async function getSnapshot(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await withLockedState(
      request,
      reply,
      { queueEvents: true },
      async ({ state, nowMs }) => ({ payload: { snapshot: buildSnapshot(state, nowMs) } })
    );
  } catch (error) {
    request.log.error(error, 'legacy-snapshot-primary-failed');
    const fallback = await buildV5BackedLegacySnapshot(request, Date.now());
    if (fallback) {
      reply.code(200).send({ snapshot: fallback, source: 'v5-fallback' });
      return;
    }
    throw error;
  }
}

export async function pauseGame(
  request: FastifyRequest,
  reply: FastifyReply,
  reason: 'DECISION' | 'MODAL' | 'SUBPAGE'
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    if (state.pause_reason === 'DECISION' && state.pause_token) {
      return {
        payload: {
          pauseToken: state.pause_token,
          pauseExpiresAtMs: state.pause_expires_at_ms,
          snapshot: buildSnapshot(state, nowMs)
        }
      };
    }

    const pauseToken = pauseState(state, reason, nowMs, request.server.env.PAUSE_TIMEOUT_MINUTES);
    return {
      payload: {
        pauseToken,
        pauseExpiresAtMs: state.pause_expires_at_ms,
        snapshot: buildSnapshot(state, nowMs)
      }
    };
  });
}

export async function resumeGame(request: FastifyRequest, reply: FastifyReply, pauseToken: string): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    if (!state.paused_at_ms) {
      return { payload: { snapshot: buildSnapshot(state, nowMs) } };
    }

    if (!state.pause_token || state.pause_token !== pauseToken) {
      const canBypassTokenForModal = state.pause_reason === 'MODAL' && !ceremonyPending(state);
      if (canBypassTokenForModal) {
        resumeState(state, nowMs);
        synchronizeProgress(state, nowMs);
        return {
          payload: {
            snapshot: buildSnapshot(state, nowMs),
            warning: 'Pause token mismatch auto-recovered for modal pause'
          }
        };
      }

      return {
        payload: {
          error: 'Invalid pause token',
          code: 'PAUSE_TOKEN_MISMATCH',
          snapshot: buildSnapshot(state, nowMs),
          details: {
            pauseReason: state.pause_reason,
            ceremonyDue: ceremonyPending(state)
          }
        },
        statusCode: 409
      };
    }

    if (ceremonyPending(state)) {
      return {
        payload: {
          error: 'Complete mandatory ceremony before resuming',
          code: 'CEREMONY_REQUIRED',
          snapshot: buildSnapshot(state, nowMs)
        },
        statusCode: 409
      };
    }

    resumeState(state, nowMs);
    synchronizeProgress(state, nowMs);

    return { payload: { snapshot: buildSnapshot(state, nowMs) } };
  });
}


function hasCommandAccess(state: DbGameStateRow): boolean {
  const ranks = BRANCH_CONFIG[state.branch].ranks;
  const currentRank = (ranks[state.rank_index] ?? '').toLowerCase();
  const captainIndex = ranks.findIndex((rank) => {
    const lowered = rank.toLowerCase();
    return lowered.includes('captain') || lowered.includes('kapten');
  });

  if (captainIndex >= 0) {
    return state.rank_index >= captainIndex;
  }

  return currentRank.includes('major') || currentRank.includes('colonel') || currentRank.includes('general') || state.rank_index >= 8;
}


function currentCeremonyCycleDay(gameDay: number): number {
  if (gameDay < 15) return 0;
  return Math.floor(gameDay / 15) * 15;
}

function nextCeremonyDayFrom(gameDay: number): number {
  if (gameDay < 15) return 15;
  return gameDay % 15 === 0 ? gameDay + 15 : gameDay + (15 - (gameDay % 15));
}

function ceremonyPending(state: DbGameStateRow): boolean {
  const cycleDay = currentCeremonyCycleDay(state.current_day);
  return cycleDay >= 15 && state.ceremony_completed_day < cycleDay;
}

function enforceCeremonyPause(state: DbGameStateRow, nowMs: number, timeoutMinutes: number): void {
  if (!ceremonyPending(state)) return;
  if (state.pause_reason === 'DECISION') return;
  pauseState(state, 'SUBPAGE', nowMs, timeoutMinutes);
}

function ensureNoPendingDecision(state: DbGameStateRow): string | null {
  if (state.pending_event_id) return 'Resolve pending decision before taking actions';
  if (ceremonyPending(state)) return 'Ceremony is mandatory today. Open Ceremony page to proceed.';
  if (state.active_mission?.status === 'ACTIVE' && !state.active_mission.playerParticipates) {
    return 'Mission call active. Please choose ikut/tidak ikut dulu.';
  }
  return null;
}

function buildMissionParticipants(state: DbGameStateRow, playerParticipates: boolean): Array<{ name: string; role: 'PLAYER' | 'NPC' }> {
  const casualtySlots = new Set((state.raider_casualties ?? []).map((item) => item.slot));
  const activeNpcRoster = buildNpcRegistry(state.branch, MAX_ACTIVE_NPCS).filter((npc) => !casualtySlots.has(npc.slot));
  const freeTimeRoster = activeNpcRoster.filter((npc) => {
    const cycleSeed = state.current_day + state.mission_call_issued_day + state.last_mission_day + npc.slot * 3;
    return cycleSeed % 4 !== 0;
  });
  const sourceRoster = freeTimeRoster.length >= 4 ? freeTimeRoster : activeNpcRoster;
  const dynamicSeat = Math.max(4, Math.min(8, sourceRoster.length));
  const startOffset = sourceRoster.length === 0
    ? 0
    : Math.abs(state.current_day * 11 + state.rank_index * 7 + state.mission_call_issued_day * 5) % sourceRoster.length;

  const rotatedRoster = sourceRoster.length === 0
    ? []
    : [...sourceRoster.slice(startOffset), ...sourceRoster.slice(0, startOffset)];

  const npcParticipants = rotatedRoster
    .slice(0, dynamicSeat)
    .map((npc) => ({ name: npc.name, role: 'NPC' as const }));

  if (!playerParticipates) {
    return npcParticipants;
  }
  return [{ name: state.player_name, role: 'PLAYER' as const }, ...npcParticipants.slice(0, Math.max(3, dynamicSeat - 1))];
}

function computeMissionParticipantStats(
  participants: Array<{ name: string; role: 'PLAYER' | 'NPC' }>,
  state: DbGameStateRow,
  dangerTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME',
  success: boolean
): Array<{ name: string; role: 'PLAYER' | 'NPC'; tactical: number; support: number; leadership: number; resilience: number; total: number }> {
  const dangerWeight = { LOW: 4, MEDIUM: 8, HIGH: 12, EXTREME: 16 }[dangerTier];
  return participants.map((member, idx) => {
    const seed = state.current_day * 37 + member.name.length * 13 + idx * 17 + state.rank_index * 19 + (success ? 23 : 7);
    const tactical = Math.max(0, Math.min(100, 40 + dangerWeight + (seed % 23)));
    const support = Math.max(0, Math.min(100, 34 + Math.floor(dangerWeight / 2) + ((seed * 3) % 29)));
    const leadershipBase = member.role === 'PLAYER' ? 44 : 30;
    const leadership = Math.max(0, Math.min(100, leadershipBase + Math.floor(state.rank_index * 2.2) + ((seed * 5) % 21)));
    const resilience = Math.max(0, Math.min(100, 30 + Math.floor((state.health + state.morale) / 5) + ((seed * 7) % 17)));
    const total = tactical + support + leadership + resilience;
    return {
      name: member.name,
      role: member.role,
      tactical,
      support,
      leadership,
      resilience,
      total
    };
  }).sort((a, b) => b.total - a.total);
}

function maybeIssueMissionCall(state: DbGameStateRow, nowMs: number, timeoutMinutes: number): void {
  const missionIntervalDays = 10;
  const ensureModalPause = () => {
    if (state.pause_reason === 'DECISION') return;
    if (!state.paused_at_ms) {
      pauseState(state, 'MODAL', nowMs, timeoutMinutes);
      return;
    }
    if (state.pause_reason !== 'MODAL') {
      state.pause_reason = 'MODAL';
      state.pause_expires_at_ms = nowMs + timeoutMinutes * 60_000;
    }
  };

  if (state.active_mission?.status === 'ACTIVE') {
    ensureModalPause();
    return;
  }

  const currentCycle = Math.floor(state.current_day / missionIntervalDays);
  const lastIssuedCycle = Math.floor(Math.max(0, state.mission_call_issued_day) / missionIntervalDays);
  if (currentCycle <= 0 || currentCycle <= lastIssuedCycle) return;

  state.active_mission = {
    missionId: `mission-call-${state.current_day}-${randomUUID().slice(0, 8)}`,
    issuedDay: state.current_day,
    missionType: 'COUNTER_RAID',
    dangerTier: state.rank_index >= 8 ? 'HIGH' : 'MEDIUM',
    playerParticipates: false,
    status: 'ACTIVE',
    participants: buildMissionParticipants(state, false)
  };
  state.mission_call_issued_day = state.current_day;
  ensureModalPause();
}

function enforceMissionCallPause(state: DbGameStateRow, nowMs: number, timeoutMinutes: number): void {
  if (!state.active_mission || state.active_mission.status !== 'ACTIVE') return;
  if (state.active_mission.playerParticipates) return;
  if (state.pause_reason === 'DECISION') return;
  pauseState(state, 'MODAL', nowMs, timeoutMinutes);
}

export async function runTraining(
  request: FastifyRequest,
  reply: FastifyReply,
  intensity: 'LOW' | 'MEDIUM' | 'HIGH'
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const pendingError = ensureNoPendingDecision(state);
    if (pendingError) {
      return { statusCode: 409, payload: { error: pendingError, snapshot: buildSnapshot(state, nowMs) } };
    }

    const action = applyTrainingAction(state, intensity);
    const promoted = tryPromotion(state);

    const snapshot = buildSnapshot(state, nowMs);
    const payload: ActionResult = {
      type: 'TRAINING',
      snapshot,
      details: {
        ...action.details,
        promoted,
        rankCode: snapshot.rankCode
      }
    };

    return { payload };
  });
}

export async function runDeployment(
  request: FastifyRequest,
  reply: FastifyReply,
  missionType: 'PATROL' | 'SUPPORT',
  missionDurationDays = 2
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const pendingError = ensureNoPendingDecision(state);
    if (pendingError) {
      const snapshot = buildSnapshot(state, nowMs);
      const payload: ActionResult = {
        type: 'DEPLOYMENT',
        snapshot,
        details: {
          blocked: true,
          reason: pendingError,
          rankCode: snapshot.rankCode
        }
      };
      return { payload };
    }

    const missionCooldownDays = 10;
    const daysSinceLastMission = Math.max(0, state.current_day - state.last_mission_day);
    if (daysSinceLastMission < missionCooldownDays) {
      const waitDays = missionCooldownDays - daysSinceLastMission;
      const snapshot = buildSnapshot(state, nowMs);
      const payload: ActionResult = {
        type: 'DEPLOYMENT',
        snapshot,
        details: {
          blocked: true,
          reason: `Mission assignment not ready. Next assignment available in ${waitDays} in-game day(s).`,
          daysUntilNextMission: waitDays,
          rankCode: snapshot.rankCode
        }
      };
      return { payload };
    }

    const mission = generateMission(state);
    const action = applyDeploymentAction(state, missionType, mission);
    const durationMultiplier = state.game_time_scale === 3 ? 3 : 1;
    const effectiveMissionDurationDays = Math.max(1, Math.ceil(missionDurationDays / durationMultiplier));
    const advancedDays = advanceGameDays(state, effectiveMissionDurationDays);
    state.last_mission_day = state.current_day;
    if (state.active_mission?.status === 'ACTIVE' && state.active_mission.playerParticipates) {
      state.active_mission = {
        ...state.active_mission,
        status: 'RESOLVED',
        archivedUntilCeremonyDay: nextCeremonyDayFrom(state.current_day)
      };
    }
    const promoted = tryPromotion(state);

    const snapshot = buildSnapshot(state, nowMs);
    const payload: ActionResult = {
      type: 'DEPLOYMENT',
      snapshot,
      details: {
        ...action.details,
        promoted,
        rankCode: snapshot.rankCode,
        missionDurationDays: effectiveMissionDurationDays,
        advancedDays,
        nextMissionInDays: missionCooldownDays,
        terrain: mission.terrain,
        objective: mission.objective,
        enemyStrength: mission.enemyStrength,
        difficultyRating: mission.difficultyRating,
        equipmentQuality: mission.equipmentQuality,
        promotionRecommendation: promoted ? 'PROMOTION_CONFIRMED' : evaluatePromotionAlgorithm(state).recommendation
      }
    };

    return { payload };
  });
}

export async function runCareerReview(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withLockedState(request, reply, { queueEvents: true }, async ({ state, nowMs }) => {
    const pendingError = ensureNoPendingDecision(state);
    if (pendingError) {
      return { statusCode: 409, payload: { error: pendingError, snapshot: buildSnapshot(state, nowMs) } };
    }

    const promotionEvaluation = evaluatePromotionAlgorithm(state);
    const promoted = tryPromotion(state);
    if (!promoted) {
      state.morale = Math.max(0, state.morale - 1);
    }

    const snapshot = buildSnapshot(state, nowMs);
    const payload: ActionResult = {
      type: 'CAREER_REVIEW',
      snapshot,
      details: {
        promoted,
        rankCode: snapshot.rankCode,
        promotionRecommendation: promotionEvaluation.recommendation,
        serviceYears: promotionEvaluation.serviceYears,
        minimumServiceYears: promotionEvaluation.minimumServiceYears,
        meritPoints: promotionEvaluation.meritPoints,
        minimumMeritPoints: promotionEvaluation.minimumMeritPoints,
        vacancyAvailabilityPercent: promotionEvaluation.vacancyAvailabilityPercent,
        rejectionLetter: promoted ? null : promotionEvaluation.rejectionLetter
      }
    };

    return { payload };
  });
}

export async function runMilitaryAcademy(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: {
    tier: 1 | 2;
    answers: number[] | null;
    preferredDivision?: string;
  }
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const pendingError = ensureNoPendingDecision(state);
    if (pendingError) {
      return { statusCode: 409, payload: { error: pendingError, snapshot: buildSnapshot(state, nowMs) } };
    }

    const { tier, answers, preferredDivision } = payload;

    const correctMap = tier === 2 ? [4, 2, 3, 1, 4] : [2, 3, 1, 4, 2];
    const hasInteractiveAnswers = Array.isArray(answers) && answers.length === 5;

    let score = 0;
    if (hasInteractiveAnswers) {
      const normalizedAnswers = (answers as number[]).slice(0, 5);
      for (let i = 0; i < correctMap.length; i += 1) {
        if (normalizedAnswers[i] === correctMap[i]) {
          score += 20;
        }
      }
    } else {
      const legacyBase = Math.round((state.morale * 0.45 + state.health * 0.35 + Math.min(100, state.promotion_points * 2) * 0.2));
      score = Math.max(40, Math.min(100, legacyBase));
    }

    const passThreshold = tier === 2 ? 80 : 60;
    if (score < passThreshold) {
      state.morale = Math.max(0, state.morale - 2);
      return {
        payload: {
          type: 'MILITARY_ACADEMY',
          snapshot: buildSnapshot(state, nowMs),
          details: {
            passed: false,
            score,
            passThreshold,
            message: hasInteractiveAnswers
              ? 'Assessment not passed. Repeat academy training phase.'
              : 'Legacy academy check did not pass threshold. Open training phase for full assessment.'
          }
        }
      };
    }

    const fee = tier === 2 ? 3200 : 1800;
    const moraleBoost = tier === 2 ? 5 : 3;
    const healthBoost = tier === 2 ? 2 : 1;
    const pointsBoost = tier === 2 ? 8 : 5;

    state.money_cents = Math.max(0, state.money_cents - fee);
    state.morale = Math.min(100, state.morale + moraleBoost);
    state.health = Math.min(100, state.health + healthBoost);
    state.promotion_points += pointsBoost;
    state.academy_tier = Math.max(state.academy_tier, tier);

    const lieutenantIndex = BRANCH_CONFIG[state.branch].ranks.findIndex((rank) => {
      const lowered = rank.toLowerCase();
      return (lowered.includes('lieutenant') || lowered.includes('letnan')) && !lowered.includes('jendral') && !lowered.includes('general');
    });

    if (lieutenantIndex >= 0 && state.rank_index < lieutenantIndex) {
      state.rank_index = lieutenantIndex;
      state.days_in_rank = 0;
    }

    const freedomIncrement = Math.max(10, Math.floor(score / 2));
    state.division_freedom_score = Math.min(100, state.division_freedom_score + freedomIncrement);

    const allowedDivisions = academyAllowedDivisions(state.division_freedom_score);

    const divisionRoleUnlocks =
      state.division_freedom_score >= 80
        ? ['Division Commander Track', 'Joint Task Force Chief', 'Strategic Operations Staff', 'Cross-Corps Command Integrator']
        : state.division_freedom_score >= 60
          ? ['Brigade Operations Officer', 'Division Staff Planner', 'Inter-Unit Doctrine Coordinator']
          : ['Company Ops Lead', 'Junior Division Liaison'];

    state.preferred_division = preferredDivision && allowedDivisions.includes(preferredDivision) ? preferredDivision : allowedDivisions[0];
    const primaryDivision = state.preferred_division ?? allowedDivisions[0] ?? 'Nondivisi';
    const primaryDivisionHead = evaluateDivisionHead(state, primaryDivision);
    const logisticsDivisionHead = evaluateDivisionHead(state, 'Engineer Command HQ');
    const medicalDivisionHead = evaluateDivisionHead(state, 'Medical Command HQ');
    const cyberDivisionHead = evaluateDivisionHead(state, 'Signal Cyber HQ');
    const legalDivisionHead = evaluateDivisionHead(state, 'Military Court Division');

    const grade: 'A' | 'B' | 'C' | 'D' = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : 'D';
    const freedomLevel: 'LIMITED' | 'STANDARD' | 'ADVANCED' | 'ELITE' =
      state.division_freedom_score >= 80
        ? 'ELITE'
        : state.division_freedom_score >= 60
          ? 'ADVANCED'
          : state.division_freedom_score >= 40
            ? 'STANDARD'
            : 'LIMITED';

    const certificate = {
      id: `${state.profile_id}-${Date.now()}-${tier}`,
      tier,
      academyName: tier === 2 ? 'Grand Staff Military Academy' : 'Officer Foundation Military Academy',
      score,
      grade,
      divisionFreedomLevel: freedomLevel,
      trainerName: primaryDivisionHead.name,
      issuedAtDay: state.current_day,
      message: `Congratulations on your successful completion of the academy assessment phase. Signed by ${primaryDivisionHead.name}, Acting Head of ${primaryDivision}.`,
      assignedDivision: primaryDivision
    };

    const specializationCertificates = [
      {
        id: `${state.profile_id}-${Date.now()}-${tier}-spec-core`,
        tier,
        academyName: `Operational Certification · ${primaryDivision} Core`,
        score: Math.max(70, score - 5),
        grade,
        divisionFreedomLevel: freedomLevel,
        trainerName: primaryDivisionHead.name,
        issuedAtDay: state.current_day,
        message: 'Specialized certification for divisional role standards.',
        assignedDivision: primaryDivision
      },
      {
        id: `${state.profile_id}-${Date.now()}-${tier}-spec-log`,
        tier,
        academyName: 'Logistics Throughput Certification',
        score: Math.max(72, score - 4),
        grade,
        divisionFreedomLevel: freedomLevel,
        trainerName: logisticsDivisionHead.name,
        issuedAtDay: state.current_day,
        message: 'Supply tempo, budget control, and convoy resilience.',
        assignedDivision: 'Engineer Command HQ'
      },
      {
        id: `${state.profile_id}-${Date.now()}-${tier}-spec-med`,
        tier,
        academyName: 'Field Medical Coordination Certification',
        score: Math.max(71, score - 4),
        grade,
        divisionFreedomLevel: freedomLevel,
        trainerName: medicalDivisionHead.name,
        issuedAtDay: state.current_day,
        message: 'Combat triage command and evacuation corridor protocol.',
        assignedDivision: 'Medical Command HQ'
      },
      ...(tier === 2
        ? [{
            id: `${state.profile_id}-${Date.now()}-${tier}-spec-joint`,
            tier,
            academyName: 'Joint Command Certification',
            score: Math.max(75, score - 2),
            grade,
            divisionFreedomLevel: freedomLevel,
            trainerName: primaryDivisionHead.name,
            issuedAtDay: state.current_day,
            message: 'Joint-task-force command certification.',
            assignedDivision: primaryDivision
          }, {
            id: `${state.profile_id}-${Date.now()}-${tier}-spec-cyber`,
            tier,
            academyName: 'Cyber Defense Operations Certification',
            score: Math.max(76, score - 1),
            grade,
            divisionFreedomLevel: freedomLevel,
            trainerName: cyberDivisionHead.name,
            issuedAtDay: state.current_day,
            message: 'Advanced threat containment and resilient command-network doctrine.',
            assignedDivision: 'Signal Cyber HQ'
          }, {
            id: `${state.profile_id}-${Date.now()}-${tier}-spec-legal`,
            tier,
            academyName: 'Military Law & Tribunal Procedure Certification',
            score: Math.max(74, score - 2),
            grade,
            divisionFreedomLevel: freedomLevel,
            trainerName: legalDivisionHead.name,
            issuedAtDay: state.current_day,
            message: 'Command accountability and tribunal-grade evidence discipline.',
            assignedDivision: 'Military Court Division'
          }]
        : [])
    ];

    const existing = Array.isArray(state.certificate_inventory) ? state.certificate_inventory : [];
    const merged = [certificate, ...specializationCertificates, ...existing];
    const dedup = merged.filter((item, idx, arr) => arr.findIndex((row) => row.academyName === item.academyName && row.assignedDivision === item.assignedDivision) === idx);
    state.certificate_inventory = dedup.slice(0, 40);

    const snapshot = buildSnapshot(state, nowMs);
    const actionPayload: ActionResult = {
      type: 'MILITARY_ACADEMY',
      snapshot,
      details: {
        passed: true,
        certificate,
        academyTier: state.academy_tier,
        fee,
        moraleBoost,
        healthBoost,
        pointsBoost,
        divisionFreedomScore: state.division_freedom_score,
        allowedDivisions,
        assessmentMode: hasInteractiveAnswers ? 'INTERACTIVE' : 'LEGACY_COMPAT',
        certificateBenefits: {
          divisionRoleUnlocks,
          promotionChanceBonusPercent: tier === 2 ? 12 : 7,
          totalCertifications: state.certificate_inventory.length
        }
      }
    };

    return { payload: actionPayload };
  });
}

export async function runTravel(
  request: FastifyRequest,
  reply: FastifyReply,
  place: 'BASE_HQ' | 'BORDER_OUTPOST' | 'LOGISTICS_HUB' | 'TACTICAL_TOWN'
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const pendingError = ensureNoPendingDecision(state);
    if (pendingError) {
      return { statusCode: 409, payload: { error: pendingError, snapshot: buildSnapshot(state, nowMs) } };
    }

    const effects = {
      BASE_HQ: { cost: 300, morale: 2, health: 1, points: 1 },
      BORDER_OUTPOST: { cost: 800, morale: 1, health: -1, points: 3 },
      LOGISTICS_HUB: { cost: 450, morale: 1, health: 0, points: 2 },
      TACTICAL_TOWN: { cost: 650, morale: 3, health: 1, points: 2 }
    }[place];

    state.money_cents = Math.max(0, state.money_cents - effects.cost);
    state.morale = Math.max(0, Math.min(100, state.morale + effects.morale));
    state.health = Math.max(0, Math.min(100, state.health + effects.health));
    state.promotion_points += effects.points;
    state.last_travel_place = place;
    advanceGameDays(state, 1);

    const snapshot = buildSnapshot(state, nowMs);
    const payload: ActionResult = {
      type: 'TRAVEL',
      snapshot,
      details: {
        place,
        travelCost: effects.cost,
        moraleDelta: effects.morale,
        healthDelta: effects.health,
        promotionPointDelta: effects.points,
        etaDays: 1
      }
    };

    return { payload };
  });
}

export async function chooseDecision(
  request: FastifyRequest,
  reply: FastifyReply,
  eventId: number,
  optionId: string
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs, client, profileId }) => {
    if (!state.pending_event_id || state.pending_event_id !== eventId) {
      return {
        payload: {
          result: null,
          conflict: true,
          reason: state.pending_event_id ? 'Pending decision changed on server' : 'No pending decision available',
          snapshot: buildSnapshot(state, nowMs)
        }
      };
    }

    const event = await getEventById(client, eventId);
    if (!event) {
      return { statusCode: 404, payload: { error: 'Event not found' } };
    }

    const selected = event.options.find((option: DbEventOption) => option.id === optionId);
    if (!selected) {
      return { statusCode: 400, payload: { error: 'Invalid option selected' } };
    }

    const before = snapshotStateForLog(state);
    const applied = applyDecisionEffects(state, selected.effects ?? {});
    const promoted = tryPromotion(state);

    state.pending_event_id = null;
    state.pending_event_payload = null;
    scheduleNextEventDay(state);

    resumeState(state, nowMs);
    synchronizeProgress(state, nowMs);

    const after = snapshotStateForLog(state);

    await insertDecisionLog(client, {
      profileId,
      eventId,
      gameDay: state.current_day,
      selectedOption: optionId,
      consequences: applied,
      stateBefore: before,
      stateAfter: after
    });

    const decisionResult: DecisionResult = {
      applied,
      promoted,
      newRankCode: BRANCH_CONFIG[state.branch].ranks[state.rank_index] ?? 'UNKNOWN'
    };

    return {
      payload: {
        result: decisionResult,
        snapshot: buildSnapshot(state, nowMs)
      }
    };
  });
}



export async function runCommandAction(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { action: 'PLAN_MISSION' | 'ISSUE_SANCTION' | 'ISSUE_PROMOTION'; targetNpcId?: string; note?: string }
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const pendingError = ensureNoPendingDecision(state);
    if (pendingError) {
      return { statusCode: 409, payload: { error: pendingError, snapshot: buildSnapshot(state, nowMs) } };
    }

    const canAccessCommand = hasCommandAccess(state);
    if (!canAccessCommand) {
      const currentRank = BRANCH_CONFIG[state.branch].ranks[state.rank_index] ?? 'UNKNOWN';
      return {
        statusCode: 403,
        payload: {
          error: `Command access requires Captain/Kapten rank or higher. Current rank: ${currentRank}` ,
          snapshot: buildSnapshot(state, nowMs)
        }
      };
    }

    const { action, targetNpcId, note } = payload;
    const normalizedNote = note?.trim() ?? '';

    if (action === 'PLAN_MISSION') {
      state.promotion_points += 4;
      state.morale = Math.min(100, state.morale + 1);
      state.next_event_day = Math.max(state.current_day + 2, state.next_event_day);
    }

    if (action === 'ISSUE_SANCTION') {
      state.morale = Math.max(0, state.morale - 1);
      state.promotion_points += 2;
    }

    if (action === 'ISSUE_PROMOTION') {
      state.morale = Math.min(100, state.morale + 2);
      state.promotion_points += 5;
    }

    const snapshot = buildSnapshot(state, nowMs);
    const result: ActionResult = {
      type: 'COMMAND',
      snapshot,
      details: {
        action,
        targetNpcId: targetNpcId ?? null,
        note: normalizedNote,
        commandAccess: true,
        issuedByRank: snapshot.rankCode,
        effect: {
          morale: snapshot.morale,
          promotionPoints: state.promotion_points,
          nextEventDay: state.next_event_day
        }
      }
    };

    return { payload: result };
  });
}



export async function setGameTimeScale(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { scale: 1 | 3 }
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    autoResumeIfExpired(state, nowMs);
    synchronizeProgress(state, nowMs);

    const nextScale: 1 | 3 = payload.scale === 3 ? 3 : 1;
    if (state.game_time_scale === nextScale) {
      return {
        payload: {
          type: 'COMMAND',
          snapshot: buildSnapshot(state, nowMs),
          details: { gameTimeScale: nextScale, changed: false }
        } as ActionResult
      };
    }

    state.game_time_scale = nextScale;
    state.server_reference_time_ms = Math.round(nowMs - (state.current_day * GAME_MS_PER_DAY) / nextScale);

    return {
      payload: {
        type: 'COMMAND',
        snapshot: buildSnapshot(state, nowMs),
        details: { gameTimeScale: nextScale, changed: true }
      } as ActionResult
    };
  });
}

export async function restartWorldFromZero(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs, client, profileId }) => {
    state.server_reference_time_ms = nowMs;
    state.current_day = 0;
    state.paused_at_ms = null;
    state.pause_reason = null;
    state.pause_token = null;
    state.pause_expires_at_ms = null;
    state.game_time_scale = 1;
    state.rank_index = 0;
    state.money_cents = 0;
    state.morale = 70;
    state.health = 80;
    state.promotion_points = 0;
    state.days_in_rank = 0;
    state.next_event_day = 3;
    state.last_mission_day = -10;
    state.academy_tier = 0;
    state.last_travel_place = null;
    state.certificate_inventory = [];
    state.division_freedom_score = 0;
    state.preferred_division = null;
    state.pending_event_id = null;
    state.pending_event_payload = null;
    state.mission_call_issued_day = 0;
    state.active_mission = null;
    state.ceremony_completed_day = 0;
    state.ceremony_recent_awards = [];
    state.player_medals = [];
    state.player_ribbons = [];
    state.player_position = 'No Position';
    state.player_division = 'Nondivisi';
    state.npc_award_history = {};
    state.raider_last_attack_day = 0;
    state.raider_casualties = [];
    state.national_stability = 72;
    state.military_stability = 70;
    state.military_fund_cents = 250000;
    state.fund_secretary_npc = null;
    state.corruption_risk = 18;
    state.court_pending_cases = [];
    state.military_law_current = null;
    state.military_law_logs = [];

    await client.query('DELETE FROM decision_logs WHERE profile_id = $1', [profileId]);
    await clearV5World(client, profileId);
    await ensureV5World(client, {
      profileId,
      playerName: state.player_name,
      branch: state.branch
    }, nowMs);

    return {
      payload: {
        ok: true,
        snapshot: buildSnapshot(state, nowMs)
      }
    };
  });
}


function npcHash(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 9973;
  }
  return hash;
}

export async function runSocialInteraction(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { npcId: string; interaction: 'MENTOR' | 'SUPPORT' | 'BOND' | 'DEBRIEF'; note?: string }
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const pendingError = ensureNoPendingDecision(state);
    if (pendingError) {
      return { statusCode: 409, payload: { error: pendingError, snapshot: buildSnapshot(state, nowMs) } };
    }

    const { npcId, interaction, note } = payload;
    const seed = npcHash(npcId) + state.current_day * 7 + state.rank_index * 13;
    const variance = (seed % 5) - 2;
    const readinessFactor = Math.round((state.morale + state.health) / 40);

    const baseline = {
      MENTOR: { morale: 3, health: 0, points: 3, money: -120 },
      SUPPORT: { morale: 2, health: 1, points: 2, money: -80 },
      BOND: { morale: 4, health: 0, points: 1, money: -160 },
      DEBRIEF: { morale: 1, health: 0, points: 4, money: -60 }
    }[interaction];

    const moraleDelta = Math.max(-3, Math.min(7, baseline.morale + Math.floor(variance / 2) + (readinessFactor > 4 ? 1 : 0)));
    const healthDelta = Math.max(-2, Math.min(3, baseline.health + (seed % 3 === 0 ? 1 : 0)));
    const pointsDelta = Math.max(1, baseline.points + (seed % 4 === 0 ? 1 : 0) + (readinessFactor >= 5 ? 1 : 0));
    const moneyDelta = baseline.money + (interaction === 'DEBRIEF' ? 20 : 0);

    state.morale = Math.max(0, Math.min(100, state.morale + moraleDelta));
    state.health = Math.max(0, Math.min(100, state.health + healthDelta));
    state.promotion_points = Math.max(0, state.promotion_points + pointsDelta);
    state.money_cents = Math.max(0, state.money_cents + moneyDelta);

    const snapshot = buildSnapshot(state, nowMs);
    const result: ActionResult = {
      type: 'SOCIAL_INTERACTION',
      snapshot,
      details: {
        npcId,
        interaction,
        note: note?.trim() ?? null,
        effect: {
          moraleDelta,
          healthDelta,
          promotionPointsDelta: pointsDelta,
          moneyDelta
        },
        summary: `${interaction} completed with ${npcId}. Team cohesion and readiness updated.`
      }
    };

    return { payload: result };
  });
}


function mergeAwardList(current: string[], incoming: string | null | undefined, limit: number): string[] {
  if (!incoming) return current.slice(0, limit);
  return Array.from(new Set([...current, incoming])).slice(-limit);
}

function buildRecipientKey(name: string, position: string): string {
  return `${name.trim().toLowerCase()}::${position.trim().toLowerCase()}`;
}

export async function completeCeremony(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    if (!ceremonyPending(state)) {
      return { payload: { ok: true, snapshot: buildSnapshot(state, nowMs), alreadyCompleted: true } };
    }

    const report = buildCeremonyReport(state);
    const playerKey = buildRecipientKey(state.player_name, state.player_position);
    const playerRecipient = report.recipients.find((item: CeremonyRecipient) => buildRecipientKey(item.npcName, item.position) === playerKey) ?? null;
    const awardedToPlayer = Boolean(playerRecipient);

    state.player_medals = mergeAwardList(state.player_medals, playerRecipient?.medalName, 24);
    state.player_ribbons = mergeAwardList(state.player_ribbons, playerRecipient?.ribbonName, 24);

    const nextHistory = { ...state.npc_award_history };
    for (const recipient of report.recipients) {
      if (buildRecipientKey(recipient.npcName, recipient.position) === playerKey) continue;
      const row = nextHistory[recipient.npcName] ?? { medals: [], ribbons: [] };
      row.medals = mergeAwardList(row.medals, recipient.medalName, 12);
      row.ribbons = mergeAwardList(row.ribbons, recipient.ribbonName, 12);
      nextHistory[recipient.npcName] = row;
    }

    state.npc_award_history = nextHistory;
    state.ceremony_recent_awards = report.recipients;
    state.ceremony_completed_day = report.ceremonyDay;

    if (
      state.active_mission &&
      state.active_mission.status === 'RESOLVED' &&
      (state.active_mission.archivedUntilCeremonyDay ?? 0) <= report.ceremonyDay
    ) {
      state.active_mission = null;
    }

    if (state.pause_reason === 'SUBPAGE' && state.paused_at_ms) {
      resumeState(state, nowMs);
      synchronizeProgress(state, nowMs);
    }

    return {
      payload: {
        ok: true,
        awardedToPlayer,
        snapshot: buildSnapshot(state, nowMs)
      }
    };
  });
}




function evaluateDivisionHead(state: DbGameStateRow, division: string): { name: string; score: number } {
  const roster = buildNpcRegistry(state.branch, MAX_ACTIVE_NPCS);
  const ranked = roster
    .map((npc) => {
      const base = npc.division === division ? 14 : 0;
      const competence = base + ((npc.slot * 19 + state.current_day * 7 + state.morale + state.health) % 100);
      return { name: npc.name, score: competence };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0] ?? { name: 'Acting Division Head', score: 60 };
}

function buildNewsFeed(state: DbGameStateRow, decisionLogs: Array<{ id: number; game_day: number; selected_option: string; consequences: unknown }>, filterType?: NewsType): NewsItem[] {
  const minDay = Math.max(0, state.current_day - 30);
  const items: NewsItem[] = [];

  for (const log of decisionLogs) {
    if (log.game_day < minDay) continue;
    const option = String(log.selected_option || '').toLowerCase();
    const effect = (log.consequences && typeof log.consequences === 'object') ? log.consequences as Record<string, unknown> : {};

    const missionHit = option.includes('mission') || (typeof effect.promotionPointDelta === 'number' && Number(effect.promotionPointDelta) >= 2);
    const promotionHit = option.includes('promot') || (typeof effect.promotionPointDelta === 'number' && Number(effect.promotionPointDelta) >= 4);
    const dismissalHit = option.includes('sanction') || option.includes('dismiss') || option.includes('terminate');

    if (missionHit) {
      items.push({ id: `m-${log.id}`, day: log.game_day, type: 'MISSION', title: 'News Misi', detail: `Operasi baru tercatat dari keputusan ${log.selected_option}.` });
    }
    if (promotionHit) {
      items.push({ id: `p-${log.id}`, day: log.game_day, type: 'PROMOTION', title: 'News Promosi', detail: `Evaluasi karier menunjukkan kenaikan potensi promosi.` });
    }
    if (dismissalHit) {
      items.push({ id: `d-${log.id}`, day: log.game_day, type: 'DISMISSAL', title: 'News Pemecatan/Sanksi', detail: `Tindakan disiplin atau pemecatan diproses pada rantai komando.` });
    }
  }

  for (const award of state.ceremony_recent_awards) {
    items.push({
      id: `medal-${award.order}-${award.npcName}`,
      day: state.ceremony_completed_day,
      type: 'MEDAL',
      title: 'News Upacara Medal',
      detail: `${award.npcName} menerima ${award.medalName} / ${award.ribbonName} pada upacara terakhir.`
    });
  }

  if (state.court_pending_cases.some((item) => item.status !== 'CLOSED')) {
    items.push({
      id: `court-${state.current_day}`,
      day: state.current_day,
      type: 'DISMISSAL',
      title: 'News Pengadilan Militer',
      detail: `Terdapat ${state.court_pending_cases.filter((item) => item.status !== 'CLOSED').length} sidang aktif menunggu panel hakim.`
    });
  }

  const chiefReviewCases = state.court_pending_cases.filter((item) => item.id.startsWith('chief-review-'));
  if (chiefReviewCases.some((item) => item.status !== 'CLOSED')) {
    const unresolved = chiefReviewCases.filter((item) => item.status !== 'CLOSED').length;
    items.push({
      id: `chief-review-pending-${state.current_day}`,
      day: state.current_day,
      type: 'DISMISSAL',
      title: 'News Pengajuan Pemecatan Chief of Staff',
      detail: `Posisi sekretaris militer terlambat diisi. ${unresolved} pengajuan evaluasi/pemecatan Chief of Staff masuk pending sidang.`
    });
  } else if (chiefReviewCases.length > 0) {
    const latest = chiefReviewCases.reduce((max, item) => Math.max(max, item.day), 0);
    items.push({
      id: `chief-review-resolved-${latest}`,
      day: latest,
      type: 'DISMISSAL',
      title: 'News Pergantian Chief of Staff',
      detail: 'Sidang evaluasi Chief of Staff telah ditutup: hasil berupa pergantian atau peringatan resmi komando.'
    });
  }

  if (state.national_stability <= 35 || state.military_stability <= 35) {
    items.push({
      id: `instability-${state.current_day}`,
      day: state.current_day,
      type: 'MISSION',
      title: 'News Stabilitas Kritis',
      detail: 'Stabilitas negara/militer rendah, potensi pemberontakan internal meningkat.'
    });
  }

  const filtered = filterType ? items.filter((item) => item.type === filterType) : items;
  return filtered.sort((a, b) => b.day - a.day).slice(0, 120);
}

function randomFromSeed(seed: number, min: number, max: number): number {
  const span = max - min + 1;
  return min + (Math.abs(seed) % span);
}

export async function runRaiderDefense(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const pendingError = ensureNoPendingDecision(state);
    if (pendingError) {
      return { statusCode: 409, payload: { error: pendingError, snapshot: buildSnapshot(state, nowMs) } };
    }

    if (state.current_day - state.raider_last_attack_day < 6) {
      return { statusCode: 409, payload: { error: 'Raider team belum siap menyerang lagi', snapshot: buildSnapshot(state, nowMs) } };
    }

    const registry = buildNpcRegistry(state.branch, MAX_ACTIVE_NPCS);
    const seedBase = state.current_day * 31 + state.rank_index * 19 + state.morale * 7 + state.health * 3;
    const casualtyCount = randomFromSeed(seedBase, 1, 4);
    const casualties: RaiderCasualty[] = [];

    for (let i = 0; i < casualtyCount; i += 1) {
      const slot = randomFromSeed(seedBase + i * 13, 0, MAX_ACTIVE_NPCS - 1);
      const identity = registry[slot];
      if (!identity) continue;
      if (state.raider_casualties.some((item) => item.slot === slot)) continue;

      casualties.push({
        slot,
        npcName: identity.name,
        division: identity.division,
        unit: identity.unit,
        role: identity.position,
        day: state.current_day,
        cause: i % 2 === 0 ? 'Base perimeter breach' : 'Close-quarter raid encounter'
      });
    }

    state.raider_casualties = [...state.raider_casualties, ...casualties].slice(-120);
    state.raider_last_attack_day = state.current_day;
    state.morale = Math.max(0, state.morale - (casualties.length * 4));
    state.health = Math.max(0, state.health - randomFromSeed(seedBase + 99, 2, 8));
    state.promotion_points += Math.max(1, 6 - casualties.length);

    const snapshot = buildSnapshot(state, nowMs);
    return {
      payload: {
        type: 'V3_MISSION',
        snapshot,
        details: {
          raiderAttack: true,
          casualties,
          summary: `Raider assault neutralized with ${casualties.length} personnel losses.`
        }
      } as ActionResult
    };
  });
}

export async function getDecisionLogs(
  request: FastifyRequest,
  reply: FastifyReply,
  query: { cursor?: number; limit: number }
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ client, profileId }) => {
    const logs = await listDecisionLogs(client, profileId, query.cursor, query.limit);
    const nextCursor = logs.length === query.limit ? logs[logs.length - 1].id : null;

    return {
      payload: {
        items: logs,
        nextCursor
      }
    };
  });
}

export async function getGameConfig(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async () => {
    return {
      payload: {
        branches: BRANCH_CONFIG,
        generatedAt: Date.now()
      }
    };
  });
}

export async function getCeremonyReport(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    if (!ceremonyPending(state)) {
      return { statusCode: 409, payload: { error: 'Ceremony has not started yet', snapshot: buildSnapshot(state, nowMs) } };
    }
    return { payload: { ceremony: buildCeremonyReport(state) } };
  });
}

export async function getCurrentSnapshotForSubPage(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withLockedState(
    request,
    reply,
    { queueEvents: false },
    async ({ state, nowMs }) => ({ payload: { snapshot: buildSnapshot(state, nowMs) } })
  );
}

export async function getNpcBackgroundActivity(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const snapshot = buildSnapshot(state, nowMs);
    const registry = buildNpcRegistry(snapshot.branch, MAX_ACTIVE_NPCS);
    const activity = Array.from({ length: MAX_ACTIVE_NPCS }, (_, i) => {
      const cycleSeed = snapshot.gameDay * 37 + i * 11 + snapshot.age + snapshot.morale;
      const op = ['training', 'deployment', 'career-review', 'resupply', 'medical', 'intel'][cycleSeed % 6];
      const impact = ['morale+', 'health+', 'funds+', 'promotion+', 'coordination+', 'readiness+'][(cycleSeed + 3) % 6];
      return {
        npcId: `npc-${i + 1}`,
        npcName: registry[i]?.name ?? `NPC-${i + 1}`,
        lastTickDay: Math.max(1, snapshot.gameDay - (i % 3)),
        operation: op,
        result: `${op} completed (${impact})`,
        readiness: Math.max(25, Math.min(100, snapshot.health + ((cycleSeed % 19) - 9))),
        morale: Math.max(20, Math.min(100, snapshot.morale + ((cycleSeed % 15) - 7))),
        rankInfluence: Math.max(1, snapshot.rankCode.length + (i % 4)),
        promotionRecommendation: (['STRONG_RECOMMEND', 'RECOMMEND', 'HOLD', 'NOT_RECOMMENDED'] as const)[cycleSeed % 4],
        notificationLetter:
          cycleSeed % 4 === 3
            ? `Administrative Letter: NPC-${i + 1} promotion request postponed due to vacancy constraints.`
            : null
      };
    });

    return { payload: { generatedAt: nowMs, items: activity } };
  });
}




function getTotalCertificationCount(state: DbGameStateRow): number {
  return Array.isArray(state.certificate_inventory) ? state.certificate_inventory.length : 0;
}

function hasRecruitmentPrereqFromInventory(state: DbGameStateRow, minTier: 1 | 2): boolean {
  const certs = Array.isArray(state.certificate_inventory) ? state.certificate_inventory : [];
  return certs.some((cert) => {
    if (!cert || typeof cert !== 'object') return false;
    const tier = typeof cert.tier === 'number' ? cert.tier : 0;
    if (tier >= minTier) {
      return true;
    }

    const academyName = String((cert as { academyName?: unknown }).academyName ?? '').toLowerCase();
    if (minTier === 1) {
      return academyName.includes('officer') || academyName.includes('academy');
    }

    return academyName.includes('high command') || academyName.includes('command staff');
  });
}

function normalizeDivisionToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasDivisionCertificate(state: DbGameStateRow, division: string): boolean {
  const target = normalizeDivisionToken(division);
  const certs = Array.isArray(state.certificate_inventory) ? state.certificate_inventory : [];
  return certs.some((cert) => {
    if (!cert || typeof cert !== 'object') return false;

    const candidates = [
      String((cert as { assignedDivision?: unknown }).assignedDivision ?? ''),
      String((cert as { division?: unknown }).division ?? ''),
      String((cert as { divisionName?: unknown }).divisionName ?? ''),
      String((cert as { academyName?: unknown }).academyName ?? ''),
      String((cert as { message?: unknown }).message ?? '')
    ]
      .map(normalizeDivisionToken)
      .filter(Boolean);

    return candidates.some((candidate) => candidate === target || candidate.includes(target) || target.includes(candidate));
  });
}

function scoreRecruitmentExam(track: RecruitmentTrack, answers: Record<string, string>): {
  examPass: boolean;
  answeredCount: number;
  correctCount: number;
  requiredCorrect: number;
  missingQuestionIds: string[];
} {
  const normalizedAnswers = Object.fromEntries(
    Object.entries(answers).map(([id, value]) => [id, value.trim().toLowerCase()])
  );

  const expected = track.exam.map((item) => ({ id: item.id, answer: item.answer.trim().toLowerCase() }));
  const answeredExpected = expected.filter((item) => Boolean(normalizedAnswers[item.id]));
  const correctCount = answeredExpected.filter((item) => normalizedAnswers[item.id] === item.answer).length;
  const answeredCount = answeredExpected.length;
  const requiredCorrect = Math.max(2, Math.ceil(expected.length * 0.66));
  const missingQuestionIds = expected.filter((item) => !normalizedAnswers[item.id]).map((item) => item.id);
  const examPass = answeredCount >= 2 && correctCount >= requiredCorrect;

  return { examPass, answeredCount, correctCount, requiredCorrect, missingQuestionIds };
}

export async function runRecruitmentApply(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { trackId: string; answers: Record<string, string> }
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const track = RECRUITMENT_TRACKS.find((item) => item.id === payload.trackId);
    if (!track) {
      return { statusCode: 400, payload: { error: 'Track rekrutmen tidak valid', snapshot: buildSnapshot(state, nowMs) } };
    }

    const rankOk = state.rank_index >= track.minRankIndex;
    const officerOk = !track.needOfficerCert || state.academy_tier >= 1 || hasRecruitmentPrereqFromInventory(state, 1);
    const highOk = !track.needHighCommandCert || state.academy_tier >= 2 || hasRecruitmentPrereqFromInventory(state, 2);
    const priorDivisionCertified = hasDivisionCertificate(state, track.division);
    const totalCertificationCount = getTotalCertificationCount(state);
    const certificationCountOk = totalCertificationCount >= track.requiredCertificationCount;
    const examScore = scoreRecruitmentExam(track, payload.answers);
    const examPass = priorDivisionCertified || examScore.examPass;

    if (!(rankOk && officerOk && highOk && certificationCountOk && examPass)) {
      const certs = Array.isArray(state.certificate_inventory) ? state.certificate_inventory : [];
      const answeredCount = examScore.answeredCount;
      const correctCount = examScore.correctCount;
      const accuracy = answeredCount > 0 ? correctCount / answeredCount : 0;

      const failedReasons = [
        rankOk ? null : `Rank minimal belum terpenuhi (butuh ${track.minRankIndex})`,
        officerOk ? null : 'Sertifikasi Officer Academy tidak terdeteksi (academy tier/inventory)',
        highOk ? null : 'Sertifikasi High Command tidak terdeteksi (academy tier/inventory)',
        certificationCountOk ? null : `Total sertifikasi belum cukup (${totalCertificationCount}/${track.requiredCertificationCount})`,
        examPass
          ? null
          : priorDivisionCertified
            ? `Ujian track belum lulus (answered=${answeredCount}, correct=${correctCount}, accuracy=${Math.round(accuracy * 100)}%, requiredCorrect=${examScore.requiredCorrect})`
            : 'Ujian track belum lulus dan sertifikasi divisi sebelumnya belum terdeteksi'
      ].filter(Boolean);

      return {
        statusCode: 409,
        payload: {
          error: failedReasons.join('; '),
          snapshot: buildSnapshot(state, nowMs),
          details: {
            rankOk,
            officerOk,
            highOk,
            examPass,
            priorDivisionCertified,
            certificationCountOk,
            requiredCertificationCount: track.requiredCertificationCount,
            totalCertificationCount,
            trackDivision: track.division,
            detectedDivisions: certs
              .map((cert) => String((cert as { assignedDivision?: unknown }).assignedDivision ?? (cert as { division?: unknown }).division ?? ''))
              .filter(Boolean),
            exam: {
              answeredCount: examScore.answeredCount,
              correctCount: examScore.correctCount,
              requiredCorrect: examScore.requiredCorrect,
              expectedQuestionIds: track.exam.map((q) => q.id),
              missingQuestionIds: examScore.missingQuestionIds,
              accuracy
            }
          }
        }
      };
    }

    const divisionHead = evaluateDivisionHead(state, track.division);
    const assignedRole = track.rolePool[(state.current_day + state.rank_index) % track.rolePool.length] ?? 'Division Staff Officer';
    state.player_position = assignedRole;
    state.player_division = track.division;

    const npcRecruitmentWave = buildNpcRegistry(state.branch, MAX_ACTIVE_NPCS)
      .slice(0, 10)
      .map((npc, idx) => ({
        npcName: npc.name,
        assignedDivision: track.division,
        assignedRole: track.rolePool[(state.current_day + idx) % track.rolePool.length] ?? 'Division Support Officer'
      }));

    const certificate = {
      id: `${state.profile_id}-recruit-${Date.now()}`,
      tier: state.academy_tier >= 2 ? 2 as const : 1 as const,
      academyName: `Recruitment Board · ${track.name}`,
      score: Math.max(80, Math.min(99, 80 + state.rank_index + Math.floor(state.morale / 10))),
      grade: 'A' as const,
      divisionFreedomLevel: 'ELITE' as const,
      trainerName: divisionHead.name,
      issuedAtDay: state.current_day,
      message: `Surat mutasi resmi: penempatan awal di ${track.division} sebagai ${assignedRole}. Ditandatangani Kepala Divisi ${divisionHead.name} (score ${divisionHead.score}) hasil evaluasi Chief of Staff.`,
      assignedDivision: track.division
    };

    const existingCertificates = Array.isArray(state.certificate_inventory) ? state.certificate_inventory : [];
    const dedupedCertificates = existingCertificates.filter((item) => String(item.assignedDivision ?? '').toLowerCase() !== track.division.toLowerCase());
    state.certificate_inventory = [certificate, ...dedupedCertificates].slice(0, 40);

    return {
      payload: {
        type: 'RECRUITMENT',
        snapshot: buildSnapshot(state, nowMs),
        details: {
          accepted: true,
          certificate,
          npcRecruitmentWave,
          redirectTo: '/dashboard'
        }
      } as ActionResult
    };
  });
}


function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function maybeCreateCourtCase(state: DbGameStateRow): void {
  const shouldCreate = state.corruption_risk >= 55 || state.military_stability <= 35 || state.national_stability <= 38;
  if (!shouldCreate) return;

  const existingPending = state.court_pending_cases.filter((item) => item.status !== 'CLOSED').length;
  if (existingPending >= 8) return;

  const newCase = {
    id: `case-${state.current_day}-${existingPending + 1}`,
    day: state.current_day,
    title: state.corruption_risk >= 55 ? 'Investigasi indikasi korupsi kas militer' : 'Sidang disiplin komando operasi',
    severity: (state.corruption_risk >= 70 || state.military_stability <= 25 ? 'HIGH' : state.corruption_risk >= 45 ? 'MEDIUM' : 'LOW') as 'LOW' | 'MEDIUM' | 'HIGH',
    status: 'PENDING' as const,
    requestedBy: 'Chief of Staff Council'
  };

  state.court_pending_cases = [...state.court_pending_cases, newCase].slice(-60);
}

function computeMissionDelta(payload: { missionType: 'RECON' | 'COUNTER_RAID' | 'BLACK_OPS' | 'TRIBUNAL_SECURITY'; dangerTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'; playerParticipates: boolean }): { success: boolean; successScore: number; fundDelta: number; moraleDelta: number; healthDelta: number; stabilityDelta: number; corruptionDelta: number; casualties: number } {
  const dangerFactor = { LOW: 8, MEDIUM: 16, HIGH: 28, EXTREME: 40 }[payload.dangerTier];
  const missionBias = { RECON: 14, COUNTER_RAID: 10, BLACK_OPS: -6, TRIBUNAL_SECURITY: 6 }[payload.missionType];
  const participationBonus = payload.playerParticipates ? 7 : 0;
  const successScore = 52 + missionBias + participationBonus - Math.floor(dangerFactor * 0.55);
  const randomFactor = (Date.now() + dangerFactor * 13 + missionBias * 19) % 100;
  const success = randomFactor < successScore;
  const casualties = success ? Math.max(0, Math.floor((dangerFactor - 10) / 18)) : Math.max(1, Math.floor((dangerFactor + 6) / 14));

  return {
    success,
    successScore,
    fundDelta: success ? (payload.dangerTier === 'EXTREME' ? 22000 : 14000) : -(payload.dangerTier === 'EXTREME' ? 18000 : 9000),
    moraleDelta: success ? 3 : -5,
    healthDelta: payload.playerParticipates ? (success ? -2 : -8) : 0,
    stabilityDelta: success ? 4 : -7,
    corruptionDelta: payload.missionType === 'TRIBUNAL_SECURITY' ? -4 : success ? 0 : 4,
    casualties
  };
}

export async function getMedalCatalog(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => ({
    payload: {
      items: MEDAL_CATALOG,
      note: 'Medal hanya dapat diberikan saat upacara dan wajib berbasis prestasi misi.',
      snapshot: buildSnapshot(state, nowMs)
    }
  }));
}

export async function runV3Mission(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { missionType: 'RECON' | 'COUNTER_RAID' | 'BLACK_OPS' | 'TRIBUNAL_SECURITY'; dangerTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'; playerParticipates: boolean }
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: true }, async ({ state, nowMs }) => {
    const existingMission = state.active_mission?.status === 'ACTIVE' ? state.active_mission : null;
    state.active_mission = existingMission
      ? {
          ...existingMission,
          missionType: payload.missionType,
          dangerTier: payload.dangerTier,
          playerParticipates: payload.playerParticipates,
          participants: buildMissionParticipants(state, payload.playerParticipates)
        }
      : {
          missionId: `mission-manual-${state.current_day}`,
          issuedDay: state.current_day,
          missionType: payload.missionType,
          dangerTier: payload.dangerTier,
          playerParticipates: payload.playerParticipates,
          status: 'ACTIVE',
          participants: buildMissionParticipants(state, payload.playerParticipates)
        };
    const delta = computeMissionDelta(payload);
    const missionParticipantStats = computeMissionParticipantStats(state.active_mission.participants, state, payload.dangerTier, delta.success);

    state.money_cents = Math.max(0, state.money_cents + Math.floor(delta.fundDelta / 2));
    state.military_fund_cents = Math.max(0, state.military_fund_cents + delta.fundDelta);
    state.morale = clampScore(state.morale + delta.moraleDelta);
    state.health = clampScore(state.health + delta.healthDelta);
    state.national_stability = clampScore(state.national_stability + delta.stabilityDelta);
    state.military_stability = clampScore(state.military_stability + delta.stabilityDelta + (delta.success ? 1 : -2));
    state.corruption_risk = clampScore(state.corruption_risk + delta.corruptionDelta + (state.fund_secretary_npc ? -1 : 2));
    const missionPromotionBonus = Math.max(1, Math.round((delta.success ? 5 : 2) + delta.successScore / 26));
    state.promotion_points += missionPromotionBonus;
    state.last_mission_day = state.current_day;
    if (state.active_mission) {
      state.active_mission = {
        ...state.active_mission,
        status: 'RESOLVED',
        participantStats: missionParticipantStats,
        archivedUntilCeremonyDay: nextCeremonyDayFrom(state.current_day)
      };
    }

    maybeCreateCourtCase(state);

    const details = {
      ...delta,
      missionType: payload.missionType,
      dangerTier: payload.dangerTier,
      playerParticipates: payload.playerParticipates,
      npcOnly: !payload.playerParticipates,
      missionPromotionBonus,
      participantStats: missionParticipantStats,
      requiresAcknowledgementBeforeResume: Boolean(payload.playerParticipates)
    };

    return {
      payload: {
        type: 'V3_MISSION',
        snapshot: buildSnapshot(state, nowMs),
        details
      } as ActionResult
    };
  });
}

export async function respondMissionCall(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { participate: boolean }
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const activeMission = state.active_mission;
    if (!activeMission || activeMission.status !== 'ACTIVE') {
      return { statusCode: 409, payload: { error: 'Tidak ada panggilan misi aktif.', snapshot: buildSnapshot(state, nowMs) } };
    }

    state.active_mission = {
      ...activeMission,
      playerParticipates: payload.participate,
      participants: buildMissionParticipants(state, payload.participate)
    };

    if (payload.participate) {
      if (!state.paused_at_ms) {
        pauseState(state, 'MODAL', nowMs, request.server.env.PAUSE_TIMEOUT_MINUTES);
      }
      return {
        payload: {
          type: 'V3_MISSION',
          snapshot: buildSnapshot(state, nowMs),
          details: {
            missionType: state.active_mission.missionType,
            dangerTier: state.active_mission.dangerTier,
            playerParticipates: true,
            autoTriggered: true,
            awaitingManualExecution: true
          }
        } as ActionResult
      };
    }

    const missionPayload = {
      missionType: activeMission.missionType,
      dangerTier: activeMission.dangerTier,
      playerParticipates: false
    } as const;

    const delta = computeMissionDelta(missionPayload);
    const missionParticipantStats = computeMissionParticipantStats(state.active_mission.participants, state, missionPayload.dangerTier, delta.success);
    state.money_cents = Math.max(0, state.money_cents + Math.floor(delta.fundDelta / 2));
    state.military_fund_cents = Math.max(0, state.military_fund_cents + delta.fundDelta);
    state.morale = clampScore(state.morale + delta.moraleDelta);
    state.health = clampScore(state.health + delta.healthDelta);
    state.national_stability = clampScore(state.national_stability + delta.stabilityDelta);
    state.military_stability = clampScore(state.military_stability + delta.stabilityDelta + (delta.success ? 1 : -2));
    state.corruption_risk = clampScore(state.corruption_risk + delta.corruptionDelta + (state.fund_secretary_npc ? -1 : 2));
    const missionPromotionBonus = Math.max(1, Math.round((delta.success ? 4 : 2) + delta.successScore / 30));
    state.promotion_points += missionPromotionBonus;
    state.last_mission_day = state.current_day;
    state.active_mission = {
      ...state.active_mission,
      status: 'RESOLVED',
      participantStats: missionParticipantStats,
      archivedUntilCeremonyDay: nextCeremonyDayFrom(state.current_day)
    };

    if (state.paused_at_ms && state.pause_reason === 'MODAL') {
      resumeState(state, nowMs);
    }

    maybeCreateCourtCase(state);

    return {
      payload: {
        type: 'V3_MISSION',
        snapshot: buildSnapshot(state, nowMs),
        details: {
          ...delta,
          missionType: missionPayload.missionType,
          dangerTier: missionPayload.dangerTier,
          playerParticipates: missionPayload.playerParticipates,
          autoTriggered: true,
          missionPromotionBonus,
          participantStats: missionParticipantStats
        }
      } as ActionResult
    };
  });
}


export async function saveMissionPlan(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { strategy: string; objective: string; prepChecklist: string[] }
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const activeMission = state.active_mission;
    if (!activeMission || activeMission.status !== 'ACTIVE' || !activeMission.playerParticipates) {
      return {
        statusCode: 409,
        payload: {
          error: 'Belum ada misi aktif yang Anda ikuti untuk disusun rencananya.',
          snapshot: buildSnapshot(state, nowMs)
        }
      };
    }

    state.active_mission = {
      ...activeMission,
      plan: {
        strategy: payload.strategy,
        objective: payload.objective,
        prepChecklist: payload.prepChecklist.slice(0, 4),
        plannedBy: state.player_name,
        plannedAtDay: state.current_day
      }
    };

    return {
      payload: {
        type: 'COMMAND',
        snapshot: buildSnapshot(state, nowMs),
        details: {
          saved: true,
          missionId: state.active_mission.missionId,
          plan: state.active_mission.plan
        }
      } as ActionResult
    };
  });
}

export async function appointFundSecretary(request: FastifyRequest, reply: FastifyReply, npcName: string): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    if ((state.rank_index ?? 0) < 8) {
      return { statusCode: 409, payload: { error: 'Hanya level komando tinggi yang dapat menunjuk sekretaris kas militer.', snapshot: buildSnapshot(state, nowMs) } };
    }

    state.fund_secretary_npc = npcName;
    state.corruption_risk = clampScore(state.corruption_risk - 3);

    return {
      payload: {
        type: 'APPOINT_SECRETARY',
        snapshot: buildSnapshot(state, nowMs),
        details: { npcName }
      } as ActionResult
    };
  });
}

export async function reviewMilitaryCourtCase(
  request: FastifyRequest,
  reply: FastifyReply,
  caseId: string,
  verdict: 'UPHOLD' | 'DISMISS' | 'REASSIGN'
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    const idx = state.court_pending_cases.findIndex((item) => item.id === caseId && item.status !== 'CLOSED');
    if (idx < 0) {
      return { statusCode: 404, payload: { error: 'Kasus sidang tidak ditemukan.', snapshot: buildSnapshot(state, nowMs) } };
    }

    const target = state.court_pending_cases[idx];
    state.court_pending_cases[idx] = { ...target, status: 'CLOSED' };

    if (verdict === 'UPHOLD') {
      state.corruption_risk = clampScore(state.corruption_risk - 8);
      state.military_stability = clampScore(state.military_stability + 4);
    } else if (verdict === 'DISMISS') {
      state.national_stability = clampScore(state.national_stability - 2);
      state.military_stability = clampScore(state.military_stability - 2);
    } else {
      state.national_stability = clampScore(state.national_stability + 1);
      state.military_stability = clampScore(state.military_stability + 1);
    }

    return {
      payload: {
        type: 'COURT_REVIEW',
        snapshot: buildSnapshot(state, nowMs),
        details: { caseId, verdict }
      } as ActionResult
    };
  });
}

export async function getNews(request: FastifyRequest, reply: FastifyReply, filterType?: NewsType): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ client, profileId, state, nowMs }) => {
    const logs = await listDecisionLogs(client, profileId, undefined, 200);
    const items = buildNewsFeed(state, logs, filterType);
    return {
      payload: {
        items,
        generatedAt: nowMs,
        rangeDays: 30,
        filter: filterType ?? null,
        snapshot: buildSnapshot(state, nowMs)
      }
    };
  });
}

export async function getMilitaryLawState(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await withLockedState(request, reply, { queueEvents: false }, async ({ state, nowMs }) => {
    maybeAutoGovernMilitaryLaw(state);
    const current = state.military_law_current;
    const logs = state.military_law_logs.slice().reverse().slice(0, 20);
    return {
      payload: {
        current,
        logs,
        articleOptions: buildMilitaryLawArticleOptions(),
        mlcEligibleMembers: mlcEligibleMembers(state),
        governance: militaryLawCouncilStatus(state),
        snapshot: buildSnapshot(state, nowMs)
      }
    };
  });
}

export async function voteMilitaryLaw(
  request: FastifyRequest,
  reply: FastifyReply,
  payload:
    | { articleKey: 'chiefTerm'; optionId: MilitaryLawDraftSelection['chiefTermOptionId']; rationale?: string }
    | { articleKey: 'cabinet'; optionId: MilitaryLawDraftSelection['cabinetOptionId']; rationale?: string }
    | { articleKey: 'optionalPosts'; optionId: MilitaryLawDraftSelection['optionalPostOptionId']; rationale?: string }
): Promise<void> {
  await withLockedState(request, reply, { queueEvents: true }, async ({ state, nowMs }) => {
    maybeAutoGovernMilitaryLaw(state);

    const voteAccess = evaluateMilitaryLawVoteAccess(state);
    if (!voteAccess.ok) {
      return {
        statusCode: voteAccess.statusCode,
        payload: {
          error: voteAccess.error,
          snapshot: buildSnapshot(state, nowMs)
        }
      };
    }

    const votes = computeMilitaryLawVotes(state);
    const nextSelection = applyArticleVoteToSelection(selectionFromCurrentLaw(state), payload);
    const enacted = composeMilitaryLawEntry(state, nextSelection, votes.votesFor, votes.votesAgainst, state.player_name);
    state.military_law_current = enacted;
    state.military_law_logs = [...state.military_law_logs, enacted].slice(-40);

    state.national_stability = clampScore(state.national_stability + (enacted.rules.npcCommandDrift >= 0 ? 2 : -1));
    state.military_stability = clampScore(state.military_stability + (enacted.rules.npcCommandDrift >= 0 ? 3 : 1));
    state.promotion_points = Math.max(0, Math.round(state.promotion_points * (enacted.rules.promotionPointMultiplierPct / 100)));

    const details = {
      approved: true,
      rationale: payload.rationale?.trim() ?? null,
      changedArticle: payload.articleKey,
      changedOptionId: payload.optionId,
      law: enacted,
      activeOptionalPosts: enacted.rules.optionalPosts,
      effect: {
        promotionPointMultiplierPct: enacted.rules.promotionPointMultiplierPct,
        npcCommandDrift: enacted.rules.npcCommandDrift,
        chiefOfStaffTermLimitDays: enacted.rules.chiefOfStaffTermLimitDays,
        cabinetSeatCount: enacted.rules.cabinetSeatCount
      }
    };

    return {
      payload: {
        type: 'MILITARY_LAW_VOTE',
        snapshot: buildSnapshot(state, nowMs),
        details
      } as ActionResult
    };
  });
}
