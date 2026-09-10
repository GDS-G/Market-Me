ALTER TABLE workspace_ai_text_invocation_intent
  ADD CONSTRAINT workspace_ai_text_invocation_intent_id_workspace_provider_unique
  UNIQUE (id, workspace_id, provider);

CREATE TABLE workspace_ai_text_invocation_attempt (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  intent_id uuid NOT NULL UNIQUE,
  provider text NOT NULL CHECK (
    provider IN ('openai', 'anthropic', 'google_generative_ai')
  ),
  model_id text NOT NULL CHECK (
    char_length(model_id) BETWEEN 1 AND 200 AND model_id = btrim(model_id)
  ),
  status text NOT NULL CHECK (
    status IN ('claimed', 'succeeded', 'failed', 'ambiguous')
  ),
  output_sha256 text CHECK (output_sha256 IS NULL OR output_sha256 ~ '^[0-9a-f]{64}$'),
  provider_response_id_sha256 text CHECK (
    provider_response_id_sha256 IS NULL OR provider_response_id_sha256 ~ '^[0-9a-f]{64}$'
  ),
  stop_reason text CHECK (
    stop_reason IS NULL OR stop_reason IN ('completed', 'max_output', 'refusal', 'blocked', 'unknown')
  ),
  failure_code text CHECK (
    failure_code IS NULL OR failure_code IN (
      'credential_unavailable', 'provider_outcome_unknown',
      'evidence_changed', 'claim_abandoned'
    )
  ),
  safe_message text CHECK (
    safe_message IS NULL OR (
      char_length(safe_message) BETWEEN 1 AND 300 AND safe_message = btrim(safe_message)
    )
  ),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens BETWEEN 0 AND 1000000000),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens BETWEEN 0 AND 1000000000),
  claimed_by uuid NOT NULL,
  claimed_at timestamptz NOT NULL,
  claim_expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (intent_id, workspace_id, provider)
    REFERENCES workspace_ai_text_invocation_intent(id, workspace_id, provider)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, claimed_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workspace_ai_text_invocation_attempt_state_check CHECK (
    (status = 'claimed' AND completed_at IS NULL AND output_sha256 IS NULL AND
      provider_response_id_sha256 IS NULL AND stop_reason IS NULL AND
      failure_code IS NULL AND safe_message IS NULL AND
      input_tokens IS NULL AND output_tokens IS NULL) OR
    (status = 'succeeded' AND completed_at IS NOT NULL AND output_sha256 IS NOT NULL AND
      stop_reason IS NOT NULL AND failure_code IS NULL AND safe_message IS NULL) OR
    (status IN ('failed', 'ambiguous') AND completed_at IS NOT NULL AND
      output_sha256 IS NULL AND provider_response_id_sha256 IS NULL AND
      stop_reason IS NULL AND failure_code IS NOT NULL AND safe_message IS NOT NULL AND
      input_tokens IS NULL AND output_tokens IS NULL)
  ),
  CHECK (created_at = claimed_at),
  CHECK (claim_expires_at > claimed_at),
  CHECK (completed_at IS NULL OR completed_at >= claimed_at)
);

CREATE INDEX workspace_ai_text_invocation_attempt_recent_idx
  ON workspace_ai_text_invocation_attempt(workspace_id, created_at DESC, id DESC);
