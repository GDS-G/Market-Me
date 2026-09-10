CREATE TABLE relationship_identity_link (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  relationship_a_id uuid NOT NULL,
  relationship_b_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'suggested',
  evidence_kind text NOT NULL,
  confidence numeric(4, 3) NOT NULL,
  suggested_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  reviewed_by uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, relationship_a_id, relationship_b_id),
  FOREIGN KEY (relationship_a_id, workspace_id)
    REFERENCES relationship_contact(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (relationship_b_id, workspace_id)
    REFERENCES relationship_contact(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT relationship_identity_link_order_check
    CHECK (relationship_a_id::text < relationship_b_id::text),
  CONSTRAINT relationship_identity_link_status_check
    CHECK (status IN ('suggested', 'confirmed', 'dismissed')),
  CONSTRAINT relationship_identity_link_evidence_check
    CHECK (evidence_kind IN (
      'verified_link', 'exact_address', 'strong_identifier', 'user_confirmation'
    )),
  CONSTRAINT relationship_identity_link_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT relationship_identity_link_review_check CHECK (
    (status = 'suggested' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status <> 'suggested' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX relationship_identity_link_workspace_status_idx
  ON relationship_identity_link(workspace_id, status, updated_at DESC);

CREATE INDEX relationship_identity_link_a_idx
  ON relationship_identity_link(workspace_id, relationship_a_id, status);

CREATE INDEX relationship_identity_link_b_idx
  ON relationship_identity_link(workspace_id, relationship_b_id, status);

CREATE OR REPLACE FUNCTION relationship_effective_contact_permission(
  p_workspace_id uuid,
  p_relationship_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE confirmed_group(id) AS (
    SELECT p_relationship_id
    UNION
    SELECT CASE
      WHEN link.relationship_a_id = confirmed_group.id
        THEN link.relationship_b_id
      ELSE link.relationship_a_id
    END
    FROM relationship_identity_link link
    JOIN confirmed_group
      ON link.relationship_a_id = confirmed_group.id
      OR link.relationship_b_id = confirmed_group.id
    WHERE link.workspace_id = p_workspace_id
      AND link.status = 'confirmed'
  )
  SELECT CASE
    WHEN bool_or(contact.contact_permission = 'suppressed') THEN 'suppressed'
    ELSE 'allowed'
  END
  FROM confirmed_group
  JOIN relationship_contact contact
    ON contact.id = confirmed_group.id
    AND contact.workspace_id = p_workspace_id
$$;
