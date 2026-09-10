ALTER TABLE draft_generation
  ADD COLUMN IF NOT EXISTS draft_format text NOT NULL DEFAULT 'channel_neutral'
  CHECK (draft_format IN ('channel_neutral', 'social_short', 'social_standard', 'email', 'article_intro', 'community_reply', 'direct_message'));

ALTER TABLE content_draft_version
  ADD COLUMN IF NOT EXISTS source_version_id uuid REFERENCES content_draft_version(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS change_note text;

CREATE UNIQUE INDEX IF NOT EXISTS content_draft_one_general_variant_idx
  ON content_draft(draft_generation_id) WHERE audience_profile_version_id IS NULL;

CREATE INDEX IF NOT EXISTS content_draft_version_source_idx ON content_draft_version(source_version_id);
