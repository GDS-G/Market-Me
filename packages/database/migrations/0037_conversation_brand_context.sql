CREATE UNIQUE INDEX IF NOT EXISTS brand_profile_id_workspace_idx
  ON brand_profile(id, workspace_id);

ALTER TABLE conversation_thread
  ADD COLUMN IF NOT EXISTS brand_profile_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_thread_brand_workspace_fk'
  ) THEN
    ALTER TABLE conversation_thread
      ADD CONSTRAINT conversation_thread_brand_workspace_fk
      FOREIGN KEY (brand_profile_id, workspace_id)
      REFERENCES brand_profile(id, workspace_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS conversation_thread_workspace_brand_activity_idx
  ON conversation_thread(workspace_id, brand_profile_id, last_message_at DESC NULLS LAST, updated_at DESC);
