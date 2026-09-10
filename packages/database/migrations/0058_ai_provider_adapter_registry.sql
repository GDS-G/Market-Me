CREATE TABLE ai_provider_adapter (
  provider text NOT NULL CHECK (
    char_length(provider) BETWEEN 1 AND 100 AND provider = btrim(provider)
  ),
  model text NOT NULL CHECK (
    char_length(model) BETWEEN 1 AND 100 AND model = btrim(model)
  ),
  display_name text NOT NULL CHECK (
    char_length(display_name) BETWEEN 1 AND 160 AND display_name = btrim(display_name)
  ),
  privacy_class text NOT NULL CHECK (
    privacy_class IN ('local', 'private_cloud', 'cloud')
  ),
  quality text NOT NULL CHECK (
    quality IN ('standard', 'enhanced', 'highest')
  ),
  speed text NOT NULL CHECK (
    speed IN ('fast', 'balanced', 'thorough')
  ),
  cost text NOT NULL CHECK (cost IN ('low', 'medium', 'high')),
  context_limit integer NOT NULL CHECK (context_limit BETWEEN 1 AND 2000000),
  is_available boolean NOT NULL DEFAULT false,
  is_approved boolean NOT NULL DEFAULT false,
  requires_paid_reservation boolean NOT NULL DEFAULT true,
  availability_reason text CHECK (
    availability_reason IS NULL OR (
      char_length(availability_reason) BETWEEN 1 AND 500 AND
      availability_reason = btrim(availability_reason)
    )
  ),
  configuration_source text NOT NULL CHECK (
    configuration_source IN ('built_in', 'administrator')
  ),
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, model),
  CHECK (is_available OR availability_reason IS NOT NULL)
);

CREATE TABLE ai_provider_adapter_capability (
  provider text NOT NULL,
  model text NOT NULL,
  capability text NOT NULL CHECK (capability IN (
    'generate_text',
    'generate_structured_output',
    'analyze_image',
    'transcribe',
    'embed',
    'rerank',
    'moderate',
    'use_tools'
  )),
  PRIMARY KEY (provider, model, capability),
  FOREIGN KEY (provider, model)
    REFERENCES ai_provider_adapter(provider, model) ON DELETE CASCADE
);

CREATE INDEX ai_provider_adapter_status_idx
  ON ai_provider_adapter(is_approved, is_available, updated_at DESC, provider, model);

CREATE INDEX ai_provider_adapter_capability_idx
  ON ai_provider_adapter_capability(capability, provider, model);

INSERT INTO ai_provider_adapter (
  provider, model, display_name, privacy_class, quality, speed, cost,
  context_limit, is_available, is_approved, requires_paid_reservation,
  configuration_source, verified_at, created_at, updated_at
) VALUES (
  'market-me', 'grounded-template', 'Market Me grounded templates',
  'local', 'standard', 'fast', 'low', 32000, true, true, false,
  'built_in', TIMESTAMPTZ '2026-08-11 00:00:00+00',
  TIMESTAMPTZ '2026-08-11 00:00:00+00', TIMESTAMPTZ '2026-08-11 00:00:00+00'
);

INSERT INTO ai_provider_adapter_capability (provider, model, capability) VALUES
  ('market-me', 'grounded-template', 'generate_text'),
  ('market-me', 'grounded-template', 'generate_structured_output');

ALTER TABLE workspace_ai_routing_preference
  ADD CONSTRAINT workspace_ai_routing_preference_adapter_fk
  FOREIGN KEY (provider, model)
  REFERENCES ai_provider_adapter(provider, model) ON DELETE RESTRICT;
