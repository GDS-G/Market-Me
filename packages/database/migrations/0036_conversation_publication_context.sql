CREATE UNIQUE INDEX IF NOT EXISTS channel_connection_id_workspace_idx
  ON channel_connection(id, workspace_id);

CREATE UNIQUE INDEX IF NOT EXISTS publication_action_context_identity_idx
  ON publication_action(id, channel_connection_id, workspace_id);

ALTER TABLE conversation_thread
  ADD COLUMN IF NOT EXISTS channel_connection_id uuid,
  ADD COLUMN IF NOT EXISTS publication_action_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_thread_channel_workspace_fk'
  ) THEN
    ALTER TABLE conversation_thread
      ADD CONSTRAINT conversation_thread_channel_workspace_fk
      FOREIGN KEY (channel_connection_id, workspace_id)
      REFERENCES channel_connection(id, workspace_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_thread_publication_context_fk'
  ) THEN
    ALTER TABLE conversation_thread
      ADD CONSTRAINT conversation_thread_publication_context_fk
      FOREIGN KEY (publication_action_id, channel_connection_id, workspace_id)
      REFERENCES publication_action(id, channel_connection_id, workspace_id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_thread_publication_requires_channel_check'
  ) THEN
    ALTER TABLE conversation_thread
      ADD CONSTRAINT conversation_thread_publication_requires_channel_check
      CHECK (publication_action_id IS NULL OR channel_connection_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS conversation_thread_workspace_channel_activity_idx
  ON conversation_thread(workspace_id, channel_connection_id, last_message_at DESC NULLS LAST, updated_at DESC);

CREATE INDEX IF NOT EXISTS conversation_thread_workspace_publication_activity_idx
  ON conversation_thread(workspace_id, publication_action_id, last_message_at DESC NULLS LAST, updated_at DESC);
