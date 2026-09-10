CREATE TABLE IF NOT EXISTS conversation_read_state (
  workspace_id uuid NOT NULL,
  conversation_thread_id uuid NOT NULL,
  user_id uuid NOT NULL,
  last_read_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_thread_id, user_id),
  FOREIGN KEY (conversation_thread_id, workspace_id)
    REFERENCES conversation_thread(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS conversation_read_state_user_idx
  ON conversation_read_state(workspace_id, user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS conversation_message_unread_idx
  ON conversation_message(workspace_id, conversation_thread_id, created_at, created_by);
