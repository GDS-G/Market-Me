ALTER TABLE workspace_ai_adapter_invocation_binding
  ADD CONSTRAINT workspace_ai_adapter_invocation_binding_id_workspace_provider_unique
  UNIQUE (id, workspace_id, provider);

CREATE TABLE workspace_ai_adapter_health_observation (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  invocation_binding_id uuid NOT NULL,
  provider text NOT NULL CHECK (
    provider IN ('openai', 'anthropic', 'google_generative_ai')
  ),
  status text NOT NULL CHECK (status IN ('healthy', 'unhealthy')),
  failure_code text CHECK (
    failure_code IS NULL OR failure_code IN (
      'credential_rejected', 'rate_limited',
      'provider_unavailable', 'unexpected_response'
    )
  ),
  safe_message text CHECK (
    safe_message IS NULL OR (
      char_length(safe_message) BETWEEN 1 AND 300 AND
      safe_message = btrim(safe_message)
    )
  ),
  credential_fingerprint text NOT NULL CHECK (
    credential_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  contract_source_hash text NOT NULL CHECK (
    contract_source_hash ~ '^[0-9a-f]{64}$'
  ),
  checked_by uuid NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (invocation_binding_id, workspace_id, provider)
    REFERENCES workspace_ai_adapter_invocation_binding(id, workspace_id, provider)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, checked_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (expires_at > checked_at),
  CHECK (
    (status = 'healthy' AND failure_code IS NULL AND safe_message IS NULL) OR
    (status = 'unhealthy' AND failure_code IS NOT NULL AND safe_message IS NOT NULL)
  )
);

CREATE INDEX workspace_ai_adapter_health_observation_latest_idx
  ON workspace_ai_adapter_health_observation(
    workspace_id, invocation_binding_id, checked_at DESC, id DESC
  );

CREATE INDEX workspace_ai_adapter_health_observation_expiry_idx
  ON workspace_ai_adapter_health_observation(workspace_id, expires_at, status);
