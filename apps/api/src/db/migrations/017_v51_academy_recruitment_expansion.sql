ALTER TABLE npc_entities
  DROP CONSTRAINT IF EXISTS npc_entities_slot_no_check;

ALTER TABLE npc_entities
  ADD CONSTRAINT npc_entities_slot_no_check CHECK (slot_no BETWEEN 1 AND 120);

ALTER TABLE recruitment_queue
  DROP CONSTRAINT IF EXISTS recruitment_queue_slot_no_check;

ALTER TABLE recruitment_queue
  ADD CONSTRAINT recruitment_queue_slot_no_check CHECK (slot_no BETWEEN 1 AND 120);

CREATE TABLE IF NOT EXISTS division_quota_states (
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  division TEXT NOT NULL,
  head_npc_id TEXT NULL,
  quota_total SMALLINT NOT NULL CHECK (quota_total BETWEEN 0 AND 120),
  quota_used SMALLINT NOT NULL DEFAULT 0 CHECK (quota_used BETWEEN 0 AND 120),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'COOLDOWN')) DEFAULT 'OPEN',
  cooldown_until_day INTEGER NULL,
  cooldown_days SMALLINT NOT NULL DEFAULT 2 CHECK (cooldown_days BETWEEN 1 AND 30),
  decision_note TEXT NOT NULL DEFAULT '',
  updated_day INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, division)
);

CREATE INDEX IF NOT EXISTS idx_division_quota_states_profile_status
  ON division_quota_states(profile_id, status, updated_day DESC);

CREATE TABLE IF NOT EXISTS academy_batches (
  batch_id TEXT PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  track TEXT NOT NULL,
  tier SMALLINT NOT NULL CHECK (tier BETWEEN 1 AND 3),
  start_day INTEGER NOT NULL,
  end_day INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'GRADUATED', 'FAILED')) DEFAULT 'ACTIVE',
  lock_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  graduation_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_academy_batches_profile_status_day
  ON academy_batches(profile_id, status, start_day DESC);

CREATE TABLE IF NOT EXISTS academy_batch_members (
  batch_id TEXT NOT NULL REFERENCES academy_batches(batch_id) ON DELETE CASCADE,
  member_key TEXT NOT NULL,
  holder_type TEXT NOT NULL CHECK (holder_type IN ('PLAYER', 'NPC')),
  npc_id TEXT NULL,
  day_progress SMALLINT NOT NULL DEFAULT 0 CHECK (day_progress BETWEEN 0 AND 8),
  daily_scores JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_score SMALLINT NOT NULL DEFAULT 0 CHECK (final_score BETWEEN 0 AND 100),
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  rank_position SMALLINT NOT NULL DEFAULT 0,
  extra_cert_count SMALLINT NOT NULL DEFAULT 0 CHECK (extra_cert_count BETWEEN 0 AND 8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, member_key)
);

CREATE INDEX IF NOT EXISTS idx_academy_batch_members_batch_rank
  ON academy_batch_members(batch_id, rank_position, final_score DESC);

CREATE TABLE IF NOT EXISTS recruitment_applications_v51 (
  id BIGSERIAL PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  division TEXT NOT NULL,
  holder_type TEXT NOT NULL CHECK (holder_type IN ('PLAYER', 'NPC')),
  npc_id TEXT NULL,
  holder_name TEXT NOT NULL,
  applied_day INTEGER NOT NULL,
  base_diploma_score SMALLINT NOT NULL DEFAULT 0 CHECK (base_diploma_score BETWEEN 0 AND 100),
  extra_cert_count SMALLINT NOT NULL DEFAULT 0 CHECK (extra_cert_count BETWEEN 0 AND 30),
  exam_score SMALLINT NOT NULL DEFAULT 0 CHECK (exam_score BETWEEN 0 AND 100),
  composite_score NUMERIC(6,2) NOT NULL DEFAULT 0,
  fatigue SMALLINT NOT NULL DEFAULT 0 CHECK (fatigue BETWEEN 0 AND 100),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')) DEFAULT 'PENDING',
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recruitment_applications_v51_profile_division
  ON recruitment_applications_v51(profile_id, division, applied_day DESC, id DESC);

CREATE TABLE IF NOT EXISTS quota_decision_logs (
  id BIGSERIAL PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  division TEXT NOT NULL,
  head_npc_id TEXT NULL,
  decision_day INTEGER NOT NULL,
  quota_total SMALLINT NOT NULL,
  cooldown_days SMALLINT NOT NULL,
  reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quota_decision_logs_profile_division_day
  ON quota_decision_logs(profile_id, division, decision_day DESC, id DESC);
