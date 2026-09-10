ALTER TABLE evidence_item
  ADD COLUMN IF NOT EXISTS superseded_by_evidence_id uuid REFERENCES evidence_item(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS evidence_item_active_unresolved_idx
  ON evidence_item(content_package_id)
  WHERE provenance = 'unresolved' AND superseded_by_evidence_id IS NULL;
