-- A terminal no-run result resolves uncertainty without retrying activation.
CREATE TABLE campaign_activation_closure (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  expected_version_id uuid NOT NULL REFERENCES campaign_version(id),
  expected_actor_incarnation_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id),
  closed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  canonical_request text NOT NULL CHECK(octet_length(canonical_request)<=2048),
  PRIMARY KEY(workspace_id,request_id),
  CHECK((jsonb_typeof(canonical_request::jsonb)='object'
    AND jsonb_typeof(canonical_request::jsonb->'workspaceId')='string' AND canonical_request::jsonb->>'workspaceId'=workspace_id::text
    AND jsonb_typeof(canonical_request::jsonb->'campaignId')='string' AND canonical_request::jsonb->>'campaignId'=campaign_id::text
    AND jsonb_typeof(canonical_request::jsonb->'requestId')='string' AND canonical_request::jsonb->>'requestId'=request_id::text
    AND jsonb_typeof(canonical_request::jsonb->'expectedVersionId')='string' AND canonical_request::jsonb->>'expectedVersionId'=expected_version_id::text
    AND jsonb_typeof(canonical_request::jsonb->'expectedActorIncarnationId')='string' AND canonical_request::jsonb->>'expectedActorIncarnationId'=expected_actor_incarnation_id::text
    AND canonical_request::jsonb - ARRAY['workspaceId','campaignId','requestId','expectedVersionId','expectedActorIncarnationId']='{}'::jsonb) IS TRUE)
);
CREATE FUNCTION protect_campaign_activation_closure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    -- UUID text is canonical and contains no escaping characters. Use exactly the
    -- application's compact JSON key, not PostgreSQL's whitespace-bearing JSON text.
    PERFORM pg_advisory_xact_lock(hashtextextended('["campaign-activation-v1","'||NEW.workspace_id::text||'","'||NEW.request_id::text||'"]',0));
    IF EXISTS(SELECT 1 FROM campaign_activation_receipt WHERE workspace_id=NEW.workspace_id AND request_id=NEW.request_id)
      OR NOT EXISTS(SELECT 1 FROM active_workspace_membership WHERE workspace_id=NEW.workspace_id AND user_id=NEW.created_by)
      OR NOT EXISTS(SELECT 1 FROM campaign c JOIN campaign_version v ON v.campaign_id=c.id
        WHERE c.workspace_id=NEW.workspace_id AND c.id=NEW.campaign_id AND v.id=NEW.expected_version_id) THEN
      RAISE EXCEPTION 'Only an unaccepted scoped activation request can be closed' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM workspace WHERE id=OLD.workspace_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Activation closures are immutable and must be retained' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER campaign_activation_closure_guard BEFORE INSERT OR UPDATE OR DELETE ON campaign_activation_closure
  FOR EACH ROW EXECUTE FUNCTION protect_campaign_activation_closure();

CREATE FUNCTION prevent_closed_campaign_activation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('["campaign-activation-v1","'||NEW.workspace_id::text||'","'||NEW.request_id::text||'"]',0));
  IF EXISTS(SELECT 1 FROM campaign_activation_closure WHERE workspace_id=NEW.workspace_id AND request_id=NEW.request_id) THEN
    RAISE EXCEPTION 'Closed activation requests cannot be accepted' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER campaign_activation_receipt_closed_guard BEFORE INSERT ON campaign_activation_receipt
  FOR EACH ROW EXECUTE FUNCTION prevent_closed_campaign_activation();
