ALTER TABLE workspace_ai_text_invocation_attempt
  ADD CONSTRAINT workspace_ai_text_invocation_attempt_id_workspace_unique
  UNIQUE (id, workspace_id);

ALTER TABLE ai_usage_event
  ADD CONSTRAINT ai_usage_event_id_workspace_unique UNIQUE (id, workspace_id);

CREATE TABLE workspace_ai_text_output_artifact (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL UNIQUE,
  intent_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google_generative_ai')),
  model_id text NOT NULL CHECK (char_length(model_id) BETWEEN 1 AND 200),
  encrypted_output text NOT NULL CHECK (
    char_length(encrypted_output) BETWEEN 10 AND 800000 AND encrypted_output LIKE 'v1.%'
  ),
  encryption_key_version text NOT NULL CHECK (encryption_key_version = 'v1'),
  output_sha256 text NOT NULL CHECK (output_sha256 ~ '^[0-9a-f]{64}$'),
  character_count integer NOT NULL CHECK (character_count BETWEEN 0 AND 400000),
  status text NOT NULL CHECK (status IN ('pending_review', 'accepted', 'discarded')),
  created_by uuid NOT NULL,
  reviewed_by uuid,
  review_note text CHECK (review_note IS NULL OR (
    char_length(review_note) BETWEEN 1 AND 1000 AND review_note = btrim(review_note)
  )),
  created_at timestamptz NOT NULL,
  reviewed_at timestamptz,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (attempt_id, workspace_id)
    REFERENCES workspace_ai_text_invocation_attempt(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (intent_id, workspace_id, provider)
    REFERENCES workspace_ai_text_invocation_intent(id, workspace_id, provider) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, reviewed_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workspace_ai_text_output_artifact_state_check CHECK (
    (status = 'pending_review' AND reviewed_by IS NULL AND review_note IS NULL AND reviewed_at IS NULL) OR
    (status IN ('accepted', 'discarded') AND reviewed_by IS NOT NULL AND review_note IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX workspace_ai_text_output_artifact_id_workspace_idx
  ON workspace_ai_text_output_artifact(id, workspace_id);
CREATE INDEX workspace_ai_text_output_artifact_review_idx
  ON workspace_ai_text_output_artifact(workspace_id, status, created_at DESC, id DESC);

ALTER TABLE ai_usage_event
  ADD COLUMN text_invocation_attempt_id uuid,
  ADD CONSTRAINT ai_usage_event_text_attempt_workspace_fk
    FOREIGN KEY (text_invocation_attempt_id, workspace_id)
    REFERENCES workspace_ai_text_invocation_attempt(id, workspace_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX ai_usage_event_one_per_text_attempt_idx
  ON ai_usage_event(text_invocation_attempt_id)
  WHERE text_invocation_attempt_id IS NOT NULL;

CREATE TABLE workspace_ai_text_invocation_reconciliation (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL UNIQUE,
  reservation_id uuid NOT NULL,
  rate_card_id uuid NOT NULL REFERENCES ai_provider_rate_card(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('settled', 'quarantined')),
  reason text CHECK (reason IS NULL OR reason IN (
    'missing_usage', 'unsupported_rate_card', 'cost_exceeds_authorization'
  )),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  actual_cost_minor integer CHECK (actual_cost_minor BETWEEN 0 AND 1000000000),
  input_tokens integer CHECK (input_tokens BETWEEN 0 AND 1000000000),
  output_tokens integer CHECK (output_tokens BETWEEN 0 AND 1000000000),
  usage_event_id uuid,
  reconciled_by uuid NOT NULL,
  reconciled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (attempt_id, workspace_id)
    REFERENCES workspace_ai_text_invocation_attempt(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (reservation_id, workspace_id)
    REFERENCES ai_spend_reservation(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (usage_event_id, workspace_id)
    REFERENCES ai_usage_event(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, reconciled_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workspace_ai_text_invocation_reconciliation_state_check CHECK (
    (status = 'settled' AND reason IS NULL AND actual_cost_minor IS NOT NULL AND
      input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND usage_event_id IS NOT NULL) OR
    (status = 'quarantined' AND reason IS NOT NULL AND usage_event_id IS NULL)
  )
);

CREATE INDEX workspace_ai_text_invocation_reconciliation_recent_idx
  ON workspace_ai_text_invocation_reconciliation(workspace_id, created_at DESC, id DESC);
