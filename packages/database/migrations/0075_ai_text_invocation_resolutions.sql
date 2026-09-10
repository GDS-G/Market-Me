ALTER TABLE workspace_ai_text_invocation_reconciliation
  ADD CONSTRAINT workspace_ai_text_invocation_reconciliation_id_workspace_unique
  UNIQUE (id, workspace_id);

CREATE TABLE workspace_ai_text_invocation_resolution (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL UNIQUE,
  reservation_id uuid NOT NULL,
  reconciliation_id uuid UNIQUE,
  provider text NOT NULL CHECK (
    provider IN ('openai', 'anthropic', 'google_generative_ai')
  ),
  model_id text NOT NULL CHECK (
    char_length(model_id) BETWEEN 1 AND 200 AND model_id = btrim(model_id)
  ),
  disposition text NOT NULL CHECK (
    disposition IN ('confirmed_no_charge', 'settled_provider_charge')
  ),
  provider_charge_minor integer CHECK (
    provider_charge_minor IS NULL OR provider_charge_minor BETWEEN 1 AND 1000000000
  ),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  evidence_reference text NOT NULL CHECK (
    char_length(evidence_reference) BETWEEN 3 AND 1000
    AND evidence_reference = btrim(evidence_reference)
  ),
  resolution_note text NOT NULL CHECK (
    char_length(resolution_note) BETWEEN 3 AND 1000
    AND resolution_note = btrim(resolution_note)
  ),
  reservation_previous_status text NOT NULL CHECK (
    reservation_previous_status IN ('reserved', 'released', 'expired')
  ),
  reservation_final_status text NOT NULL CHECK (
    reservation_final_status IN ('settled', 'released', 'expired')
  ),
  resolved_by uuid NOT NULL,
  resolved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (attempt_id, workspace_id)
    REFERENCES workspace_ai_text_invocation_attempt(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (reservation_id, workspace_id)
    REFERENCES ai_spend_reservation(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (reconciliation_id, workspace_id)
    REFERENCES workspace_ai_text_invocation_reconciliation(id, workspace_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, resolved_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workspace_ai_text_invocation_resolution_fields_check CHECK (
    (disposition = 'confirmed_no_charge' AND provider_charge_minor IS NULL
      AND reservation_final_status IN ('released', 'expired')) OR
    (disposition = 'settled_provider_charge' AND provider_charge_minor IS NOT NULL
      AND reservation_final_status = 'settled')
  )
);

CREATE UNIQUE INDEX workspace_ai_text_invocation_resolution_id_workspace_idx
  ON workspace_ai_text_invocation_resolution(id, workspace_id);
CREATE INDEX workspace_ai_text_invocation_resolution_recent_idx
  ON workspace_ai_text_invocation_resolution(workspace_id, resolved_at DESC, id DESC);
