# Military Career Life Simulator

Production-ready, ultra-lightweight real-time military career simulator.

## 1. Product Overview

- **Frontend**: Next.js 15 App Router + Tailwind + Zustand
- **Backend**: Fastify REST API + PostgreSQL (Railway)
- **Hosting**:
  - Frontend: Vercel
  - Backend + PostgreSQL: Railway
- **Gameplay clock**: 1 in-game day = 10 real seconds
- **Authoritative timing**: server-managed only (no client counters)

Core formula:

```ts
gameDay = Math.floor((nowMs - serverReferenceTimeMs) / 10000);
```

Time pauses when decisions/subpages/modals are open and resumes with reference-time correction to prevent drift.

## 2. Architecture Summary

```text
Browser (Next.js)
  -> /api/v1/* (same-origin rewrite on Vercel)
  -> Railway Fastify API
  -> Railway PostgreSQL
```

- Frontend computes live day using server clock offset and snapshot reference time.
- Backend applies all progression in DB transactions (`SELECT ... FOR UPDATE`).
- Game state persists in `game_states`; decisions persist in `decision_logs`.

## 3. Repository Structure

```text
apps/web        # Next.js frontend
apps/api        # Fastify backend
packages/shared # Shared types/constants
```

Key files:

- `apps/api/src/modules/game/service.ts`
- `apps/api/src/modules/game/engine.ts`
- `apps/api/src/db/migrations/001_init.sql`
- `apps/api/src/db/migrations/002_seed_events.sql`
- `apps/web/components/dashboard-shell.tsx`
- `apps/web/components/paused-route-guard.tsx`

## 4. Features Implemented (MVP)

- Email/password auth with HttpOnly cookie session
- Profile creation:
  - name
  - starting age (default 17)
  - country: US / Indonesia
  - branch mapped by country
- Country/branch-specific systems:
  - ranks
  - salary scaling
  - promotion logic (US vs ID behavior split)
  - deployment profiles
  - event pools
- Dashboard:
  - in-game date/day
  - age
  - rank
  - branch
  - money
  - morale
  - health
- Decision popup system with transactional consequences
- Decision logs with cursor pagination
- Subpage pause guard (`SUBPAGE`) and decision pause (`DECISION`)
- Auto-resume safety timeout: 30 minutes
- V5.1 Academy + Recruitment expansion:
  - 8-day academy lock flow with graduation ranking
  - recruitment quota race with mandatory diploma + extra certifications
  - all player/NPC start-reset path from `Nondivisi`
  - adaptive V5 scheduler budget for 120 active NPC targets

## 5. REST API (Base: `/api/v1`)

Auth:

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`

Profile:

- `POST /profile/create`

Game:

- `GET /game/snapshot`
- `POST /game/pause`
- `POST /game/resume`
- `POST /game/actions/training`
- `POST /game/actions/deployment`
- `POST /game/actions/career-review`
- `POST /game/decisions/:eventId/choose`
- `GET /game/decision-logs?cursor=&limit=`
- `GET /game/config`
- `GET /meta/build`

Game V5:

- `POST /game/v5/session/start`
- `POST /game/v5/session/heartbeat`
- `GET /game/v5/session/sync?sinceVersion=`
- `GET /game/v5/npcs?status=&cursor=&limit=`
- `GET /game/v5/npcs/:npcId`
- `POST /game/v5/missions/plan`
- `POST /game/v5/missions/execute`
- `GET /game/v5/ceremony/current`
- `POST /game/v5/ceremony/complete`
- `POST /game/v5/academy/enroll`
- `POST /game/v5/certifications/exam`
- `GET /game/v5/expansion/state`
- `POST /game/v5/academy/batch/start`
- `GET /game/v5/academy/batch/current`
- `POST /game/v5/academy/batch/submit-day`
- `POST /game/v5/academy/batch/graduate`
- `GET /game/v5/recruitment/board`
- `POST /game/v5/recruitment/apply`

Events:

- `GET /events/pool`

## 6. Database

Schema and indexes are in:

- `apps/api/src/db/migrations/001_init.sql`

Seed events are in:

- `apps/api/src/db/migrations/002_seed_events.sql`

Includes:

- `users`
- `profiles`
- `sessions`
- `game_states`
- `events`
- `decision_logs`
- `JSONB` for event options and decision payload/log consequence storage
- read-path indexes + GIN for consequences

## 7. Local Setup

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- pnpm (recommended via Corepack)

Enable pnpm:

```bash
corepack enable
corepack prepare pnpm@9.12.2 --activate
```

Install dependencies:

```bash
corepack pnpm install
```

Create env file:

```bash
cp .env.example .env
```

Configure `DATABASE_URL` and secrets in `.env`.

Run migrations:

```bash
corepack pnpm --filter @mls/api migrate
```

Run backend:

```bash
corepack pnpm dev:api
```

Run frontend:

```bash
corepack pnpm dev:web
```

Web: `http://localhost:3000`
API health: `http://localhost:4000/api/v1/health`

