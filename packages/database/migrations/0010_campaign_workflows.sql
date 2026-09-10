CREATE TABLE IF NOT EXISTS destination (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_id text,
  canonical_url text NOT NULL,
  known_redirects text[] NOT NULL DEFAULT '{}',
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  content_type text NOT NULL DEFAULT 'web_page',
  brand_id uuid REFERENCES brand(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  identifiers jsonb NOT NULL DEFAULT '{}',
  topics text[] NOT NULL DEFAULT '{}',
  audiences text[] NOT NULL DEFAULT '{}',
  geography text[] NOT NULL DEFAULT '{}',
  language text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'unavailable', 'expired', 'replaced', 'archived')),
  available_at timestamptz,
  expires_at timestamptz,
  replacement_destination_id uuid REFERENCES destination(id) ON DELETE SET NULL,
  tracking jsonb NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, canonical_url)
);

CREATE UNIQUE INDEX IF NOT EXISTS destination_provider_external_idx
  ON destination(workspace_id, provider, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS destination_workspace_status_idx ON destination(workspace_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS campaign (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validating', 'awaiting_approval', 'scheduled', 'active', 'paused', 'completed', 'failed', 'canceled', 'archived')),
  current_version_id uuid,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_workspace_status_idx ON campaign(workspace_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS campaign_version (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'superseded')),
  objective text NOT NULL CHECK (objective IN ('awareness', 'audience_growth', 'website_traffic', 'lead_generation', 'sales', 'subscriptions', 'registrations', 'applications', 'customer_retention', 'community_engagement', 'product_education', 'fundraising', 'recruitment', 'custom')),
  content_package_ids uuid[] NOT NULL DEFAULT '{}',
  destination_id uuid REFERENCES destination(id) ON DELETE SET NULL,
  information_depth text NOT NULL,
  promotional_strength text NOT NULL,
  autonomy_mode text NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  context jsonb NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (campaign_id, version_number)
);

ALTER TABLE campaign
  ADD CONSTRAINT campaign_current_version_fk FOREIGN KEY (current_version_id) REFERENCES campaign_version(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS campaign_one_draft_idx ON campaign_version(campaign_id) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS campaign_one_published_idx ON campaign_version(campaign_id) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS campaign_step (
  id uuid PRIMARY KEY,
  campaign_version_id uuid NOT NULL REFERENCES campaign_version(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  name text NOT NULL,
  operation_type text NOT NULL CHECK (operation_type IN ('create_destination', 'publish_content', 'send_notification', 'discover', 'outreach', 'monitor', 'respond', 'collect_lead', 'update_system', 'request_approval', 'wait', 'analyze', 'evaluate', 'schedule_follow_up', 'manual_handoff')),
  desired_capability text NOT NULL,
  depends_on text[] NOT NULL DEFAULT '{}',
  inputs jsonb NOT NULL DEFAULT '{}',
  outputs jsonb NOT NULL DEFAULT '{}',
  execution_methods text[] NOT NULL DEFAULT '{}',
  approval_required boolean NOT NULL DEFAULT true,
  schedule_type text NOT NULL DEFAULT 'immediate' CHECK (schedule_type IN ('immediate', 'exact_time', 'preferred_window', 'recurring', 'evergreen_queue', 'dependency', 'conditional', 'follow_up')),
  scheduled_at timestamptz,
  preferred_window_start timestamptz,
  preferred_window_end timestamptz,
  condition jsonb NOT NULL DEFAULT '{}',
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  timeout_seconds integer NOT NULL DEFAULT 300 CHECK (timeout_seconds > 0),
  optional boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (campaign_version_id, step_key)
);

CREATE TABLE IF NOT EXISTS campaign_instance (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  campaign_version_id uuid NOT NULL REFERENCES campaign_version(id),
  status text NOT NULL CHECK (status IN ('awaiting_approval', 'scheduled', 'active', 'paused', 'completed', 'failed', 'canceled')),
  temporal_workflow_id text UNIQUE,
  temporal_run_id text,
  context jsonb NOT NULL DEFAULT '{}',
  requested_by uuid NOT NULL REFERENCES app_user(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_instance_workspace_status_idx ON campaign_instance(workspace_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS campaign_step_run (
  id uuid PRIMARY KEY,
  campaign_instance_id uuid NOT NULL REFERENCES campaign_instance(id) ON DELETE CASCADE,
  campaign_step_id uuid NOT NULL REFERENCES campaign_step(id),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'waiting', 'running', 'succeeded', 'partially_succeeded', 'temporarily_failed', 'permanently_failed', 'canceled', 'rolled_back', 'manual_resolution')),
  idempotency_key text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}',
  output jsonb NOT NULL DEFAULT '{}',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_instance_id, campaign_step_id),
  UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS campaign_step_attempt (
  id uuid PRIMARY KEY,
  campaign_step_run_id uuid NOT NULL REFERENCES campaign_step_run(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'temporarily_failed', 'permanently_failed', 'canceled')),
  input jsonb NOT NULL DEFAULT '{}',
  output jsonb NOT NULL DEFAULT '{}',
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (campaign_step_run_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS campaign_approval (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  campaign_instance_id uuid NOT NULL REFERENCES campaign_instance(id) ON DELETE CASCADE,
  campaign_step_run_id uuid REFERENCES campaign_step_run(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested', 'canceled')),
  request_snapshot jsonb NOT NULL,
  conditions jsonb NOT NULL DEFAULT '{}',
  requested_by uuid NOT NULL REFERENCES app_user(id),
  assigned_reviewer_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  decision_notes text,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_one_pending_step_approval_idx
  ON campaign_approval(campaign_instance_id, campaign_step_run_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS campaign_workflow_command (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  campaign_instance_id uuid NOT NULL REFERENCES campaign_instance(id) ON DELETE CASCADE,
  command_type text NOT NULL CHECK (command_type IN ('start', 'pause', 'resume', 'cancel', 'approval_decision', 'manual_step_completed')),
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  last_error text,
  actor_user_id uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS campaign_workflow_command_ready_idx
  ON campaign_workflow_command(status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');
