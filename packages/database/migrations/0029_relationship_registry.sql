CREATE TABLE IF NOT EXISTS relationship_contact (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  organization_name text,
  stage text NOT NULL DEFAULT 'unknown',
  contact_permission text NOT NULL DEFAULT 'allowed',
  assigned_owner_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  observed_interests text[] NOT NULL DEFAULT '{}',
  shared_topics text[] NOT NULL DEFAULT '{}',
  preferred_tone text,
  notes text NOT NULL DEFAULT '',
  suppression_reason text,
  suppressed_at timestamptz,
  suppressed_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  CONSTRAINT relationship_contact_stage_check CHECK (
    stage IN (
      'unknown', 'discovered', 'new_contact', 'engaged', 'active_conversation',
      'lead', 'customer', 'partner', 'collaborator', 'community_member', 'inactive'
    )
  ),
  CONSTRAINT relationship_contact_permission_check CHECK (
    contact_permission IN ('allowed', 'suppressed')
  ),
  CONSTRAINT relationship_contact_suppression_state_check CHECK (
    (
      contact_permission = 'allowed'
      AND suppression_reason IS NULL
      AND suppressed_at IS NULL
      AND suppressed_by IS NULL
    ) OR (
      contact_permission = 'suppressed'
      AND length(trim(suppression_reason)) > 0
      AND suppressed_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS relationship_contact_workspace_updated_idx
  ON relationship_contact(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS relationship_contact_workspace_permission_idx
  ON relationship_contact(workspace_id, contact_permission, stage);

CREATE TABLE IF NOT EXISTS relationship_identity (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  relationship_contact_id uuid NOT NULL,
  provider text NOT NULL,
  provider_subject_id text NOT NULL,
  display_handle text,
  profile_url text,
  status text NOT NULL DEFAULT 'reported',
  confidence numeric(4, 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (relationship_contact_id, workspace_id)
    REFERENCES relationship_contact(id, workspace_id) ON DELETE CASCADE,
  UNIQUE (workspace_id, provider, provider_subject_id),
  CONSTRAINT relationship_identity_status_check CHECK (status IN ('reported', 'verified')),
  CONSTRAINT relationship_identity_confidence_check CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  )
);

CREATE INDEX IF NOT EXISTS relationship_identity_contact_idx
  ON relationship_identity(relationship_contact_id, provider);