## 8. Environment Variables

Use `.env.example` as baseline.

Backend:

- `PORT` (Railway runtime port, automatically provided)
- `API_PORT` (default `4000`)
- `API_HOST` (default `0.0.0.0`)
- `DATABASE_URL`
- `DATABASE_PRIVATE_URL` (optional fallback on Railway; preferred internal network URL)
- `DATABASE_PUBLIC_URL` (optional fallback)
- `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` (optional fallback set)
- `SESSION_SECRET`
- `COOKIE_SECRET`
- `SESSION_DAYS` (default `30`)
- `PAUSE_TIMEOUT_MINUTES` (default `30`)
- `CORS_ORIGIN` (comma-separated allowlist, e.g. `https://militarylife.vercel.app,http://localhost:3000`)
- `AUTO_MIGRATE_ON_BOOT` (default `true`)
- `AUTO_MIGRATE_STRICT` (default `true`, fail startup if migration fails)
- `DB_HEALTHCHECK_TIMEOUT_MS` (default `5000`)
- `DB_HEALTHCHECK_INTERVAL_MS` (default `5000`)
- `DB_POOL_MAX` (default `20`)
- `DB_SSL_MODE` (`auto` default, set `require` for managed PostgreSQL providers like Railway)
- `STARTUP_DB_CHECK_STRICT` (default `false`, if `true` API exits when first DB probe fails)

Frontend:

- `NEXT_PUBLIC_API_BASE` (default `/api/v1`)
- `BACKEND_ORIGIN` (used by Next.js rewrite, e.g. Railway API URL)

## 9. Deployment (Strict Free-Tier Path)

Railway deploy behavior is pinned via `railway.toml` (`build:api` + root `start` command) to avoid monorepo auto-detection failures.

Important build-context guardrail:
- Do **not** exclude `.nixpacks/` in `.dockerignore`.
- Railway-generated Dockerfile copies `.nixpacks/nixpkgs-*.nix`; excluding that folder causes build failure:
  `failed to compute cache key ... "/.nixpacks/nixpkgs-*.nix": not found`.
- For API service deploy, exclude `apps/web` from Docker context (`.dockerignore`) to keep image layers small and reduce registry push instability on monorepo builds.

## A. Railway (Backend + PostgreSQL)

1. Create a Railway project.
2. Add PostgreSQL service.
3. Add API service from this repo root (`/`) so `railway.toml` is used.
4. Set region to **Singapore**.
5. Set environment variables (from section 8).
   - Ensure DB service is linked to API service so Railway injects database vars.
   - Do not use `localhost` for `DATABASE_URL` in Railway production.
6. Deploy API service.
   - For fresh Railway Postgres, set `DATABASE_PRIVATE_URL` (or `DATABASE_URL`) to your service endpoint, e.g. `postgresql://<user>:<pass>@postgres-fxbi-production.up.railway.app:5432/<db>?sslmode=require`.
7. Run migration command in Railway service shell:

```bash
corepack pnpm --filter @mls/api migrate
```

8. Confirm health endpoint.
   - `GET /api/v1/health` now checks DB readiness and returns `503` if DB is down.

If startup logs show `ECONNREFUSED ::1:5432`, your API is using local DB config in Railway. Link PostgreSQL service and set a non-local `DATABASE_URL` (or rely on `DATABASE_PRIVATE_URL`).


### Troubleshooting `404 /api/v1/*` on Vercel

