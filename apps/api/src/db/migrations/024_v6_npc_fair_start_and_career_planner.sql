ALTER TABLE npc_stats
  ADD COLUMN IF NOT EXISTS rank_index SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS academy_tier SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE npc_stats
  DROP CONSTRAINT IF EXISTS npc_stats_rank_index_check;
ALTER TABLE npc_stats
  ADD CONSTRAINT npc_stats_rank_index_check CHECK (rank_index BETWEEN 0 AND 13);

ALTER TABLE npc_stats
  DROP CONSTRAINT IF EXISTS npc_stats_academy_tier_check;
ALTER TABLE npc_stats
  ADD CONSTRAINT npc_stats_academy_tier_check CHECK (academy_tier BETWEEN 0 AND 3);

UPDATE npc_stats
SET rank_index = LEAST(
  13,
  GREATEST(
    0,
    FLOOR(
      (
        COALESCE(promotion_points, 0) * 0.42 +
        COALESCE(xp, 0) * 0.08 +
        COALESCE(leadership, 50) * 0.3 +
        COALESCE(competence, 50) * 0.2 +
        COALESCE(resilience, 50) * 0.15
      ) / 55.0
    )::int
  )
)
WHERE rank_index = 0
  AND (COALESCE(promotion_points, 0) > 0 OR COALESCE(xp, 0) > 0);

WITH npc_cert AS (
  SELECT
    profile_id,
    npc_id,
    MAX(tier)::int AS max_tier
  FROM certification_records
  WHERE holder_type = 'NPC'
    AND npc_id IS NOT NULL
    AND valid = TRUE
  GROUP BY profile_id, npc_id
)
UPDATE npc_stats s
SET academy_tier = LEAST(3, GREATEST(0, npc_cert.max_tier))
FROM npc_cert
WHERE s.profile_id = npc_cert.profile_id
  AND s.npc_id = npc_cert.npc_id;

CREATE TABLE IF NOT EXISTS npc_career_plans (
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  npc_id TEXT NOT NULL,
  strategy_mode TEXT NOT NULL CHECK (strategy_mode IN ('RUSH_T1', 'BALANCED_T2', 'DEEP_T3')),
  career_stage TEXT NOT NULL CHECK (career_stage IN ('CIVILIAN_START', 'ACADEMY', 'DIVISION_PIPELINE', 'IN_DIVISION', 'MUTATION_PIPELINE')),
  desired_division TEXT NULL,
  target_tier SMALLINT NOT NULL DEFAULT 1 CHECK (target_tier BETWEEN 1 AND 3),
  next_action_day INTEGER NOT NULL DEFAULT 0,
  last_action_day INTEGER NULL,
  last_application_id TEXT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, npc_id),
  FOREIGN KEY (profile_id, npc_id) REFERENCES npc_entities(profile_id, npc_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_npc_career_plans_profile_stage_next
  ON npc_career_plans(profile_id, career_stage, next_action_day ASC);

INSERT INTO npc_career_plans (
  profile_id,
  npc_id,
  strategy_mode,
  career_stage,
  desired_division,
  target_tier,
  next_action_day,
  last_action_day,
  last_application_id,
  meta
)
SELECT
  e.profile_id,
  e.npc_id,
  CASE
    WHEN COALESCE(t.ambition, 50) >= 70 AND COALESCE(t.discipline, 55) <= 45 THEN 'RUSH_T1'
    WHEN (COALESCE(t.ambition, 50) + COALESCE(t.discipline, 55) + COALESCE(t.integrity, 60)) >= 210 THEN 'DEEP_T3'
    ELSE 'BALANCED_T2'
  END AS strategy_mode,
  CASE
    WHEN LOWER(COALESCE(e.division, '')) = 'nondivisi' AND COALESCE(s.academy_tier, 0) >= 1 THEN 'DIVISION_PIPELINE'
    WHEN LOWER(COALESCE(e.division, '')) = 'nondivisi' THEN 'CIVILIAN_START'
    ELSE 'IN_DIVISION'
  END AS career_stage,
  CASE
    WHEN LOWER(COALESCE(e.division, '')) = 'nondivisi' THEN NULL
    ELSE e.division
  END AS desired_division,
  CASE
    WHEN COALESCE(t.ambition, 50) >= 70 AND COALESCE(t.discipline, 55) <= 45 THEN 1
    WHEN (COALESCE(t.ambition, 50) + COALESCE(t.discipline, 55) + COALESCE(t.integrity, 60)) >= 210 THEN 3
    ELSE 2
  END AS target_tier,
  0 AS next_action_day,
  NULL AS last_action_day,
  NULL AS last_application_id,
  jsonb_build_object('backfill', TRUE, 'source', '024_v6_npc_fair_start_and_career_planner') AS meta
FROM npc_entities e
LEFT JOIN npc_stats s
  ON s.profile_id = e.profile_id
 AND s.npc_id = e.npc_id
LEFT JOIN npc_trait_memory t
  ON t.profile_id = e.profile_id
 AND t.npc_id = e.npc_id
WHERE e.is_current = TRUE
ON CONFLICT (profile_id, npc_id) DO NOTHING;

WITH ranked AS (
  SELECT
    application_id,
    ROW_NUMBER() OVER (
      PARTITION BY profile_id, npc_id
      ORDER BY registered_day DESC, application_id DESC
    ) AS rn
  FROM recruitment_pipeline_applications
  WHERE holder_type = 'NPC'
    AND npc_id IS NOT NULL
    AND status IN ('REGISTRATION', 'TRYOUT', 'SELECTION')
)
UPDATE recruitment_pipeline_applications r
SET
  status = 'ANNOUNCEMENT_REJECTED',
  announcement_day = COALESCE(r.announcement_day, r.registered_day),
  note = 'AUTO_CLOSED_DUPLICATE_ACTIVE',
  updated_at = now()
FROM ranked
WHERE r.application_id = ranked.application_id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_recruitment_pipeline_active_npc_unique
  ON recruitment_pipeline_applications(profile_id, npc_id)
  WHERE holder_type = 'NPC'
    AND npc_id IS NOT NULL
    AND status IN ('REGISTRATION', 'TRYOUT', 'SELECTION');
