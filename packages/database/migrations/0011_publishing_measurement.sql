CREATE TABLE IF NOT EXISTS channel_connection (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('discord_webhook')),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'revoked')),
  encrypted_credentials text NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}',
  capabilities jsonb NOT NULL DEFAULT '{}',
  capabilities_observed_at timestamptz,
  last_tested_at timestamptz,
  last_error text,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider, name)
);

CREATE INDEX IF NOT EXISTS channel_connection_workspace_status_idx
  ON channel_connection(workspace_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS publication_action (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  campaign_instance_id uuid NOT NULL REFERENCES campaign_instance(id) ON DELETE CASCADE,
  campaign_step_run_id uuid NOT NULL REFERENCES campaign_step_run(id) ON DELETE CASCADE,
  channel_connection_id uuid NOT NULL REFERENCES channel_connection(id) ON DELETE RESTRICT,
  action_type text NOT NULL CHECK (action_type IN ('publish_content')),
  status text NOT NULL CHECK (status IN ('dispatching', 'succeeded', 'failed', 'ambiguous')),
  idempotency_key text NOT NULL UNIQUE,
  request_snapshot jsonb NOT NULL,
  provider_external_id text,
  provider_url text,
  response_metadata jsonb NOT NULL DEFAULT '{}',
  last_error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS publication_action_instance_idx
  ON publication_action(campaign_instance_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS tracked_link (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  destination_id uuid NOT NULL REFERENCES destination(id) ON DELETE RESTRICT,
  campaign_instance_id uuid REFERENCES campaign_instance(id) ON DELETE SET NULL,
  campaign_step_run_id uuid REFERENCES campaign_step_run(id) ON DELETE SET NULL,
  slug text NOT NULL UNIQUE CHECK (length(slug) BETWEEN 8 AND 64),
  canonical_url text NOT NULL,
  utm_parameters jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'expired')),
  expires_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tracked_link_workspace_idx ON tracked_link(workspace_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS tracked_link_one_per_step_idx
  ON tracked_link(campaign_step_run_id) WHERE campaign_step_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS measurement_ingest_key (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS measurement_ingest_key_workspace_idx
  ON measurement_ingest_key(workspace_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS measurement_event (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'impression', 'reach', 'view', 'reaction', 'comment', 'reply', 'share', 'save', 'follow',
    'profile_visit', 'outbound_click', 'destination_visit', 'form_completion', 'lead',
    'application', 'registration', 'subscription', 'purchase', 'booking', 'donation',
    'revenue', 'unsubscribe', 'complaint', 'custom'
  )),
  source text NOT NULL,
  campaign_id uuid REFERENCES campaign(id) ON DELETE SET NULL,
  campaign_instance_id uuid REFERENCES campaign_instance(id) ON DELETE SET NULL,
  campaign_step_run_id uuid REFERENCES campaign_step_run(id) ON DELETE SET NULL,
  destination_id uuid REFERENCES destination(id) ON DELETE SET NULL,
  tracked_link_id uuid REFERENCES tracked_link(id) ON DELETE SET NULL,
  publication_action_id uuid REFERENCES publication_action(id) ON DELETE SET NULL,
  external_event_id text,
  value numeric(20,6),
  currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  properties jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, event_key)
);

CREATE INDEX IF NOT EXISTS measurement_event_campaign_idx
  ON measurement_event(workspace_id, campaign_instance_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS measurement_event_destination_idx
  ON measurement_event(workspace_id, destination_id, occurred_at DESC);
