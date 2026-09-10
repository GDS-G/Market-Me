UPDATE channel_connection
SET capabilities = jsonb_set(capabilities, '{supportedActions,read_metrics}', 'true'::jsonb, true),
  capabilities_observed_at = now(),
  updated_at = now()
WHERE provider = 'mailchimp_email'
  AND COALESCE(capabilities #>> '{supportedActions,read_metrics}', 'false') <> 'true';
