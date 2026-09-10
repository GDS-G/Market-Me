CREATE TABLE content_asset_rights_campaign (
  content_asset_id uuid NOT NULL REFERENCES content_asset(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (content_asset_id, campaign_id),
  CONSTRAINT content_asset_rights_campaign_campaign_fk
    FOREIGN KEY (campaign_id) REFERENCES campaign(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX content_asset_rights_campaign_reverse_idx
  ON content_asset_rights_campaign(campaign_id, content_asset_id);

ALTER TABLE draft_channel_preview_asset
  ADD COLUMN rights_campaign_id uuid,
  ADD CONSTRAINT draft_preview_asset_rights_campaign_fk
    FOREIGN KEY (rights_campaign_id) REFERENCES campaign(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

UPDATE draft_channel_preview_asset
SET rights_status = 'unchecked', rights_revision = 0,
  rights_reviewed_at = NULL, rights_expires_at = NULL,
  rights_channel_connection_id = NULL
WHERE rights_status = 'cleared';

ALTER TABLE draft_channel_preview_asset
  DROP CONSTRAINT draft_preview_asset_rights_revision_check,
  ADD CONSTRAINT draft_preview_asset_rights_revision_check
    CHECK (
      (rights_status = 'unchecked' AND rights_revision = 0
        AND rights_channel_connection_id IS NULL AND rights_campaign_id IS NULL)
      OR (rights_status = 'cleared' AND rights_revision > 0
        AND rights_reviewed_at IS NOT NULL
        AND rights_channel_connection_id IS NOT NULL
        AND rights_campaign_id IS NOT NULL)
    );
