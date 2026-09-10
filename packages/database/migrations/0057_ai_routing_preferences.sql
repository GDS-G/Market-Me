CREATE TABLE workspace_ai_routing_preference (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN (
    'understand_content',
    'prepare_copy',
    'plan_campaign',
    'discover_profiles_and_content',
    'draft_eligible_interaction',
    'review_rules_rights_and_claims',
    'evaluate_results_and_experiments'
  )),
  provider text NOT NULL CHECK (
    char_length(provider) BETWEEN 1 AND 100 AND provider = btrim(provider)
  ),
  model text NOT NULL CHECK (
    char_length(model) BETWEEN 1 AND 100 AND model = btrim(model)
  ),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, action),
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, updated_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX workspace_ai_routing_preference_updated_idx
  ON workspace_ai_routing_preference(workspace_id, updated_at DESC, action);
