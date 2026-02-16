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

## 4. Matrix 20 Fitur

| # | Fitur | Status Saat Ini | Gap | Spesifikasi Final | Endpoint | Data Model | Acceptance |
|---|---|---|---|---|---|---|---|
| 1 | Pangkat, promosi, demosi | Parsial | Riwayat rank belum jadi source utama | Semua perubahan rank tercatat bertanggal + alasan | `GET /game/v5/personnel/rank-history` | `personnel_rank_history` | Promosi/demosi (termasuk court) masuk history |
| 2 | Divisi, lamar divisi, jabatan | Parsial | Proses lamar belum 4 tahap formal | Catalog divisi + pipeline lamaran + mutasi jabatan | `GET /game/v5/divisions/catalog` | `recruitment_pipeline_applications`, `personnel_assignment_history` | Tidak bisa lompat tahap |
| 3 | Akademi, ijazah, gelar prefix/suffix | Parsial | Durasi lama 8 hari statis | Tier academy `4/5/6` hari + gelar dinamis nama | `GET /game/v5/academy/programs`, `GET /game/v5/academy/titles` | `academy_batches.total_days`, `education_titles` | Tier 1=4, Tier 2=5, Tier 3=6 |
| 4 | Hierarki + command chain forwarding | Parsial | Penalty chain break belum terstandar | Forwarding chain + ack + dampak stabilitas | `GET /game/v5/expansion/state` (ringkasan) | state runtime + timeline | Chain break menghasilkan event/penalty |
| 5 | Pengadilan militer | Parsial | Dampak verdict belum selalu menulis state personel | Verdict formal update rank/divisi/jabatan + surat | `GET /game/v5/court/cases`, `POST /game/v5/court/cases/:caseId/verdict` | `court_cases_v2` | Verdict menutup case + update state |
| 6 | Military Law (MLC editable) | Ada | Integrasi runtime multiplier belum penuh | Perubahan hukum lewat council vote + log | `GET /game/v5/councils`, `POST /game/v5/councils/:councilId/vote` | `councils`, `council_votes` | Quorum + eligibility vote berlaku |
| 7 | Rekrutmen divisi 4 tahap | Parsial | Masih ada jalur instan legacy | Pipeline `REGISTRATION -> TRYOUT -> SELECTION -> ANNOUNCEMENT` | `POST /game/v5/divisions/applications/*` | `recruitment_pipeline_applications` | Announcement hanya day 4 |
| 8 | Misi DOM 13 hari 3 sesi | Belum/Parsial | Siklus DOM belum jadi model utama | Tiap 13 hari generate 3 sesi, player hanya 1 sesi | `GET /game/v5/dom/cycle/current`, `POST /game/v5/dom/sessions/:sessionId/*` | `dom_operation_cycles`, `dom_operation_sessions` | Selalu 3 sesi per cycle |
| 9 | Smart Human NPC | Parsial | Trait/memory belum diekspos penuh | Rule-based traits + risiko integritas/pengkhianatan | runtime tick + snapshot | `npc_stats`, `npc_trait_memory` | Perilaku berbeda antar NPC |
| 10 | Stabilitas internal/negara | Ada | Balancing lanjut bisa dituning per patch | Stability terhubung misi/court/corruption/raider/chain-break | `GET /game/v5/expansion/state` | `game_states` (governance fields) | Nilai stabilitas bergerak by event |
| 11 | Serangan teroris/raider | Ada | Variasi skenario serangan masih bisa ditambah | Serangan periodik + casualty permanen + replacement queue + countdown | `GET /game/v5/expansion/state`, `GET /game/v5/social/timeline` | `npc_entities`, `recruitment_queue`, `social_timeline_events` | KIA permanen + queue replacement + countdown tampil |
| 12 | Berita + event chances | Ada | Taxonomy domain event bisa diperluas | Event bus lintas sistem + filter domain/severity + date grouping | `GET /game/v5/social/timeline` | `social_timeline_events` | Event tampil berdasarkan date + severity |
| 13 | Kematian NPC permanen + rekrut otomatis | Ada | UX countdown replacement belum lengkap | Permanent death + auto replacement due-day | `GET /game/v5/session/sync` | `npc_entities`, `recruitment_queue` | Replacement otomatis setelah due day |
| 14 | Upacara, medali, prestasi | Ada | Formula pool medali masih dapat di-tune | Ceremony + medal pool lintas 3 sesi DOM (kompetisi ketat) | `GET /game/v5/ceremony/current`, `GET /game/v5/dom/cycle/current` | `ceremony_cycles`, `ceremony_awards`, `dom_operation_sessions.result` | Distribusi medali berbasis hasil + pool cycle |
| 15 | Tryout divisi/korps/satuan | Parsial | Tryout belum selalu day-gated | Tryout hanya sesudah registration (day-2) | `POST /game/v5/divisions/applications/:id/tryout` | `recruitment_pipeline_applications` | Gagal jika lompat tahap |
| 16 | Stats health/intelligence/kompetensi + substats | Parsial | Substats integritas/loyalitas belum penuh di semua flow | Tambah intelligence/competence/loyalty/integrity/betrayal risk | `GET /game/v5/npcs` | `npc_stats` | Nilai tersimpan dan update tiap tick |
| 17 | Rekam jejak NPC+player bertanggal | Parsial | Timeline lintas sistem belum konsisten | Timeline sosial + history rank/assignment | `GET /game/v5/social/timeline` | `social_timeline_events`, history tables | Semua mutasi penting ada timestamp |
| 18 | Potensi korupsi & penghianatan | Parsial | Trigger investigasi otomatis belum penuh | Risk model + integrasi court/news/mailbox | `GET /game/v5/expansion/state` | `npc_stats`, `npc_trait_memory`, court | Threshold memicu case/event |
| 19 | Dewan militer tambahan | Parsial | Council selain MLC belum standar | `MLC`, `DOM`, `Personnel Board`, `Strategic Council` | `GET /game/v5/councils` | `councils`, `council_votes` | Quorum menutup voting |
| 20 | Mailbox + side notification NPC->player | Parsial | Surat belum persisten/mark-read merata | Mailbox persisten + unread summary | `GET /game/v5/mailbox`, `POST /game/v5/mailbox/:messageId/read` | `mailbox_messages` | Unread counter + mark-read valid |

