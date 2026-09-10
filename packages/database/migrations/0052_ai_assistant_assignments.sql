CREATE TABLE workspace_ai_assistant_assignment (
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
  assistant_profile_id text NOT NULL CHECK (assistant_profile_id IN (
    'content_analyst',
    'copy_assistant',
    'campaign_planner',
    'discovery_assistant',
    'conversation_assistant',
    'compliance_reviewer',
    'performance_analyst'
  )),
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

CREATE INDEX workspace_ai_assistant_assignment_updated_idx
  ON workspace_ai_assistant_assignment(workspace_id, updated_at DESC, action);
