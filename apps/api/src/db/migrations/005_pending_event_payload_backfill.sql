UPDATE game_states
SET pending_event_payload = jsonb_set(
  jsonb_set(
    jsonb_set(
      pending_event_payload,
      '{chancePercent}',
      COALESCE(pending_event_payload->'chancePercent', '35'::jsonb),
      true
    ),
    '{conditionLabel}',
    COALESCE(pending_event_payload->'conditionLabel', to_jsonb('Legacy pending event'::text)),
    true
  ),
  '{options}',
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', COALESCE(option_item->>'id', 'legacy-option'),
          'label', COALESCE(option_item->>'label', 'Legacy option'),
          'impactScope', COALESCE(option_item->>'impactScope', 'SELF'),
          'effectPreview', COALESCE(option_item->>'effectPreview', 'Effect summary unavailable')
        )
      )
      FROM jsonb_array_elements(COALESCE(pending_event_payload->'options', '[]'::jsonb)) option_item
    ),
    '[]'::jsonb
  ),
  true
)
WHERE pending_event_payload IS NOT NULL
  AND (
    NOT (pending_event_payload ? 'chancePercent')
    OR NOT (pending_event_payload ? 'conditionLabel')
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(pending_event_payload->'options', '[]'::jsonb)) option_item
      WHERE NOT (option_item ? 'impactScope') OR NOT (option_item ? 'effectPreview')
    )
  );
