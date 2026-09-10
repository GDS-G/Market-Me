ALTER TABLE channel_connection
  DROP CONSTRAINT channel_connection_provider_check;

ALTER TABLE channel_connection
  ADD CONSTRAINT channel_connection_provider_check
  CHECK (provider IN ('discord_webhook', 'mailchimp_email', 'slack_webhook', 'mastodon_account'));

ALTER TABLE channel_connection
  ADD CONSTRAINT channel_connection_mastodon_configuration_check
  CHECK (
    provider <> 'mastodon_account'
    OR (
      configuration->>'host' ~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
      AND configuration->>'host' = lower(configuration->>'host')
      AND configuration->>'instanceOrigin' = ('https://' || (configuration->>'host'))
      AND length(configuration->>'accountId') BETWEEN 1 AND 500
      AND length(configuration->>'username') BETWEEN 1 AND 500
      AND length(configuration->>'acct') BETWEEN 1 AND 500
      AND jsonb_typeof(configuration->'maxCharacters') = 'number'
      AND (configuration->>'maxCharacters')::integer BETWEEN 1 AND 100000
      AND capabilities->>'provider' = 'mastodon_account'
      AND capabilities #>> '{supportedActions,publish_content}' = 'true'
      AND capabilities #>> '{features,providerMessageIdentity}' = 'true'
      AND capabilities #>> '{features,providerIdempotency}' = 'true'
      AND capabilities #>> '{limits,attachmentsPerMessage}' = '0'
      AND capabilities #>> '{limits,contentCharacters}' = configuration->>'maxCharacters'
    )
  );
