ALTER TABLE game_states
  ADD COLUMN IF NOT EXISTS military_law_current JSONB,
  ADD COLUMN IF NOT EXISTS military_law_logs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE game_states
  ALTER COLUMN player_position SET DEFAULT 'No Position',
  ALTER COLUMN player_division SET DEFAULT 'Nondivisi';

UPDATE game_states
SET military_law_logs = '[]'::jsonb
WHERE military_law_logs IS NULL;
