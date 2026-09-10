CREATE TABLE ai_spend_reservation (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  campaign_id uuid,
  idempotency_key uuid NOT NULL,
  capability text NOT NULL CHECK (
    capability IN ('generate_text', 'generate_structured_output', 'analyze_image', 'transcribe', 'embed', 'rerank', 'moderate', 'use_tools')
  ),
  feature text NOT NULL CHECK (length(feature) BETWEEN 1 AND 100),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  estimated_cost_minor integer NOT NULL CHECK (estimated_cost_minor BETWEEN 1 AND 1000000000),
  actual_cost_minor integer CHECK (actual_cost_minor BETWEEN 0 AND 1000000000),
  status text NOT NULL CHECK (status IN ('reserved', 'denied', 'settled', 'released', 'expired')),
  exceeded_scopes text[] NOT NULL DEFAULT '{}' CHECK (
    exceeded_scopes <@ ARRAY['daily', 'campaign', 'monthly']::text[]
  ),
  cap_behavior text NOT NULL CHECK (
    cap_behavior IN ('pause_ai_work', 'lower_cost_fallback', 'limited_drafts', 'require_approval')
  ),
  requested_by uuid NOT NULL,
  resolved_by uuid,
  expires_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key),
  FOREIGN KEY (campaign_id, workspace_id)
    REFERENCES campaign(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, requested_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, resolved_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT ai_spend_reservation_state_check CHECK (
    (status = 'reserved' AND expires_at IS NOT NULL AND resolved_at IS NULL
      AND resolved_by IS NULL AND actual_cost_minor IS NULL
      AND cardinality(exceeded_scopes) = 0)
    OR (status = 'denied' AND expires_at IS NULL AND resolved_at IS NOT NULL
      AND resolved_by IS NOT NULL AND actual_cost_minor IS NULL
      AND cardinality(exceeded_scopes) > 0)
    OR (status = 'settled' AND expires_at IS NOT NULL AND resolved_at IS NOT NULL
      AND resolved_by IS NOT NULL AND actual_cost_minor IS NOT NULL
      AND cardinality(exceeded_scopes) = 0)
    OR (status IN ('released', 'expired') AND expires_at IS NOT NULL
      AND resolved_at IS NOT NULL AND actual_cost_minor IS NULL
      AND cardinality(exceeded_scopes) = 0)
  )
);

CREATE UNIQUE INDEX ai_spend_reservation_id_workspace_idx
  ON ai_spend_reservation(id, workspace_id);
CREATE INDEX ai_spend_reservation_active_workspace_idx
  ON ai_spend_reservation(workspace_id, currency, expires_at, id)
  WHERE status = 'reserved';
CREATE INDEX ai_spend_reservation_recent_workspace_idx
  ON ai_spend_reservation(workspace_id, created_at DESC, id DESC);

ALTER TABLE ai_usage_event
  ADD COLUMN spend_reservation_id uuid,
  ADD CONSTRAINT ai_usage_event_reservation_workspace_fk
    FOREIGN KEY (spend_reservation_id, workspace_id)
    REFERENCES ai_spend_reservation(id, workspace_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX ai_usage_event_one_per_reservation_idx
  ON ai_usage_event(spend_reservation_id)
  WHERE spend_reservation_id IS NOT NULL;
