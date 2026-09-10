CREATE TABLE IF NOT EXISTS connector_cursor (
  id uuid PRIMARY KEY,
  storage_connection_id uuid NOT NULL REFERENCES storage_connection(id) ON DELETE CASCADE,
  scope_key text NOT NULL,
  cursor text NOT NULL,
  cursor_kind text NOT NULL CHECK (cursor_kind IN ('google_page_token', 'microsoft_delta_link')),
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_connection_id, scope_key)
);

CREATE TABLE IF NOT EXISTS connector_sync_run (
  id uuid PRIMARY KEY,
  storage_connection_id uuid NOT NULL REFERENCES storage_connection(id) ON DELETE CASCADE,
  smart_source_id uuid REFERENCES smart_source(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  discovered_count integer NOT NULL DEFAULT 0,
  changed_count integer NOT NULL DEFAULT 0,
  deleted_count integer NOT NULL DEFAULT 0,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS connector_sync_run_connection_time_idx
  ON connector_sync_run(storage_connection_id, started_at DESC);

CREATE TABLE IF NOT EXISTS source_item (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  smart_source_id uuid NOT NULL REFERENCES smart_source(id) ON DELETE CASCADE,
  provider_item_id text NOT NULL,
  provider_parent_id text,
  name text NOT NULL,
  display_path text NOT NULL,
  mime_type text NOT NULL,
  is_folder boolean NOT NULL DEFAULT false,
  size_bytes bigint,
  modified_at timestamptz,
  content_hash text,
  provider_etag text,
  web_url text,
  deleted_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (smart_source_id, provider_item_id)
);

CREATE INDEX IF NOT EXISTS source_item_source_active_idx
  ON source_item(smart_source_id, modified_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS source_item_content_hash_idx
  ON source_item(workspace_id, content_hash) WHERE content_hash IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ingestion_event (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  smart_source_id uuid NOT NULL REFERENCES smart_source(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  event_kind text NOT NULL CHECK (event_kind IN ('discovered', 'changed', 'deleted', 'reconciled')),
  provider_item_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'ignored', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (smart_source_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ingestion_event_pending_idx
  ON ingestion_event(smart_source_id, created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS webhook_subscription (
  id uuid PRIMARY KEY,
  storage_connection_id uuid NOT NULL REFERENCES storage_connection(id) ON DELETE CASCADE,
  provider_subscription_id text NOT NULL,
  resource text NOT NULL,
  client_state_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'renewing', 'expired', 'revoked', 'error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_connection_id, provider_subscription_id)
);
