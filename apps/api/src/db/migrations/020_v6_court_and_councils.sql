CREATE TABLE IF NOT EXISTS court_cases_v2 (
  case_id TEXT PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  case_type TEXT NOT NULL CHECK (case_type IN ('DISMISSAL', 'SANCTION', 'DEMOTION', 'MUTATION')),
  target_type TEXT NOT NULL CHECK (target_type IN ('PLAYER', 'NPC')),
  target_npc_id TEXT NULL,
  requested_day INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'IN_REVIEW', 'CLOSED')) DEFAULT 'PENDING',
  verdict TEXT NULL CHECK (verdict IN ('UPHOLD', 'DISMISS', 'REASSIGN')),
  decision_day INTEGER NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_court_cases_v2_profile_status_day
  ON court_cases_v2(profile_id, status, requested_day DESC);

CREATE TABLE IF NOT EXISTS councils (
  council_id TEXT PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  council_type TEXT NOT NULL CHECK (council_type IN ('MLC', 'DOM', 'PERSONNEL_BOARD', 'STRATEGIC_COUNCIL')),
  agenda TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')) DEFAULT 'OPEN',
  opened_day INTEGER NOT NULL,
  closed_day INTEGER NULL,
  quorum SMALLINT NOT NULL DEFAULT 3 CHECK (quorum BETWEEN 1 AND 50),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_councils_profile_status_day
  ON councils(profile_id, status, opened_day DESC);

CREATE TABLE IF NOT EXISTS council_votes (
  id BIGSERIAL PRIMARY KEY,
  council_id TEXT NOT NULL REFERENCES councils(council_id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  voter_type TEXT NOT NULL CHECK (voter_type IN ('PLAYER', 'NPC')),
  voter_npc_id TEXT NULL,
  vote_choice TEXT NOT NULL CHECK (vote_choice IN ('APPROVE', 'REJECT', 'ABSTAIN')),
  rationale TEXT NOT NULL DEFAULT '',
  voted_day INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_council_votes_council
  ON council_votes(council_id, voted_day DESC, id DESC);

INSERT INTO court_cases_v2 (
  case_id,
  profile_id,
  case_type,
  target_type,
  target_npc_id,
  requested_day,
  status,
  verdict,
  decision_day,
  details
)
SELECT
  COALESCE(item->>'id', CONCAT('legacy-case-', gs.profile_id::text, '-', gs.current_day::text, '-', ord::text)),
  gs.profile_id,
  CASE
    WHEN LOWER(COALESCE(item->>'title', '')) LIKE '%demot%' THEN 'DEMOTION'
    WHEN LOWER(COALESCE(item->>'title', '')) LIKE '%mutasi%' THEN 'MUTATION'
    WHEN LOWER(COALESCE(item->>'title', '')) LIKE '%pecat%' THEN 'DISMISSAL'
    ELSE 'SANCTION'
  END,
  'PLAYER',
  NULL,
  COALESCE(NULLIF(item->>'day', '')::INTEGER, gs.current_day),
  CASE WHEN COALESCE(item->>'status', 'PENDING') = 'CLOSED' THEN 'CLOSED' ELSE 'PENDING' END,
  NULL,
  NULL,
  item
FROM game_states gs,
LATERAL jsonb_array_elements(COALESCE(gs.court_pending_cases, '[]'::jsonb)) WITH ORDINALITY AS src(item, ord)
ON CONFLICT (case_id) DO NOTHING;
