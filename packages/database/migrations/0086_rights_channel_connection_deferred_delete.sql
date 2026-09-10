ALTER TABLE content_asset_rights_channel_connection
  DROP CONSTRAINT content_asset_rights_channel_connect_channel_connection_id_fkey,
  ADD CONSTRAINT content_asset_rights_channel_connection_channel_fk
    FOREIGN KEY (channel_connection_id) REFERENCES channel_connection(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE draft_channel_preview_asset
  DROP CONSTRAINT draft_channel_preview_asset_rights_channel_connection_id_fkey,
  ADD CONSTRAINT draft_preview_asset_rights_channel_connection_fk
    FOREIGN KEY (rights_channel_connection_id) REFERENCES channel_connection(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
