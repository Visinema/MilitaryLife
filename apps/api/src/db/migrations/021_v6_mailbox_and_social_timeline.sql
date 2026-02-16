CREATE TABLE IF NOT EXISTS mailbox_messages (
  message_id TEXT PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('SYSTEM', 'NPC', 'COUNCIL')),
  sender_npc_id TEXT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('PROMOTION', 'DEMOTION', 'MUTATION', 'SANCTION', 'COUNCIL_INVITE', 'COURT', 'GENERAL')),
  related_ref TEXT NULL,
  created_day INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ NULL,
  read_day INTEGER NULL
);

CREATE INDEX IF NOT EXISTS idx_mailbox_messages_profile_created
  ON mailbox_messages(profile_id, created_day DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mailbox_messages_profile_unread
  ON mailbox_messages(profile_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS social_timeline_events (
  id BIGSERIAL PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('PLAYER', 'NPC')),
  actor_npc_id TEXT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  event_day INTEGER NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_timeline_events_profile_day
  ON social_timeline_events(profile_id, event_day DESC, id DESC);

INSERT INTO social_timeline_events (
  profile_id,
  actor_type,
  actor_npc_id,
  event_type,
  title,
  detail,
  event_day,
  meta
)
SELECT
  dl.profile_id,
  'PLAYER',
  NULL,
  'DECISION',
  CONCAT('Decision #', dl.event_id::text),
  CONCAT('Player selected option ', dl.selected_option, ' with logged consequences.'),
  dl.game_day,
  COALESCE(dl.consequences, '{}'::jsonb)
FROM decision_logs dl
WHERE NOT EXISTS (
  SELECT 1
  FROM social_timeline_events t
  WHERE t.profile_id = dl.profile_id
    AND t.event_type = 'DECISION'
    AND t.event_day = dl.game_day
    AND t.title = CONCAT('Decision #', dl.event_id::text)
);