If browser console shows `GET /api/v1/game/snapshot 404` or `POST /api/v1/profile/create 404`:

1. Verify `BACKEND_ORIGIN` in Vercel points to Railway API domain (for example `https://<service>.up.railway.app`).
   - Build frontend sekarang sengaja gagal jika `BACKEND_ORIGIN` kosong pada deploy Vercel (preview/production), untuk mencegah runtime 404 di `/api/v1/*`.
2. Open `https://<vercel-domain>/api/v1/health` directly:
   - `200/503` means proxy is working and issue is on API/runtime side.
   - `404` means Vercel proxy is not configured/deployed correctly.
3. On Railway, ensure API service has DB env vars from linked PostgreSQL and migrations have run:

```bash
corepack pnpm --filter @mls/api migrate
```

## B. Vercel (Frontend)

1. Create Vercel project from this repo.
2. Set **Root Directory** to `apps/web`.
3. Add env vars:
   - `BACKEND_ORIGIN=https://<railway-api-domain>` (scheme recommended; config auto-normalizes if omitted)
   - `NEXT_PUBLIC_API_BASE=/api/v1`
   - Optional: `NEXT_PUBLIC_APP_VERSION=5.0` (major.minor base; patch auto-generated every build/push)
   - Optional (manual lock): `NEXT_PUBLIC_APP_VERSION_OVERRIDE=5.0.0` (use only if you intentionally want fixed version text)
4. Deploy.

Next.js rewrite proxies `/api/*` to Railway so cookie auth remains first-party from browser perspective.

## 10. Free-Tier Operations Policy (`$0`)

- No external paid services.
- Rely on platform logs only (Vercel + Railway).
- Keep polling low (10s running / 30s paused).
- Keep DB pool small (`max=5`) and payloads minimal.
- Keep static content lean and avoid heavy client bundles.

Official pricing pages (verify current policy before go-live):

- Vercel: https://vercel.com/pricing
- Railway: https://railway.com/pricing

## 11. Performance Strategy

- Server components by default; client components only where interactive
- Lazy-loaded decision modal
- Minimal global state (Zustand slices)
- No WebSocket overhead
- Transaction-only write paths
- Index-driven read patterns
- Brotli/gzip compression in Fastify

## 12. Time/Consistency Guarantees

- `gameDay` computed from server reference time only
- Pause freezes progression (`paused_at_ms`)
- Resume adjusts reference:

```text
server_reference_time_ms += (resume_now_ms - paused_at_ms)
```

- Auto-resume when pause exceeds timeout (30 minutes)
- No client-side drift accumulators

## 13. Testing & Acceptance Checklist

1. Register/login with cookie session.
2. Create profile and fetch snapshot.
3. Verify day progression every 10 seconds.
4. Enter subpage (`/dashboard/training`) and verify paused day.
5. Leave subpage and verify progression resumes.
6. Trigger decision event and verify modal + paused state.
7. Submit option and verify transactional updates + log insert.
8. Verify logs pagination.
9. Verify second concurrent active session gets conflict.
10. Restart client and confirm no time drift.

## 14. Runbook

- Health check: `GET /api/v1/health`
- Migration: `corepack pnpm --filter @mls/api migrate`
- Logs: Vercel function logs + Railway service logs
- Recovery:
  - restart API service on Railway
  - verify DB connectivity
  - re-run migration command (idempotent)

## 15. Known Constraints (Free Tier)

- Idle sleep/cold starts may increase first request latency.
- Free quotas may throttle availability under load.
- Global p95 performance depends on region and quota state.

Mitigation (still free-tier compatible):

- Keep payloads tiny
- Keep polling conservative
- Prefer static rendering for non-interactive pages
- Avoid expensive DB queries and N+1 patterns

## 16. Security Notes

- HttpOnly cookie-based session token
- Session token stored hashed in DB
- Input validation with Zod
- Route-level auth checks
- Rate limiting enabled on API

---

This repository is intentionally lean for global MVP launch on strict zero-cost infrastructure while preserving clean architecture and transactional integrity.


## Deployment Notes
- For Vercel monorepo deployments, this repo uses a root `vercel.json` that targets the `@mls/web` Next.js build command (`corepack pnpm --filter @mls/web build`) to avoid output-directory mismatch errors.
