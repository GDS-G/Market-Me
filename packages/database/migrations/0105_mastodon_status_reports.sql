CREATE TABLE mastodon_status_report_snapshot (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  publication_action_id uuid NOT NULL REFERENCES publication_action(id) ON DELETE CASCADE,
  provider_status_id text NOT NULL CHECK (length(provider_status_id) BETWEEN 1 AND 500 AND provider_status_id !~ '[[:cntrl:]]'),
  provider_account_id text NOT NULL CHECK (length(provider_account_id) BETWEEN 1 AND 500 AND provider_account_id !~ '[[:cntrl:]]'),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  replies_count bigint NOT NULL CHECK (replies_count BETWEEN 0 AND 9007199254740991),
  reblogs_count bigint NOT NULL CHECK (reblogs_count BETWEEN 0 AND 9007199254740991),
  favourites_count bigint NOT NULL CHECK (favourites_count BETWEEN 0 AND 9007199254740991),
  status_created_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES app_user(id),
  UNIQUE (publication_action_id, snapshot_hash)
);

CREATE INDEX mastodon_status_report_snapshot_instance_idx
  ON mastodon_status_report_snapshot(workspace_id, publication_action_id, observed_at DESC);

UPDATE channel_connection
SET capabilities = jsonb_set(capabilities, '{supportedActions,read_metrics}', 'true'::jsonb, true),
  capabilities_observed_at = now(),
  updated_at = now()
WHERE provider = 'mastodon_account'
  AND COALESCE(capabilities #>> '{supportedActions,read_metrics}', 'false') <> 'true';

ALTER TABLE campaign_provider_metric_total
  ALTER COLUMN report_snapshot_id DROP NOT NULL,
  ADD COLUMN mastodon_report_snapshot_id uuid REFERENCES mastodon_status_report_snapshot(id) ON DELETE CASCADE;

ALTER TABLE campaign_provider_metric_total
  DROP CONSTRAINT campaign_provider_metric_total_metric_type_check,
  ADD CONSTRAINT campaign_provider_metric_total_metric_type_check CHECK (metric_type IN (
    'email_sent', 'email_unique_open', 'email_unique_click',
    'email_unsubscribe', 'email_bounce', 'email_complaint',
    'mastodon_reply', 'mastodon_reblog', 'mastodon_favourite'
  )),
  ADD CONSTRAINT campaign_provider_metric_total_snapshot_source_check CHECK (
    (
      metric_type IN (
        'email_sent', 'email_unique_open', 'email_unique_click',
        'email_unsubscribe', 'email_bounce', 'email_complaint'
      )
      AND report_snapshot_id IS NOT NULL
      AND mastodon_report_snapshot_id IS NULL
    )
    OR
    (
      metric_type IN ('mastodon_reply', 'mastodon_reblog', 'mastodon_favourite')
      AND report_snapshot_id IS NULL
      AND mastodon_report_snapshot_id IS NOT NULL
    )
  );
