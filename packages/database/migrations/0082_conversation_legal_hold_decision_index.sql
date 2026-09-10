CREATE INDEX conversation_legal_hold_release_decisions_idx
  ON conversation_legal_hold_release_request(
    workspace_id,
    decided_at DESC,
    id
  )
  WHERE status IN ('approved', 'rejected');
