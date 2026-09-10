CREATE TABLE workspace_invitation (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  email text NOT NULL,
  normalized_email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'editor', 'approver', 'analyst', 'viewer')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by uuid NOT NULL,
  accepted_by uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, invited_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workspace_invitation_email_length CHECK (
    char_length(email) BETWEEN 3 AND 320
    AND char_length(normalized_email) BETWEEN 3 AND 320
  ),
  CONSTRAINT workspace_invitation_state_consistent CHECK (
    (status = 'pending' AND accepted_by IS NULL AND accepted_at IS NULL AND revoked_at IS NULL)
    OR (status = 'accepted' AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND accepted_by IS NULL AND accepted_at IS NULL AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX workspace_invitation_one_pending_email_idx
  ON workspace_invitation(workspace_id, normalized_email)
  WHERE status = 'pending';

CREATE INDEX workspace_invitation_email_lookup_idx
  ON workspace_invitation(normalized_email, status, expires_at);

CREATE INDEX workspace_invitation_workspace_time_idx
  ON workspace_invitation(workspace_id, created_at DESC);
