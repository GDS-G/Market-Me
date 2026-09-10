ALTER TABLE ai_provider_invocation_contract
  ADD COLUMN codec_available boolean NOT NULL DEFAULT false,
  ADD COLUMN codec_version text;

ALTER TABLE ai_provider_invocation_contract
  ADD CONSTRAINT ai_provider_invocation_contract_codec_state_check CHECK (
    (codec_available = false AND codec_version IS NULL) OR
    (codec_available = true AND codec_version ~ '^[a-z0-9][a-z0-9._-]{0,99}$')
  );

UPDATE ai_provider_invocation_contract
SET status = 'retired', updated_at = now()
WHERE contract_version = 'contract-v1' AND status = 'approved';

INSERT INTO ai_provider_invocation_contract (
  id, provider, contract_key, contract_version, status, transport,
  credential_mode, request_schema_version, response_schema_version,
  source_reference, source_hash, implementation_available,
  codec_available, codec_version, reviewed_at
) VALUES
(
  '00000000-0000-4000-8000-000000000721', 'openai',
  'openai-hosted-json', 'contract-v2', 'approved', 'https_json',
  'bearer_api_key', 'text-request-v1', 'text-response-v1',
  'market-me://invocation-contracts/openai-hosted-json/contract-v2',
  'fdf80ddbd48af723e312f8672cda0a5ec431cbb616a0c6948a36c649b02c8e9a',
  false, true, 'text-codec-v1', '2026-08-11T00:00:00.000Z'
),
(
  '00000000-0000-4000-8000-000000000722', 'anthropic',
  'anthropic-hosted-json', 'contract-v2', 'approved', 'https_json',
  'api_key_header', 'text-request-v1', 'text-response-v1',
  'market-me://invocation-contracts/anthropic-hosted-json/contract-v2',
  '43e6a249a5a6b3045f52b2ef64f53fb1db3fe6d5bd2dd0a7504576a59b7a4ede',
  false, true, 'text-codec-v1', '2026-08-11T00:00:00.000Z'
),
(
  '00000000-0000-4000-8000-000000000723', 'google_generative_ai',
  'google-generative-ai-hosted-json', 'contract-v2', 'approved', 'https_json',
  'api_key_header', 'text-request-v1', 'text-response-v1',
  'market-me://invocation-contracts/google-generative-ai-hosted-json/contract-v2',
  'b3c68ab7c1c085ef28093be5d9a464cab35ad7d6900a241233e154a63ec0b879',
  false, true, 'text-codec-v1', '2026-08-11T00:00:00.000Z'
);
