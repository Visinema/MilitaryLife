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



export interface RaiderCasualty {
  slot: number;
  npcName: string;
  division: string;
  unit: string;
  role: string;
  day: number;
  cause: string;
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
  type: 'TRAINING' | 'DEPLOYMENT' | 'CAREER_REVIEW' | 'MILITARY_ACADEMY' | 'TRAVEL' | 'COMMAND' | 'SOCIAL_INTERACTION' | 'RECRUITMENT' | 'V3_MISSION' | 'COURT_REVIEW' | 'APPOINT_SECRETARY';
  snapshot: GameSnapshot;
  details: Record<string, unknown>;
}
