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

export interface EducationTitle {
  titleCode: string;
  label: string;
  mode: 'PREFIX' | 'SUFFIX';
  sourceTrack: string;
  minTier: 1 | 2 | 3;
  active: boolean;
}

export interface AcademyCertificate {
  id: string;
  tier: 1 | 2 | 3;
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
  npcAwardHistory?: Record<string, { medals: string[]; ribbons: string[] }>;
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

export type NpcRuntimeStatus = 'ACTIVE' | 'INJURED' | 'KIA' | 'RESERVE' | 'RECRUITING';

export interface NpcRuntimeState {
  npcId: string;
  slotNo: number;
  generation: number;
  name: string;
  division: string;
  unit: string;
  position: string;
  status: NpcRuntimeStatus;
  joinedDay: number;
  deathDay: number | null;
  tactical: number;
  support: number;
  leadership: number;
  resilience: number;
  intelligence: number;
  competence: number;
  loyalty: number;
  integrityRisk: number;
  betrayalRisk: number;
  fatigue: number;
  trauma: number;
  xp: number;
  promotionPoints: number;
  relationToPlayer: number;
  lastTask: string | null;
  updatedAtMs: number;
}

export interface NpcLifecycleEvent {
  id: number;
  npcId: string;
  eventType:
    | 'PROMOTION'
    | 'ACADEMY_PASS'
    | 'ACADEMY_FAIL'
    | 'CERTIFICATION_EARNED'
    | 'KIA'
    | 'REPLACEMENT_QUEUED'
    | 'REPLACEMENT_JOINED'
    | 'DISCIPLINARY';
  day: number;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface MissionInstanceV5 {
  missionId: string;
  status: 'PLANNED' | 'ACTIVE' | 'RESOLVED';
  issuedDay: number;
  missionType: 'RECON' | 'COUNTER_RAID' | 'BLACK_OPS' | 'TRIBUNAL_SECURITY';
  dangerTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  plan: {
    strategy: string;
    objective: string;
    prepChecklist: string[];
    chainQuality: number;
    logisticReadiness: number;
  } | null;
  execution: {
    success: boolean;
    successScore: number;
    casualties: number;
    moraleDelta: number;
    healthDelta: number;
    fundDeltaCents: number;
  } | null;
  updatedAtMs: number;
}

export interface CeremonyCycleV5 {
  cycleId: string;
  ceremonyDay: number;
  status: 'PENDING' | 'COMPLETED';
  completedAtMs: number | null;
  summary: {
    attendance: number;
    kiaMemorialCount: number;
    commandRotationApplied: boolean;
  };
  awards: Array<{
    orderNo: number;
    npcId: string | null;
    recipientName: string;
    medal: string;
    ribbon: string;
    reason: string;
  }>;
}

export interface CertificationRecordV5 {
  certId: string;
  holderType: 'PLAYER' | 'NPC';
  npcId: string | null;
  certCode: string;
  track: string;
  tier: 1 | 2 | 3;
  grade: 'A' | 'B' | 'C' | 'D';
  issuedDay: number;
  expiresDay: number;
  valid: boolean;
}

export interface AcademyBatchStanding {
  holderType: 'PLAYER' | 'NPC';
  npcId: string | null;
  name: string;
  dayProgress: number;
  finalScore: number;
  passed: boolean;
  rankPosition: number;
  extraCertCount: number;
}

export interface AcademyBatchState {
  batchId: string;
  track: string;
  tier: number;
  status: 'ACTIVE' | 'GRADUATED' | 'FAILED';
  lockEnabled: boolean;
  startDay: number;
  endDay: number;
  totalDays: number;
  playerDayProgress: number;
  expectedWorldDay: number;
  canSubmitToday: boolean;
  nextQuestionSetId: string | null;
  standingsTop10: AcademyBatchStanding[];
  playerStanding: AcademyBatchStanding | null;
  graduation:
    | {
        passed: boolean;
        playerRank: number;
        totalCadets: number;
        certificateCodes: string[];
        message: string;
      }
    | null;
}

export interface DivisionQuotaState {
  division: string;
  headNpcId: string | null;
  headName: string | null;
  quotaTotal: number;
  quotaUsed: number;
  quotaRemaining: number;
  status: 'OPEN' | 'COOLDOWN';
  cooldownUntilDay: number | null;
  cooldownDays: number;
  decisionNote: string;
  updatedDay: number;
}

export interface RecruitmentCompetitionEntry {
  holderType: 'PLAYER' | 'NPC';
  npcId: string | null;
  name: string;
  division: string;
  appliedDay: number;
  examScore: number;
  compositeScore: number;
  fatigue: number;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  reason?: string | null;
  rank: number;
}

export interface RecruitmentPipelineState {
  applicationId: string;
  holderType: 'PLAYER' | 'NPC';
  npcId: string | null;
  holderName: string;
  division: string;
  status: 'REGISTRATION' | 'TRYOUT' | 'SELECTION' | 'ANNOUNCEMENT_ACCEPTED' | 'ANNOUNCEMENT_REJECTED';
  registeredDay: number;
  tryoutDay: number | null;
  selectionDay: number | null;
  announcementDay: number | null;
  tryoutScore: number;
  finalScore: number;
  note: string;
}

export interface DomOperationSession {
  sessionId: string;
  sessionNo: 1 | 2 | 3;
  participantMode: 'PLAYER_ELIGIBLE' | 'NPC_ONLY';
  npcSlots: number;
  playerJoined: boolean;
  playerJoinDay: number | null;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED';
  result: Record<string, unknown>;
}

export interface DomOperationCycle {
  cycleId: string;
  startDay: number;
  endDay: number;
  status: 'ACTIVE' | 'COMPLETED';
  sessions: DomOperationSession[];
}

export interface CourtCaseV2 {
  caseId: string;
  caseType: 'DISMISSAL' | 'SANCTION' | 'DEMOTION' | 'MUTATION';
  targetType: 'PLAYER' | 'NPC';
  targetNpcId: string | null;
  requestedDay: number;
  status: 'PENDING' | 'IN_REVIEW' | 'CLOSED';
  verdict: 'UPHOLD' | 'DISMISS' | 'REASSIGN' | null;
  decisionDay: number | null;
  details: Record<string, unknown>;
}

export interface CouncilState {
  councilId: string;
  councilType: 'MLC' | 'DOM' | 'PERSONNEL_BOARD' | 'STRATEGIC_COUNCIL';
  agenda: string;
  status: 'OPEN' | 'CLOSED';
  openedDay: number;
  closedDay: number | null;
  quorum: number;
  votes: {
    approve: number;
    reject: number;
    abstain: number;
  };
}

export interface MailboxMessage {
  messageId: string;
  senderType: 'SYSTEM' | 'NPC' | 'COUNCIL';
  senderNpcId: string | null;
  subject: string;
  body: string;
  category: 'PROMOTION' | 'DEMOTION' | 'MUTATION' | 'SANCTION' | 'COUNCIL_INVITE' | 'COURT' | 'GENERAL';
  relatedRef: string | null;
  createdDay: number;
  createdAt: string;
  readAt: string | null;
  readDay: number | null;
}

export interface SocialTimelineEvent {
  id: number;
  actorType: 'PLAYER' | 'NPC';
  actorNpcId: string | null;
  eventType: string;
  title: string;
  detail: string;
  eventDay: number;
  createdAt: string;
  meta: Record<string, unknown>;
}

export interface CommandChainAck {
  id: number;
  orderId: string;
  actorType: 'PLAYER' | 'NPC';
  actorNpcId: string | null;
  hopNo: number;
  forwardedToNpcId: string | null;
  ackDay: number;
  note: string;
  createdAt: string;
}

export interface CommandChainOrder {
  orderId: string;
  issuedDay: number;
  issuerType: 'PLAYER' | 'NPC';
  issuerNpcId: string | null;
  targetNpcId: string | null;
  targetDivision: string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'PENDING' | 'FORWARDED' | 'ACKNOWLEDGED' | 'BREACHED' | 'EXPIRED';
  ackDueDay: number;
  completedDay: number | null;
  penaltyApplied: boolean;
  commandPayload: Record<string, unknown>;
  acks?: CommandChainAck[];
}

export interface ExpansionStateV51 {
  academyLockActive: boolean;
  academyLockReason: string | null;
  academyBatch: AcademyBatchState | null;
  quotaBoard: DivisionQuotaState[];
  recruitmentRace: {
    division: string | null;
    top10: RecruitmentCompetitionEntry[];
    playerRank: number | null;
    playerEntry: RecruitmentCompetitionEntry | null;
    generatedAtDay: number;
  };
  performance: {
    maxNpcOps: number;
    adaptiveBudget: number;
    tickPressure: 'LOW' | 'MEDIUM' | 'HIGH';
    pollingHintMs: number;
  };
  recruitmentPipeline?: RecruitmentPipelineState[];
  domCycle?: DomOperationCycle | null;
  councils?: CouncilState[];
  openCourtCases?: CourtCaseV2[];
  mailboxSummary?: {
    unreadCount: number;
    latest: MailboxMessage | null;
  };
  socialTimelineSummary?: SocialTimelineEvent[];
  commandChainSummary?: {
    openOrders: number;
    breachedOrders: number;
    latest: CommandChainOrder | null;
  };
  governanceSummary?: {
    nationalStability: number;
    militaryStability: number;
    militaryFundCents: number;
    corruptionRisk: number;
    riskIndex: number;
  };
  raiderThreat?: {
    threatLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    threatScore: number;
    cadenceDays: number;
    lastAttackDay: number | null;
    nextAttackDay: number;
    daysUntilNext: number;
    pendingReplacementCount: number;
  };
  domMedalCompetition?: {
    cycleId: string | null;
    totalQuota: number;
    allocated: number;
    remaining: number;
    completedSessions: number;
    pendingSessions: number;
    playerSessionNo: 1 | 2 | 3;
    playerNpcSlots: number;
  };
}

export interface WorldDelta {
  fromVersion: number;
  toVersion: number;
  currentDay: number;
  player: {
    moneyCents: number;
    morale: number;
    health: number;
    rankIndex: number;
    assignment: string;
    commandAuthority: number;
  };
  activeNpcCount: number;
  changedNpcIds: string[];
  changedNpcStates: NpcRuntimeState[];
  activeMission: MissionInstanceV5 | null;
  pendingCeremony: CeremonyCycleV5 | null;
  recruitmentQueue: Array<{
    slotNo: number;
    dueDay: number;
    generationNext: number;
    status: 'QUEUED' | 'FULFILLED' | 'CANCELLED';
  }>;
  recentLifecycleEvents: NpcLifecycleEvent[];
}

export interface GameSnapshotV5 {
  serverNowMs: number;
  stateVersion: number;
  world: {
    currentDay: number;
    gameTimeScale: 1 | 3;
    sessionActiveUntilMs: number | null;
  };
  player: {
    playerName: string;
    branch: BranchCode;
    rankIndex: number;
    moneyCents: number;
    morale: number;
    health: number;
    assignment: string;
    commandAuthority: number;
  };
  npcSummary: {
    total: number;
    active: number;
    injured: number;
    reserve: number;
    kia: number;
    recruiting: number;
  };
  activeMission: MissionInstanceV5 | null;
  pendingCeremony: CeremonyCycleV5 | null;
  expansion?: ExpansionStateV51 | null;
}
