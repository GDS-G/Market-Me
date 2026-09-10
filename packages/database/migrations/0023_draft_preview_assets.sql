CREATE TABLE IF NOT EXISTS draft_channel_preview_asset (
  draft_channel_preview_id uuid NOT NULL REFERENCES draft_channel_preview(id) ON DELETE CASCADE,
  content_asset_id uuid NOT NULL REFERENCES content_asset(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL CHECK (sort_order BETWEEN 0 AND 9),
  source_asset_id uuid REFERENCES content_asset(id) ON DELETE RESTRICT,
  object_key text NOT NULL,
  content_hash text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  alt_text text,
  alt_text_status text NOT NULL CHECK (alt_text_status IN ('approved', 'decorative')),
  scan_status text NOT NULL CHECK (scan_status IN ('clean', 'not_configured')),
  rights_status text NOT NULL CHECK (rights_status IN ('cleared', 'unchecked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_channel_preview_id, content_asset_id),
  UNIQUE (draft_channel_preview_id, sort_order)
);

CREATE INDEX IF NOT EXISTS draft_channel_preview_asset_asset_idx
  ON draft_channel_preview_asset(content_asset_id);
