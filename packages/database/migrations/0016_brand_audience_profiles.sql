CREATE TABLE IF NOT EXISTS brand_profile (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  current_version_id uuid,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS brand_profile_version (
  id uuid PRIMARY KEY,
  brand_profile_id uuid NOT NULL REFERENCES brand_profile(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'superseded')),
  profile jsonb NOT NULL DEFAULT '{}',
  information_depth_default text CHECK (information_depth_default IN ('minimal', 'teaser', 'contextual', 'detailed', 'comprehensive', 'custom')),
  information_depth_ceiling text CHECK (information_depth_ceiling IN ('minimal', 'teaser', 'contextual', 'detailed', 'comprehensive')),
  promotional_strength_default text CHECK (promotional_strength_default IN ('informational', 'subtle', 'light', 'standard', 'strong', 'campaign_push', 'custom')),
  promotional_strength_ceiling text CHECK (promotional_strength_ceiling IN ('informational', 'subtle', 'light', 'standard', 'strong', 'campaign_push')),
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (brand_profile_id, version_number)
);

ALTER TABLE brand_profile
  ADD CONSTRAINT brand_profile_current_version_fk FOREIGN KEY (current_version_id) REFERENCES brand_profile_version(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS brand_profile_one_draft_idx ON brand_profile_version(brand_profile_id) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS brand_profile_one_published_idx ON brand_profile_version(brand_profile_id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS brand_profile_workspace_status_idx ON brand_profile(workspace_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS audience_profile (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  current_version_id uuid,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS audience_profile_version (
  id uuid PRIMARY KEY,
  audience_profile_id uuid NOT NULL REFERENCES audience_profile(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'superseded')),
  audience_type text NOT NULL CHECK (audience_type IN ('consumer', 'business', 'professional', 'community', 'media', 'donor', 'applicant', 'partner', 'mixed')),
  profile jsonb NOT NULL DEFAULT '{}',
  information_depth_default text CHECK (information_depth_default IN ('minimal', 'teaser', 'contextual', 'detailed', 'comprehensive', 'custom')),
  information_depth_ceiling text CHECK (information_depth_ceiling IN ('minimal', 'teaser', 'contextual', 'detailed', 'comprehensive')),
  promotional_strength_default text CHECK (promotional_strength_default IN ('informational', 'subtle', 'light', 'standard', 'strong', 'campaign_push', 'custom')),
  promotional_strength_ceiling text CHECK (promotional_strength_ceiling IN ('informational', 'subtle', 'light', 'standard', 'strong', 'campaign_push')),
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (audience_profile_id, version_number)
);

ALTER TABLE audience_profile
  ADD CONSTRAINT audience_profile_current_version_fk FOREIGN KEY (current_version_id) REFERENCES audience_profile_version(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS audience_profile_one_draft_idx ON audience_profile_version(audience_profile_id) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS audience_profile_one_published_idx ON audience_profile_version(audience_profile_id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS audience_profile_workspace_status_idx ON audience_profile(workspace_id, status, updated_at DESC);

ALTER TABLE campaign_version
  ADD COLUMN IF NOT EXISTS brand_profile_version_id uuid REFERENCES brand_profile_version(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS campaign_version_audience_profile (
  campaign_version_id uuid NOT NULL REFERENCES campaign_version(id) ON DELETE CASCADE,
  audience_profile_version_id uuid NOT NULL REFERENCES audience_profile_version(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  PRIMARY KEY (campaign_version_id, audience_profile_version_id),
  UNIQUE (campaign_version_id, sort_order)
);

CREATE INDEX IF NOT EXISTS campaign_version_brand_profile_idx ON campaign_version(brand_profile_version_id);
CREATE INDEX IF NOT EXISTS campaign_version_audience_profile_version_idx ON campaign_version_audience_profile(audience_profile_version_id);
