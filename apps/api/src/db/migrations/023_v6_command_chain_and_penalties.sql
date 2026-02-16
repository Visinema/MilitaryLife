CREATE TABLE IF NOT EXISTS command_chain_orders (
  order_id TEXT PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  issued_day INTEGER NOT NULL,
  issuer_type TEXT NOT NULL CHECK (issuer_type IN ('PLAYER', 'NPC')),
  issuer_npc_id TEXT NULL,
  target_npc_id TEXT NULL,
  target_division TEXT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')) DEFAULT 'MEDIUM',
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'FORWARDED', 'ACKNOWLEDGED', 'BREACHED', 'EXPIRED')) DEFAULT 'PENDING',
  ack_due_day INTEGER NOT NULL,
  completed_day INTEGER NULL,
  penalty_applied BOOLEAN NOT NULL DEFAULT FALSE,
  command_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_command_chain_orders_profile_status_due
  ON command_chain_orders(profile_id, status, ack_due_day, issued_day DESC);

CREATE TABLE IF NOT EXISTS command_chain_acks (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES command_chain_orders(order_id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('PLAYER', 'NPC')),
  actor_npc_id TEXT NULL,
  hop_no SMALLINT NOT NULL CHECK (hop_no BETWEEN 0 AND 60),
  forwarded_to_npc_id TEXT NULL,
  ack_day INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_command_chain_acks_order_hop
  ON command_chain_acks(order_id, hop_no ASC, id ASC);
