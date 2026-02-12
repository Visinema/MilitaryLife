CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'country_code') THEN
    CREATE TYPE country_code AS ENUM ('US', 'ID');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'branch_code') THEN
    CREATE TYPE branch_code AS ENUM ('US_ARMY', 'US_NAVY', 'ID_TNI_AD', 'ID_TNI_AL');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pause_reason') THEN
    CREATE TYPE pause_reason AS ENUM ('DECISION', 'MODAL', 'SUBPAGE');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(48) NOT NULL,
  start_age SMALLINT NOT NULL DEFAULT 17 CHECK (start_age BETWEEN 15 AND 40),
  country country_code NOT NULL,
  branch branch_code NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  country country_code NOT NULL,
  branch branch_code NOT NULL,
  rank_min SMALLINT NOT NULL DEFAULT 0,
  rank_max SMALLINT NOT NULL DEFAULT 6,
  base_weight SMALLINT NOT NULL DEFAULT 1,
  cooldown_days INTEGER NOT NULL DEFAULT 30,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  options JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_states (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  active_session_id UUID NULL REFERENCES sessions(id) ON DELETE SET NULL,
  server_reference_time_ms BIGINT NOT NULL,
  current_day INTEGER NOT NULL DEFAULT 0,
  paused_at_ms BIGINT NULL,
  pause_reason pause_reason NULL,
  pause_token UUID NULL,
  pause_expires_at_ms BIGINT NULL,
  rank_index SMALLINT NOT NULL DEFAULT 0,
  money_cents BIGINT NOT NULL DEFAULT 0,
  morale SMALLINT NOT NULL DEFAULT 70 CHECK (morale BETWEEN 0 AND 100),
  health SMALLINT NOT NULL DEFAULT 80 CHECK (health BETWEEN 0 AND 100),
  promotion_points INTEGER NOT NULL DEFAULT 0,
  days_in_rank INTEGER NOT NULL DEFAULT 0,
  next_event_day INTEGER NOT NULL DEFAULT 3,
  pending_event_id BIGINT NULL REFERENCES events(id) ON DELETE SET NULL,
  pending_event_payload JSONB NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decision_logs (
  id BIGSERIAL PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  game_day INTEGER NOT NULL,
  selected_option TEXT NOT NULL,
  consequences JSONB NOT NULL,
  state_before JSONB NOT NULL,
  state_after JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_country_branch ON profiles(country, branch);
CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_country_branch_active ON events(country, branch, is_active);
CREATE INDEX IF NOT EXISTS idx_events_rank_window ON events(branch, rank_min, rank_max);
CREATE INDEX IF NOT EXISTS idx_game_states_pending_event ON game_states(pending_event_id) WHERE pending_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_game_states_pause_expiry ON game_states(pause_expires_at_ms) WHERE pause_expires_at_ms IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_decision_logs_profile_day ON decision_logs(profile_id, game_day DESC);
CREATE INDEX IF NOT EXISTS idx_decision_logs_profile_created ON decision_logs(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decision_logs_consequences_gin ON decision_logs USING GIN (consequences);
