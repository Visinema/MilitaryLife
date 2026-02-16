CREATE TABLE IF NOT EXISTS v5_mission_templates (
  mission_type TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  base_chain_quality SMALLINT NOT NULL,
  base_logistic_readiness SMALLINT NOT NULL,
  default_danger_tier TEXT NOT NULL CHECK (default_danger_tier IN ('LOW', 'MEDIUM', 'HIGH', 'EXTREME')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS v5_certification_catalog (
  cert_code TEXT PRIMARY KEY,
  track TEXT NOT NULL,
  tier SMALLINT NOT NULL CHECK (tier BETWEEN 1 AND 3),
  validity_days INTEGER NOT NULL CHECK (validity_days BETWEEN 1 AND 3650),
  mission_buff_pct SMALLINT NOT NULL DEFAULT 0,
  command_buff_pct SMALLINT NOT NULL DEFAULT 0,
  casualty_mitigation_pct SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO v5_mission_templates (mission_type, title, base_chain_quality, base_logistic_readiness, default_danger_tier)
VALUES
  ('RECON', 'Recon Corridor Sweep', 62, 64, 'MEDIUM'),
  ('COUNTER_RAID', 'Counter Raider Containment', 66, 58, 'HIGH'),
  ('BLACK_OPS', 'Black Ops Surgical Strike', 74, 72, 'EXTREME'),
  ('TRIBUNAL_SECURITY', 'Tribunal Security Shield', 70, 76, 'LOW')
ON CONFLICT (mission_type) DO NOTHING;

INSERT INTO v5_certification_catalog (cert_code, track, tier, validity_days, mission_buff_pct, command_buff_pct, casualty_mitigation_pct)
VALUES
  ('OFFICER_FOUNDATION', 'OFFICER', 1, 540, 6, 4, 2),
  ('HIGH_COMMAND_STRATEGY', 'HIGH_COMMAND', 2, 720, 10, 9, 4),
  ('SPECIALIST_CYBER_OPS', 'CYBER', 2, 540, 9, 5, 3),
  ('TRIBUNAL_RULES_OF_ENGAGEMENT', 'TRIBUNAL', 2, 480, 4, 8, 2),
  ('SPECIALIST_FIELD_MEDIC', 'SPECIALIST', 1, 420, 5, 3, 10)
ON CONFLICT (cert_code) DO NOTHING;
