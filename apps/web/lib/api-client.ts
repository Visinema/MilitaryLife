import type { AuthMeResponse } from '@mls/shared/api-types';
import type { ActionResult, CeremonyReport, DecisionResult, GameSnapshot, MedalCatalogItem, MilitaryLawCabinetOptionId, MilitaryLawChiefTermOptionId, MilitaryLawEntry, MilitaryLawOptionalPostOptionId, NewsItem, NewsType } from '@mls/shared/game-types';

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

let snapshotBackoffUntilMs = 0;
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
    throw new ApiError(response.status, payload.error ?? 'Request failed', payload.details ?? payload);
  }

  return payload as T;
}

function requestSnapshot(): Promise<{ snapshot: GameSnapshot }> {
  if (snapshotInFlight) {
    return snapshotInFlight;
  }

  snapshotInFlight = request<{ snapshot: GameSnapshot }>('/game/snapshot', 'GET')
    .then((payload) => {
      snapshotBackoffUntilMs = 0;
      return payload;
    })
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.status >= 500) {
        snapshotBackoffUntilMs = Date.now() + 15_000;
      }
      throw error;
    })
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
  createProfile(payload: { name: string; startAge: number; country: 'US'; branch: string }) {
    return request<{ profileId: string }>('/profile/create', 'POST', payload);
  },
  snapshot() {
    if (Date.now() < snapshotBackoffUntilMs) {
      throw new ApiError(503, 'Snapshot sementara cooldown karena backend belum siap');
    }

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
