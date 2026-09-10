CREATE TABLE workspace_ai_adapter_candidate (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  provider text NOT NULL CHECK (
    provider IN ('openai', 'anthropic', 'google_generative_ai')
  ),
  model_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'retired')
  ),
  display_name text NOT NULL CHECK (
    char_length(display_name) BETWEEN 1 AND 160 AND display_name = btrim(display_name)
  ),
  privacy_class text NOT NULL DEFAULT 'cloud' CHECK (privacy_class = 'cloud'),
  quality text NOT NULL CHECK (quality IN ('standard', 'enhanced', 'highest')),
  speed text NOT NULL CHECK (speed IN ('fast', 'balanced', 'thorough')),
  cost text NOT NULL CHECK (cost IN ('low', 'medium', 'high')),
  context_limit integer NOT NULL CHECK (context_limit BETWEEN 1 AND 2000000),
  requires_paid_reservation boolean NOT NULL DEFAULT true CHECK (requires_paid_reservation),
  evidence_reference text NOT NULL CHECK (
    char_length(evidence_reference) BETWEEN 1 AND 1000 AND
    evidence_reference = btrim(evidence_reference)
  ),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  source_credential_fingerprint text NOT NULL CHECK (
    source_credential_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  submitted_by uuid NOT NULL,
  reviewed_by uuid,
  review_note text CHECK (
    review_note IS NULL OR (
      char_length(review_note) BETWEEN 1 AND 1000 AND review_note = btrim(review_note)
    )
  ),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider, model_id),
  FOREIGN KEY (workspace_id, provider, model_id)
    REFERENCES workspace_ai_provider_model(workspace_id, provider, model_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, submitted_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, reviewed_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_note IS NULL AND retired_at IS NULL) OR
    (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_note IS NOT NULL AND retired_at IS NULL) OR
    (status = 'retired' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_note IS NOT NULL AND retired_at IS NOT NULL)
  )
);

CREATE TABLE workspace_ai_adapter_candidate_capability (
  candidate_id uuid NOT NULL REFERENCES workspace_ai_adapter_candidate(id) ON DELETE CASCADE,
  capability text NOT NULL CHECK (capability IN (
    'generate_text', 'generate_structured_output', 'analyze_image',
    'transcribe', 'embed', 'rerank', 'moderate', 'use_tools'
  )),
  PRIMARY KEY (candidate_id, capability)
);

CREATE INDEX workspace_ai_adapter_candidate_status_idx
  ON workspace_ai_adapter_candidate(workspace_id, status, updated_at DESC, id);

CREATE INDEX workspace_ai_adapter_candidate_capability_idx
  ON workspace_ai_adapter_candidate_capability(capability, candidate_id);
