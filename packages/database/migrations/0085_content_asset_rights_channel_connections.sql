CREATE TABLE content_asset_rights_channel_connection (
  content_asset_id uuid NOT NULL REFERENCES content_asset(id) ON DELETE CASCADE,
  channel_connection_id uuid NOT NULL REFERENCES channel_connection(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (content_asset_id, channel_connection_id)
);

CREATE INDEX content_asset_rights_channel_connection_reverse_idx
  ON content_asset_rights_channel_connection(channel_connection_id, content_asset_id);

-- Release 0.95 clearances named only a provider and could therefore authorize
-- every account of that provider. Revoke them until an operator selects exact
-- workspace Channel Connections and records a new rights revision.
UPDATE content_asset
SET rights_status = 'restricted', rights_revision = rights_revision + 1
WHERE rights_status = 'cleared';

ALTER TABLE draft_channel_preview_asset
  ADD COLUMN rights_channel_connection_id uuid
    REFERENCES channel_connection(id) ON DELETE RESTRICT;

UPDATE draft_channel_preview_asset
SET rights_status = 'unchecked', rights_revision = 0,
  rights_reviewed_at = NULL, rights_expires_at = NULL
WHERE rights_status = 'cleared';

ALTER TABLE draft_channel_preview_asset
  DROP CONSTRAINT draft_preview_asset_rights_revision_check,
  ADD CONSTRAINT draft_preview_asset_rights_revision_check
    CHECK (
      (rights_status = 'unchecked' AND rights_revision = 0
        AND rights_channel_connection_id IS NULL)
      OR (rights_status = 'cleared' AND rights_revision > 0
        AND rights_reviewed_at IS NOT NULL
        AND rights_channel_connection_id IS NOT NULL)
    );
