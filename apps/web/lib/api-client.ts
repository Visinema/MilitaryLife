import type { AuthMeResponse } from '@mls/shared/api-types';
import type {
  AcademyBatchState,
  ActionResult,
  CeremonyCycleV5,
  CeremonyReport,
  CertificationRecordV5,
  CommandChainOrder,
  CouncilState,
  CourtCaseV2,
  DomOperationCycle,
  EducationTitle,
  ExpansionStateV51,
  DecisionResult,
  GameSnapshot,
  GameSnapshotV5,
  MailboxMessage,
  MedalCatalogItem,
  MilitaryLawCabinetOptionId,
  MilitaryLawChiefTermOptionId,
  MilitaryLawEntry,
  MilitaryLawOptionalPostOptionId,
  MissionInstanceV5,
  NewsItem,
  NewsType,
  NpcLifecycleEvent,
  NpcRuntimeState,
  NpcRuntimeStatus,
  RecruitmentPipelineState,
  RecruitmentCompetitionEntry,
  SocialTimelineEvent,
  WorldDelta
} from '@mls/shared/game-types';

type HttpMethod = 'GET' | 'POST';

export type TravelPlace = 'BASE_HQ' | 'BORDER_OUTPOST' | 'LOGISTICS_HUB' | 'TACTICAL_TOWN';
export type CommandAction = 'PLAN_MISSION' | 'ISSUE_SANCTION' | 'ISSUE_PROMOTION';
export type SocialInteractionType = 'MENTOR' | 'SUPPORT' | 'BOND' | 'DEBRIEF';


export type MilitaryLawProposalPayload =
  | {
      articleKey: 'chiefTerm';
      optionId: MilitaryLawChiefTermOptionId;
      rationale?: string;
    }
  | {
      articleKey: 'cabinet';
      optionId: MilitaryLawCabinetOptionId;
      rationale?: string;
    }
  | {
      articleKey: 'optionalPosts';
      optionId: MilitaryLawOptionalPostOptionId;
      rationale?: string;
    };

type RequestOptions = {
  cache?: RequestCache;
};

class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function normalizeApiBase(rawValue: string | undefined): string {
  const fallback = '/api/v1';
  const raw = rawValue?.trim();
  if (!raw) return fallback;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const normalizedPath = url.pathname.replace(/\/$/, '').replace(/\/api(?:\/v1)?$/i, '/api/v1');
      const ensuredPath = normalizedPath.endsWith('/api/v1') ? normalizedPath : `${normalizedPath}/api/v1`;
      return `${url.origin}${ensuredPath}`;
    } catch {
      return fallback;
    }
  }

  const normalizedRelative = raw.replace(/\/$/, '').replace(/\/api(?:\/v1)?$/i, '/api/v1');
  return normalizedRelative.endsWith('/api/v1') ? normalizedRelative : `${normalizedRelative}/api/v1`;
}

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_BASE);

let snapshotInFlight: Promise<{ snapshot: GameSnapshot }> | null = null;

const REQUEST_TIMEOUT_MS: Record<HttpMethod, number> = {
  GET: 8_000,
  POST: 12_000
};

async function request<T>(path: string, method: HttpMethod, body?: unknown, options?: RequestOptions): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS[method]);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: body
        ? {
            'content-type': 'application/json'
          }
        : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: options?.cache ?? 'no-store',
      keepalive: method !== 'GET',
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(408, 'Request timeout. Coba lagi beberapa saat.');
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => ({}))) as { error?: string; details?: unknown } & T;

  if (!response.ok) {
    const defaultMessage = payload.error ?? 'Request failed';
    if (response.status === 404 && path.startsWith('/game/v5/')) {
      throw new ApiError(
        response.status,
        `Endpoint backend belum tersedia: ${path}. Pastikan API backend versi terbaru sudah terdeploy.`,
        payload.details ?? payload
      );
    }
    throw new ApiError(response.status, defaultMessage, payload.details ?? payload);
  }

  return payload as T;
}

function requestSnapshot(): Promise<{ snapshot: GameSnapshot }> {
  if (snapshotInFlight) {
    return snapshotInFlight;
  }

  snapshotInFlight = request<{ snapshot: GameSnapshot }>('/game/snapshot', 'GET')
    .then((payload) => payload)
    .finally(() => {
      snapshotInFlight = null;
    });

  return snapshotInFlight;
}

