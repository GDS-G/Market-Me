CREATE TABLE mailchimp_campaign_report_snapshot (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  publication_action_id uuid NOT NULL REFERENCES publication_action(id) ON DELETE CASCADE,
  provider_campaign_id text NOT NULL CHECK (length(provider_campaign_id) BETWEEN 1 AND 200),
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  emails_sent integer NOT NULL CHECK (emails_sent >= 0),
  opens_total integer NOT NULL CHECK (opens_total >= 0),
  unique_opens integer NOT NULL CHECK (unique_opens >= 0 AND unique_opens <= opens_total),
  clicks_total integer NOT NULL CHECK (clicks_total >= 0),
  unique_clicks integer NOT NULL CHECK (unique_clicks >= 0 AND unique_clicks <= clicks_total),
  unsubscribed integer NOT NULL CHECK (unsubscribed >= 0),
  hard_bounces integer NOT NULL CHECK (hard_bounces >= 0),
  soft_bounces integer NOT NULL CHECK (soft_bounces >= 0),
  abuse_reports integer NOT NULL CHECK (abuse_reports >= 0),
  send_time timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES app_user(id),
  UNIQUE (publication_action_id, snapshot_hash)
);

CREATE INDEX mailchimp_campaign_report_snapshot_instance_idx
  ON mailchimp_campaign_report_snapshot(workspace_id, publication_action_id, observed_at DESC);
