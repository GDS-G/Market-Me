CREATE TABLE ai_analysis_cache_entry (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  capability text NOT NULL CHECK (capability IN (
    'generate_text',
    'generate_structured_output',
    'analyze_image',
    'transcribe',
    'embed',
    'rerank',
    'moderate',
    'use_tools'
  )),
  feature text NOT NULL CHECK (length(feature) BETWEEN 1 AND 100),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  model_family text NOT NULL CHECK (length(model_family) BETWEEN 1 AND 100),
  prompt_version text NOT NULL CHECK (length(prompt_version) BETWEEN 1 AND 100),
  context_revision text NOT NULL CHECK (length(context_revision) BETWEEN 1 AND 200),
  result jsonb NOT NULL,
  result_hash text NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  result_bytes integer NOT NULL CHECK (result_bytes BETWEEN 1 AND 262144),
  hit_count integer NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  created_by uuid NOT NULL,
  last_hit_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (
    workspace_id, capability, feature, content_hash, model_family,
    prompt_version, context_revision
  ),
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT ai_analysis_cache_expiry_check CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '30 days'
  ),
  CONSTRAINT ai_analysis_cache_hit_time_check CHECK (
    last_hit_at IS NULL OR last_hit_at >= created_at
  )
);

CREATE INDEX ai_analysis_cache_active_workspace_idx
  ON ai_analysis_cache_entry(workspace_id, expires_at, created_at DESC);
CREATE INDEX ai_analysis_cache_recent_hit_idx
  ON ai_analysis_cache_entry(workspace_id, last_hit_at DESC)
  WHERE last_hit_at IS NOT NULL;
