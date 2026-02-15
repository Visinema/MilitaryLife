ALTER TABLE game_states
  ADD COLUMN IF NOT EXISTS npc_award_history JSONB NOT NULL DEFAULT '{}'::jsonb;
