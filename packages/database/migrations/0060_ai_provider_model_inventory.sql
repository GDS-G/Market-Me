CREATE TABLE workspace_ai_provider_model (
  workspace_id uuid NOT NULL,
  provider text NOT NULL CHECK (
    provider IN ('openai', 'anthropic', 'google_generative_ai')
  ),
  model_id text NOT NULL CHECK (
    char_length(model_id) BETWEEN 1 AND 512 AND model_id = btrim(model_id)
  ),
  display_name text CHECK (
    display_name IS NULL OR (
      char_length(display_name) BETWEEN 1 AND 200 AND display_name = btrim(display_name)
    )
  ),
  input_token_limit integer CHECK (
    input_token_limit IS NULL OR input_token_limit BETWEEN 1 AND 100000000
  ),
  output_token_limit integer CHECK (
    output_token_limit IS NULL OR output_token_limit BETWEEN 1 AND 100000000
  ),
  provider_created_at timestamptz,
  credential_fingerprint text NOT NULL CHECK (
    credential_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider, model_id),
  FOREIGN KEY (workspace_id, provider)
    REFERENCES workspace_ai_provider_connection(workspace_id, provider)
    ON DELETE CASCADE,
  CHECK (last_seen_at >= first_seen_at),
  CHECK (retired_at IS NULL OR retired_at >= last_seen_at)
);

CREATE INDEX workspace_ai_provider_model_active_idx
  ON workspace_ai_provider_model(workspace_id, provider, last_seen_at DESC, model_id)
  WHERE retired_at IS NULL;

CREATE INDEX workspace_ai_provider_model_retired_idx
  ON workspace_ai_provider_model(workspace_id, provider, retired_at DESC, model_id)
  WHERE retired_at IS NOT NULL;
