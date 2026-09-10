CREATE TABLE workspace_ai_provider_connection (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (
    provider IN ('openai', 'anthropic', 'google_generative_ai')
  ),
  status text NOT NULL DEFAULT 'unverified' CHECK (
    status IN ('unverified', 'verified', 'error', 'revoked')
  ),
  encrypted_credential text CHECK (
    encrypted_credential IS NULL OR
    char_length(encrypted_credential) BETWEEN 20 AND 4096
  ),
  credential_fingerprint text CHECK (
    credential_fingerprint IS NULL OR credential_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  encryption_key_version text CHECK (
    encryption_key_version IS NULL OR encryption_key_version = 'v1'
  ),
  last_error text CHECK (
    last_error IS NULL OR (
      char_length(last_error) BETWEEN 1 AND 500 AND last_error = btrim(last_error)
    )
  ),
  verified_at timestamptz,
  revoked_at timestamptz,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider),
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, updated_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (
    (
      status = 'revoked' AND encrypted_credential IS NULL AND
      credential_fingerprint IS NULL AND encryption_key_version IS NULL AND
      verified_at IS NULL AND revoked_at IS NOT NULL
    ) OR (
      status <> 'revoked' AND encrypted_credential IS NOT NULL AND
      credential_fingerprint IS NOT NULL AND encryption_key_version = 'v1' AND
      revoked_at IS NULL
    )
  ),
  CHECK ((status = 'verified') = (verified_at IS NOT NULL)),
  CHECK ((status = 'error') = (last_error IS NOT NULL))
);

CREATE INDEX workspace_ai_provider_connection_status_idx
  ON workspace_ai_provider_connection(workspace_id, status, updated_at DESC, provider);
