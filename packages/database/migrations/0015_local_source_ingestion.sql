ALTER TABLE source_item
  ADD COLUMN IF NOT EXISTS object_key text;

CREATE INDEX IF NOT EXISTS source_item_local_object_idx
  ON source_item(smart_source_id, object_key)
  WHERE object_key IS NOT NULL AND deleted_at IS NULL;
