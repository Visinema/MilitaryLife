import type { AuthMeResponse } from '@mls/shared/api-types';
import type { ActionResult, DecisionResult, GameSnapshot } from '@mls/shared/game-types';

type HttpMethod = 'GET' | 'POST';

export type TravelPlace = 'BASE_HQ' | 'BORDER_OUTPOST' | 'LOGISTICS_HUB' | 'TACTICAL_TOWN';

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

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api/v1';

let snapshotBackoffUntilMs = 0;
let snapshotInFlight: Promise<{ snapshot: GameSnapshot }> | null = null;

async function request<T>(path: string, method: HttpMethod, body?: unknown, options?: RequestOptions): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body
      ? {
          'content-type': 'application/json'
        }
      : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: options?.cache ?? 'no-store',
    keepalive: method !== 'GET'
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => ({}))) as { error?: string; details?: unknown } & T;

  if (!response.ok) {
    throw new ApiError(response.status, payload.error ?? 'Request failed', payload.details);
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
  createProfile(payload: { name: string; startAge: number; country: 'US' | 'ID'; branch: string }) {
    return request<{ profileId: string }>('/profile/create', 'POST', payload);
  },
  snapshot() {
    if (Date.now() < snapshotBackoffUntilMs) {
      throw new ApiError(503, 'Snapshot sementara cooldown karena backend belum siap');
    }

    return requestSnapshot();
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
  militaryAcademy(payload: { tier: 1 | 2; answers?: number[]; preferredDivision?: 'INFANTRY' | 'INTEL' | 'LOGISTICS' | 'CYBER' }) {
    return request<ActionResult>('/game/actions/military-academy', 'POST', payload);
  },
  travel(place: TravelPlace) {
    return request<ActionResult>('/game/actions/travel', 'POST', { place });
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
  pool(limit = 20) {
    return request<{ items: Array<Record<string, unknown>> }>(`/events/pool?limit=${limit}`, 'GET', undefined, { cache: 'force-cache' });
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
