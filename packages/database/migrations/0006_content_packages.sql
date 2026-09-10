ALTER TABLE ingestion_event
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE INDEX IF NOT EXISTS ingestion_event_ready_work_idx
  ON ingestion_event(next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS content_package (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  smart_source_id uuid NOT NULL REFERENCES smart_source(id) ON DELETE CASCADE,
  root_source_item_id uuid NOT NULL REFERENCES source_item(id) ON DELETE CASCADE,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('detecting', 'stabilizing', 'analyzing', 'needs_review', 'ready', 'approved', 'executing', 'completed', 'failed')),
  confidence double precision CHECK (confidence BETWEEN 0 AND 1),
  context_pack_version_ids uuid[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (smart_source_id, root_source_item_id)
);

CREATE INDEX IF NOT EXISTS content_package_workspace_time_idx
  ON content_package(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS content_asset (
  id uuid PRIMARY KEY,
  content_package_id uuid NOT NULL REFERENCES content_package(id) ON DELETE CASCADE,
  source_item_id uuid REFERENCES source_item(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('original', 'supporting', 'derivative')),
  file_name text NOT NULL,
  mime_type text NOT NULL,
  content_hash text NOT NULL,
  extracted_text text,
  extraction_status text NOT NULL CHECK (extraction_status IN ('pending', 'completed', 'skipped', 'failed')),
  extraction_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_package_id, source_item_id)
);

CREATE TABLE IF NOT EXISTS evidence_item (
  id uuid PRIMARY KEY,
  content_package_id uuid NOT NULL REFERENCES content_package(id) ON DELETE CASCADE,
  fact_key text,
  claim text NOT NULL,
  provenance text NOT NULL CHECK (provenance IN ('observed', 'authoritative_context', 'inferred', 'unresolved')),
  source_references text[] NOT NULL DEFAULT '{}',
  confidence double precision CHECK (confidence BETWEEN 0 AND 1),
  context_pack_version_id uuid REFERENCES context_pack_version(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evidence_item_package_idx
  ON evidence_item(content_package_id, provenance, fact_key);

CREATE TABLE IF NOT EXISTS evidence_conflict (
  id uuid PRIMARY KEY,
  content_package_id uuid NOT NULL REFERENCES content_package(id) ON DELETE CASCADE,
  fact_key text NOT NULL,
  candidate_evidence_ids uuid[] NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution_evidence_id uuid REFERENCES evidence_item(id) ON DELETE SET NULL,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (content_package_id, fact_key)
);
