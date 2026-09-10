ALTER TABLE browser_job
  ADD COLUMN IF NOT EXISTS campaign_instance_id uuid REFERENCES campaign_instance(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS campaign_step_run_id uuid REFERENCES campaign_step_run(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'browser_job_campaign_binding_check') THEN
    ALTER TABLE browser_job ADD CONSTRAINT browser_job_campaign_binding_check
      CHECK ((campaign_instance_id IS NULL) = (campaign_step_run_id IS NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS browser_job_campaign_step_idx
  ON browser_job(campaign_step_run_id)
  WHERE campaign_step_run_id IS NOT NULL;
