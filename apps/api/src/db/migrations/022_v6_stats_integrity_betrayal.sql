CREATE TABLE IF NOT EXISTS npc_trait_memory (
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  npc_id TEXT NOT NULL,
  ambition SMALLINT NOT NULL DEFAULT 50 CHECK (ambition BETWEEN 0 AND 100),
  discipline SMALLINT NOT NULL DEFAULT 55 CHECK (discipline BETWEEN 0 AND 100),
  integrity SMALLINT NOT NULL DEFAULT 60 CHECK (integrity BETWEEN 0 AND 100),
  sociability SMALLINT NOT NULL DEFAULT 50 CHECK (sociability BETWEEN 0 AND 100),
  memory JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, npc_id)
);

CREATE INDEX IF NOT EXISTS idx_npc_trait_memory_profile
  ON npc_trait_memory(profile_id);

INSERT INTO npc_trait_memory (profile_id, npc_id, ambition, discipline, integrity, sociability, memory)
SELECT
  s.profile_id,
  s.npc_id,
  LEAST(100, GREATEST(0, 35 + (s.promotion_points / 4))),
  LEAST(100, GREATEST(0, 55 + ((s.resilience - s.fatigue) / 3))),
  LEAST(100, GREATEST(0, 70 - s.integrity_risk)),
  LEAST(100, GREATEST(0, 40 + (s.relation_to_player / 2))),
  '[]'::jsonb
FROM npc_stats s
ON CONFLICT (profile_id, npc_id) DO NOTHING;

UPDATE npc_stats
SET
  competence = LEAST(100, GREATEST(0, ROUND((tactical + support + leadership + resilience) / 4.0))),
  intelligence = LEAST(100, GREATEST(0, ROUND((support + leadership) / 2.0))),
  loyalty = LEAST(100, GREATEST(0, ROUND(100 - betrayal_risk * 0.7))),
  integrity_risk = LEAST(100, GREATEST(0, integrity_risk)),
  betrayal_risk = LEAST(100, GREATEST(0, betrayal_risk));
