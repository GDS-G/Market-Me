ALTER TABLE workspace_ai_adapter_registration
  ADD CONSTRAINT workspace_ai_adapter_registration_id_workspace_provider_unique
  UNIQUE (id, workspace_id, provider);

ALTER TABLE workspace_ai_adapter_rate_binding
  ADD CONSTRAINT workspace_ai_adapter_rate_binding_id_workspace_registration_unique
  UNIQUE (id, workspace_id, registration_id);

CREATE TABLE ai_provider_invocation_contract (
  id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (
    provider IN ('openai', 'anthropic', 'google_generative_ai')
  ),
  contract_key text NOT NULL CHECK (
    contract_key ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
  ),
  contract_version text NOT NULL CHECK (
    char_length(contract_version) BETWEEN 1 AND 100 AND
    contract_version = btrim(contract_version)
  ),
  status text NOT NULL CHECK (status IN ('approved', 'retired')),
  transport text NOT NULL CHECK (transport = 'https_json'),
  credential_mode text NOT NULL CHECK (
    credential_mode IN ('bearer_api_key', 'api_key_header')
  ),
  request_schema_version text NOT NULL CHECK (
    request_schema_version ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
  ),
  response_schema_version text NOT NULL CHECK (
    response_schema_version ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
  ),
  source_reference text NOT NULL CHECK (
    source_reference ~ '^market-me://invocation-contracts/' AND
    char_length(source_reference) <= 500
  ),
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  implementation_available boolean NOT NULL DEFAULT false CHECK (
    implementation_available = false
  ),
  reviewed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, contract_key, contract_version),
  UNIQUE (id, provider)
);

CREATE INDEX ai_provider_invocation_contract_status_idx
  ON ai_provider_invocation_contract(provider, status, contract_key, contract_version);

CREATE TABLE workspace_ai_adapter_invocation_binding (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  rate_binding_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  provider text NOT NULL CHECK (
    provider IN ('openai', 'anthropic', 'google_generative_ai')
  ),
  status text NOT NULL DEFAULT 'configured' CHECK (
    status IN ('configured', 'retired')
  ),
  contract_source_hash text NOT NULL CHECK (
    contract_source_hash ~ '^[0-9a-f]{64}$'
  ),
  configured_by uuid NOT NULL,
  retired_by uuid,
  retirement_reason text CHECK (
    retirement_reason IS NULL OR (
      char_length(retirement_reason) BETWEEN 1 AND 500 AND
      retirement_reason = btrim(retirement_reason)
    )
  ),
  configured_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registration_id),
  FOREIGN KEY (registration_id, workspace_id, provider)
    REFERENCES workspace_ai_adapter_registration(id, workspace_id, provider)
    ON DELETE RESTRICT,
  FOREIGN KEY (rate_binding_id, workspace_id, registration_id)
    REFERENCES workspace_ai_adapter_rate_binding(id, workspace_id, registration_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (contract_id, provider)
    REFERENCES ai_provider_invocation_contract(id, provider)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, configured_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, retired_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CHECK (
    (status = 'configured' AND retired_by IS NULL AND retirement_reason IS NULL AND retired_at IS NULL) OR
    (status = 'retired' AND retired_by IS NOT NULL AND retirement_reason IS NOT NULL AND retired_at IS NOT NULL)
  )
);

CREATE INDEX workspace_ai_adapter_invocation_binding_status_idx
  ON workspace_ai_adapter_invocation_binding(workspace_id, status, updated_at DESC, id);

CREATE INDEX workspace_ai_adapter_invocation_binding_rate_idx
  ON workspace_ai_adapter_invocation_binding(rate_binding_id, status, workspace_id);

INSERT INTO ai_provider_invocation_contract (
  id, provider, contract_key, contract_version, status, transport,
  credential_mode, request_schema_version, response_schema_version,
  source_reference, source_hash, implementation_available, reviewed_at
) VALUES
(
  '00000000-0000-4000-8000-000000000711', 'openai',
  'openai-hosted-json', 'contract-v1', 'approved', 'https_json',
  'bearer_api_key', 'request-v1', 'response-v1',
  'market-me://invocation-contracts/openai-hosted-json/contract-v1',
  '00e85979abe30df48f5fbc879f2c3b74e9e489440bee04770aa96b6c96aedbb4',
  false, '2026-08-11T00:00:00.000Z'
),
(
  '00000000-0000-4000-8000-000000000712', 'anthropic',
  'anthropic-hosted-json', 'contract-v1', 'approved', 'https_json',
  'api_key_header', 'request-v1', 'response-v1',
  'market-me://invocation-contracts/anthropic-hosted-json/contract-v1',
  '0e429e510131f1dd9d43e988baeb6fd6f50e94cadc122bde93ad3eb9824ef69f',
  false, '2026-08-11T00:00:00.000Z'
),
(
  '00000000-0000-4000-8000-000000000713', 'google_generative_ai',
  'google-generative-ai-hosted-json', 'contract-v1', 'approved', 'https_json',
  'api_key_header', 'request-v1', 'response-v1',
  'market-me://invocation-contracts/google-generative-ai-hosted-json/contract-v1',
  'abf03612640a154bf09d8bc220d52a52985672d29222b1311f0d27b3ab5ae299',
  false, '2026-08-11T00:00:00.000Z'
);
