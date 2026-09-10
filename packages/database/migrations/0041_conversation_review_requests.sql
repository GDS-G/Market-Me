ALTER TABLE conversation_message
  ADD CONSTRAINT conversation_message_workspace_thread_unique
  UNIQUE (id, workspace_id, conversation_thread_id);

CREATE TABLE conversation_review_request (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  conversation_thread_id uuid NOT NULL,
  source_message_id uuid,
  status text NOT NULL DEFAULT 'open',
  request_text text NOT NULL,
  due_at timestamptz,
  requested_by uuid NOT NULL,
  requested_reviewer_id uuid NOT NULL,
  closed_by uuid,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id, conversation_thread_id),
  FOREIGN KEY (conversation_thread_id, workspace_id)
    REFERENCES conversation_thread(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (source_message_id, workspace_id, conversation_thread_id)
    REFERENCES conversation_message(id, workspace_id, conversation_thread_id)
    ON DELETE NO ACTION,
  FOREIGN KEY (requested_by)
    REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (requested_reviewer_id)
    REFERENCES app_user(id) ON DELETE RESTRICT,
  FOREIGN KEY (closed_by)
    REFERENCES app_user(id) ON DELETE RESTRICT,
  CONSTRAINT conversation_review_request_status_check
    CHECK (status IN ('open', 'resolved', 'cancelled')),
  CONSTRAINT conversation_review_request_text_check
    CHECK (length(btrim(request_text)) BETWEEN 1 AND 10000),
  CONSTRAINT conversation_review_request_teammate_check
    CHECK (requested_by <> requested_reviewer_id),
  CONSTRAINT conversation_review_request_close_check CHECK (
    (status = 'open' AND closed_by IS NULL AND closed_at IS NULL)
    OR (status <> 'open' AND closed_by IS NOT NULL AND closed_at IS NOT NULL)
  )
);

CREATE TABLE conversation_review_request_mention (
  workspace_id uuid NOT NULL,
  conversation_thread_id uuid NOT NULL,
  review_request_id uuid NOT NULL,
  mentioned_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_request_id, mentioned_user_id),
  FOREIGN KEY (review_request_id, workspace_id, conversation_thread_id)
    REFERENCES conversation_review_request(id, workspace_id, conversation_thread_id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, mentioned_user_id)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE CASCADE
);

CREATE INDEX conversation_review_request_thread_idx
  ON conversation_review_request(conversation_thread_id, status, created_at DESC);

CREATE INDEX conversation_review_request_reviewer_idx
  ON conversation_review_request(workspace_id, requested_reviewer_id, status, due_at)
  WHERE status = 'open';

CREATE INDEX conversation_review_request_mention_user_idx
  ON conversation_review_request_mention(workspace_id, mentioned_user_id, created_at DESC);
