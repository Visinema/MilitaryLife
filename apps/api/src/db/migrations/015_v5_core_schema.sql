CREATE TABLE IF NOT EXISTS game_worlds (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  state_version BIGINT NOT NULL DEFAULT 1,
  last_tick_ms BIGINT NOT NULL DEFAULT 0,
  session_active_until_ms BIGINT NULL,
  game_time_scale SMALLINT NOT NULL DEFAULT 1 CHECK (game_time_scale IN (1, 3)),
  current_day INTEGER NOT NULL DEFAULT 0,
  world_seed BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_runtime (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  money_cents BIGINT NOT NULL DEFAULT 0,
  morale SMALLINT NOT NULL DEFAULT 70 CHECK (morale BETWEEN 0 AND 100),
  health SMALLINT NOT NULL DEFAULT 80 CHECK (health BETWEEN 0 AND 100),
  rank_index SMALLINT NOT NULL DEFAULT 0,
  assignment TEXT NOT NULL DEFAULT 'Field Command',
  command_authority SMALLINT NOT NULL DEFAULT 40 CHECK (command_authority BETWEEN 0 AND 100),
  fatigue SMALLINT NOT NULL DEFAULT 0 CHECK (fatigue BETWEEN 0 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS npc_entities (
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  npc_id TEXT NOT NULL,
  slot_no SMALLINT NOT NULL CHECK (slot_no BETWEEN 1 AND 80),
  generation INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  division TEXT NOT NULL,
  unit TEXT NOT NULL,
  position TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INJURED', 'KIA', 'RESERVE', 'RECRUITING')),
  joined_day INTEGER NOT NULL DEFAULT 0,
  death_day INTEGER NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, npc_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_npc_entities_current_slot
  ON npc_entities(profile_id, slot_no)
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_npc_entities_profile_status_slot
  ON npc_entities(profile_id, status, slot_no);

CREATE TABLE IF NOT EXISTS npc_stats (
  profile_id UUID NOT NULL,
  npc_id TEXT NOT NULL,
  tactical SMALLINT NOT NULL DEFAULT 50 CHECK (tactical BETWEEN 0 AND 100),
  support SMALLINT NOT NULL DEFAULT 50 CHECK (support BETWEEN 0 AND 100),
  leadership SMALLINT NOT NULL DEFAULT 50 CHECK (leadership BETWEEN 0 AND 100),
  resilience SMALLINT NOT NULL DEFAULT 50 CHECK (resilience BETWEEN 0 AND 100),
  fatigue SMALLINT NOT NULL DEFAULT 0 CHECK (fatigue BETWEEN 0 AND 100),
  trauma SMALLINT NOT NULL DEFAULT 0 CHECK (trauma BETWEEN 0 AND 100),
  xp INTEGER NOT NULL DEFAULT 0,
  promotion_points INTEGER NOT NULL DEFAULT 0,
  relation_to_player SMALLINT NOT NULL DEFAULT 50 CHECK (relation_to_player BETWEEN 0 AND 100),
  last_tick_day INTEGER NOT NULL DEFAULT 0,
  last_task TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, npc_id),
  FOREIGN KEY (profile_id, npc_id) REFERENCES npc_entities(profile_id, npc_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS npc_task_queue (
  id BIGSERIAL PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  npc_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  due_tick BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')) DEFAULT 'QUEUED',
  started_at_ms BIGINT NULL,
  finished_at_ms BIGINT NULL,
  result JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_npc_task_queue_profile_due_status
  ON npc_task_queue(profile_id, due_tick, status);

CREATE TABLE IF NOT EXISTS npc_lifecycle_events (
  id BIGSERIAL PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  npc_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  day INTEGER NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_npc_lifecycle_events_profile_day
  ON npc_lifecycle_events(profile_id, day DESC);

CREATE TABLE IF NOT EXISTS mission_instances (
  mission_id TEXT PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('PLANNED', 'ACTIVE', 'RESOLVED')) DEFAULT 'PLANNED',
  issued_day INTEGER NOT NULL,
  mission_type TEXT NOT NULL CHECK (mission_type IN ('RECON', 'COUNTER_RAID', 'BLACK_OPS', 'TRIBUNAL_SECURITY')),
  danger_tier TEXT NOT NULL CHECK (danger_tier IN ('LOW', 'MEDIUM', 'HIGH', 'EXTREME')),
  plan JSONB NULL,
  result JSONB NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mission_instances_profile_status_day
  ON mission_instances(profile_id, status, issued_day DESC);

CREATE TABLE IF NOT EXISTS mission_participants (
  id BIGSERIAL PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES mission_instances(mission_id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  npc_id TEXT NULL,
  role TEXT NOT NULL CHECK (role IN ('PLAYER', 'NPC')),
  contribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS academy_enrollments (
  id BIGSERIAL PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  enrollee_type TEXT NOT NULL CHECK (enrollee_type IN ('PLAYER', 'NPC')),
  npc_id TEXT NULL,
  track TEXT NOT NULL,
  tier SMALLINT NOT NULL CHECK (tier BETWEEN 1 AND 3),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'PASSED', 'FAILED')) DEFAULT 'ACTIVE',
  started_day INTEGER NOT NULL,
  completed_day INTEGER NULL,
  score SMALLINT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_academy_enrollments_profile_started
  ON academy_enrollments(profile_id, started_day DESC);

CREATE TABLE IF NOT EXISTS certification_records (
  cert_id TEXT PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  holder_type TEXT NOT NULL CHECK (holder_type IN ('PLAYER', 'NPC')),
  npc_id TEXT NULL,
  cert_code TEXT NOT NULL,
  track TEXT NOT NULL,
  tier SMALLINT NOT NULL CHECK (tier BETWEEN 1 AND 3),
  grade TEXT NOT NULL CHECK (grade IN ('A', 'B', 'C', 'D')),
  issued_day INTEGER NOT NULL,
  expires_day INTEGER NOT NULL,
  valid BOOLEAN NOT NULL DEFAULT TRUE,
  source_enrollment_id BIGINT NULL REFERENCES academy_enrollments(id) ON DELETE SET NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certification_records_profile_valid
  ON certification_records(profile_id, valid);

CREATE TABLE IF NOT EXISTS ceremony_cycles (
  cycle_id TEXT PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ceremony_day INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED')) DEFAULT 'PENDING',
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at_ms BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ceremony_cycles_profile_day
  ON ceremony_cycles(profile_id, ceremony_day DESC);

CREATE TABLE IF NOT EXISTS ceremony_awards (
  id BIGSERIAL PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES ceremony_cycles(cycle_id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  npc_id TEXT NULL,
  recipient_name TEXT NOT NULL,
  medal TEXT NOT NULL,
  ribbon TEXT NOT NULL,
  reason TEXT NOT NULL,
  order_no SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ceremony_awards_cycle_order
  ON ceremony_awards(cycle_id, order_no);

CREATE TABLE IF NOT EXISTS recruitment_queue (
  id BIGSERIAL PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  slot_no SMALLINT NOT NULL CHECK (slot_no BETWEEN 1 AND 80),
  generation_next INTEGER NOT NULL,
  enqueued_day INTEGER NOT NULL,
  due_day INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'FULFILLED', 'CANCELLED')) DEFAULT 'QUEUED',
  replaced_npc_id TEXT NOT NULL,
  new_npc_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recruitment_queue_profile_due
  ON recruitment_queue(profile_id, status, due_day);

CREATE TABLE IF NOT EXISTS game_world_deltas (
  id BIGSERIAL PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  state_version BIGINT NOT NULL,
  delta JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(profile_id, state_version)
);

CREATE INDEX IF NOT EXISTS idx_game_world_deltas_profile_version
  ON game_world_deltas(profile_id, state_version);

CREATE INDEX IF NOT EXISTS idx_game_worlds_session_active
  ON game_worlds(session_active_until_ms);
