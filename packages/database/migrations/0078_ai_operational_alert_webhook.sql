CREATE TABLE workspace_ai_operational_alert_webhook (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  endpoint_url text NOT NULL CHECK (
    char_length(endpoint_url) BETWEEN 12 AND 2000
    AND endpoint_url = btrim(endpoint_url)
    AND endpoint_url ~ '^https://[^[:space:]]+$'
  ),
  encrypted_signing_secret text NOT NULL CHECK (
    char_length(encrypted_signing_secret) BETWEEN 20 AND 4096
  ),
  secret_fingerprint text NOT NULL CHECK (
    secret_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  encryption_key_version text NOT NULL CHECK (encryption_key_version = 'v1'),
  status text NOT NULL CHECK (status IN ('unverified', 'verified', 'error', 'disabled')),
  last_tested_at timestamptz,
  last_error text CHECK (
    last_error IS NULL OR (
      char_length(last_error) BETWEEN 1 AND 300 AND last_error = btrim(last_error)
    )
  ),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, updated_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workspace_ai_operational_alert_webhook_state_check CHECK (
    (status = 'unverified' AND last_tested_at IS NULL AND last_error IS NULL) OR
    (status = 'verified' AND last_tested_at IS NOT NULL AND last_error IS NULL) OR
    (status = 'error' AND last_tested_at IS NOT NULL AND last_error IS NOT NULL) OR
    status = 'disabled'
  )
);

CREATE TABLE workspace_ai_operational_alert_delivery (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  incident_type text NOT NULL CHECK (
    incident_type IN (
      'provider_circuit_open',
      'invocation_ambiguous',
      'reconciliation_quarantined'
    )
  ),
  attempt_id uuid NOT NULL,
  provider text NOT NULL CHECK (
    provider IN ('openai', 'anthropic', 'google_generative_ai')
  ),
  event_type text NOT NULL CHECK (
    event_type IN (
      'incident_opened', 'incident_acknowledged',
      'acknowledgement_overdue', 'resolution_overdue', 'incident_resolved'
    )
  ),
  source_observed_at timestamptz NOT NULL,
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object'
    AND octet_length(payload::text) BETWEEN 2 AND 32768
  ),
  status text NOT NULL CHECK (
    status IN ('pending', 'processing', 'failed', 'delivered', 'dead_letter')
  ),
  attempt_count integer NOT NULL CHECK (attempt_count BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL,
  claimed_at timestamptz,
  delivered_at timestamptz,
  response_status integer CHECK (
    response_status IS NULL OR response_status BETWEEN 100 AND 599
  ),
  last_error text CHECK (
    last_error IS NULL OR (
      char_length(last_error) BETWEEN 1 AND 300 AND last_error = btrim(last_error)
    )
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (attempt_id, workspace_id)
    REFERENCES workspace_ai_text_invocation_attempt(id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT workspace_ai_operational_alert_delivery_state_check CHECK (
    (status = 'pending' AND attempt_count = 0 AND claimed_at IS NULL
      AND delivered_at IS NULL AND response_status IS NULL AND last_error IS NULL) OR
    (status = 'processing' AND attempt_count BETWEEN 1 AND 5
      AND claimed_at IS NOT NULL AND delivered_at IS NULL) OR
    (status = 'failed' AND attempt_count BETWEEN 1 AND 4
      AND claimed_at IS NULL AND delivered_at IS NULL AND last_error IS NOT NULL) OR
    (status = 'delivered' AND attempt_count BETWEEN 1 AND 5
      AND claimed_at IS NULL AND delivered_at IS NOT NULL
      AND response_status BETWEEN 200 AND 299 AND last_error IS NULL) OR
    (status = 'dead_letter' AND attempt_count BETWEEN 1 AND 5
      AND claimed_at IS NULL AND delivered_at IS NULL AND last_error IS NOT NULL)
  ),
  UNIQUE (workspace_id, incident_type, attempt_id, event_type)
);

CREATE INDEX workspace_ai_operational_alert_delivery_ready_idx
  ON workspace_ai_operational_alert_delivery(next_attempt_at, created_at, id)
  WHERE status IN ('pending', 'failed', 'processing');
CREATE INDEX workspace_ai_operational_alert_delivery_workspace_idx
  ON workspace_ai_operational_alert_delivery(workspace_id, created_at DESC, id DESC);
