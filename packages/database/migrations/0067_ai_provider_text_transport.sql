ALTER TABLE ai_provider_invocation_contract
  ADD COLUMN transport_available boolean NOT NULL DEFAULT false,
  ADD COLUMN transport_version text,
  ADD COLUMN endpoint_policy text;

ALTER TABLE ai_provider_invocation_contract
  ADD CONSTRAINT ai_provider_invocation_contract_transport_state_check CHECK (
    (transport_available = false AND transport_version IS NULL AND endpoint_policy IS NULL) OR
    (transport_available = true AND
      transport_version ~ '^[a-z0-9][a-z0-9._-]{0,99}$' AND
      endpoint_policy ~ '^[a-z0-9][a-z0-9._-]{0,99}$')
  );

UPDATE ai_provider_invocation_contract
SET status = 'retired', updated_at = now()
WHERE contract_version = 'contract-v2' AND status = 'approved';

INSERT INTO ai_provider_invocation_contract (
  id, provider, contract_key, contract_version, status, transport,
  credential_mode, request_schema_version, response_schema_version,
  source_reference, source_hash, implementation_available,
  codec_available, codec_version, transport_available, transport_version,
  endpoint_policy, reviewed_at
) VALUES
(
  '00000000-0000-4000-8000-000000000731', 'openai',
  'openai-hosted-json', 'contract-v3', 'approved', 'https_json',
  'bearer_api_key', 'text-request-v1', 'text-response-v1',
  'market-me://invocation-contracts/openai-hosted-json/contract-v3',
  '49452d6ab67a23e1b960ae00900e1af15384033bd7863a3c0c683e8b2a393704',
  false, true, 'text-codec-v1', true, 'fixed-https-text-v1',
  'openai-responses-v1', '2026-08-11T00:00:00.000Z'
),
(
  '00000000-0000-4000-8000-000000000732', 'anthropic',
  'anthropic-hosted-json', 'contract-v3', 'approved', 'https_json',
  'api_key_header', 'text-request-v1', 'text-response-v1',
  'market-me://invocation-contracts/anthropic-hosted-json/contract-v3',
  '2a2ed66a5672c05db7c95efae74f9dc2ac8a97f463babfbd74f6994e62cc894d',
  false, true, 'text-codec-v1', true, 'fixed-https-text-v1',
  'anthropic-messages-v1', '2026-08-11T00:00:00.000Z'
),
(
  '00000000-0000-4000-8000-000000000733', 'google_generative_ai',
  'google-generative-ai-hosted-json', 'contract-v3', 'approved', 'https_json',
  'api_key_header', 'text-request-v1', 'text-response-v1',
  'market-me://invocation-contracts/google-generative-ai-hosted-json/contract-v3',
  '45cfdcd21a0954401de98ad6e57435fb17f0f878698a0958e1d5f4148728b83a',
  false, true, 'text-codec-v1', true, 'fixed-https-text-v1',
  'google-generate-content-v1', '2026-08-11T00:00:00.000Z'
);
