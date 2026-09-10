ALTER TABLE channel_connection
  DROP CONSTRAINT channel_connection_provider_check;

ALTER TABLE channel_connection
  ADD CONSTRAINT channel_connection_provider_check
  CHECK (provider IN ('discord_webhook', 'mailchimp_email'));

ALTER TABLE draft_channel_preview
  ADD COLUMN rendered_subject text,
  ADD COLUMN subject_count integer CHECK (subject_count IS NULL OR subject_count >= 0),
  ADD COLUMN subject_limit integer CHECK (subject_limit IS NULL OR subject_limit > 0),
  ADD CONSTRAINT draft_channel_preview_email_subject_check CHECK (
    provider <> 'mailchimp_email'
    OR (
      rendered_subject IS NOT NULL
      AND length(trim(rendered_subject)) > 0
      AND subject_count = length(rendered_subject)
      AND subject_limit IS NOT NULL
    )
  );

ALTER TABLE publication_action
  ADD CONSTRAINT publication_action_provider_external_id_length_check
  CHECK (provider_external_id IS NULL OR length(provider_external_id) BETWEEN 1 AND 200);
