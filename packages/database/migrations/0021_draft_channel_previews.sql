CREATE TABLE IF NOT EXISTS draft_channel_preview (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  content_draft_id uuid NOT NULL REFERENCES content_draft(id) ON DELETE CASCADE,
  content_draft_version_id uuid NOT NULL REFERENCES content_draft_version(id) ON DELETE RESTRICT,
  channel_connection_id uuid NOT NULL REFERENCES channel_connection(id) ON DELETE RESTRICT,
  destination_id uuid REFERENCES destination(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  capability_version text NOT NULL,
  capability_observed_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('ready', 'blocked')),
  rendered_content text NOT NULL,
  character_count integer NOT NULL CHECK (character_count >= 0),
  character_limit integer CHECK (character_limit > 0),
  validation_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  capability_snapshot jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (content_draft_version_id, channel_connection_id, destination_id)
);

CREATE INDEX IF NOT EXISTS draft_channel_preview_draft_idx ON draft_channel_preview(content_draft_id, created_at DESC);
CREATE INDEX IF NOT EXISTS draft_channel_preview_connection_idx ON draft_channel_preview(channel_connection_id);
