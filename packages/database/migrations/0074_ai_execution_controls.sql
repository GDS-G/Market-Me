CREATE TABLE workspace_ai_execution_control (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('stopped', 'enabled')),
  reason text NOT NULL CHECK (
    char_length(reason) BETWEEN 3 AND 500 AND reason = btrim(reason)
  ),
  enabled_until timestamptz,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, updated_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workspace_ai_execution_control_state_fields_check CHECK (
    (state = 'stopped' AND enabled_until IS NULL) OR
    (state = 'enabled' AND enabled_until IS NOT NULL)
  )
);

CREATE TABLE workspace_ai_provider_circuit (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (
    provider IN ('openai', 'anthropic', 'google_generative_ai')
  ),
  state text NOT NULL CHECK (state IN ('closed', 'open')),
  consecutive_unsafe_outcomes integer NOT NULL CHECK (
    consecutive_unsafe_outcomes BETWEEN 0 AND 1000000
  ),
  last_failure_code text CHECK (
    last_failure_code IS NULL OR last_failure_code IN (
      'credential_unavailable', 'provider_outcome_unknown', 'claim_abandoned'
    )
  ),
  last_outcome_at timestamptz,
  opened_at timestamptz,
  opened_by_attempt_id uuid REFERENCES workspace_ai_text_invocation_attempt(id)
    ON DELETE RESTRICT,
  reset_by uuid,
  reset_note text CHECK (
    reset_note IS NULL OR (
      char_length(reset_note) BETWEEN 3 AND 500 AND reset_note = btrim(reset_note)
    )
  ),
  reset_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, provider),
  FOREIGN KEY (workspace_id, reset_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workspace_ai_provider_circuit_state_fields_check CHECK (
    (state = 'closed' AND opened_at IS NULL AND opened_by_attempt_id IS NULL) OR
    (state = 'open' AND consecutive_unsafe_outcomes >= 1 AND
      last_failure_code IS NOT NULL AND opened_at IS NOT NULL AND
      opened_by_attempt_id IS NOT NULL)
  ),
  CONSTRAINT workspace_ai_provider_circuit_reset_check CHECK (
    (reset_by IS NULL AND reset_note IS NULL AND reset_at IS NULL) OR
    (reset_by IS NOT NULL AND reset_note IS NOT NULL AND reset_at IS NOT NULL)
  )
);

CREATE INDEX workspace_ai_provider_circuit_state_idx
  ON workspace_ai_provider_circuit(workspace_id, state, provider);
