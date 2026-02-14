-- Backfill legacy pending event payload keys so web never receives undefined chance/condition/impact.
UPDATE game_states gs
SET pending_event_payload = jsonb_build_object(
  'title', COALESCE(gs.pending_event_payload->>'title', 'Pending Event'),
  'description', COALESCE(gs.pending_event_payload->>'description', ''),
  'chancePercent', COALESCE(NULLIF(gs.pending_event_payload->>'chancePercent', '')::int, 25),
  'conditionLabel', COALESCE(NULLIF(gs.pending_event_payload->>'conditionLabel', ''), 'Condition not available'),
  'options', COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', COALESCE(item->>'id', concat('opt-', ord::text)),
          'label', COALESCE(item->>'label', 'Option'),
          'impactScope', COALESCE(item->>'impactScope', 'SELF'),
          'effectPreview', COALESCE(item->>'effectPreview', 'Tidak ada dampak statistik langsung.')
        )
      )
      FROM jsonb_array_elements(COALESCE(gs.pending_event_payload->'options', '[]'::jsonb)) WITH ORDINALITY AS t(item, ord)
    ),
    '[]'::jsonb
  )
)
WHERE gs.pending_event_id IS NOT NULL
  AND gs.pending_event_payload IS NOT NULL;

-- Ensure a pending decision remains explicitly marked as DECISION pause if pause row exists.
UPDATE game_states
SET pause_reason = 'DECISION'::pause_reason
WHERE pending_event_id IS NOT NULL
  AND paused_at_ms IS NOT NULL
  AND (pause_reason IS NULL OR pause_reason <> 'DECISION'::pause_reason);
