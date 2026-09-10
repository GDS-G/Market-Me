ALTER TABLE content_draft_claim_evidence
  DROP CONSTRAINT IF EXISTS content_draft_claim_evidence_evidence_item_id_fkey;

ALTER TABLE content_draft_claim_evidence
  ADD CONSTRAINT content_draft_claim_evidence_evidence_item_id_fkey
  FOREIGN KEY (evidence_item_id) REFERENCES evidence_item(id);
