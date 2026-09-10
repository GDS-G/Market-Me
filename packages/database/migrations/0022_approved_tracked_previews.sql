ALTER TABLE draft_channel_preview
  DROP CONSTRAINT IF EXISTS draft_channel_preview_content_draft_version_id_channel_conn_key;

ALTER TABLE draft_channel_preview
  ADD COLUMN IF NOT EXISTS link_mode text NOT NULL DEFAULT 'canonical'
    CHECK (link_mode IN ('canonical', 'tracked'));

ALTER TABLE draft_channel_preview
  ADD CONSTRAINT draft_channel_preview_exact_render_key
  UNIQUE NULLS NOT DISTINCT (content_draft_version_id, channel_connection_id, destination_id, link_mode);

ALTER TABLE tracked_link
  ADD COLUMN IF NOT EXISTS draft_channel_preview_id uuid
    REFERENCES draft_channel_preview(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS tracked_link_one_per_preview_idx
  ON tracked_link(draft_channel_preview_id) WHERE draft_channel_preview_id IS NOT NULL;

ALTER TABLE draft_channel_preview
  ADD CONSTRAINT draft_channel_preview_tracked_destination_check
  CHECK (link_mode <> 'tracked' OR destination_id IS NOT NULL);
