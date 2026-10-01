-- Reusable values only: no preparation, approval, source binding or execution authority.
CREATE TABLE preparation_preset (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  latest_version_number integer NOT NULL DEFAULT 1 CHECK (latest_version_number > 0),
  archived boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, workspace_id)
);
CREATE INDEX preparation_preset_workspace_order ON preparation_preset(workspace_id, updated_at DESC, id);

CREATE TABLE preparation_preset_version (
  preset_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  notes text NOT NULL CHECK (char_length(notes) <= 2000),
  configuration jsonb NOT NULL CHECK ((jsonb_typeof(configuration) = 'object' AND octet_length(configuration::text) <= 32768
    AND configuration->>'templateKey' = 'general_announcement' AND configuration->'templateVersion' = '1'::jsonb
    AND configuration - ARRAY['templateKey','templateVersion','name','description','brandProfileVersionId',
      'audienceProfileVersionIds','destinationId','informationDepth','promotionalStrength','timezone'] = '{}'::jsonb
    AND jsonb_typeof(configuration->'name') = 'string' AND char_length(configuration->>'name') BETWEEN 1 AND 200
    AND jsonb_typeof(configuration->'description') = 'string' AND char_length(configuration->>'description') <= 5000
    AND jsonb_typeof(configuration->'timezone') = 'string' AND char_length(configuration->>'timezone') BETWEEN 1 AND 100
    AND configuration->>'informationDepth' IN ('minimal','teaser','contextual','detailed','comprehensive','custom')
    AND configuration->>'promotionalStrength' IN ('informational','subtle','light','standard','strong','campaign_push','custom')
    AND CASE WHEN jsonb_typeof(configuration->'audienceProfileVersionIds') = 'array'
      THEN jsonb_array_length(configuration->'audienceProfileVersionIds') <= 20 ELSE false END) IS TRUE),
  canonical_configuration text NOT NULL CHECK (octet_length(canonical_configuration) <= 32768),
  configuration_hash text NOT NULL CHECK (configuration_hash ~ '^[0-9a-f]{64}$'),
  copied_from_preset_id uuid,
  copied_from_version_number integer,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (preset_id, version_number),
  UNIQUE (preset_id, workspace_id, version_number),
  FOREIGN KEY (preset_id, workspace_id) REFERENCES preparation_preset(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (copied_from_preset_id, workspace_id, copied_from_version_number)
    REFERENCES preparation_preset_version(preset_id, workspace_id, version_number) DEFERRABLE INITIALLY DEFERRED,
  CHECK ((copied_from_preset_id IS NULL) = (copied_from_version_number IS NULL)),
  CHECK (configuration = canonical_configuration::jsonb),
  CHECK (configuration_hash = encode(sha256(convert_to(canonical_configuration,'UTF8')),'hex'))
);
ALTER TABLE preparation_preset ADD CONSTRAINT preparation_preset_latest_version_fk
  FOREIGN KEY (id, workspace_id, latest_version_number)
  REFERENCES preparation_preset_version(preset_id, workspace_id, version_number) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE preparation_preset_receipt (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('create','revise','clone','archive','restore')),
  preset_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  revision integer NOT NULL CHECK (revision > 0),
  archived boolean NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  canonical_request text NOT NULL CHECK (octet_length(canonical_request) <= 32768),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, request_id),
  FOREIGN KEY (preset_id, workspace_id, version_number)
    REFERENCES preparation_preset_version(preset_id, workspace_id, version_number) DEFERRABLE INITIALLY DEFERRED
);

CREATE FUNCTION protect_preparation_preset_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM workspace_membership WHERE workspace_id=NEW.workspace_id
      AND user_id=NEW.created_by AND role IN ('owner','admin','editor')) THEN
      RAISE EXCEPTION 'Preset history requires a current workspace writer' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'preparation_preset' THEN
      IF NEW.revision <> 1 OR NEW.latest_version_number <> 1 OR NEW.archived THEN
        RAISE EXCEPTION 'A new preset starts at available revision and version one' USING ERRCODE = '23514';
      END IF;
    ELSIF TG_TABLE_NAME = 'preparation_preset_version' THEN
      IF NOT EXISTS (SELECT 1 FROM preparation_preset WHERE id=NEW.preset_id AND workspace_id=NEW.workspace_id
        AND latest_version_number=NEW.version_number AND NOT archived)
        OR (NEW.copied_from_preset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM preparation_preset
          WHERE id=NEW.copied_from_preset_id AND workspace_id=NEW.workspace_id AND NOT archived)) THEN
        RAISE EXCEPTION 'Preset version must match the available workspace root' USING ERRCODE = '23514';
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM preparation_preset p JOIN preparation_preset_version v
          ON v.preset_id=p.id AND v.version_number=p.latest_version_number
        WHERE p.id=NEW.preset_id AND p.workspace_id=NEW.workspace_id AND p.revision=NEW.revision
          AND p.latest_version_number=NEW.version_number AND p.archived=NEW.archived AND v.title=NEW.title)
        OR (NEW.canonical_request::jsonb->>'operation') IS DISTINCT FROM NEW.operation
        OR (NEW.canonical_request::jsonb->>'workspaceId') IS DISTINCT FROM NEW.workspace_id::text
        OR (NEW.canonical_request::jsonb->>'requestId') IS DISTINCT FROM NEW.request_id::text THEN
        RAISE EXCEPTION 'Preset receipt must match its exact request and committed library result' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM workspace WHERE id = OLD.workspace_id) THEN
      RAISE EXCEPTION 'Preparation preset history must be retained; archive the preset instead' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME <> 'preparation_preset' THEN
    RAISE EXCEPTION 'Preparation preset versions and request receipts are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.revision <> OLD.revision + 1
    OR NEW.latest_version_number NOT IN (OLD.latest_version_number, OLD.latest_version_number + 1)
    OR (NEW.latest_version_number <> OLD.latest_version_number AND (OLD.archived OR NEW.archived))
    OR (NEW.latest_version_number = OLD.latest_version_number AND NEW.archived = OLD.archived) THEN
    RAISE EXCEPTION 'Preparation preset updates require one new version or archive-state transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preparation_preset_guard BEFORE INSERT OR UPDATE OR DELETE ON preparation_preset
  FOR EACH ROW EXECUTE FUNCTION protect_preparation_preset_history();
CREATE TRIGGER preparation_preset_version_guard BEFORE INSERT OR UPDATE OR DELETE ON preparation_preset_version
  FOR EACH ROW EXECUTE FUNCTION protect_preparation_preset_history();
CREATE TRIGGER preparation_preset_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON preparation_preset_receipt
  FOR EACH ROW EXECUTE FUNCTION protect_preparation_preset_history();
