CREATE TABLE ai_cost_quote (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  campaign_id uuid,
  rate_card_id uuid NOT NULL REFERENCES ai_provider_rate_card(id) ON DELETE RESTRICT,
  capability text NOT NULL CHECK (capability IN (
    'generate_text', 'generate_structured_output', 'analyze_image',
    'transcribe', 'embed', 'rerank', 'moderate', 'use_tools'
  )),
  feature text NOT NULL CHECK (length(feature) BETWEEN 1 AND 100),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  minor_unit_exponent smallint NOT NULL CHECK (minor_unit_exponent BETWEEN 0 AND 4),
  forecasts jsonb NOT NULL CHECK (jsonb_typeof(forecasts) = 'array'),
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  minimum_cost_minor integer NOT NULL CHECK (minimum_cost_minor BETWEEN 0 AND 1000000000),
  maximum_cost_minor integer NOT NULL CHECK (
    maximum_cost_minor BETWEEN minimum_cost_minor AND 1000000000
  ),
  quote_hash text NOT NULL CHECK (quote_hash ~ '^[0-9a-f]{64}$'),
  quoted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, quote_hash),
  FOREIGN KEY (campaign_id, workspace_id)
    REFERENCES campaign(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT ai_cost_quote_lifetime_check CHECK (
    expires_at > quoted_at
    AND expires_at <= quoted_at + interval '15 minutes'
    AND created_at = quoted_at
  )
);

CREATE INDEX ai_cost_quote_recent_workspace_idx
  ON ai_cost_quote(workspace_id, created_at DESC, id DESC);
CREATE INDEX ai_cost_quote_active_workspace_idx
  ON ai_cost_quote(workspace_id, expires_at, id);

ALTER TABLE ai_spend_reservation
  ADD COLUMN cost_quote_id uuid,
  ADD CONSTRAINT ai_spend_reservation_cost_quote_workspace_fk
    FOREIGN KEY (cost_quote_id, workspace_id)
    REFERENCES ai_cost_quote(id, workspace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT ai_spend_reservation_cost_quote_unique UNIQUE (cost_quote_id);
