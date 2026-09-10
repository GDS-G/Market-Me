CREATE TABLE workspace_ai_adapter_registration (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  candidate_id uuid NOT NULL UNIQUE REFERENCES workspace_ai_adapter_candidate(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (
    provider IN ('openai', 'anthropic', 'google_generative_ai')
  ),
  model_id text NOT NULL,
  status text NOT NULL DEFAULT 'registered' CHECK (
    status IN ('registered', 'retired')
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
  source_credential_fingerprint text NOT NULL CHECK (
    source_credential_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  registered_by uuid NOT NULL,
  retired_by uuid,
  retirement_reason text CHECK (
    retirement_reason IS NULL OR (
      char_length(retirement_reason) BETWEEN 1 AND 500 AND
      retirement_reason = btrim(retirement_reason)
    )
  ),
  registered_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider, model_id),
  FOREIGN KEY (workspace_id, provider, model_id)
    REFERENCES workspace_ai_adapter_candidate(workspace_id, provider, model_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, registered_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, retired_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (
    (status = 'registered' AND retired_by IS NULL AND retirement_reason IS NULL AND retired_at IS NULL) OR
    (status = 'retired' AND retired_by IS NOT NULL AND retirement_reason IS NOT NULL AND retired_at IS NOT NULL)
  )
);

CREATE TABLE workspace_ai_adapter_registration_capability (
  registration_id uuid NOT NULL REFERENCES workspace_ai_adapter_registration(id) ON DELETE CASCADE,
  capability text NOT NULL CHECK (capability IN (
    'generate_text', 'generate_structured_output', 'analyze_image',
    'transcribe', 'embed', 'rerank', 'moderate', 'use_tools'
  )),
  PRIMARY KEY (registration_id, capability)
);

CREATE INDEX workspace_ai_adapter_registration_status_idx
  ON workspace_ai_adapter_registration(workspace_id, status, updated_at DESC, id);

CREATE INDEX workspace_ai_adapter_registration_capability_idx
  ON workspace_ai_adapter_registration_capability(capability, registration_id);
