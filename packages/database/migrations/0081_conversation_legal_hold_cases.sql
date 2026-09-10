ALTER TABLE conversation_thread
  ADD COLUMN retention_revision integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT conversation_thread_retention_revision_check
    CHECK (retention_revision >= 0);

ALTER TABLE conversation_retention_erasure_request
  ADD COLUMN thread_retention_revision integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT conversation_erasure_retention_revision_check
    CHECK (thread_retention_revision >= 0);

CREATE TABLE conversation_legal_hold_case (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  conversation_thread_id uuid NOT NULL,
  previous_retention_class text NOT NULL CHECK (
    previous_retention_class IN ('standard', 'personal_message', 'imported_email')
  ),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  case_reference text CHECK (
    case_reference IS NULL OR length(btrim(case_reference)) BETWEEN 1 AND 200
  ),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
  placed_by uuid NOT NULL,
  placed_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid,
  released_at timestamptz,
  release_request_id uuid,
  CONSTRAINT conversation_legal_hold_identity_unique
    UNIQUE (id, workspace_id, conversation_thread_id),
  CONSTRAINT conversation_legal_hold_release_state_check CHECK (
    (status = 'active' AND released_by IS NULL AND released_at IS NULL
      AND release_request_id IS NULL)
    OR (status = 'released' AND released_by IS NOT NULL AND released_at IS NOT NULL
      AND release_request_id IS NOT NULL)
  ),
  FOREIGN KEY (workspace_id, placed_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, released_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX conversation_one_active_legal_hold_idx
  ON conversation_legal_hold_case(workspace_id, conversation_thread_id)
  WHERE status = 'active';

CREATE TABLE conversation_legal_hold_release_request (
  id uuid PRIMARY KEY,
  legal_hold_case_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  conversation_thread_id uuid NOT NULL,
  target_retention_class text NOT NULL CHECK (
    target_retention_class IN ('standard', 'personal_message', 'imported_email')
  ),
  request_note text NOT NULL CHECK (length(btrim(request_note)) BETWEEN 3 AND 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected')
  ),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text CHECK (
    decision_note IS NULL OR length(btrim(decision_note)) BETWEEN 3 AND 1000
  ),
  CONSTRAINT conversation_legal_hold_release_decision_check CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL
      AND decision_note IS NULL)
    OR (status IN ('approved', 'rejected') AND decided_by IS NOT NULL
      AND decided_at IS NOT NULL AND decision_note IS NOT NULL)
  ),
  CONSTRAINT conversation_legal_hold_release_separation_check CHECK (
    decided_by IS NULL OR decided_by <> requested_by
  ),
  FOREIGN KEY (workspace_id, requested_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, decided_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (legal_hold_case_id, workspace_id, conversation_thread_id)
    REFERENCES conversation_legal_hold_case(id, workspace_id, conversation_thread_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX conversation_one_pending_hold_release_idx
  ON conversation_legal_hold_release_request(legal_hold_case_id)
  WHERE status = 'pending';

CREATE INDEX conversation_legal_hold_history_idx
  ON conversation_legal_hold_case(workspace_id, conversation_thread_id, placed_at DESC, id);

CREATE INDEX conversation_legal_hold_release_history_idx
  ON conversation_legal_hold_release_request(
    workspace_id, conversation_thread_id, requested_at DESC, id
  );
