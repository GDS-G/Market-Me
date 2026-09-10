ALTER TABLE ai_provider_invocation_contract
  DROP CONSTRAINT ai_provider_invocation_contract_implementation_available_check;

ALTER TABLE ai_provider_invocation_contract
  ADD COLUMN implementation_version text;

ALTER TABLE ai_provider_invocation_contract
  ADD CONSTRAINT ai_provider_invocation_contract_implementation_state_check CHECK (
    (implementation_available = false AND implementation_version IS NULL) OR
    (implementation_available = true AND codec_available = true AND
      transport_available = true AND
      implementation_version ~ '^[a-z0-9][a-z0-9._-]{0,99}$')
  );

UPDATE ai_provider_invocation_contract
SET status = 'retired', updated_at = now()
WHERE contract_version = 'contract-v3' AND status = 'approved';

INSERT INTO ai_provider_invocation_contract (
  id, provider, contract_key, contract_version, status, transport,
  credential_mode, request_schema_version, response_schema_version,
  source_reference, source_hash, implementation_available, implementation_version,
  codec_available, codec_version, transport_available, transport_version,
  endpoint_policy, reviewed_at
) VALUES
(
  '00000000-0000-4000-8000-000000000741', 'openai',
  'openai-hosted-json', 'contract-v4', 'approved', 'https_json',
  'bearer_api_key', 'text-request-v1', 'text-response-v1',
  'market-me://invocation-contracts/openai-hosted-json/contract-v4',
  '05ac8697e4860be929dfb5087c72aee45f0386a0019920bfdf9f72f007630d33',
  true, 'hosted-text-implementation-v1', true, 'text-codec-v1',
  true, 'fixed-https-text-v1', 'openai-responses-v1', '2026-08-11T00:00:00.000Z'
),
(
  '00000000-0000-4000-8000-000000000742', 'anthropic',
  'anthropic-hosted-json', 'contract-v4', 'approved', 'https_json',
  'api_key_header', 'text-request-v1', 'text-response-v1',
  'market-me://invocation-contracts/anthropic-hosted-json/contract-v4',
  '02b9d5ea3fd2eaec96cf6f2abc0341fbc240fbdc80e3572a103e8c92f7d10605',
  true, 'hosted-text-implementation-v1', true, 'text-codec-v1',
  true, 'fixed-https-text-v1', 'anthropic-messages-v1', '2026-08-11T00:00:00.000Z'
),
(
  '00000000-0000-4000-8000-000000000743', 'google_generative_ai',
  'google-generative-ai-hosted-json', 'contract-v4', 'approved', 'https_json',
  'api_key_header', 'text-request-v1', 'text-response-v1',
  'market-me://invocation-contracts/google-generative-ai-hosted-json/contract-v4',
  'ef12cef6941877fd79638c63103aff8c5083d446091cf5f3da8bcecf9da2435a',
  true, 'hosted-text-implementation-v1', true, 'text-codec-v1',
  true, 'fixed-https-text-v1', 'google-generate-content-v1', '2026-08-11T00:00:00.000Z'
);
