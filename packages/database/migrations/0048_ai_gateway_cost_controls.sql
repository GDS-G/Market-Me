CREATE TABLE workspace_ai_policy (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'recommended' CHECK (
    mode IN ('recommended', 'lower_cost', 'highest_quality', 'faster', 'private_local', 'custom')
  ),
  maximum_privacy_class text NOT NULL DEFAULT 'cloud' CHECK (
    maximum_privacy_class IN ('cloud', 'private_cloud', 'local')
  ),
  failover_mode text NOT NULL DEFAULT 'ask_before_switching' CHECK (
    failover_mode IN ('automatic_approved', 'ask_before_switching', 'no_external_fallback')
  ),
  cap_behavior text NOT NULL DEFAULT 'require_approval' CHECK (
    cap_behavior IN ('pause_ai_work', 'lower_cost_fallback', 'limited_drafts', 'require_approval')
  ),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  daily_budget_minor integer CHECK (daily_budget_minor BETWEEN 1 AND 1000000000),
  campaign_budget_minor integer CHECK (campaign_budget_minor BETWEEN 1 AND 1000000000),
  monthly_budget_minor integer CHECK (monthly_budget_minor BETWEEN 1 AND 1000000000),
  alert_threshold_percentages jsonb NOT NULL DEFAULT '[50, 80, 100]'::jsonb CHECK (
    jsonb_typeof(alert_threshold_percentages) = 'array'
    AND jsonb_array_length(alert_threshold_percentages) BETWEEN 1 AND 5
  ),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, updated_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE TABLE ai_usage_event (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  campaign_id uuid,
  capability text NOT NULL CHECK (
    capability IN ('generate_text', 'generate_structured_output', 'analyze_image', 'transcribe', 'embed', 'rerank', 'moderate', 'use_tools')
  ),
  feature text NOT NULL CHECK (length(feature) BETWEEN 1 AND 100),
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 100),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
  privacy_class text NOT NULL CHECK (privacy_class IN ('cloud', 'private_cloud', 'local')),
  input_units integer NOT NULL DEFAULT 0 CHECK (input_units >= 0),
  output_units integer NOT NULL DEFAULT 0 CHECK (output_units >= 0),
  cached_input_units integer NOT NULL DEFAULT 0 CHECK (cached_input_units >= 0),
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count BETWEEN 1 AND 1000000),
  latency_ms integer NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  estimated_cost_minor integer NOT NULL DEFAULT 0 CHECK (estimated_cost_minor >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  prompt_version text,
  context_revision text,
  content_hash text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_usage_campaign_workspace_fk
    FOREIGN KEY (campaign_id, workspace_id)
    REFERENCES campaign(id, workspace_id) ON DELETE RESTRICT
);

CREATE INDEX ai_usage_event_workspace_time_idx
  ON ai_usage_event(workspace_id, occurred_at DESC, id);
CREATE INDEX ai_usage_event_workspace_feature_time_idx
  ON ai_usage_event(workspace_id, feature, occurred_at DESC);
CREATE INDEX ai_usage_event_campaign_time_idx
  ON ai_usage_event(campaign_id, occurred_at DESC)
  WHERE campaign_id IS NOT NULL;
