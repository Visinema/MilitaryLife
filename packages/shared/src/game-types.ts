import type { BranchCode, CountryCode, PauseReason } from './constants.js';

export interface PendingDecision {
  eventId: number;
  title: string;
  description: string;
  chancePercent: number;
  conditionLabel: string;
  options: Array<{
    id: string;
    label: string;
    impactScope: 'SELF' | 'ORGANIZATION';
    effectPreview: string;
  }>;
}

export interface DivisionAccessProfile {
  division: 'INFANTRY' | 'INTEL' | 'LOGISTICS' | 'CYBER';
  accessLevel: 'LIMITED' | 'STANDARD' | 'ADVANCED' | 'ELITE';
  benefits: string[];
  dangerousMissionUnlocked: boolean;
}

export interface AcademyCertificate {
  id: string;
  tier: 1 | 2;
  academyName: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  divisionFreedomLevel: 'LIMITED' | 'STANDARD' | 'ADVANCED' | 'ELITE';
  trainerName: string;
  issuedAtDay: number;
  message: string;
  assignedDivision: string;
}

export interface CeremonyChiefOfStaff {
  name: string;
  competenceScore: number;
  previousChiefName: string | null;
  replacedPreviousChief: boolean;
}

export interface CeremonyRecipient {
  order: number;
  npcName: string;
  division: string;
  unit: string;
  position: string;
  medalName: string;
  ribbonName: string;
  reason: string;
}

export interface MissionParticipant {
  name: string;
  role: 'PLAYER' | 'NPC';
}

export interface MissionParticipantStats {
  name: string;
  role: 'PLAYER' | 'NPC';
  tactical: number;
  support: number;
  leadership: number;
  resilience: number;
  total: number;
}

export interface MissionPlanState {
  strategy: string;
  objective: string;
  prepChecklist: string[];
  plannedBy: string;
  plannedAtDay: number;
}

export interface ActiveMissionState {
  missionId: string;
  issuedDay: number;
  missionType: 'RECON' | 'COUNTER_RAID' | 'BLACK_OPS' | 'TRIBUNAL_SECURITY';
  dangerTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  playerParticipates: boolean;
  status: 'ACTIVE' | 'RESOLVED';
  participants: MissionParticipant[];
  participantStats?: MissionParticipantStats[];
  plan?: MissionPlanState | null;
  archivedUntilCeremonyDay?: number | null;
}



export interface RaiderCasualty {
  slot: number;
  npcName: string;
  division: string;
  unit: string;
  role: string;
  day: number;
  cause: string;
}



export type MilitaryLawPresetId = 'BALANCED_COMMAND' | 'EXPEDITIONARY_MANDATE' | 'DISCIPLINE_FIRST' | 'CIVIL_OVERSIGHT';


export type MilitaryLawChiefTermOptionId = 'TERM_42' | 'TERM_54' | 'TERM_60' | 'TERM_72' | 'TERM_90';
export type MilitaryLawCabinetOptionId = 'CABINET_5' | 'CABINET_6' | 'CABINET_7' | 'CABINET_8' | 'CABINET_9';
export type MilitaryLawOptionalPostOptionId = 'POSTS_MINIMAL' | 'POSTS_BALANCED' | 'POSTS_EXPEDITIONARY' | 'POSTS_OVERSIGHT';

export interface MilitaryLawArticleSelection {
  chiefTermOptionId: MilitaryLawChiefTermOptionId;
  cabinetOptionId: MilitaryLawCabinetOptionId;
  optionalPostOptionId: MilitaryLawOptionalPostOptionId;
}

export interface MilitaryLawRuleSet {
  cabinetSeatCount: number;
  chiefOfStaffTermLimitDays: number;
  optionalPosts: string[];
  promotionPointMultiplierPct: number;
  npcCommandDrift: number;
}

export interface MilitaryLawEntry {
  version: number;
  presetId: MilitaryLawPresetId | 'CUSTOM';
  title: string;
  summary: string;
  enactedDay: number;
  votesFor: number;
  votesAgainst: number;
  councilMembers: number;
  initiatedBy: string;
  articleSelection?: MilitaryLawArticleSelection;
  rules: MilitaryLawRuleSet;
}

export type NewsType = 'DISMISSAL' | 'MISSION' | 'PROMOTION' | 'MEDAL';

export interface NewsItem {
  id: string;
  day: number;
  type: NewsType;
  title: string;
  detail: string;
}

export interface MedalCatalogItem {
  code: string;
  name: string;
  description: string;
  minimumMissionSuccess: number;
  minimumDangerTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  criteria: string[];
}

export interface CeremonyReport {
  ceremonyDay: number;
  attendance: number;
  medalQuota: number;
  chiefOfStaff: CeremonyChiefOfStaff;
  logs: string[];
  recipients: CeremonyRecipient[];
}

export interface GameSnapshot {
  rankIndex?: number;
  serverNowMs: number;
  serverReferenceTimeMs: number;
  gameDay: number;
  inGameDate: string;
  age: number;
  playerName: string;
  country: CountryCode;
  branch: BranchCode;
  rankCode: string;
  moneyCents: number;
  morale: number;
  health: number;
  paused: boolean;
  pauseReason: PauseReason | null;
  pauseToken: string | null;
  pauseExpiresAtMs: number | null;
  gameTimeScale: 1 | 3;
  lastMissionDay: number;
  academyTier?: number;
  academyCertifiedOfficer?: boolean;
  academyCertifiedHighOfficer?: boolean;
  lastTravelPlace?: string | null;
  certificates?: AcademyCertificate[];
  divisionFreedomScore?: number;
  preferredDivision?: string | null;
  divisionAccess?: DivisionAccessProfile | null;
  pendingDecision: PendingDecision | null;
  missionCallDue?: boolean;
  missionCallIssuedDay?: number | null;
  activeMission?: ActiveMissionState | null;
  ceremonyDue: boolean;
  nextCeremonyDay: number;
  ceremonyCompletedDay: number;
  ceremonyRecentAwards: CeremonyRecipient[];
  playerMedals: string[];
  playerRibbons: string[];
  playerPosition: string;
  playerDivision: string;
  raiderLastAttackDay: number;
  raiderCasualties: RaiderCasualty[];
  nationalStability: number;
  militaryStability: number;
  militaryFundCents: number;
  fundSecretaryNpc: string | null;
  secretaryVacancyDays: number;
  secretaryEscalationRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  corruptionRisk: number;
  pendingCourtCases: Array<{
    id: string;
    day: number;
    title: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    status: 'PENDING' | 'IN_REVIEW' | 'CLOSED';
    requestedBy: string;
  }>;
  militaryLawCurrent: MilitaryLawEntry | null;
  militaryLawLogs: MilitaryLawEntry[];
  mlcEligibleMembers: number;
}

export interface DecisionResult {
  applied: {
    moneyDelta: number;
    moraleDelta: number;
    healthDelta: number;
    promotionPointDelta: number;
  };
  promoted: boolean;
  newRankCode: string;
}

export interface ActionResult {
  type: 'TRAINING' | 'DEPLOYMENT' | 'CAREER_REVIEW' | 'MILITARY_ACADEMY' | 'TRAVEL' | 'COMMAND' | 'SOCIAL_INTERACTION' | 'RECRUITMENT' | 'V3_MISSION' | 'COURT_REVIEW' | 'APPOINT_SECRETARY' | 'MILITARY_LAW_VOTE';
  snapshot: GameSnapshot;
  details: Record<string, unknown>;
}