### Delivery 3 Fase (V5-Centric)

- Fase 1 (fondasi data + engine inti): migrasi history/title/mailbox/timeline/stats, academy tier day (`4/5/6`), pipeline rekrutmen formal, endpoint V5 dasar.
- Fase 2 (governance + mission + smart NPC): command chain, court v2, councils, DOM cycle `13` hari `3` sesi, risk corruption/betrayal, integrasi surat + timeline.
- Fase 3 (UX lengkap + balancing + hardening): tuning stabilitas, raid cadence, medal competition lintas DOM, feed berita/event, cutover penuh dari adapter legacy.

## 5. Gameplay Rule Constants

- Academy: Tier 1 = `4` hari, Tier 2 = `5` hari, Tier 3 = `6` hari.
- Recruitment pipeline: total `4` hari, `4` tahap.
- DOM operation cycle: tiap `13` hari, `3` sesi per cycle.
- DOM session rule: player hanya bisa join `1` sesi per cycle.

## 6. Public API V5 (Base `/api/v1/game/v5`)

Core session/runtime:
- `POST /session/start`
- `POST /session/heartbeat`
- `GET /session/sync?sinceVersion=`
- `GET /npcs`
- `GET /npcs/:npcId`
- `GET /expansion/state`

Academy:
- `POST /academy/batch/start`
- `GET /academy/batch/current`
- `POST /academy/batch/submit-day`
- `POST /academy/batch/graduate`
- `GET /academy/programs`
- `GET /academy/titles`

Divisions & recruitment:
- `GET /divisions/catalog`
- `POST /divisions/applications/register`
- `POST /divisions/applications/:id/tryout`
- `POST /divisions/applications/:id/finalize`
- `GET /divisions/applications/:id`
- `GET /personnel/rank-history`

DOM operations:
- `GET /dom/cycle/current`
- `POST /dom/sessions/:sessionId/join`
- `POST /dom/sessions/:sessionId/execute`

