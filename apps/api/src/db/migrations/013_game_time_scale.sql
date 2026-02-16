ALTER TABLE game_states
  ADD COLUMN IF NOT EXISTS game_time_scale SMALLINT NOT NULL DEFAULT 1;

UPDATE game_states
SET game_time_scale = 1
WHERE game_time_scale IS NULL OR game_time_scale NOT IN (1, 3);
