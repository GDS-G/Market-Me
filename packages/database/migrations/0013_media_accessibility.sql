ALTER TABLE content_asset
  ADD COLUMN IF NOT EXISTS source_asset_id uuid REFERENCES content_asset(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS object_key text,
  ADD COLUMN IF NOT EXISTS byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  ADD COLUMN IF NOT EXISTS processing_version text,
  ADD COLUMN IF NOT EXISTS recipe jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS media_status text NOT NULL DEFAULT 'unsupported'
    CHECK (media_status IN ('stored', 'processed', 'unsupported', 'failed')),
  ADD COLUMN IF NOT EXISTS scan_status text NOT NULL DEFAULT 'not_configured'
    CHECK (scan_status IN ('clean', 'infected', 'not_configured', 'failed')),
  ADD COLUMN IF NOT EXISTS rights_status text NOT NULL DEFAULT 'unchecked'
    CHECK (rights_status IN ('unchecked', 'cleared', 'restricted', 'expired')),
  ADD COLUMN IF NOT EXISTS alt_text text,
  ADD COLUMN IF NOT EXISTS alt_text_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (alt_text_status IN ('not_applicable', 'needs_review', 'approved', 'decorative')),
  ADD COLUMN IF NOT EXISTS accessibility_notes text;

CREATE INDEX IF NOT EXISTS content_asset_source_idx
  ON content_asset(source_asset_id) WHERE source_asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS content_asset_object_key_idx
  ON content_asset(object_key) WHERE object_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS content_asset_accessibility_review_idx
  ON content_asset(content_package_id, alt_text_status)
  WHERE alt_text_status = 'needs_review';
