CREATE INDEX IF NOT EXISTS conversation_thread_workspace_status_activity_idx
  ON conversation_thread(workspace_id, status, last_message_at DESC NULLS LAST, updated_at DESC);

CREATE INDEX IF NOT EXISTS conversation_thread_workspace_provider_activity_idx
  ON conversation_thread(workspace_id, provider, last_message_at DESC NULLS LAST, updated_at DESC);

CREATE INDEX IF NOT EXISTS conversation_thread_workspace_owner_activity_idx
  ON conversation_thread(workspace_id, assigned_owner_id, last_message_at DESC NULLS LAST, updated_at DESC);

CREATE INDEX IF NOT EXISTS conversation_handoff_open_thread_due_idx
  ON conversation_handoff_brief(workspace_id, conversation_thread_id, due_at)
  WHERE status = 'open';
