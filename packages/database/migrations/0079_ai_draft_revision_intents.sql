ALTER TABLE workspace_ai_text_invocation_intent
  ADD COLUMN source_content_draft_id uuid,
  ADD COLUMN source_content_draft_version_id uuid,
  ADD COLUMN draft_revision_goal text,
  ADD COLUMN product_prompt_version text,
  ADD COLUMN source_context_sha256 text,
  ADD CONSTRAINT workspace_ai_text_invocation_intent_source_draft_fkey
    FOREIGN KEY (source_content_draft_id, workspace_id)
    REFERENCES content_draft(id, workspace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT workspace_ai_text_invocation_intent_source_version_fkey
    FOREIGN KEY (source_content_draft_version_id, source_content_draft_id)
    REFERENCES content_draft_version(id, content_draft_id) ON DELETE RESTRICT,
  ADD CONSTRAINT workspace_ai_text_invocation_intent_draft_revision_goal_check
    CHECK (draft_revision_goal IS NULL OR draft_revision_goal IN (
      'clarity', 'concision', 'audience_fit', 'call_to_action'
    )),
  ADD CONSTRAINT workspace_ai_text_intent_product_prompt_ver_check
    CHECK (product_prompt_version IS NULL OR (
      char_length(product_prompt_version) BETWEEN 1 AND 100
      AND product_prompt_version = btrim(product_prompt_version)
    )),
  ADD CONSTRAINT workspace_ai_text_invocation_intent_source_context_hash_check
    CHECK (source_context_sha256 IS NULL OR source_context_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT workspace_ai_text_invocation_intent_draft_revision_source_check
    CHECK (
      (source_content_draft_id IS NULL
        AND source_content_draft_version_id IS NULL
        AND draft_revision_goal IS NULL
        AND product_prompt_version IS NULL
        AND source_context_sha256 IS NULL) OR
      (source_content_draft_id IS NOT NULL
        AND source_content_draft_version_id IS NOT NULL
        AND draft_revision_goal IS NOT NULL
        AND product_prompt_version IS NOT NULL
        AND source_context_sha256 IS NOT NULL)
    );

CREATE INDEX workspace_ai_text_invocation_intent_source_draft_idx
  ON workspace_ai_text_invocation_intent (
    workspace_id, source_content_draft_id, created_at DESC, id DESC
  )
  WHERE source_content_draft_id IS NOT NULL;
