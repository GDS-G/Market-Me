CREATE TABLE IF NOT EXISTS conversation_shared_resource (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  conversation_thread_id uuid NOT NULL,
  kind text NOT NULL,
  destination_id uuid,
  channel_connection_id uuid,
  publication_action_id uuid,
  idempotency_key uuid NOT NULL,
  observed_at timestamptz NOT NULL,
  recorded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, conversation_thread_id, idempotency_key),
  FOREIGN KEY (conversation_thread_id, workspace_id)
    REFERENCES conversation_thread(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (destination_id, workspace_id)
    REFERENCES destination(id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (publication_action_id, channel_connection_id, workspace_id)
    REFERENCES publication_action(id, channel_connection_id, workspace_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, recorded_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT conversation_shared_resource_kind_check CHECK (
    kind IN ('destination', 'publication')
  ),
  CONSTRAINT conversation_shared_resource_target_check CHECK (
    (
      kind = 'destination'
      AND destination_id IS NOT NULL
      AND channel_connection_id IS NULL
      AND publication_action_id IS NULL
    ) OR (
      kind = 'publication'
      AND destination_id IS NULL
      AND channel_connection_id IS NOT NULL
      AND publication_action_id IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS conversation_shared_resource_thread_time_idx
  ON conversation_shared_resource(workspace_id, conversation_thread_id, created_at DESC);

CREATE INDEX IF NOT EXISTS conversation_shared_resource_destination_idx
  ON conversation_shared_resource(workspace_id, destination_id, observed_at DESC)
  WHERE destination_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_shared_resource_publication_idx
  ON conversation_shared_resource(workspace_id, publication_action_id, observed_at DESC)
  WHERE publication_action_id IS NOT NULL;
