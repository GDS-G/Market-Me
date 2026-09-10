ALTER TABLE conversation_thread
  ADD COLUMN retention_class text NOT NULL DEFAULT 'standard',
  ADD COLUMN retention_class_updated_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN retention_class_updated_at timestamptz,
  ADD CONSTRAINT conversation_thread_retention_class_check CHECK (
    retention_class IN ('standard', 'personal_message', 'imported_email', 'legal_hold')
  ),
  ADD CONSTRAINT conversation_thread_retention_review_check CHECK (
    (retention_class_updated_by IS NULL AND retention_class_updated_at IS NULL)
    OR (retention_class_updated_by IS NOT NULL AND retention_class_updated_at IS NOT NULL)
  );

CREATE TABLE conversation_retention_policy (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  standard_days integer NOT NULL DEFAULT 365,
  personal_message_days integer NOT NULL DEFAULT 180,
  imported_email_days integer NOT NULL DEFAULT 365,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_retention_days_check CHECK (
    standard_days BETWEEN 1 AND 3650
    AND personal_message_days BETWEEN 1 AND 3650
    AND imported_email_days BETWEEN 1 AND 3650
  ),
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, updated_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX conversation_thread_retention_preview_idx
  ON conversation_thread(
    workspace_id, status, retention_class,
    (COALESCE(last_message_at, created_at))
  )
  WHERE status IN ('resolved', 'archived')
    AND retention_class <> 'legal_hold';
