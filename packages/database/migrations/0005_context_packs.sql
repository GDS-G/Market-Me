CREATE TABLE IF NOT EXISTS context_pack (
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

CREATE TABLE IF NOT EXISTS context_pack_version (
  id uuid PRIMARY KEY,
  context_pack_id uuid NOT NULL REFERENCES context_pack(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'superseded')),
  instructions text NOT NULL DEFAULT '',
  authority_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (context_pack_id, version_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS context_pack_one_draft_idx
  ON context_pack_version(context_pack_id) WHERE status = 'draft';

ALTER TABLE context_pack
  ADD CONSTRAINT context_pack_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES context_pack_version(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS context_pack_workspace_idx
  ON context_pack(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS context_pack_source (
  id uuid PRIMARY KEY,
  context_pack_version_id uuid NOT NULL REFERENCES context_pack_version(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('source_item', 'manual_text', 'url')),
  source_item_id uuid REFERENCES source_item(id) ON DELETE SET NULL,
  label text NOT NULL,
  source_reference text NOT NULL,
  selected_sections text[] NOT NULL DEFAULT '{}',
  authority_rank integer NOT NULL DEFAULT 50 CHECK (authority_rank BETWEEN 0 AND 100),
  content_text text,
  content_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (context_pack_version_id, source_reference)
);

CREATE TABLE IF NOT EXISTS context_pack_fact (
  id uuid PRIMARY KEY,
  context_pack_version_id uuid NOT NULL REFERENCES context_pack_version(id) ON DELETE CASCADE,
  fact_key text NOT NULL,
  value_json jsonb NOT NULL,
  source_id uuid REFERENCES context_pack_source(id) ON DELETE SET NULL,
  confidence double precision CHECK (confidence BETWEEN 0 AND 1),
  status text NOT NULL CHECK (status IN ('proposed', 'accepted', 'conflicted', 'unresolved')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS context_pack_fact_version_key_idx
  ON context_pack_fact(context_pack_version_id, fact_key);
