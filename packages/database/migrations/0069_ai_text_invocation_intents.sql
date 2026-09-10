ALTER TABLE ai_spend_reservation
  ADD CONSTRAINT ai_spend_reservation_id_workspace_quote_unique
  UNIQUE (id, workspace_id, cost_quote_id);

CREATE TABLE workspace_ai_text_invocation_intent (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  invocation_binding_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  cost_quote_id uuid NOT NULL,
  provider text NOT NULL CHECK (
    provider IN ('openai', 'anthropic', 'google_generative_ai')
  ),
  model_id text NOT NULL CHECK (
    char_length(model_id) BETWEEN 1 AND 200 AND model_id = btrim(model_id)
  ),
  idempotency_key uuid NOT NULL,
  user_text_sha256 text NOT NULL CHECK (user_text_sha256 ~ '^[0-9a-f]{64}$'),
  system_text_sha256 text CHECK (
    system_text_sha256 IS NULL OR system_text_sha256 ~ '^[0-9a-f]{64}$'
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  max_output_tokens integer NOT NULL CHECK (max_output_tokens BETWEEN 1 AND 16384),
  contract_source_hash text NOT NULL CHECK (contract_source_hash ~ '^[0-9a-f]{64}$'),
  credential_fingerprint text NOT NULL CHECK (credential_fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('prepared', 'cancelled')),
  prepared_by uuid NOT NULL,
  cancelled_by uuid,
  cancellation_reason text CHECK (
    cancellation_reason IS NULL OR (
      char_length(cancellation_reason) BETWEEN 1 AND 500 AND
      cancellation_reason = btrim(cancellation_reason)
    )
  ),
  prepared_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, idempotency_key),
  UNIQUE (reservation_id),
  FOREIGN KEY (invocation_binding_id, workspace_id, provider)
    REFERENCES workspace_ai_adapter_invocation_binding(id, workspace_id, provider)
    ON DELETE RESTRICT,
  FOREIGN KEY (reservation_id, workspace_id, cost_quote_id)
    REFERENCES ai_spend_reservation(id, workspace_id, cost_quote_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (cost_quote_id, workspace_id)
    REFERENCES ai_cost_quote(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, prepared_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, cancelled_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workspace_ai_text_invocation_intent_state_check CHECK (
    (status = 'prepared' AND cancelled_by IS NULL AND
      cancellation_reason IS NULL AND cancelled_at IS NULL) OR
    (status = 'cancelled' AND cancelled_by IS NOT NULL AND
      cancellation_reason IS NOT NULL AND cancelled_at IS NOT NULL)
  ),
  CHECK (expires_at > prepared_at),
  CHECK (created_at = prepared_at)
);

CREATE INDEX workspace_ai_text_invocation_intent_recent_idx
  ON workspace_ai_text_invocation_intent(workspace_id, created_at DESC, id DESC);

CREATE INDEX workspace_ai_text_invocation_intent_current_idx
  ON workspace_ai_text_invocation_intent(workspace_id, expires_at, id)
  WHERE status = 'prepared';
