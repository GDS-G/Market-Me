ALTER TABLE mailchimp_report_collection_state
  ADD COLUMN audience_id text;

UPDATE mailchimp_report_collection_state state
SET audience_id = COALESCE(
  NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,audienceId}', ''),
  connection.configuration->>'audienceId'
)
FROM publication_action action
JOIN channel_connection connection
  ON connection.id = action.channel_connection_id
  AND connection.workspace_id = action.workspace_id
  AND connection.provider = 'mailchimp_email'
WHERE action.id = state.publication_action_id
  AND action.workspace_id = state.workspace_id;

ALTER TABLE mailchimp_report_collection_state
  ALTER COLUMN audience_id SET NOT NULL,
  ADD CONSTRAINT mailchimp_report_collection_state_audience_id_check
    CHECK (audience_id ~ '^[A-Za-z0-9_-]{1,64}$');
