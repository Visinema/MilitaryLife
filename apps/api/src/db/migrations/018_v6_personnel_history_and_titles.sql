ALTER TABLE npc_stats
  ADD COLUMN IF NOT EXISTS intelligence SMALLINT NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS competence SMALLINT NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS loyalty SMALLINT NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS integrity_risk SMALLINT NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS betrayal_risk SMALLINT NOT NULL DEFAULT 8;

ALTER TABLE npc_stats
  DROP CONSTRAINT IF EXISTS npc_stats_intelligence_check;
ALTER TABLE npc_stats
  ADD CONSTRAINT npc_stats_intelligence_check CHECK (intelligence BETWEEN 0 AND 100);

ALTER TABLE npc_stats
  DROP CONSTRAINT IF EXISTS npc_stats_competence_check;
ALTER TABLE npc_stats
  ADD CONSTRAINT npc_stats_competence_check CHECK (competence BETWEEN 0 AND 100);

ALTER TABLE npc_stats
  DROP CONSTRAINT IF EXISTS npc_stats_loyalty_check;
ALTER TABLE npc_stats
  ADD CONSTRAINT npc_stats_loyalty_check CHECK (loyalty BETWEEN 0 AND 100);

ALTER TABLE npc_stats
  DROP CONSTRAINT IF EXISTS npc_stats_integrity_risk_check;
ALTER TABLE npc_stats
  ADD CONSTRAINT npc_stats_integrity_risk_check CHECK (integrity_risk BETWEEN 0 AND 100);

ALTER TABLE npc_stats
  DROP CONSTRAINT IF EXISTS npc_stats_betrayal_risk_check;
ALTER TABLE npc_stats
  ADD CONSTRAINT npc_stats_betrayal_risk_check CHECK (betrayal_risk BETWEEN 0 AND 100);

ALTER TABLE academy_batches
  ADD COLUMN IF NOT EXISTS total_days SMALLINT NOT NULL DEFAULT 8;

ALTER TABLE academy_batches
  DROP CONSTRAINT IF EXISTS academy_batches_total_days_check;
ALTER TABLE academy_batches
  ADD CONSTRAINT academy_batches_total_days_check CHECK (total_days BETWEEN 4 AND 12);

UPDATE academy_batches
SET total_days = GREATEST(4, LEAST(12, COALESCE(total_days, 8)));

ALTER TABLE academy_batch_members
  DROP CONSTRAINT IF EXISTS academy_batch_members_day_progress_check;
ALTER TABLE academy_batch_members
  ADD CONSTRAINT academy_batch_members_day_progress_check CHECK (day_progress BETWEEN 0 AND 12);

ALTER TABLE academy_batch_members
  DROP CONSTRAINT IF EXISTS academy_batch_members_extra_cert_count_check;
ALTER TABLE academy_batch_members
  ADD CONSTRAINT academy_batch_members_extra_cert_count_check CHECK (extra_cert_count BETWEEN 0 AND 12);

CREATE TABLE IF NOT EXISTS education_titles (
  title_code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('PREFIX', 'SUFFIX')),
  source_track TEXT NOT NULL,
  min_tier SMALLINT NOT NULL CHECK (min_tier BETWEEN 1 AND 3),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO education_titles (title_code, label, mode, source_track, min_tier, active)
VALUES
  ('OFFICER_FOUNDATION', 'S.Ml', 'SUFFIX', 'OFFICER', 1, TRUE),
  ('HIGH_COMMAND_STRATEGY', 'Dr.', 'PREFIX', 'HIGH_COMMAND', 2, TRUE),
  ('SPECIALIST_CYBER_OPS', 'S.Siber', 'SUFFIX', 'CYBER', 2, TRUE),
  ('TRIBUNAL_RULES_OF_ENGAGEMENT', 'Juris Militer', 'PREFIX', 'TRIBUNAL', 2, TRUE),
  ('SPECIALIST_FIELD_MEDIC', 'M.Med', 'SUFFIX', 'SPECIALIST', 1, TRUE)
ON CONFLICT (title_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS personnel_rank_history (
  id BIGSERIAL PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('PLAYER', 'NPC')),
  npc_id TEXT NULL,
  old_rank_index SMALLINT NOT NULL,
  new_rank_index SMALLINT NOT NULL,
  reason TEXT NOT NULL,
  changed_day INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personnel_rank_history_profile_day
  ON personnel_rank_history(profile_id, changed_day DESC, id DESC);

CREATE TABLE IF NOT EXISTS personnel_assignment_history (
  id BIGSERIAL PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('PLAYER', 'NPC')),
  npc_id TEXT NULL,
  old_division TEXT NOT NULL,
  new_division TEXT NOT NULL,
  old_position TEXT NOT NULL,
  new_position TEXT NOT NULL,
  reason TEXT NOT NULL,
  changed_day INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personnel_assignment_history_profile_day
  ON personnel_assignment_history(profile_id, changed_day DESC, id DESC);

INSERT INTO personnel_rank_history (
  profile_id,
  actor_type,
  npc_id,
  old_rank_index,
  new_rank_index,
  reason,
  changed_day
)
SELECT
  gs.profile_id,
  'PLAYER',
  NULL,
  gs.rank_index,
  gs.rank_index,
  'BASELINE_MIGRATION',
  gs.current_day
FROM game_states gs
WHERE NOT EXISTS (
  SELECT 1
  FROM personnel_rank_history h
  WHERE h.profile_id = gs.profile_id
    AND h.actor_type = 'PLAYER'
);

INSERT INTO personnel_assignment_history (
  profile_id,
  actor_type,
  npc_id,
  old_division,
  new_division,
  old_position,
  new_position,
  reason,
  changed_day
)
SELECT
  gs.profile_id,
  'PLAYER',
  NULL,
  gs.player_division,
  gs.player_division,
  gs.player_position,
  gs.player_position,
  'BASELINE_MIGRATION',
  gs.current_day
FROM game_states gs
WHERE NOT EXISTS (
  SELECT 1
  FROM personnel_assignment_history h
  WHERE h.profile_id = gs.profile_id
    AND h.actor_type = 'PLAYER'
);
