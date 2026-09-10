ALTER TABLE conversation_service_level_policy
  ADD COLUMN escalation_after_minutes integer NOT NULL DEFAULT 60,
  ADD CONSTRAINT conversation_service_level_escalation_check
    CHECK (escalation_after_minutes BETWEEN 0 AND 10080);

CREATE INDEX conversation_thread_active_attention_idx
  ON conversation_thread(workspace_id, status, follow_up_at, response_due_at)
  WHERE status NOT IN ('resolved', 'archived');
