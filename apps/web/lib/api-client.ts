import type { AuthMeResponse, GameSnapshot, ActionResult, DecisionResult } from '@mls/shared';

type HttpMethod = 'GET' | 'POST';

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

async function request<T>(path: string, method: HttpMethod, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: {
      'content-type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
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
    return request<{ snapshot: GameSnapshot }>('/game/snapshot', 'GET');
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
  deployment(missionType: 'PATROL' | 'SUPPORT') {
    return request<ActionResult>('/game/actions/deployment', 'POST', { missionType });
  },
  careerReview() {
    return request<ActionResult>('/game/actions/career-review', 'POST', {});
  },
  chooseDecision(eventId: number, optionId: string) {
    return request<{ result: DecisionResult; snapshot: GameSnapshot }>(`/game/decisions/${eventId}/choose`, 'POST', {
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
    return request<{ branches: Record<string, unknown>; generatedAt: number }>('/game/config', 'GET');
  },
  pool(limit = 20) {
    return request<{ items: Array<Record<string, unknown>> }>(`/events/pool?limit=${limit}`, 'GET');
  }
};

export { ApiError };
