CREATE TABLE ai_budget_alert (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  campaign_id uuid,
  source_reservation_id uuid,
  scope text NOT NULL CHECK (scope IN ('daily', 'campaign', 'monthly')),
  window_key text NOT NULL CHECK (length(window_key) BETWEEN 7 AND 100),
  threshold_percentage integer NOT NULL CHECK (threshold_percentage BETWEEN 1 AND 100),
  committed_cost_minor integer NOT NULL CHECK (committed_cost_minor BETWEEN 0 AND 1000000000),
  cap_minor integer NOT NULL CHECK (cap_minor BETWEEN 1 AND 1000000000),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged')),
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, scope, window_key, threshold_percentage, cap_minor, currency),
  FOREIGN KEY (campaign_id, workspace_id)
    REFERENCES campaign(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_reservation_id, workspace_id)
    REFERENCES ai_spend_reservation(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, acknowledged_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT ai_budget_alert_scope_shape_check CHECK (
    (scope = 'campaign' AND campaign_id IS NOT NULL AND window_key = campaign_id::text)
    OR (scope IN ('daily', 'monthly') AND campaign_id IS NULL)
  ),
  CONSTRAINT ai_budget_alert_acknowledgement_check CHECK (
    (status = 'open' AND acknowledged_by IS NULL AND acknowledged_at IS NULL)
    OR (status = 'acknowledged' AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX ai_budget_alert_id_workspace_idx
  ON ai_budget_alert(id, workspace_id);
CREATE INDEX ai_budget_alert_open_workspace_idx
  ON ai_budget_alert(workspace_id, created_at DESC, id DESC)
  WHERE status = 'open';
CREATE INDEX ai_budget_alert_recent_workspace_idx
  ON ai_budget_alert(workspace_id, created_at DESC, id DESC);
