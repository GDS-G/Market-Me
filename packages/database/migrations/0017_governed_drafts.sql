CREATE TABLE IF NOT EXISTS draft_generation (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  campaign_version_id uuid NOT NULL REFERENCES campaign_version(id) ON DELETE RESTRICT,
  content_package_id uuid NOT NULL REFERENCES content_package(id) ON DELETE RESTRICT,
  content_package_version integer NOT NULL CHECK (content_package_version > 0),
  brand_profile_version_id uuid REFERENCES brand_profile_version(id) ON DELETE RESTRICT,
  information_depth text NOT NULL CHECK (information_depth IN ('minimal', 'teaser', 'contextual', 'detailed', 'comprehensive', 'custom')),
  promotional_strength text NOT NULL CHECK (promotional_strength IN ('informational', 'subtle', 'light', 'standard', 'strong', 'campaign_push', 'custom')),
  evidence_snapshot jsonb NOT NULL,
  generator_provider text NOT NULL,
  generator_model text NOT NULL,
  generator_version text NOT NULL,
  prompt_version text NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS draft_generation_workspace_time_idx ON draft_generation(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS content_draft (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  draft_generation_id uuid NOT NULL REFERENCES draft_generation(id) ON DELETE CASCADE,
  audience_profile_version_id uuid REFERENCES audience_profile_version(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'working' CHECK (status IN ('working', 'pending_review', 'approved', 'rejected', 'changes_requested', 'archived')),
  current_version_id uuid,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_generation_id, audience_profile_version_id)
);

CREATE TABLE IF NOT EXISTS content_draft_version (
  id uuid PRIMARY KEY,
  content_draft_id uuid NOT NULL REFERENCES content_draft(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'working' CHECK (status IN ('working', 'pending_review', 'approved', 'rejected', 'changes_requested', 'superseded')),
  headline text NOT NULL,
  body text NOT NULL,
  call_to_action text,
  hashtags text[] NOT NULL DEFAULT '{}',
  alt_text text,
  rationale text NOT NULL,
  presentation_choices jsonb NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_draft_id, version_number)
);

ALTER TABLE content_draft ADD CONSTRAINT content_draft_current_version_fk FOREIGN KEY (current_version_id) REFERENCES content_draft_version(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS content_draft_claim (
  id uuid PRIMARY KEY,
  content_draft_version_id uuid NOT NULL REFERENCES content_draft_version(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('fact', 'call_to_action')),
  claim_text text NOT NULL,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  UNIQUE (content_draft_version_id, sort_order)
);

CREATE TABLE IF NOT EXISTS content_draft_claim_evidence (
  content_draft_claim_id uuid NOT NULL REFERENCES content_draft_claim(id) ON DELETE CASCADE,
  evidence_item_id uuid NOT NULL REFERENCES evidence_item(id) ON DELETE RESTRICT,
  PRIMARY KEY (content_draft_claim_id, evidence_item_id)
);

CREATE TABLE IF NOT EXISTS content_draft_approval (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  content_draft_id uuid NOT NULL REFERENCES content_draft(id) ON DELETE CASCADE,
  content_draft_version_id uuid NOT NULL REFERENCES content_draft_version(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested', 'canceled')),
  request_snapshot jsonb NOT NULL,
  requested_by uuid NOT NULL REFERENCES app_user(id),
  assigned_reviewer_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  decision_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS content_draft_one_pending_approval_idx ON content_draft_approval(content_draft_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS content_draft_workspace_status_idx ON content_draft(workspace_id, status, updated_at DESC);
