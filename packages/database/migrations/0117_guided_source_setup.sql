-- One immutable create receipt per workspace/request. This is not an activation command.
CREATE TABLE smart_source_setup_receipt (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  smart_source_id uuid NOT NULL UNIQUE REFERENCES smart_source(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  canonical_request text NOT NULL CHECK (octet_length(canonical_request) <= 32768),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, request_id)
);

CREATE FUNCTION protect_smart_source_setup_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM workspace WHERE id = OLD.workspace_id) THEN
      RAISE EXCEPTION 'Source setup receipts survive individual source deletion' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Source setup receipts are immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM smart_source WHERE id = NEW.smart_source_id
      AND workspace_id = NEW.workspace_id AND created_by = NEW.created_by AND version = 1 AND enabled = false)
    OR NOT EXISTS (SELECT 1 FROM workspace_membership WHERE workspace_id = NEW.workspace_id
      AND user_id = NEW.created_by AND role IN ('owner', 'admin', 'editor')) THEN
    RAISE EXCEPTION 'Source setup receipt scope and initial state are invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER smart_source_setup_receipt_protection
  BEFORE INSERT OR UPDATE OR DELETE ON smart_source_setup_receipt
  FOR EACH ROW EXECUTE FUNCTION protect_smart_source_setup_receipt();
