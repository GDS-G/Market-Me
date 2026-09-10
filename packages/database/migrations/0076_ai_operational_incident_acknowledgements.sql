CREATE TABLE workspace_ai_operational_incident_acknowledgement (
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
  reconciliation_id uuid,
  source_observed_at timestamptz NOT NULL,
  acknowledgement_note text NOT NULL CHECK (
    char_length(acknowledgement_note) BETWEEN 3 AND 1000
    AND acknowledgement_note = btrim(acknowledgement_note)
  ),
  acknowledged_by uuid NOT NULL,
  acknowledged_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (attempt_id, workspace_id)
    REFERENCES workspace_ai_text_invocation_attempt(id, workspace_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (reconciliation_id, workspace_id)
    REFERENCES workspace_ai_text_invocation_reconciliation(id, workspace_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, acknowledged_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workspace_ai_operational_incident_ack_shape_check CHECK (
    (incident_type = 'reconciliation_quarantined' AND reconciliation_id IS NOT NULL) OR
    (incident_type IN ('provider_circuit_open', 'invocation_ambiguous')
      AND reconciliation_id IS NULL)
  ),
  UNIQUE (workspace_id, incident_type, attempt_id)
);

CREATE INDEX workspace_ai_operational_incident_ack_recent_idx
  ON workspace_ai_operational_incident_acknowledgement(
    workspace_id, acknowledged_at DESC, id DESC
  );
