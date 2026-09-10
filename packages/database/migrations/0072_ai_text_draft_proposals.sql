ALTER TABLE content_draft
  ADD CONSTRAINT content_draft_id_workspace_unique UNIQUE (id, workspace_id);

ALTER TABLE content_draft_version
  ADD CONSTRAINT content_draft_version_id_draft_unique
  UNIQUE (id, content_draft_id);

CREATE TABLE workspace_ai_text_draft_proposal (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL UNIQUE,
  content_draft_id uuid NOT NULL,
  source_draft_version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('attached', 'dismissed')),
  attached_by uuid NOT NULL,
  dismissed_by uuid,
  dismissal_note text CHECK (dismissal_note IS NULL OR (
    char_length(dismissal_note) BETWEEN 1 AND 1000
    AND dismissal_note = btrim(dismissal_note)
  )),
  attached_at timestamptz NOT NULL,
  dismissed_at timestamptz,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (artifact_id, workspace_id)
    REFERENCES workspace_ai_text_output_artifact(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (content_draft_id, workspace_id)
    REFERENCES content_draft(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_draft_version_id, content_draft_id)
    REFERENCES content_draft_version(id, content_draft_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, attached_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, dismissed_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT workspace_ai_text_draft_proposal_state_check CHECK (
    (status = 'attached' AND dismissed_by IS NULL
      AND dismissal_note IS NULL AND dismissed_at IS NULL) OR
    (status = 'dismissed' AND dismissed_by IS NOT NULL
      AND dismissal_note IS NOT NULL AND dismissed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX workspace_ai_text_draft_proposal_id_workspace_idx
  ON workspace_ai_text_draft_proposal(id, workspace_id);
CREATE INDEX workspace_ai_text_draft_proposal_draft_idx
  ON workspace_ai_text_draft_proposal(
    workspace_id, content_draft_id, status, attached_at DESC, id DESC
  );
