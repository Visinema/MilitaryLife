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
  type: 'TRAINING' | 'DEPLOYMENT' | 'CAREER_REVIEW' | 'MILITARY_ACADEMY' | 'TRAVEL' | 'COMMAND' | 'SOCIAL_INTERACTION';
  snapshot: GameSnapshot;
  details: Record<string, unknown>;
}
