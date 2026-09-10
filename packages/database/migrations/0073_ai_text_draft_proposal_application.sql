ALTER TABLE workspace_ai_text_draft_proposal
  DROP CONSTRAINT workspace_ai_text_draft_proposal_status_check,
  DROP CONSTRAINT workspace_ai_text_draft_proposal_state_check;

ALTER TABLE workspace_ai_text_draft_proposal
  ADD COLUMN applied_by uuid,
  ADD COLUMN application_note text,
  ADD COLUMN applied_version_id uuid,
  ADD COLUMN selected_fields text[],
  ADD COLUMN applied_at timestamptz,
  ADD CONSTRAINT workspace_ai_text_draft_proposal_status_check
    CHECK (status IN ('attached', 'applied', 'dismissed')),
  ADD CONSTRAINT workspace_ai_text_draft_proposal_application_note_check
    CHECK (application_note IS NULL OR (
      char_length(application_note) BETWEEN 3 AND 1000
      AND application_note = btrim(application_note)
    )),
  ADD CONSTRAINT workspace_ai_text_draft_proposal_selected_fields_check
    CHECK (selected_fields IS NULL OR (
      cardinality(selected_fields) BETWEEN 1 AND 4
      AND selected_fields <@ ARRAY[
        'lead_in', 'call_to_action', 'hashtags', 'alt_text'
      ]::text[]
    )),
  ADD CONSTRAINT workspace_ai_text_draft_proposal_applied_version_fkey
    FOREIGN KEY (applied_version_id, content_draft_id)
    REFERENCES content_draft_version(id, content_draft_id) ON DELETE RESTRICT,
  ADD CONSTRAINT workspace_ai_text_draft_proposal_applied_by_fkey
    FOREIGN KEY (workspace_id, applied_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  ADD CONSTRAINT workspace_ai_text_draft_proposal_state_check CHECK (
    (status = 'attached'
      AND dismissed_by IS NULL AND dismissal_note IS NULL AND dismissed_at IS NULL
      AND applied_by IS NULL AND application_note IS NULL
      AND applied_version_id IS NULL AND selected_fields IS NULL AND applied_at IS NULL) OR
    (status = 'dismissed'
      AND dismissed_by IS NOT NULL AND dismissal_note IS NOT NULL AND dismissed_at IS NOT NULL
      AND applied_by IS NULL AND application_note IS NULL
      AND applied_version_id IS NULL AND selected_fields IS NULL AND applied_at IS NULL) OR
    (status = 'applied'
      AND dismissed_by IS NULL AND dismissal_note IS NULL AND dismissed_at IS NULL
      AND applied_by IS NOT NULL AND application_note IS NOT NULL
      AND applied_version_id IS NOT NULL AND selected_fields IS NOT NULL AND applied_at IS NOT NULL)
  );
