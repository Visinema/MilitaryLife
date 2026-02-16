CREATE TABLE IF NOT EXISTS recruitment_pipeline_applications (
  application_id TEXT PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  holder_type TEXT NOT NULL CHECK (holder_type IN ('PLAYER', 'NPC')),
  npc_id TEXT NULL,
  holder_name TEXT NOT NULL,
  division TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REGISTRATION', 'TRYOUT', 'SELECTION', 'ANNOUNCEMENT_ACCEPTED', 'ANNOUNCEMENT_REJECTED')),
  registered_day INTEGER NOT NULL,
  tryout_day INTEGER NULL,
  selection_day INTEGER NULL,
  announcement_day INTEGER NULL,
  tryout_score SMALLINT NOT NULL DEFAULT 0 CHECK (tryout_score BETWEEN 0 AND 100),
  final_score NUMERIC(6,2) NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recruitment_pipeline_profile_division_status
  ON recruitment_pipeline_applications(profile_id, division, status, registered_day DESC);

CREATE TABLE IF NOT EXISTS dom_operation_cycles (
  cycle_id TEXT PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  start_day INTEGER NOT NULL,
  end_day INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED')) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dom_operation_cycles_profile_day
  ON dom_operation_cycles(profile_id, start_day DESC, status);

CREATE TABLE IF NOT EXISTS dom_operation_sessions (
  session_id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES dom_operation_cycles(cycle_id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_no SMALLINT NOT NULL CHECK (session_no BETWEEN 1 AND 3),
  participant_mode TEXT NOT NULL CHECK (participant_mode IN ('PLAYER_ELIGIBLE', 'NPC_ONLY')),
  npc_slots SMALLINT NOT NULL DEFAULT 8 CHECK (npc_slots BETWEEN 1 AND 40),
  player_joined BOOLEAN NOT NULL DEFAULT FALSE,
  player_join_day INTEGER NULL,
  status TEXT NOT NULL CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED')) DEFAULT 'PLANNED',
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, session_no)
);

CREATE INDEX IF NOT EXISTS idx_dom_operation_sessions_profile_status
  ON dom_operation_sessions(profile_id, status, session_no);
