ALTER TABLE webhook_subscription
  ADD COLUMN IF NOT EXISTS provider_resource_id text,
  ADD COLUMN IF NOT EXISTS last_notification_at timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE INDEX IF NOT EXISTS webhook_subscription_renewal_idx
  ON webhook_subscription(status, expires_at);

CREATE TABLE IF NOT EXISTS webhook_event (
  id uuid PRIMARY KEY,
  webhook_subscription_id uuid NOT NULL REFERENCES webhook_subscription(id) ON DELETE CASCADE,
  provider_event_id text NOT NULL,
  event_kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (webhook_subscription_id, provider_event_id)
);

CREATE INDEX IF NOT EXISTS webhook_event_ready_idx
  ON webhook_event(next_attempt_at, received_at)
  WHERE status IN ('pending', 'failed');
