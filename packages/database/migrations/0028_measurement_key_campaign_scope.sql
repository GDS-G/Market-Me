ALTER TABLE measurement_ingest_key
  ADD COLUMN IF NOT EXISTS campaign_scope_mode text NOT NULL DEFAULT 'all';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'measurement_ingest_key_campaign_scope_mode_check'
  ) THEN
    ALTER TABLE measurement_ingest_key
      ADD CONSTRAINT measurement_ingest_key_campaign_scope_mode_check
      CHECK (campaign_scope_mode IN ('all', 'restricted'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS measurement_ingest_key_campaign_scope (
  measurement_ingest_key_id uuid NOT NULL REFERENCES measurement_ingest_key(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  PRIMARY KEY (measurement_ingest_key_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS measurement_ingest_key_campaign_scope_campaign_idx
  ON measurement_ingest_key_campaign_scope(campaign_id, measurement_ingest_key_id);
