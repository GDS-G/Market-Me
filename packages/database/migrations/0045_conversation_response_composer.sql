ALTER TABLE conversation_response_suggestion
  ADD CONSTRAINT conversation_response_suggestion_thread_identity_key
  UNIQUE (id, workspace_id, conversation_thread_id);

CREATE TABLE conversation_response_draft (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  conversation_thread_id uuid NOT NULL,
  body text NOT NULL,
  source_suggestion_id uuid,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, conversation_thread_id),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (conversation_thread_id, workspace_id)
    REFERENCES conversation_thread(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (
    source_suggestion_id, workspace_id, conversation_thread_id
  ) REFERENCES conversation_response_suggestion(
    id, workspace_id, conversation_thread_id
  ) ON DELETE SET NULL (source_suggestion_id),
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES workspace_membership(workspace_id, user_id),
  FOREIGN KEY (workspace_id, updated_by)
    REFERENCES workspace_membership(workspace_id, user_id),
  CONSTRAINT conversation_response_draft_body_check
    CHECK (length(trim(body)) BETWEEN 1 AND 20000)
);

CREATE TABLE conversation_drafting_presence (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  conversation_thread_id uuid NOT NULL,
  actor_kind text NOT NULL,
  actor_user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    workspace_id, conversation_thread_id, actor_kind, actor_user_id
  ),
  FOREIGN KEY (conversation_thread_id, workspace_id)
    REFERENCES conversation_thread(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, actor_user_id)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE CASCADE,
  CONSTRAINT conversation_drafting_presence_actor_check
    CHECK (actor_kind IN ('human', 'assistant')),
  CONSTRAINT conversation_drafting_presence_expiry_check CHECK (
    expires_at > updated_at
    AND expires_at <= updated_at + interval '5 minutes'
  )
);

CREATE INDEX conversation_drafting_presence_active_idx
  ON conversation_drafting_presence(
    workspace_id, conversation_thread_id, expires_at DESC
  );
