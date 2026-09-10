ALTER TABLE mailchimp_campaign_report_snapshot
  ADD COLUMN audience_id text;

UPDATE mailchimp_campaign_report_snapshot snapshot
SET audience_id = connection.configuration->>'audienceId'
FROM publication_action action
JOIN channel_connection connection
  ON connection.id = action.channel_connection_id
  AND connection.workspace_id = action.workspace_id
  AND connection.provider = 'mailchimp_email'
WHERE action.id = snapshot.publication_action_id
  AND action.workspace_id = snapshot.workspace_id;

ALTER TABLE mailchimp_campaign_report_snapshot
  ALTER COLUMN audience_id SET NOT NULL,
  ADD CONSTRAINT mailchimp_campaign_report_snapshot_audience_id_check
    CHECK (audience_id ~ '^[A-Za-z0-9_-]{1,64}$');
