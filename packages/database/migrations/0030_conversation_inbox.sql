CREATE TABLE IF NOT EXISTS conversation_thread (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  relationship_contact_id uuid NOT NULL,
  provider text NOT NULL,
  provider_thread_id text,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  assigned_owner_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  last_message_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (relationship_contact_id, workspace_id)
    REFERENCES relationship_contact(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT conversation_thread_status_check CHECK (
    status IN (
      'new', 'unassigned', 'ai_managed', 'assigned',
      'waiting_internal_information', 'waiting_contact',
      'scheduled_follow_up', 'resolved', 'archived'
    )
  ),
  CONSTRAINT conversation_thread_assignment_check CHECK (
    (status <> 'assigned' OR assigned_owner_id IS NOT NULL)
    AND (status <> 'unassigned' OR assigned_owner_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_thread_provider_identity_idx
  ON conversation_thread(workspace_id, provider, provider_thread_id)
  WHERE provider_thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_thread_workspace_activity_idx
  ON conversation_thread(workspace_id, last_message_at DESC NULLS LAST, updated_at DESC);

CREATE TABLE IF NOT EXISTS conversation_message (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  conversation_thread_id uuid NOT NULL,
  provider_message_id text,
  kind text NOT NULL,
  body text NOT NULL,
  author_display text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_thread_id, workspace_id)
    REFERENCES conversation_thread(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT conversation_message_kind_check CHECK (
    kind IN ('inbound', 'outbound_observed', 'internal_note', 'system')
  ),
  CONSTRAINT conversation_internal_note_actor_check CHECK (
    kind <> 'internal_note' OR created_by IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_message_provider_identity_idx
  ON conversation_message(conversation_thread_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_message_thread_time_idx
  ON conversation_message(conversation_thread_id, occurred_at, created_at);
