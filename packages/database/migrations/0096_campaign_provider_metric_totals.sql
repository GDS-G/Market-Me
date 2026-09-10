CREATE TABLE campaign_provider_metric_total (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  campaign_instance_id uuid NOT NULL REFERENCES campaign_instance(id) ON DELETE CASCADE,
  publication_action_id uuid NOT NULL REFERENCES publication_action(id) ON DELETE CASCADE,
  report_snapshot_id uuid NOT NULL REFERENCES mailchimp_campaign_report_snapshot(id) ON DELETE CASCADE,
  metric_type text NOT NULL CHECK (metric_type IN (
    'email_sent', 'email_unique_open', 'email_unique_click',
    'email_unsubscribe', 'email_bounce', 'email_complaint'
  )),
  metric_total bigint NOT NULL CHECK (metric_total >= 0),
  observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (publication_action_id, metric_type)
);

CREATE INDEX campaign_provider_metric_total_instance_idx
  ON campaign_provider_metric_total(workspace_id, campaign_instance_id, metric_type);
