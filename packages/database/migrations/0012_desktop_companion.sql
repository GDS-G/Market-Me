CREATE TABLE IF NOT EXISTS companion_pairing_code (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS companion_pairing_code_workspace_idx
  ON companion_pairing_code(workspace_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS browser_worker (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('windows', 'macos', 'linux')),
  architecture text NOT NULL CHECK (architecture IN ('x86_64', 'aarch64')),
  app_version text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked')),
  health_state text NOT NULL DEFAULT 'healthy' CHECK (health_state IN ('healthy', 'working', 'needs_attention', 'disconnected')),
  token_prefix text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  capabilities jsonb NOT NULL DEFAULT '{}',
  health_details jsonb NOT NULL DEFAULT '{}',
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS browser_worker_workspace_idx
  ON browser_worker(workspace_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS browser_job (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('open_url')),
  action_mode text NOT NULL CHECK (action_mode IN ('confirm_before_submit', 'assisted')),
  target_url text NOT NULL,
  expected_origin text NOT NULL,
  allowed_domains jsonb NOT NULL,
  instructions text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'claimed', 'succeeded', 'failed', 'canceled', 'expired')),
  idempotency_key text NOT NULL UNIQUE,
  claim_token_hash text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  result jsonb NOT NULL DEFAULT '{}',
  last_error text,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT browser_job_workspace_worker_fk FOREIGN KEY (workspace_id, worker_id)
    REFERENCES browser_worker(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS browser_job_worker_queue_idx
  ON browser_job(worker_id, status, created_at);
