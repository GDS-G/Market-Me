ALTER TABLE campaign_version
  ADD COLUMN IF NOT EXISTS success_criteria jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_version_success_criteria_array'
  ) THEN
    ALTER TABLE campaign_version
      ADD CONSTRAINT campaign_version_success_criteria_array
      CHECK (jsonb_typeof(success_criteria) = 'array');
  END IF;
END $$;
