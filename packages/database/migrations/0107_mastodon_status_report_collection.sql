CREATE TABLE mastodon_status_report_collection_state (
  publication_action_id uuid PRIMARY KEY REFERENCES publication_action(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  provider_status_id text NOT NULL CHECK (length(provider_status_id) BETWEEN 1 AND 500 AND provider_status_id !~ '[[:cntrl:]]'),
  provider_account_id text NOT NULL CHECK (length(provider_account_id) BETWEEN 1 AND 500 AND provider_account_id !~ '[[:cntrl:]]'),
  provider_status_url text NOT NULL CHECK (
    length(provider_status_url) BETWEEN 10 AND 2048
    AND provider_status_url ~ '^https://[^/?#@]+/[^[:cntrl:]]+$'
  ),
  instance_origin text NOT NULL CHECK (
    length(instance_origin) BETWEEN 9 AND 2048
    AND instance_origin ~ '^https://[^/?#@:]+$'
  ),
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

CREATE INDEX mastodon_status_report_collection_due_idx
  ON mastodon_status_report_collection_state(next_attempt_at, publication_action_id)
  WHERE claimed_at IS NULL;

INSERT INTO mastodon_status_report_collection_state (
  publication_action_id, workspace_id, provider_status_id, provider_account_id,
  provider_status_url, instance_origin, next_attempt_at
)
SELECT action.id, action.workspace_id, action.provider_external_id,
  COALESCE(
    NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,accountId}', ''),
    connection.configuration->>'accountId'
  ),
  action.provider_url,
  COALESCE(
    NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,instanceOrigin}', ''),
    connection.configuration->>'instanceOrigin'
  ),
  GREATEST(COALESCE(action.completed_at, action.started_at) + interval '5 minutes', now())
FROM publication_action action
JOIN channel_connection connection ON connection.id = action.channel_connection_id
  AND connection.workspace_id = action.workspace_id
WHERE connection.provider = 'mastodon_account'
  AND action.status = 'succeeded'
  AND action.provider_external_id IS NOT NULL
  AND action.provider_url IS NOT NULL
  AND COALESCE(
    NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,accountId}', ''),
    connection.configuration->>'accountId'
  ) IS NOT NULL
  AND COALESCE(
    NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,instanceOrigin}', ''),
    connection.configuration->>'instanceOrigin'
  ) IS NOT NULL
ON CONFLICT (publication_action_id) DO NOTHING;
