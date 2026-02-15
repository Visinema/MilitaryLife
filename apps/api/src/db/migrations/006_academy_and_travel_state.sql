ALTER TABLE game_states
  ADD COLUMN IF NOT EXISTS academy_tier SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_travel_place TEXT NULL;

UPDATE game_states
SET academy_tier = COALESCE(academy_tier, 0)
WHERE academy_tier IS NULL;
