CREATE TABLE IF NOT EXISTS conversation_routing_rule (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  brand_profile_id uuid,
  channel_connection_id uuid,
  relationship_stage text,
  intent text,
  urgency text,
  target_owner_id uuid,
  target_status text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (brand_profile_id, workspace_id)
    REFERENCES brand_profile(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (channel_connection_id, workspace_id)
    REFERENCES channel_connection(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, target_owner_id)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT conversation_routing_rule_name_check CHECK (
    length(btrim(name)) BETWEEN 1 AND 200
  ),
  CONSTRAINT conversation_routing_rule_priority_check CHECK (
    priority BETWEEN 0 AND 1000
  ),
  CONSTRAINT conversation_routing_rule_matcher_check CHECK (
    brand_profile_id IS NOT NULL
    OR channel_connection_id IS NOT NULL
    OR relationship_stage IS NOT NULL
    OR intent IS NOT NULL
    OR urgency IS NOT NULL
  ),
  CONSTRAINT conversation_routing_rule_relationship_stage_check CHECK (
    relationship_stage IS NULL OR relationship_stage IN (
      'unknown', 'discovered', 'new_contact', 'engaged',
      'active_conversation', 'lead', 'customer', 'partner',
      'collaborator', 'community_member', 'inactive'
    )
  ),
  CONSTRAINT conversation_routing_rule_intent_check CHECK (
    intent IS NULL OR intent IN (
      'unknown', 'praise', 'question', 'support', 'availability',
      'sales', 'complaint', 'collaboration', 'media_inquiry', 'other'
    )
  ),
  CONSTRAINT conversation_routing_rule_urgency_check CHECK (
    urgency IS NULL OR urgency IN (
      'unknown', 'low', 'normal', 'high', 'critical'
    )
  ),
  CONSTRAINT conversation_routing_rule_target_status_check CHECK (
    target_status IN (
      'new', 'unassigned', 'ai_managed', 'assigned',
      'waiting_internal_information', 'waiting_contact',
      'scheduled_follow_up', 'resolved', 'archived'
    )
  ),
  CONSTRAINT conversation_routing_rule_target_assignment_check CHECK (
    (target_status = 'assigned' AND target_owner_id IS NOT NULL)
    OR (target_status <> 'assigned' AND target_owner_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_routing_rule_workspace_name_idx
  ON conversation_routing_rule(workspace_id, lower(name));

CREATE INDEX IF NOT EXISTS conversation_routing_rule_evaluation_idx
  ON conversation_routing_rule(workspace_id, enabled, priority DESC, updated_at DESC);
