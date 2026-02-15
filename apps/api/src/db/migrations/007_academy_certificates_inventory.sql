ALTER TABLE game_states
  ADD COLUMN IF NOT EXISTS certificate_inventory JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS division_freedom_score SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preferred_division TEXT NULL;
