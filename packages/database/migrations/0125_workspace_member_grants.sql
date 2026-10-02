-- Retain workspace/user identity for historical foreign keys. Current authority
-- MUST use active_workspace_membership; this is not an arbitrary-SQL sandbox.
ALTER TABLE workspace_membership
  ADD COLUMN incarnation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN revoked_at timestamptz;
CREATE UNIQUE INDEX workspace_membership_incarnation_idx ON workspace_membership(incarnation_id);
CREATE INDEX workspace_membership_active_user_idx ON workspace_membership(user_id,workspace_id) WHERE revoked_at IS NULL;

CREATE VIEW active_workspace_membership WITH (security_invoker=true) AS
  SELECT workspace_id,user_id,role,created_at,role_revision,incarnation_id
  FROM workspace_membership WHERE revoked_at IS NULL
  WITH LOCAL CHECK OPTION;

CREATE OR REPLACE FUNCTION guard_workspace_member_role_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM workspace WHERE id=OLD.workspace_id)
      AND EXISTS (SELECT 1 FROM app_user WHERE id=OLD.user_id) THEN
      RAISE EXCEPTION 'Membership identity must be retained; revoke its current grant' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.role_revision<>1 OR NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'New memberships start with active revision one' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.workspace_id,NEW.user_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.workspace_id,OLD.user_id,OLD.created_at) THEN
    RAISE EXCEPTION 'Membership identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
    IF NEW.incarnation_id=OLD.incarnation_id THEN
      RAISE EXCEPTION 'Rejoining requires a new grant incarnation' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.incarnation_id IS DISTINCT FROM OLD.incarnation_id
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
    OR (NEW.revoked_at IS NOT NULL AND NEW.role IS DISTINCT FROM OLD.role) THEN
    RAISE EXCEPTION 'Grant identity, original revocation time and revoked role are protected' USING ERRCODE='23514';
  END IF;
  changed := NEW.role IS DISTINCT FROM OLD.role OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at;
  IF changed THEN
    IF OLD.role_revision=2147483647 THEN
      RAISE EXCEPTION 'Membership revision exhausted' USING ERRCODE='23514';
    END IF;
    IF NEW.role_revision NOT IN (OLD.role_revision,OLD.role_revision+1) THEN
      RAISE EXCEPTION 'Membership changes require the next available revision' USING ERRCODE='23514';
    END IF;
    NEW.role_revision := OLD.role_revision+1;
  ELSIF NEW.role_revision IS DISTINCT FROM OLD.role_revision THEN
    RAISE EXCEPTION 'Membership revision changes require an actual role or grant transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_member_identity_delete_guard BEFORE DELETE ON workspace_membership
  FOR EACH ROW EXECUTE FUNCTION guard_workspace_member_role_revision();

-- Forward-only replacement of six reviewed existing trigger bodies. All their
-- receipt/history/lineage logic and metadata remain unchanged; only nine exact
-- authority references switch to the active projection. Fail closed on drift.
DO $$
DECLARE item record; definition text; body text; reference_count integer;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('validate_source_preparation_binding',2),
    ('protect_smart_source_setup_receipt',1),
    ('protect_preparation_preset_history',1),
    ('protect_workspace_management_receipt',2),
    ('protect_workspace_member_role_receipt',2),
    ('protect_workspace_ai_policy_save_receipt',1)
  ) AS reviewed(name,expected_count) LOOP
    SELECT pg_get_functiondef(p.oid),p.prosrc INTO STRICT definition,body FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=current_schema() AND p.proname=item.name AND p.pronargs=0 AND p.prorettype='trigger'::regtype;
    SELECT count(*) INTO reference_count FROM regexp_matches(body,'\mworkspace_membership\M','g');
    IF reference_count<>item.expected_count OR body ~ '\mactive_workspace_membership\M' THEN
      RAISE EXCEPTION 'Unexpected current-membership guard body: %',item.name USING ERRCODE='23514';
    END IF;
    EXECUTE regexp_replace(definition,'\mworkspace_membership\M','active_workspace_membership','g');
  END LOOP;
END;
$$;
