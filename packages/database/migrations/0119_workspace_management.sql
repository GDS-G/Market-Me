-- Explicit owner-created empty workspaces and revision-checked display-name edits.
-- No identity provisioning, organization membership, connection or content inheritance.
ALTER TABLE workspace ADD COLUMN settings_revision integer NOT NULL DEFAULT 1 CHECK (settings_revision > 0);
ALTER TABLE workspace ADD CONSTRAINT workspace_organization_identity UNIQUE (id, organization_id);

CREATE FUNCTION guard_workspace_management_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.slug IS DISTINCT FROM OLD.slug OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Workspace identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    IF NEW.settings_revision <> OLD.settings_revision + 1
      OR char_length(NEW.name) NOT BETWEEN 1 AND 120
      OR NEW.name <> btrim(NEW.name) OR NEW.name ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'Workspace names require a bounded label and next revision' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.settings_revision IS DISTINCT FROM OLD.settings_revision THEN
    RAISE EXCEPTION 'Workspace revision changes require a display-name change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_management_revision_guard BEFORE UPDATE ON workspace
  FOR EACH ROW EXECUTE FUNCTION guard_workspace_management_revision();

CREATE TABLE workspace_management_receipt (
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('create','rename')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  revision integer NOT NULL CHECK (revision > 0),
  canonical_request text NOT NULL CHECK (octet_length(canonical_request) <= 4096),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, request_id),
  FOREIGN KEY (workspace_id, organization_id) REFERENCES workspace(id, organization_id) ON DELETE CASCADE,
  CHECK ((jsonb_typeof(canonical_request::jsonb) = 'object'
    AND canonical_request::jsonb->>'operation' = operation
    AND canonical_request::jsonb->>'requestId' = request_id::text
    AND canonical_request::jsonb->>'name' = name
    AND CASE WHEN operation='create' THEN
      revision=1 AND canonical_request::jsonb->>'organizationId' = organization_id::text
      AND canonical_request::jsonb - ARRAY['operation','organizationId','requestId','name'] = '{}'::jsonb
    ELSE
      revision>1 AND canonical_request::jsonb->>'workspaceId' = workspace_id::text
      AND canonical_request::jsonb->'expectedRevision' = to_jsonb(revision-1)
      AND canonical_request::jsonb - ARRAY['operation','workspaceId','requestId','expectedRevision','name'] = '{}'::jsonb
    END) IS TRUE)
);
CREATE INDEX workspace_management_receipt_workspace ON workspace_management_receipt(workspace_id, created_at DESC);

CREATE FUNCTION protect_workspace_management_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM workspace WHERE id=NEW.workspace_id AND organization_id=NEW.organization_id
      AND name=NEW.name AND settings_revision=NEW.revision) THEN
      RAISE EXCEPTION 'Workspace receipt must match its committed name and revision' USING ERRCODE = '23514';
    END IF;
    IF NEW.operation='create' THEN
      IF NOT EXISTS (SELECT 1 FROM organization_membership WHERE organization_id=NEW.organization_id
        AND user_id=NEW.created_by AND role='owner')
        OR NOT EXISTS (SELECT 1 FROM workspace_membership WHERE workspace_id=NEW.workspace_id
          AND user_id=NEW.created_by AND role='owner') THEN
        RAISE EXCEPTION 'Workspace creation requires its current organization owner' USING ERRCODE = '23514';
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM workspace_membership WHERE workspace_id=NEW.workspace_id
      AND user_id=NEW.created_by AND role IN ('owner','admin')) THEN
      RAISE EXCEPTION 'Workspace renaming requires current workspace administration' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM organization WHERE id=OLD.organization_id)
      AND EXISTS (SELECT 1 FROM workspace WHERE id=OLD.workspace_id) THEN
      RAISE EXCEPTION 'Workspace management receipts must be retained' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Workspace management receipts are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER workspace_management_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON workspace_management_receipt
  FOR EACH ROW EXECUTE FUNCTION protect_workspace_management_receipt();
