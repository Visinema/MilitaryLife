ALTER TABLE game_states
  ADD COLUMN IF NOT EXISTS player_position TEXT NOT NULL DEFAULT 'Platoon Leader',
  ADD COLUMN IF NOT EXISTS raider_last_attack_day INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS raider_casualties JSONB NOT NULL DEFAULT '[]'::jsonb;
