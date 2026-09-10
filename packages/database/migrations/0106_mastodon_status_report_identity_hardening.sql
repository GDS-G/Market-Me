ALTER TABLE mastodon_status_report_snapshot
  ADD COLUMN provider_status_url text;

UPDATE mastodon_status_report_snapshot snapshot
SET provider_status_url = action.provider_url
FROM publication_action action
WHERE action.id = snapshot.publication_action_id
  AND action.workspace_id = snapshot.workspace_id;

ALTER TABLE mastodon_status_report_snapshot
  ALTER COLUMN provider_status_url SET NOT NULL,
  ADD CONSTRAINT mastodon_status_report_snapshot_status_url_check CHECK (
    length(provider_status_url) BETWEEN 10 AND 2048
    AND provider_status_url ~ '^https://[^/?#@]+/[^[:cntrl:]]+$'
  );
