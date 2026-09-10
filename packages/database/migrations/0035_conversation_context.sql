CREATE UNIQUE INDEX IF NOT EXISTS campaign_id_workspace_idx
  ON campaign(id, workspace_id);

CREATE UNIQUE INDEX IF NOT EXISTS destination_id_workspace_idx
  ON destination(id, workspace_id);

ALTER TABLE conversation_thread
  ADD COLUMN IF NOT EXISTS campaign_id uuid,
  ADD COLUMN IF NOT EXISTS destination_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_thread_campaign_workspace_fk'
  ) THEN
    ALTER TABLE conversation_thread
      ADD CONSTRAINT conversation_thread_campaign_workspace_fk
      FOREIGN KEY (campaign_id, workspace_id)
      REFERENCES campaign(id, workspace_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_thread_destination_workspace_fk'
  ) THEN
    ALTER TABLE conversation_thread
      ADD CONSTRAINT conversation_thread_destination_workspace_fk
      FOREIGN KEY (destination_id, workspace_id)
      REFERENCES destination(id, workspace_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS conversation_thread_workspace_campaign_activity_idx
  ON conversation_thread(workspace_id, campaign_id, last_message_at DESC NULLS LAST, updated_at DESC);

CREATE INDEX IF NOT EXISTS conversation_thread_workspace_destination_activity_idx
  ON conversation_thread(workspace_id, destination_id, last_message_at DESC NULLS LAST, updated_at DESC);
