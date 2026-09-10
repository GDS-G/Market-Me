ALTER TABLE relationship_identity_link
  ADD COLUMN origin text NOT NULL DEFAULT 'manual_review',
  ADD COLUMN evidence_fingerprint text;

ALTER TABLE relationship_identity_link
  ADD CONSTRAINT relationship_identity_link_origin_check
    CHECK (origin IN ('manual_review', 'deterministic_scan')),
  ADD CONSTRAINT relationship_identity_link_fingerprint_check CHECK (
    evidence_fingerprint IS NULL
    OR evidence_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT relationship_identity_link_scan_evidence_check CHECK (
    origin <> 'deterministic_scan'
    OR evidence_fingerprint IS NOT NULL
  );

CREATE INDEX relationship_identity_link_scan_queue_idx
  ON relationship_identity_link(workspace_id, origin, status, updated_at DESC);
