ALTER TABLE campaign_version
  ADD COLUMN IF NOT EXISTS success_action text NOT NULL DEFAULT 'notify_only';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_version_success_action_check'
  ) THEN
    ALTER TABLE campaign_version
      ADD CONSTRAINT campaign_version_success_action_check
      CHECK (success_action IN ('notify_only', 'pause'));
  END IF;
END $$;
