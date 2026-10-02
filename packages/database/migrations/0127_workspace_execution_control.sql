-- Durable workspace-scoped hold and exact transition history. Admission guards
-- are a separate rollout requirement; this schema alone does not stop dispatch.
CREATE TABLE workspace_execution_control (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','paused')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  reason text NOT NULL DEFAULT '' CHECK(char_length(reason)<=500 AND reason=btrim(reason) AND reason !~ '[[:cntrl:]]'),
  updated_by uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  updated_by_incarnation_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((revision=1 AND state='open' AND reason='' AND updated_by IS NULL AND updated_by_incarnation_id IS NULL)
    OR (revision>1 AND reason<>'' AND updated_by IS NOT NULL AND updated_by_incarnation_id IS NOT NULL))
);

CREATE FUNCTION guard_workspace_execution_control() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM workspace WHERE id=OLD.workspace_id) THEN
      RAISE EXCEPTION 'Workspace execution state must be retained' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>1 OR NEW.state<>'open' OR NEW.reason<>'' OR NEW.updated_by IS NOT NULL
      OR NEW.updated_by_incarnation_id IS NOT NULL OR NEW.updated_at<>NEW.created_at THEN
      RAISE EXCEPTION 'Workspace execution state starts with an unattributed open revision' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF ROW(NEW.workspace_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.workspace_id,OLD.created_at)
    OR OLD.revision=2147483647 OR NEW.revision::bigint<>OLD.revision::bigint+1 OR NEW.state=OLD.state
    OR NEW.reason='' OR NOT EXISTS(SELECT 1 FROM active_workspace_membership
      WHERE workspace_id=NEW.workspace_id AND user_id=NEW.updated_by AND incarnation_id=NEW.updated_by_incarnation_id
        AND role IN ('owner','admin')) THEN
    RAISE EXCEPTION 'Execution transitions require current administration and the next revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_execution_control_guard BEFORE INSERT OR UPDATE OR DELETE ON workspace_execution_control
  FOR EACH ROW EXECUTE FUNCTION guard_workspace_execution_control();

INSERT INTO workspace_execution_control(workspace_id,created_at,updated_at)
  SELECT id,created_at,created_at FROM workspace;
CREATE FUNCTION initialize_workspace_execution_control() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO workspace_execution_control(workspace_id,created_at,updated_at) VALUES(NEW.id,NEW.created_at,NEW.created_at);
  RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_execution_control_initialize AFTER INSERT ON workspace
  FOR EACH ROW EXECUTE FUNCTION initialize_workspace_execution_control();

CREATE TABLE workspace_execution_control_receipt (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  expected_actor_incarnation_id uuid NOT NULL,
  expected_revision integer NOT NULL CHECK(expected_revision>0 AND expected_revision<2147483647),
  previous_state text NOT NULL CHECK(previous_state IN ('open','paused')),
  state text NOT NULL CHECK(state IN ('open','paused') AND state<>previous_state),
  revision integer NOT NULL CHECK(revision::bigint=expected_revision::bigint+1),
  reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 500 AND reason=btrim(reason) AND reason !~ '[[:cntrl:]]'),
  changed_at timestamptz NOT NULL,
  canonical_request text NOT NULL CHECK(octet_length(canonical_request)<=4096),
  PRIMARY KEY(workspace_id,request_id),
  UNIQUE(workspace_id,revision),
  CHECK((jsonb_typeof(canonical_request::jsonb)='object'
    AND jsonb_typeof(canonical_request::jsonb->'workspaceId')='string' AND canonical_request::jsonb->>'workspaceId'=workspace_id::text
    AND jsonb_typeof(canonical_request::jsonb->'requestId')='string' AND canonical_request::jsonb->>'requestId'=request_id::text
    AND jsonb_typeof(canonical_request::jsonb->'expectedActorIncarnationId')='string' AND canonical_request::jsonb->>'expectedActorIncarnationId'=expected_actor_incarnation_id::text
    AND canonical_request::jsonb->'expectedRevision'=to_jsonb(expected_revision)
    AND jsonb_typeof(canonical_request::jsonb->'state')='string' AND canonical_request::jsonb->>'state'=state
    AND jsonb_typeof(canonical_request::jsonb->'reason')='string' AND canonical_request::jsonb->>'reason'=reason
    AND canonical_request::jsonb - ARRAY['workspaceId','requestId','expectedActorIncarnationId','expectedRevision','state','reason']='{}'::jsonb) IS TRUE)
);

CREATE FUNCTION protect_workspace_execution_control_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS(SELECT 1 FROM active_workspace_membership WHERE workspace_id=NEW.workspace_id
      AND user_id=NEW.created_by AND incarnation_id=NEW.expected_actor_incarnation_id AND role IN ('owner','admin'))
      OR NOT EXISTS(SELECT 1 FROM workspace_execution_control WHERE workspace_id=NEW.workspace_id
        AND state=NEW.state AND revision=NEW.revision AND reason=NEW.reason AND updated_at=NEW.changed_at
        AND updated_by=NEW.created_by AND updated_by_incarnation_id=NEW.expected_actor_incarnation_id) THEN
      RAISE EXCEPTION 'Execution receipt requires exact current transition evidence' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM workspace WHERE id=OLD.workspace_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Execution receipts are immutable and must be retained' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER workspace_execution_control_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON workspace_execution_control_receipt
  FOR EACH ROW EXECUTE FUNCTION protect_workspace_execution_control_receipt();
