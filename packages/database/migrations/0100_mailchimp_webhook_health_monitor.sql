CREATE TABLE mailchimp_webhook_health_state (
  connection_id uuid PRIMARY KEY REFERENCES channel_connection(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  audience_id text NOT NULL,
  expected_callback_url text NOT NULL,
  provider_webhook_id text NOT NULL,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  attempt_count bigint NOT NULL DEFAULT 0,
  last_checked_at timestamptz,
  last_health_code text,
  consecutive_failure_count bigint NOT NULL DEFAULT 0,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mailchimp_webhook_health_audience_format CHECK (audience_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT mailchimp_webhook_health_provider_id_format CHECK (provider_webhook_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT mailchimp_webhook_health_callback_format CHECK (
    length(expected_callback_url) BETWEEN 9 AND 2048 AND expected_callback_url ~ '^https://'
  ),
  CONSTRAINT mailchimp_webhook_health_attempt_count_nonnegative CHECK (attempt_count >= 0),
  CONSTRAINT mailchimp_webhook_health_failure_count_nonnegative CHECK (consecutive_failure_count >= 0),
  CONSTRAINT mailchimp_webhook_health_code_closed CHECK (
    last_health_code IS NULL OR last_health_code IN (
      'managed_active', 'managed_missing', 'managed_drifted', 'managed_secret_missing'
    )
  ),
  CONSTRAINT mailchimp_webhook_health_error_code_closed CHECK (
    last_error_code IS NULL OR last_error_code IN (
      'authorization', 'validation', 'rate_limit', 'transient', 'permanent',
      'ambiguous', 'credential_unavailable', 'unknown'
    )
  )
);

CREATE INDEX mailchimp_webhook_health_due_idx
  ON mailchimp_webhook_health_state(next_check_at, connection_id)
  WHERE claimed_at IS NULL;

INSERT INTO mailchimp_webhook_health_state (
  connection_id, workspace_id, audience_id, expected_callback_url, provider_webhook_id
)
SELECT id, workspace_id, configuration->>'webhookAudienceId',
  configuration->>'webhookCallbackUrl', configuration->>'webhookProviderId'
FROM channel_connection
WHERE provider = 'mailchimp_email' AND status = 'active'
  AND configuration->>'webhookManagement' = 'managed'
  AND configuration->>'webhookAudienceId' ~ '^[A-Za-z0-9_-]{1,64}$'
  AND configuration->>'webhookProviderId' ~ '^[A-Za-z0-9_-]{1,64}$'
  AND length(configuration->>'webhookCallbackUrl') BETWEEN 9 AND 2048
  AND configuration->>'webhookCallbackUrl' ~ '^https://';
