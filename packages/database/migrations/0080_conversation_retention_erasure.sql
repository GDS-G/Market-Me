CREATE TABLE conversation_retention_erasure_request (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  conversation_thread_id uuid NOT NULL,
  retention_class text NOT NULL CHECK (
    retention_class IN ('standard', 'personal_message', 'imported_email')
  ),
  eligible_after timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'executed', 'rejected')
  ),
  request_note text NOT NULL CHECK (
    length(btrim(request_note)) BETWEEN 3 AND 1000
  ),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text CHECK (
    decision_note IS NULL
    OR length(btrim(decision_note)) BETWEEN 3 AND 1000
  ),
  deleted_counts jsonb,
  CONSTRAINT conversation_retention_erasure_decision_check CHECK (
    (
      status = 'pending'
      AND decided_by IS NULL
      AND decided_at IS NULL
      AND decision_note IS NULL
      AND deleted_counts IS NULL
    ) OR (
      status = 'rejected'
      AND decided_by IS NOT NULL
      AND decided_at IS NOT NULL
      AND decision_note IS NOT NULL
      AND deleted_counts IS NULL
    ) OR (
      status = 'executed'
      AND decided_by IS NOT NULL
      AND decided_at IS NOT NULL
      AND decision_note IS NOT NULL
      AND deleted_counts IS NOT NULL
    )
  ),
  CONSTRAINT conversation_retention_erasure_separation_check CHECK (
    decided_by IS NULL OR decided_by <> requested_by
  ),
  FOREIGN KEY (workspace_id, requested_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, decided_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX conversation_retention_one_pending_erasure_idx
  ON conversation_retention_erasure_request(workspace_id, conversation_thread_id)
  WHERE status = 'pending';

CREATE INDEX conversation_retention_erasure_queue_idx
  ON conversation_retention_erasure_request(workspace_id, status, requested_at, id);