Command chain:
- `GET /command-chain/orders`
- `POST /command-chain/orders`
- `GET /command-chain/orders/:orderId`
- `POST /command-chain/orders/:orderId/forward`
- `POST /command-chain/orders/:orderId/ack`

Court & councils:
- `GET /court/cases`
- `POST /court/cases/:caseId/verdict`
- `GET /councils`
- `POST /councils/:councilId/vote`

Mailbox & social:
- `GET /mailbox`
- `POST /mailbox/:messageId/read`
- `GET /social/timeline`

Legacy compatibility (state saat ini):
- Endpoint legacy yang masih dipertahankan hanya yang masih dipakai dashboard aktif (`/game/snapshot`, `/game/pause`, `/game/resume`, action legacy inti).
- Endpoint dormant/compat yang sudah dipensiunkan (retired) agar tidak mengambang:
  - `POST /game/actions/deployment`
  - `POST /game/actions/ceremony-complete`
  - `POST /game/actions/raider-defense`
  - `POST /game/actions/recruitment-apply`
  - `GET /game/config`
  - `GET /game/ceremony`
  - `GET /game/subpage-snapshot`
  - `GET /game/news`
  - `GET /game/v3/medals`
  - `GET /game/military-law`
  - `POST /game/actions/military-law-vote`
  - `POST /game/actions/v3-mission`
  - `POST /game/actions/mission-call-response`
  - `POST /game/actions/mission-plan`
  - `POST /game/actions/appoint-secretary`
  - `POST /game/actions/court-review`
  - `GET /game/npc-activity`

## 7. Migration & Compatibility

- V5 adalah jalur utama, legacy tetap kompatibel sementara.
- Migrasi lanjutan:
  - `018_v6_personnel_history_and_titles.sql`
  - `019_v6_recruitment_pipeline_and_dom.sql`
  - `020_v6_court_and_councils.sql`
  - `021_v6_mailbox_and_social_timeline.sql`
  - `022_v6_stats_integrity_betrayal.sql`
  - `023_v6_command_chain_and_penalties.sql`
- Prinsip migrasi:
  - Idempotent (`IF NOT EXISTS`, `ON CONFLICT`).
  - Backfill default untuk data lama.
  - Tanpa reset profil/user.
  - Save existing wajib migrasi aman.

## 8. System Diagrams

Academy state machine:
```text
IDLE
 -> ACTIVE(day 1..N, N=4/5/6 by tier)
 -> (N terpenuhi) GRADUATION
 -> GRADUATED | FAILED
```

Recruitment pipeline state machine:
```text
REGISTRATION (day 1)
 -> TRYOUT (day 2)
 -> SELECTION (day 3)
 -> ANNOUNCEMENT_ACCEPTED | ANNOUNCEMENT_REJECTED (day 4)
```

DOM cycle state machine:
```text
CYCLE(start day D, end day D+12)
 -> SESSION #1 (PLAYER_ELIGIBLE, NPC slots=8)
 -> SESSION #2 (NPC_ONLY)
 -> SESSION #3 (NPC_ONLY)
 -> CYCLE COMPLETED
```

Command chain state machine:
```text
PENDING -> FORWARDED -> ACKNOWLEDGED
    |          |
    | (due day lewat)
    v
 BREACHED (penalty + investigasi/sanksi)
```

Court case state machine:
```text
PENDING -> IN_REVIEW -> CLOSED
verdict: UPHOLD | DISMISS | REASSIGN
```

Mailbox state machine:
```text
CREATED (unread) -> READ (read_at/read_day set)
```

## 9. Operational Test Checklist (20 Fitur)

