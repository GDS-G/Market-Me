CREATE TABLE conversation_response_suggestion (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  conversation_thread_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  recommendation text NOT NULL,
  summary text NOT NULL,
  identified_questions text[] NOT NULL DEFAULT '{}',
  response_text text,
  uncertainty numeric(4,3) NOT NULL,
  uncertainty_reasons text[] NOT NULL DEFAULT '{}',
  recommended_promotional_strength text NOT NULL,
  proposed_destination_id uuid,
  context_snapshot jsonb NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  claims jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_fingerprint text NOT NULL,
  generator_provider text NOT NULL,
  generator_model text NOT NULL,
  generator_version text NOT NULL,
  prompt_version text NOT NULL,
  generated_by uuid NOT NULL,
  dismissed_by uuid,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (conversation_thread_id, workspace_id)
    REFERENCES conversation_thread(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (proposed_destination_id, workspace_id)
    REFERENCES destination(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, generated_by)
    REFERENCES workspace_membership(workspace_id, user_id),
  FOREIGN KEY (workspace_id, dismissed_by)
    REFERENCES workspace_membership(workspace_id, user_id),
  CONSTRAINT conversation_response_suggestion_status_check
    CHECK (status IN ('active', 'dismissed', 'superseded')),
  CONSTRAINT conversation_response_suggestion_recommendation_check
    CHECK (recommendation IN ('respond', 'clarify', 'no_response', 'human_review')),
  CONSTRAINT conversation_response_suggestion_summary_check
    CHECK (length(trim(summary)) BETWEEN 1 AND 2000),
  CONSTRAINT conversation_response_suggestion_questions_check
    CHECK (cardinality(identified_questions) <= 5),
  CONSTRAINT conversation_response_suggestion_response_check CHECK (
    (recommendation IN ('respond', 'clarify')
      AND response_text IS NOT NULL
      AND length(trim(response_text)) BETWEEN 1 AND 5000)
    OR
    (recommendation IN ('no_response', 'human_review')
      AND response_text IS NULL)
  ),
  CONSTRAINT conversation_response_suggestion_uncertainty_check
    CHECK (uncertainty >= 0 AND uncertainty <= 1),
  CONSTRAINT conversation_response_suggestion_uncertainty_reasons_check
    CHECK (cardinality(uncertainty_reasons) BETWEEN 1 AND 10),
  CONSTRAINT conversation_response_suggestion_promotion_check CHECK (
    recommended_promotional_strength IN (
      'informational', 'subtle', 'light', 'standard',
      'strong', 'campaign_push', 'custom'
    )
  ),
  CONSTRAINT conversation_response_suggestion_destination_check CHECK (
    proposed_destination_id IS NULL OR recommendation = 'respond'
  ),
  CONSTRAINT conversation_response_suggestion_snapshot_check
    CHECK (jsonb_typeof(context_snapshot) = 'object'),
  CONSTRAINT conversation_response_suggestion_citations_check
    CHECK (jsonb_typeof(citations) = 'array'),
  CONSTRAINT conversation_response_suggestion_claims_check
    CHECK (jsonb_typeof(claims) = 'array'),
  CONSTRAINT conversation_response_suggestion_fingerprint_check
    CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT conversation_response_suggestion_review_check CHECK (
    (status = 'dismissed' AND dismissed_by IS NOT NULL AND dismissed_at IS NOT NULL)
    OR
    (status IN ('active', 'superseded') AND dismissed_by IS NULL AND dismissed_at IS NULL)
  )
);

CREATE UNIQUE INDEX conversation_response_suggestion_active_idx
  ON conversation_response_suggestion(workspace_id, conversation_thread_id)
  WHERE status = 'active';

CREATE INDEX conversation_response_suggestion_thread_time_idx
  ON conversation_response_suggestion(
    workspace_id, conversation_thread_id, created_at DESC, id
  );
