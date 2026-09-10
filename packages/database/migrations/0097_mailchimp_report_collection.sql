CREATE TABLE mailchimp_report_collection_state (
  publication_action_id uuid PRIMARY KEY REFERENCES publication_action(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  next_attempt_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claimed_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code IN (
    'authorization', 'validation', 'rate_limit', 'transient', 'permanent',
    'ambiguous', 'credential_unavailable', 'unknown'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mailchimp_report_collection_due_idx
  ON mailchimp_report_collection_state(next_attempt_at, publication_action_id)
  WHERE claimed_at IS NULL;

INSERT INTO mailchimp_report_collection_state (
  publication_action_id, workspace_id, next_attempt_at
)
SELECT action.id, action.workspace_id, GREATEST(action.started_at + interval '5 minutes', now())
FROM publication_action action
JOIN channel_connection connection ON connection.id = action.channel_connection_id
WHERE connection.provider = 'mailchimp_email'
  AND action.provider_external_id IS NOT NULL
ON CONFLICT (publication_action_id) DO NOTHING;
