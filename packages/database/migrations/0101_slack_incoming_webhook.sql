ALTER TABLE channel_connection
  DROP CONSTRAINT channel_connection_provider_check;

ALTER TABLE channel_connection
  ADD CONSTRAINT channel_connection_provider_check
  CHECK (provider IN ('discord_webhook', 'mailchimp_email', 'slack_webhook'));

ALTER TABLE channel_connection
  ADD CONSTRAINT channel_connection_slack_configuration_check
  CHECK (
    provider <> 'slack_webhook'
    OR (
      configuration->>'teamId' ~ '^[A-Z0-9]{6,32}$'
      AND configuration->>'serviceId' ~ '^[A-Z0-9]{6,32}$'
      AND configuration->>'host' IN ('hooks.slack.com', 'hooks.slack-gov.com')
      AND capabilities->>'provider' = 'slack_webhook'
      AND capabilities #>> '{supportedActions,publish_content}' = 'true'
      AND capabilities #>> '{features,providerMessageIdentity}' = 'false'
    )
  );