export const api = {
  register(email: string, password: string) {
    return request<{ userId: string; email: string; profileId: string | null }>('/auth/register', 'POST', {
      email,
      password
    });
  },
  login(email: string, password: string) {
    return request<{ userId: string; email: string; profileId: string | null }>('/auth/login', 'POST', {
      email,
      password
    });
  },
  logout() {
    return request<void>('/auth/logout', 'POST');
  },
  me() {
    return request<AuthMeResponse>('/auth/me', 'GET');
  },
  buildMeta() {
    return request<{ version: string; commitShaShort: string | null; builtAt: string }>('/meta/build', 'GET', undefined, {
      cache: 'no-store'
    });
  },
  v5SessionStart(payload?: { resetWorld?: boolean }) {
    return request<{ started: boolean; resetApplied: boolean; snapshot: GameSnapshotV5 | null }>('/game/v5/session/start', 'POST', payload ?? {});
  },
  v5SessionHeartbeat(payload?: { sessionTtlMs?: number }) {
    return request<{ ok: boolean; snapshot: GameSnapshotV5 | null }>('/game/v5/session/heartbeat', 'POST', payload ?? {});
  },
  v5SessionSync(sinceVersion?: number) {
    const query = typeof sinceVersion === 'number' ? `?sinceVersion=${sinceVersion}` : '';
    return request<{ fullSync: boolean; snapshot: GameSnapshotV5 | null; delta: WorldDelta | null }>(`/game/v5/session/sync${query}`, 'GET');
  },
  v5Npcs(query?: { status?: NpcRuntimeStatus; cursor?: number; limit?: number }) {
    const params = new URLSearchParams();
    if (query?.status) params.set('status', query.status);
    if (typeof query?.cursor === 'number') params.set('cursor', String(query.cursor));
    if (typeof query?.limit === 'number') params.set('limit', String(query.limit));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<{ items: NpcRuntimeState[]; nextCursor: number | null }>(`/game/v5/npcs${suffix}`, 'GET');
  },
  v5NpcDetail(npcId: string) {
    return request<{ npc: NpcRuntimeState; lifecycleEvents: NpcLifecycleEvent[]; certifications: CertificationRecordV5[] }>(`/game/v5/npcs/${encodeURIComponent(npcId)}`, 'GET');
  },
  v5MissionPlan(payload: {
    missionType: MissionInstanceV5['missionType'];
    dangerTier: MissionInstanceV5['dangerTier'];
    strategy: string;
    objective: string;
    prepChecklist: string[];
    participantNpcIds: string[];
  }) {
    return request<{ mission: MissionInstanceV5; snapshot: GameSnapshotV5 | null }>('/game/v5/missions/plan', 'POST', payload);
  },
  v5MissionExecute(payload: { missionId: string; playerParticipates?: boolean }) {
    return request<{ mission: MissionInstanceV5; snapshot: GameSnapshotV5 | null }>('/game/v5/missions/execute', 'POST', payload);
  },
  v5CeremonyCurrent() {
    return request<{ ceremony: CeremonyCycleV5 | null; snapshot: GameSnapshotV5 | null }>('/game/v5/ceremony/current', 'GET');
  },
  v5CeremonyComplete() {
    return request<{ ceremony: CeremonyCycleV5 | null; snapshot: GameSnapshotV5 | null }>('/game/v5/ceremony/complete', 'POST', {});
  },
  v5AcademyEnroll(payload: { enrolleeType: 'PLAYER' | 'NPC'; npcId?: string; track: 'OFFICER' | 'HIGH_COMMAND' | 'SPECIALIST' | 'TRIBUNAL' | 'CYBER'; tier: number }) {
    return request<{ enrollmentId: number; passed: boolean; score: number; snapshot: GameSnapshotV5 | null }>('/game/v5/academy/enroll', 'POST', payload);
  },
  v5CertificationExam(payload: { holderType: 'PLAYER' | 'NPC'; npcId?: string; certCode: string; score: number }) {
    return request<{ passed: boolean; grade: 'A' | 'B' | 'C' | 'D'; certifications: CertificationRecordV5[]; snapshot: GameSnapshotV5 | null }>(
      '/game/v5/certifications/exam',
      'POST',
      payload
    );
  },
  v5ExpansionState() {
    return request<{ state: ExpansionStateV51; snapshot: GameSnapshotV5 | null }>('/game/v5/expansion/state', 'GET');
  },
  v5AcademyBatchStart(payload: { track: 'OFFICER' | 'HIGH_COMMAND' | 'SPECIALIST' | 'TRIBUNAL' | 'CYBER'; tier: number }) {
    return request<{ started: boolean; batchId: string; state: ExpansionStateV51; snapshot: GameSnapshotV5 | null }>(
      '/game/v5/academy/batch/start',
      'POST',
      payload
    );
  },
  v5AcademyBatchCurrent() {
    return request<{
      academyLockActive: boolean;
      academyBatch: AcademyBatchState | null;
      questionSet: { setId: string; questions: Array<{ id: string; prompt: string; choices: [string, string, string, string] }> } | null;
      state: ExpansionStateV51;
      snapshot: GameSnapshotV5 | null;
    }>('/game/v5/academy/batch/current', 'GET');
  },
  v5AcademyBatchSubmitDay(payload: { answers: number[] }) {
    return request<{
      submitted: boolean;
      academyDay: number;
      dayScore: number;
      dayPassed: boolean;
      readyToGraduate: boolean;
      graduated?: boolean;
      graduation?: {
        passed: boolean;
        playerRank: number;
        totalCadets: number;
        certificateCodes: string[];
        message: string;
      } | null;
      academyBatch: AcademyBatchState | null;
      state: ExpansionStateV51;
      snapshot: GameSnapshotV5 | null;
    }>('/game/v5/academy/batch/submit-day', 'POST', payload);
  },
  v5AcademyBatchGraduate() {
    return request<{
      graduated: boolean;
      passed: boolean;
      playerRank: number;
      totalCadets: number;
      certificateCodes: string[];
      message: string;
      academyBatch: AcademyBatchState | null;
      state: ExpansionStateV51;
      snapshot: GameSnapshotV5 | null;
    }>('/game/v5/academy/batch/graduate', 'POST', {});
  },
  v5RecruitmentBoard(division?: string) {
    const query = division ? `?division=${encodeURIComponent(division)}` : '';
    return request<{
      board: {
        division: string | null;
        requirement: { label: 'STANDARD' | 'ADVANCED' | 'ELITE'; minExtraCerts: number };
        playerEligibility: {
          hasBaseDiploma: boolean;
          baseDiplomaCode: string | null;
          baseDiplomaGrade: 'A' | 'B' | 'C' | 'D' | null;
          extraCertCount: number;
          requiredExtraCerts: number;
          missingExtraCerts: number;
          bonusScore: number;
          bonusCap: number;
          eligible: boolean;
        };
        quota: {
          division: string;
          quotaTotal: number;
          quotaUsed: number;
          quotaRemaining: number;
          status: 'OPEN' | 'COOLDOWN';
          cooldownUntilDay: number | null;
          cooldownDays: number;
          decisionNote: string;
          headName: string | null;
        } | null;
        quotaBoard: ExpansionStateV51['quotaBoard'];
        race: ExpansionStateV51['recruitmentRace'];
        questionSet: { setId: string; questions: Array<{ id: string; prompt: string; choices: [string, string, string, string] }> } | null;
      };
      state: ExpansionStateV51;
      snapshot: GameSnapshotV5 | null;
    }>(`/game/v5/recruitment/board${query}`, 'GET');
  },
  v5RecruitmentApply(payload: { division: string; answers: number[] }) {
    return request<{
      accepted: boolean;
      division: string;
      requirement: { label: 'STANDARD' | 'ADVANCED' | 'ELITE'; minExtraCerts: number };
      examScore: number;
      compositeScore: number;
      acceptedSlots: number;
      quota: {
        division: string;
        quotaTotal: number;
        quotaUsed: number;
        quotaRemaining: number;
        status: 'OPEN' | 'COOLDOWN';
        cooldownUntilDay: number | null;
        cooldownDays: number;
        decisionNote: string;
      };
      playerDecision: {
        status: 'ACCEPTED' | 'REJECTED';
        code: string;
        reason: string;
      };
      playerEntry: RecruitmentCompetitionEntry | null;
      raceTop10: RecruitmentCompetitionEntry[];
      message: string;
      state: ExpansionStateV51;
      snapshot: GameSnapshotV5 | null;
    }>('/game/v5/recruitment/apply', 'POST', payload);
  },
  v5RankHistory() {
    return request<{
      items: Array<{
        id: number;
        actorType: 'PLAYER' | 'NPC';
        npcId: string | null;
        oldRankIndex: number;
        newRankIndex: number;
        reason: string;
        changedDay: number;
        createdAt: string;
      }>;
      snapshot: GameSnapshotV5 | null;
    }>('/game/v5/personnel/rank-history', 'GET');
  },
  v5DivisionsCatalog() {
    return request<{
      items: Array<{
        id: string;
        name: string;
        type: 'DIVISI' | 'SATUAN_TUGAS' | 'KORPS';
        subdivisions: string[];
        units: string[];
        positions: string[];
        requirement: { label: 'STANDARD' | 'ADVANCED' | 'ELITE'; minExtraCerts: number };
        quota: ExpansionStateV51['quotaBoard'][number] | null;
      }>;
      snapshot: GameSnapshotV5 | null;
    }>('/game/v5/divisions/catalog', 'GET');
  },
  v5RegisterDivisionApplication(payload: { division: string }) {
    return request<{
      application: RecruitmentPipelineState;
      schedule: {
        registrationDay: number;
        tryoutDay: number;
        selectionDay: number;
        announcementDay: number;
        totalDays: number;
      };
      state: ExpansionStateV51;
      snapshot: GameSnapshotV5 | null;
    }>('/game/v5/divisions/applications/register', 'POST', payload);
  },
  v5TryoutDivisionApplication(applicationId: string, payload: { answers: number[] }) {
    return request<{
      application: RecruitmentPipelineState;
      nextStageAvailableDay: number;
      state: ExpansionStateV51;
      snapshot: GameSnapshotV5 | null;
    }>(`/game/v5/divisions/applications/${encodeURIComponent(applicationId)}/tryout`, 'POST', payload);
  },
  v5FinalizeDivisionApplication(applicationId: string) {
    return request<{
      stage: 'SELECTION' | 'ANNOUNCEMENT';
      accepted?: boolean;
      application: RecruitmentPipelineState;
      nextStageAvailableDay?: number;
      state?: ExpansionStateV51;
      snapshot?: GameSnapshotV5 | null;
    }>(`/game/v5/divisions/applications/${encodeURIComponent(applicationId)}/finalize`, 'POST', {});
  },
  v5DivisionApplication(applicationId: string) {
    return request<{
      application: RecruitmentPipelineState;
      schedule: {
        registrationDay: number;
        tryoutDay: number;
        selectionDay: number;
        announcementDay: number;
        totalDays: number;
      };
      stageIndex: number;
      currentWorldDay: number;
      canTryout: boolean;
      canFinalizeSelection: boolean;
      canAnnounce: boolean;
      snapshot: GameSnapshotV5 | null;
    }>(`/game/v5/divisions/applications/${encodeURIComponent(applicationId)}`, 'GET');
  },
  v5AcademyPrograms() {
    return request<{
      constants: { academyTierDays: Record<1 | 2 | 3, number> };
      programs: Array<{ track: string; tiers: number[]; durations: number[]; description: string }>;
      state: ExpansionStateV51;
      snapshot: GameSnapshotV5 | null;
    }>('/game/v5/academy/programs', 'GET');
  },
  v5AcademyTitles() {
    return request<{
      titles: EducationTitle[];
      playerDisplayName: string | null;
      snapshot: GameSnapshotV5 | null;
    }>('/game/v5/academy/titles', 'GET');
  },
  v5DomCycleCurrent() {
    return request<{
      constants: {
        domCycleDays: number;
        sessionsPerCycle: number;
        playerSessionNo: number;
        playerNpcSlots: number;
      };
      cycle: DomOperationCycle | null;
      snapshot: GameSnapshotV5 | null;
    }>('/game/v5/dom/cycle/current', 'GET');
  },
  v5DomJoinSession(sessionId: string) {
    return request<{ session: DomOperationCycle['sessions'][number]; cycle: DomOperationCycle | null; snapshot: GameSnapshotV5 | null }>(
      `/game/v5/dom/sessions/${encodeURIComponent(sessionId)}/join`,
      'POST',
      {}
    );
  },
  v5DomExecuteSession(sessionId: string) {
    return request<{ session: DomOperationCycle['sessions'][number]; cycle: DomOperationCycle | null; snapshot: GameSnapshotV5 | null }>(
      `/game/v5/dom/sessions/${encodeURIComponent(sessionId)}/execute`,
      'POST',
      {}
    );
  },
  v5CourtCases() {
    return request<{ cases: CourtCaseV2[]; snapshot: GameSnapshotV5 | null }>('/game/v5/court/cases', 'GET');
  },
  v5CourtVerdict(payload: { caseId: string; verdict: 'UPHOLD' | 'DISMISS' | 'REASSIGN'; note?: string; newDivision?: string; newPosition?: string }) {
    return request<{ case: CourtCaseV2; snapshot: GameSnapshotV5 | null }>(
      `/game/v5/court/cases/${encodeURIComponent(payload.caseId)}/verdict`,
      'POST',
      {
        verdict: payload.verdict,
        note: payload.note,
        newDivision: payload.newDivision,
        newPosition: payload.newPosition
      }
    );
  },
  v5Councils() {
    return request<{ councils: CouncilState[]; snapshot: GameSnapshotV5 | null }>('/game/v5/councils', 'GET');
  },
  v5CouncilVote(payload: { councilId: string; voteChoice: 'APPROVE' | 'REJECT' | 'ABSTAIN'; rationale?: string }) {
    return request<{ council: CouncilState | null; snapshot: GameSnapshotV5 | null }>(
      `/game/v5/councils/${encodeURIComponent(payload.councilId)}/vote`,
      'POST',
      { voteChoice: payload.voteChoice, rationale: payload.rationale }
    );
  },
  v5Mailbox(query?: { unreadOnly?: boolean; limit?: number }) {
    const params = new URLSearchParams();
    if (typeof query?.unreadOnly === 'boolean') params.set('unreadOnly', String(query.unreadOnly));
    if (typeof query?.limit === 'number') params.set('limit', String(query.limit));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<{
      items: MailboxMessage[];
      summary: { unreadCount: number; latest: MailboxMessage | null };
      snapshot: GameSnapshotV5 | null;
    }>(`/game/v5/mailbox${suffix}`, 'GET');
  },
  v5MailboxRead(messageId: string) {
    return request<{
      message: MailboxMessage;
      summary: { unreadCount: number; latest: MailboxMessage | null };
      snapshot: GameSnapshotV5 | null;
    }>(`/game/v5/mailbox/${encodeURIComponent(messageId)}/read`, 'POST', {});
  },
  v5SocialTimeline(query?: { actorType?: 'PLAYER' | 'NPC'; limit?: number }) {
    const params = new URLSearchParams();
    if (query?.actorType) params.set('actorType', query.actorType);
    if (typeof query?.limit === 'number') params.set('limit', String(query.limit));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<{ events: SocialTimelineEvent[]; snapshot: GameSnapshotV5 | null }>(`/game/v5/social/timeline${suffix}`, 'GET');
  },
  v5CommandChainOrders(query?: { status?: CommandChainOrder['status']; limit?: number }) {
    const params = new URLSearchParams();
    if (query?.status) params.set('status', query.status);
    if (typeof query?.limit === 'number') params.set('limit', String(query.limit));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return request<{
      orders: CommandChainOrder[];
      summary: { openOrders: number; breachedOrders: number; latest: CommandChainOrder | null };
      snapshot: GameSnapshotV5 | null;
    }>(`/game/v5/command-chain/orders${suffix}`, 'GET');
  },
  v5CommandChainOrder(orderId: string) {
    return request<{ order: CommandChainOrder; snapshot: GameSnapshotV5 | null }>(
      `/game/v5/command-chain/orders/${encodeURIComponent(orderId)}`,
      'GET'
    );
  },
  v5CommandChainCreate(payload: {
    targetNpcId?: string;
    targetDivision?: string;
    message: string;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH';
    ackWindowDays?: number;
    chainPathNpcIds?: string[];
  }) {
    return request<{ order: CommandChainOrder; snapshot: GameSnapshotV5 | null }>('/game/v5/command-chain/orders', 'POST', payload);
  },
  v5CommandChainForward(payload: { orderId: string; actorNpcId?: string; forwardedToNpcId: string; note?: string }) {
    return request<{ order: CommandChainOrder; snapshot: GameSnapshotV5 | null }>(
      `/game/v5/command-chain/orders/${encodeURIComponent(payload.orderId)}/forward`,
      'POST',
      {
        actorNpcId: payload.actorNpcId,
        forwardedToNpcId: payload.forwardedToNpcId,
        note: payload.note
      }
    );
  },
  v5CommandChainAck(payload: { orderId: string; actorNpcId?: string; note?: string }) {
    return request<{ order: CommandChainOrder; snapshot: GameSnapshotV5 | null }>(
      `/game/v5/command-chain/orders/${encodeURIComponent(payload.orderId)}/ack`,
      'POST',
      {
        actorNpcId: payload.actorNpcId,
        note: payload.note
      }
    );
  },
  createProfile(payload: { name: string; startAge: number; country: 'US'; branch: string }) {
    return request<{ profileId: string }>('/profile/create', 'POST', payload);
  },
  snapshot() {
    return requestSnapshot();
  },
  setTimeScale(scale: 1 | 3) {
    return request<ActionResult>('/game/actions/time-scale', 'POST', { scale });
  },
  pause(reason: 'DECISION' | 'MODAL' | 'SUBPAGE') {
    return request<{ pauseToken: string; pauseExpiresAtMs: number | null; snapshot: GameSnapshot }>('/game/pause', 'POST', {
      reason
    });
  },
  resume(pauseToken: string) {
    return request<{ snapshot: GameSnapshot }>('/game/resume', 'POST', { pauseToken });
  },
  training(intensity: 'LOW' | 'MEDIUM' | 'HIGH') {
    return request<ActionResult>('/game/actions/training', 'POST', { intensity });
  },
  deployment(missionType: 'PATROL' | 'SUPPORT', missionDurationDays = 2) {
    return request<ActionResult>('/game/actions/deployment', 'POST', { missionType, missionDurationDays });
  },
  careerReview() {
    return request<ActionResult>('/game/actions/career-review', 'POST', {});
  },
  militaryAcademy(payload: { tier: 1 | 2; answers?: number[]; preferredDivision?: string }) {
    return request<ActionResult>('/game/actions/military-academy', 'POST', payload);
  },
  travel(place: TravelPlace) {
    return request<ActionResult>('/game/actions/travel', 'POST', { place });
  },
  command(action: CommandAction, targetNpcId?: string, note?: string) {
    return request<ActionResult>('/game/actions/command', 'POST', { action, targetNpcId, note });
  },
  socialInteraction(npcId: string, interaction: SocialInteractionType, note?: string) {
    return request<ActionResult>('/game/actions/social-interaction', 'POST', { npcId, interaction, note });
  },
  restartWorld() {
    return request<{ ok: boolean; snapshot: GameSnapshot }>('/game/actions/restart-world', 'POST', {});
  },
  chooseDecision(eventId: number, optionId: string) {
    return request<{ result: DecisionResult | null; snapshot: GameSnapshot; conflict?: boolean; reason?: string }>(`/game/decisions/${eventId}/choose`, 'POST', {
      optionId
    });
  },
  decisionLogs(cursor?: number, limit = 20) {
    const query = new URLSearchParams();
    if (cursor) query.set('cursor', String(cursor));
    query.set('limit', String(limit));
    return request<{
      items: Array<{
        id: number;
        event_id: number;
        game_day: number;
        selected_option: string;
        consequences: Record<string, unknown>;
        created_at: string;
      }>;
      nextCursor: number | null;
    }>(`/game/decision-logs?${query.toString()}`, 'GET');
  },
  config() {
    return request<{ branches: Record<string, unknown>; generatedAt: number }>('/game/config', 'GET', undefined, { cache: 'force-cache' });
  },
  ceremony() {
    return request<{ ceremony: CeremonyReport }>('/game/ceremony', 'GET');
  },
  ceremonyComplete() {
    return request<{ ok: boolean; awardedToPlayer?: boolean; snapshot: GameSnapshot; alreadyCompleted?: boolean }>('/game/actions/ceremony-complete', 'POST', {});
  },
  raiderDefense() {
    return request<ActionResult>('/game/actions/raider-defense', 'POST', {});
  },

  recruitmentApply(payload: { trackId: string; answers: Record<string, string> }) {
    return request<ActionResult>('/game/actions/recruitment-apply', 'POST', payload);
  },

  v3Mission(payload: { missionType: 'RECON' | 'COUNTER_RAID' | 'BLACK_OPS' | 'TRIBUNAL_SECURITY'; dangerTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'; playerParticipates: boolean }) {
    return request<ActionResult>('/game/actions/v3-mission', 'POST', payload);
  },
  respondMissionCall(participate: boolean) {
    return request<ActionResult>('/game/actions/mission-call-response', 'POST', { participate });
  },
  missionPlan(payload: { strategy: string; objective: string; prepChecklist: string[] }) {
    return request<ActionResult>('/game/actions/mission-plan', 'POST', payload);
  },
  appointSecretary(npcName: string) {
    return request<ActionResult>('/game/actions/appoint-secretary', 'POST', { npcName });
  },
  courtReview(payload: { caseId: string; verdict: 'UPHOLD' | 'DISMISS' | 'REASSIGN' }) {
    return request<ActionResult>('/game/actions/court-review', 'POST', payload);
  },
  medalCatalog() {
    return request<{ items: MedalCatalogItem[]; note: string; snapshot: GameSnapshot }>('/game/v3/medals', 'GET');
  },
  news(type?: NewsType) {
    const query = type ? `?type=${type}` : '';
    return request<{ items: NewsItem[]; generatedAt: number; rangeDays: number; filter: NewsType | null; snapshot: GameSnapshot }>(`/game/news${query}`, 'GET');
  },
  pool(limit = 20) {
    return request<{ items: Array<Record<string, unknown>> }>(`/events/pool?limit=${limit}`, 'GET', undefined, { cache: 'force-cache' });
  },
  militaryLaw() {
    return request<{
      current: MilitaryLawEntry | null;
      logs: MilitaryLawEntry[];
      articleOptions: {
        chiefTerm: Array<{ id: MilitaryLawChiefTermOptionId; label: string; valueDays: number }>;
        cabinet: Array<{ id: MilitaryLawCabinetOptionId; label: string; seatCount: number }>;
        optionalPosts: Array<{ id: MilitaryLawOptionalPostOptionId; label: string; posts: string[] }>;
      };
      mlcEligibleMembers: number;
      governance: {
        canPlayerVote: boolean;
        meetingActive: boolean;
        meetingDay: number;
        totalMeetingDays: number;
        scheduledSelection: {
          chiefTermOptionId: MilitaryLawChiefTermOptionId;
          cabinetOptionId: MilitaryLawCabinetOptionId;
          optionalPostOptionId: MilitaryLawOptionalPostOptionId;
        } | null;
        note: string;
      };
      snapshot: GameSnapshot;
    }>('/game/military-law', 'GET');
  },
  militaryLawVote(payload: MilitaryLawProposalPayload) {
    return request<ActionResult>('/game/actions/military-law-vote', 'POST', payload);
  },

  npcActivity() {
    return request<{
      generatedAt: number;
      items: Array<{
        npcId: string;
        lastTickDay: number;
        operation: string;
        result: string;
        readiness: number;
        morale: number;
        rankInfluence: number;
        promotionRecommendation: 'STRONG_RECOMMEND' | 'RECOMMEND' | 'HOLD' | 'NOT_RECOMMENDED';
        notificationLetter: string | null;
      }>;
    }>('/game/npc-activity', 'GET');
  }
};

export { ApiError };
