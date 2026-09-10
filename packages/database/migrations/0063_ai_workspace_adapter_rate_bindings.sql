ALTER TABLE workspace_ai_adapter_registration
  ADD CONSTRAINT workspace_ai_adapter_registration_id_workspace_unique
  UNIQUE (id, workspace_id);

ALTER TABLE ai_provider_rate_card
  ADD CONSTRAINT ai_provider_rate_card_id_currency_unique
  UNIQUE (id, currency);

CREATE TABLE workspace_ai_adapter_rate_binding (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  rate_card_id uuid NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'bound' CHECK (status IN ('bound', 'retired')),
  rate_card_source_hash text NOT NULL CHECK (
    rate_card_source_hash ~ '^[0-9a-f]{64}$'
  ),
  bound_by uuid NOT NULL,
  retired_by uuid,
  retirement_reason text CHECK (
    retirement_reason IS NULL OR (
      char_length(retirement_reason) BETWEEN 1 AND 500 AND
      retirement_reason = btrim(retirement_reason)
    )
  ),
  bound_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registration_id, currency),
  FOREIGN KEY (registration_id, workspace_id)
    REFERENCES workspace_ai_adapter_registration(id, workspace_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (rate_card_id, currency)
    REFERENCES ai_provider_rate_card(id, currency)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, bound_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, retired_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (
    (status = 'bound' AND retired_by IS NULL AND retirement_reason IS NULL AND retired_at IS NULL) OR
    (status = 'retired' AND retired_by IS NOT NULL AND retirement_reason IS NOT NULL AND retired_at IS NOT NULL)
  )
);

CREATE INDEX workspace_ai_adapter_rate_binding_status_idx
  ON workspace_ai_adapter_rate_binding(workspace_id, status, updated_at DESC, id);

CREATE INDEX workspace_ai_adapter_rate_binding_rate_card_idx
  ON workspace_ai_adapter_rate_binding(rate_card_id, status, workspace_id);
