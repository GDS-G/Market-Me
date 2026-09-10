ALTER TABLE measurement_ingest_key
  ADD COLUMN IF NOT EXISTS allowed_event_types text[] NOT NULL DEFAULT ARRAY[
    'impression', 'reach', 'view', 'reaction', 'comment', 'reply', 'share', 'save', 'follow',
    'profile_visit', 'outbound_click', 'destination_visit', 'form_completion', 'lead', 'application',
    'registration', 'subscription', 'purchase', 'booking', 'donation', 'revenue', 'unsubscribe',
    'complaint', 'custom'
  ]::text[],
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'measurement_ingest_key_allowed_event_types'
  ) THEN
    ALTER TABLE measurement_ingest_key
      ADD CONSTRAINT measurement_ingest_key_allowed_event_types CHECK (
        cardinality(allowed_event_types) BETWEEN 1 AND 24
        AND allowed_event_types <@ ARRAY[
          'impression', 'reach', 'view', 'reaction', 'comment', 'reply', 'share', 'save', 'follow',
          'profile_visit', 'outbound_click', 'destination_visit', 'form_completion', 'lead', 'application',
          'registration', 'subscription', 'purchase', 'booking', 'donation', 'revenue', 'unsubscribe',
          'complaint', 'custom'
        ]::text[]
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS measurement_ingest_key_expiry_idx
  ON measurement_ingest_key(workspace_id, expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;