1. Migrasi existing DB ke versi terbaru tanpa kehilangan profil player.
2. Academy tier 1 selesai tepat 4 hari.
3. Academy tier 2 selesai tepat 5 hari.
4. Academy tier 3 selesai tepat 6 hari.
5. Graduation gagal jika progress < `total_days`.
6. Gelar prefix/suffix tampil konsisten pada data player.
7. Recruitment pipeline tidak bisa lompat tahap.
8. Announcement recruitment hanya muncul day ke-4.
9. Tryout score memengaruhi final score selection.
10. Rank history mencatat perubahan rank + alasan.
11. Assignment history/timeline mencatat mutasi jabatan/divisi.
12. DOM cycle selalu 13 hari dan 3 sesi.
13. Player tidak bisa join lebih dari 1 sesi DOM per cycle.
14. Session player menggunakan slot NPC = 8.
15. Court verdict menutup case dan menulis dampak state.
16. Vote council menghormati quorum dan mencegah double vote.
17. Mailbox menyimpan surat persisten, unread count akurat.
18. Mark-as-read mailbox memperbarui summary.
19. Social timeline menyimpan event bertanggal untuk player/NPC.
20. KIA NPC permanen dan replacement queue terpenuhi otomatis.
21. Raider threat menampilkan countdown (`daysUntilNext`) dan level ancaman.
22. Medal pool DOM lintas 3 sesi membatasi kuota total cycle.
23. News UI menampilkan grouping tanggal + filter domain/severity dari event bus V5.

## 10. Database

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

## 11. Local Setup

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

## 12. Environment Variables

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

## 13. Deployment (Strict Free-Tier Path)

Railway deploy behavior is pinned via `railway.toml` to use `RAILPACK` builder, avoiding Dockerfile-path push instability seen on monorepo deployments.

Important build-context guardrail:
- Keep `apps/web` excluded in `.dockerignore` for API service deploy to reduce context size and lower registry push failure risk.
- Keep `.nixpacks/` available in context as fallback safety if builder mode is switched to Nixpacks.
- Root `build` script is intentionally mapped to API-only build (`build:api`) so Railpack does not compile frontend in backend service deployments.

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
7. Migration strategy:
   - Default: automatic on boot (`AUTO_MIGRATE_ON_BOOT=true`, `AUTO_MIGRATE_STRICT=true`).
   - Manual fallback (if needed), run in Railway service shell:

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

## 14. Free-Tier Operations Policy (`$0`)

- No external paid services.
- Rely on platform logs only (Vercel + Railway).
- Keep polling low (10s running / 30s paused).
- Keep DB pool small (`max=5`) and payloads minimal.
- Keep static content lean and avoid heavy client bundles.

Official pricing pages (verify current policy before go-live):

- Vercel: https://vercel.com/pricing
- Railway: https://railway.com/pricing

## 15. Performance Strategy

- Server components by default; client components only where interactive
- Lazy-loaded decision modal
- Minimal global state (Zustand slices)
- No WebSocket overhead
- Transaction-only write paths
- Index-driven read patterns
- Brotli/gzip compression in Fastify

## 16. Time/Consistency Guarantees

- `gameDay` computed from server reference time only
- Pause freezes progression (`paused_at_ms`)
- Resume adjusts reference:

```text
server_reference_time_ms += (resume_now_ms - paused_at_ms)
```

- Auto-resume when pause exceeds timeout (30 minutes)
- No client-side drift accumulators

## 17. Testing & Acceptance Checklist

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

## 18. Runbook

- Health check: `GET /api/v1/health`
- Migration: `corepack pnpm --filter @mls/api migrate`
- Logs: Vercel function logs + Railway service logs
- Recovery:
  - restart API service on Railway
  - verify DB connectivity
  - re-run migration command (idempotent)

## 19. Known Constraints (Free Tier)

- Idle sleep/cold starts may increase first request latency.
- Free quotas may throttle availability under load.
- Global p95 performance depends on region and quota state.

Mitigation (still free-tier compatible):

- Keep payloads tiny
- Keep polling conservative
- Prefer static rendering for non-interactive pages
- Avoid expensive DB queries and N+1 patterns

## 20. Security Notes

- HttpOnly cookie-based session token
- Session token stored hashed in DB
- Input validation with Zod
- Route-level auth checks
- Rate limiting enabled on API

---

This repository is intentionally lean for global MVP launch on strict zero-cost infrastructure while preserving clean architecture and transactional integrity.


## 21. Deployment Notes
- For Vercel monorepo deployments, this repo uses a root `vercel.json` that targets the `@mls/web` Next.js build command (`corepack pnpm --filter @mls/web build`) to avoid output-directory mismatch errors.
