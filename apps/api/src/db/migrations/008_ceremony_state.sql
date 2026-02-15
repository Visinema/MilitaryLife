ALTER TABLE game_states
  ADD COLUMN IF NOT EXISTS ceremony_completed_day INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ceremony_recent_awards JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS player_medals JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS player_ribbons JSONB NOT NULL DEFAULT '[]'::jsonb;
