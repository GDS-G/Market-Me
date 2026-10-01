-- Existing-member role edits only. Role changes from trusted administrative SQL
-- also advance the revision, so a revoke/regrant cycle invalidates stale editors.
ALTER TABLE workspace_membership ADD COLUMN role_revision integer NOT NULL DEFAULT 1 CHECK (role_revision > 0);

CREATE FUNCTION guard_workspace_member_role_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.role_revision <> 1 THEN
      RAISE EXCEPTION 'New memberships start at role revision one' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Membership identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF OLD.role_revision = 2147483647 THEN
      RAISE EXCEPTION 'Membership role revision exhausted' USING ERRCODE = '23514';
    END IF;
    IF NEW.role_revision <> OLD.role_revision AND NEW.role_revision <> OLD.role_revision + 1 THEN
      RAISE EXCEPTION 'Membership role changes require the next revision' USING ERRCODE = '23514';
    END IF;
    NEW.role_revision := OLD.role_revision + 1;
  ELSIF NEW.role_revision IS DISTINCT FROM OLD.role_revision THEN
    RAISE EXCEPTION 'Membership revision changes require a role change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_member_role_revision_guard BEFORE INSERT OR UPDATE ON workspace_membership
  FOR EACH ROW EXECUTE FUNCTION guard_workspace_member_role_revision();

CREATE TABLE workspace_member_role_receipt (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  target_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  previous_role text NOT NULL CHECK (previous_role IN ('admin','editor','approver','analyst','viewer')),
  new_role text NOT NULL CHECK (new_role IN ('admin','editor','approver','analyst','viewer')),
  revision integer NOT NULL CHECK (revision > 1),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500 AND reason=btrim(reason) AND reason !~ '[[:cntrl:]]'),
  canonical_request text NOT NULL CHECK (octet_length(canonical_request) <= 4096),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,request_id),
  CHECK (created_by <> target_user_id AND previous_role <> new_role),
  CHECK ((jsonb_typeof(canonical_request::jsonb)='object'
    AND canonical_request::jsonb->>'workspaceId'=workspace_id::text
    AND canonical_request::jsonb->>'targetUserId'=target_user_id::text
    AND canonical_request::jsonb->>'requestId'=request_id::text
    AND canonical_request::jsonb->'expectedRevision'=to_jsonb(revision-1)
    AND canonical_request::jsonb->>'newRole'=new_role
    AND jsonb_typeof(canonical_request::jsonb->'reason')='string'
    AND canonical_request::jsonb->>'reason'=reason
    AND canonical_request::jsonb - ARRAY['workspaceId','targetUserId','requestId','expectedRevision','newRole','reason']='{}'::jsonb) IS TRUE)
);
CREATE INDEX workspace_member_role_receipt_target ON workspace_member_role_receipt(workspace_id,target_user_id,created_at DESC);

-- Deliberately no FK to the membership row: a future explicit membership removal
-- must not erase role history. Workspace erasure is the sole cascade boundary.
CREATE FUNCTION protect_workspace_member_role_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM workspace_membership WHERE workspace_id=NEW.workspace_id AND user_id=NEW.created_by AND role IN ('owner','admin'))
      OR NOT EXISTS (SELECT 1 FROM workspace_membership WHERE workspace_id=NEW.workspace_id AND user_id=NEW.target_user_id
        AND role=NEW.new_role AND role_revision=NEW.revision) THEN
      RAISE EXCEPTION 'Role receipt requires current administration and matching target result' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM workspace WHERE id=OLD.workspace_id) THEN
      RAISE EXCEPTION 'Member role receipts must be retained' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Member role receipts are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER workspace_member_role_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON workspace_member_role_receipt
  FOR EACH ROW EXECUTE FUNCTION protect_workspace_member_role_receipt();
