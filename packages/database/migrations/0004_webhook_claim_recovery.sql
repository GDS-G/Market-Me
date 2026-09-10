ALTER TABLE webhook_event
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS webhook_event_stale_claim_idx
  ON webhook_event(claimed_at)
  WHERE status = 'processing';
