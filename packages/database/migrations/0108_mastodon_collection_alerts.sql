CREATE TABLE mastodon_status_report_collection_alert (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  alert_type text NOT NULL CHECK (alert_type IN ('overdue', 'abandoned')),
  status text NOT NULL CHECK (status IN ('active', 'resolved')),
  affected_count integer NOT NULL CHECK (affected_count > 0),
  oldest_at timestamptz NOT NULL,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK ((status = 'active' AND resolved_at IS NULL) OR (status = 'resolved' AND resolved_at IS NOT NULL))
);

CREATE UNIQUE INDEX mastodon_status_report_collection_alert_one_active_idx
  ON mastodon_status_report_collection_alert(workspace_id, alert_type)
  WHERE status = 'active';

CREATE INDEX mastodon_status_report_collection_alert_workspace_idx
  ON mastodon_status_report_collection_alert(workspace_id, status, last_detected_at DESC);
