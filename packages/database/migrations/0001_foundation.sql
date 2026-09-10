CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS schema_migration (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_user (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  normalized_email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_membership (
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS workspace (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  default_timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS workspace_membership (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'approver', 'analyst', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS brand (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS brand_one_default_per_workspace
  ON brand(workspace_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS app_session (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_session_user_idx ON app_session(user_id);
CREATE INDEX IF NOT EXISTS app_session_expiry_idx ON app_session(expires_at);

CREATE TABLE IF NOT EXISTS storage_connection (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google_drive', 'onedrive', 'sharepoint')),
  provider_account_id text,
  display_name text NOT NULL,
  encrypted_access_token text NOT NULL,
  encrypted_refresh_token text,
  scopes text[] NOT NULL DEFAULT '{}',
  access_token_expires_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_reauthorization', 'revoked', 'error')),
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS storage_connection_workspace_idx ON storage_connection(workspace_id);

CREATE TABLE IF NOT EXISTS oauth_state (
  state_hash text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google_drive', 'onedrive', 'sharepoint')),
  code_verifier text NOT NULL,
  return_to text NOT NULL DEFAULT '/integrations',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_state_expiry_idx ON oauth_state(expires_at);

CREATE TABLE IF NOT EXISTS smart_source (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  storage_connection_id uuid REFERENCES storage_connection(id) ON DELETE SET NULL,
  name text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('google_drive', 'onedrive', 'sharepoint', 'local')),
  recursive boolean NOT NULL DEFAULT true,
  readiness_mode text NOT NULL CHECK (readiness_mode IN ('immediate', 'related_files', 'ready_marker', 'ai_recommended')),
  stabilization_window_seconds integer NOT NULL CHECK (stabilization_window_seconds BETWEEN 0 AND 86400),
  related_file_minimum integer CHECK (related_file_minimum BETWEEN 1 AND 1000),
  ready_marker text,
  ai_confidence_threshold double precision CHECK (ai_confidence_threshold BETWEEN 0 AND 1),
  allowed_mime_types text[] NOT NULL DEFAULT '{}',
  ignore_patterns text[] NOT NULL DEFAULT '{}',
  context_pack_ids uuid[] NOT NULL DEFAULT '{}',
  autonomy_mode text NOT NULL CHECK (autonomy_mode IN ('draft_only', 'approval_required', 'approve_uncertain', 'approve_first_occurrence', 'campaign_approval', 'confidence_based', 'fully_autonomous', 'custom')),
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  last_scan_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS smart_source_workspace_idx ON smart_source(workspace_id);

CREATE TABLE IF NOT EXISTS smart_source_location (
  id uuid PRIMARY KEY,
  smart_source_id uuid NOT NULL REFERENCES smart_source(id) ON DELETE CASCADE,
  provider_location_id text NOT NULL,
  display_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (smart_source_id, provider_location_id)
);

CREATE TABLE IF NOT EXISTS smart_source_test_run (
  id uuid PRIMARY KEY,
  smart_source_id uuid NOT NULL REFERENCES smart_source(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES app_user(id),
  status text NOT NULL CHECK (status IN ('passed', 'warning', 'failed')),
  matched_count integer NOT NULL DEFAULT 0,
  ignored_count integer NOT NULL DEFAULT 0,
  diagnostics jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_event (
  id uuid PRIMARY KEY,
  organization_id uuid REFERENCES organization(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES workspace(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_event_workspace_time_idx ON audit_event(workspace_id, created_at DESC);
