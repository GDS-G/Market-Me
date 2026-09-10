ALTER TABLE conversation_thread
  ADD COLUMN IF NOT EXISTS response_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_at timestamptz;

CREATE INDEX IF NOT EXISTS conversation_thread_response_due_idx
  ON conversation_thread(workspace_id, response_due_at)
  WHERE response_due_at IS NOT NULL
    AND status NOT IN ('resolved', 'archived');

CREATE INDEX IF NOT EXISTS conversation_thread_follow_up_idx
  ON conversation_thread(workspace_id, follow_up_at)
  WHERE follow_up_at IS NOT NULL
    AND status NOT IN ('resolved', 'archived');

CREATE TABLE IF NOT EXISTS conversation_handoff_brief (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  conversation_thread_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open',
  contact_summary text NOT NULL,
  importance text NOT NULL,
  request_or_offer text NOT NULL,
  prior_response_summary text NOT NULL DEFAULT '',
  relevant_context text NOT NULL DEFAULT '',
  suggested_response text NOT NULL DEFAULT '',
  due_at timestamptz,
  requested_by uuid NOT NULL REFERENCES app_user(id),
  closed_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_thread_id, workspace_id)
    REFERENCES conversation_thread(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT conversation_handoff_status_check
    CHECK (status IN ('open', 'resolved', 'cancelled')),
  CONSTRAINT conversation_handoff_close_check CHECK (
    (status = 'open' AND closed_by IS NULL AND closed_at IS NULL)
    OR (status <> 'open' AND closed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_handoff_one_open_idx
  ON conversation_handoff_brief(conversation_thread_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS conversation_handoff_workspace_due_idx
  ON conversation_handoff_brief(workspace_id, due_at)
  WHERE status = 'open';
