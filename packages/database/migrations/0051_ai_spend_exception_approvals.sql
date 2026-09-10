CREATE TABLE ai_spend_exception_request (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  denied_reservation_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'expired')
  ),
  justification text NOT NULL CHECK (length(justification) BETWEEN 1 AND 1000),
  requested_by uuid NOT NULL,
  resolved_by uuid,
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) BETWEEN 1 AND 1000),
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, denied_reservation_id),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (denied_reservation_id, workspace_id)
    REFERENCES ai_spend_reservation(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, requested_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, resolved_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT ai_spend_exception_state_check CHECK (
    (status = 'pending' AND resolved_by IS NULL AND resolved_at IS NULL
      AND decision_note IS NULL AND consumed_at IS NULL)
    OR (status = 'approved' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
    OR (status = 'rejected' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL
      AND consumed_at IS NULL)
    OR (status = 'expired' AND resolved_at IS NOT NULL AND consumed_at IS NULL)
  ),
  CONSTRAINT ai_spend_exception_consumption_check CHECK (
    consumed_at IS NULL OR (status = 'approved' AND consumed_at >= resolved_at)
  )
);

ALTER TABLE ai_spend_reservation
  ADD COLUMN spend_exception_request_id uuid,
  ADD CONSTRAINT ai_spend_reservation_exception_workspace_fk
    FOREIGN KEY (spend_exception_request_id, workspace_id)
    REFERENCES ai_spend_exception_request(id, workspace_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX ai_spend_reservation_one_per_exception_idx
  ON ai_spend_reservation(spend_exception_request_id)
  WHERE spend_exception_request_id IS NOT NULL;
CREATE INDEX ai_spend_exception_pending_workspace_idx
  ON ai_spend_exception_request(workspace_id, expires_at, created_at, id)
  WHERE status = 'pending';
CREATE INDEX ai_spend_exception_recent_workspace_idx
  ON ai_spend_exception_request(workspace_id, created_at DESC, id DESC);
