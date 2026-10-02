-- Historical activation receipts are additive: existing runs are not backfilled.
CREATE TABLE campaign_activation_receipt (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  expected_version_id uuid NOT NULL REFERENCES campaign_version(id),
  expected_actor_incarnation_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id),
  instance_id uuid NOT NULL UNIQUE REFERENCES campaign_instance(id) ON DELETE CASCADE,
  initial_status text NOT NULL CHECK(initial_status IN ('scheduled','awaiting_approval')),
  accepted_at timestamptz NOT NULL,
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

CREATE FUNCTION protect_campaign_activation_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS(SELECT 1 FROM active_workspace_membership WHERE workspace_id=NEW.workspace_id
      AND user_id=NEW.created_by AND incarnation_id=NEW.expected_actor_incarnation_id AND role IN ('owner','admin','editor'))
      OR NOT EXISTS(SELECT 1 FROM campaign_instance instance
        JOIN campaign campaign ON campaign.id=instance.campaign_id AND campaign.workspace_id=instance.workspace_id
        JOIN campaign_version version ON version.id=instance.campaign_version_id AND version.campaign_id=campaign.id
        WHERE instance.id=NEW.instance_id AND instance.workspace_id=NEW.workspace_id
          AND instance.campaign_id=NEW.campaign_id AND instance.campaign_version_id=NEW.expected_version_id
          AND instance.requested_by=NEW.created_by AND instance.status=NEW.initial_status AND instance.created_at=NEW.accepted_at
          AND version.status='published' AND campaign.current_version_id=version.id) THEN
      RAISE EXCEPTION 'Activation receipt requires exact current grant and original run evidence' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM workspace WHERE id=OLD.workspace_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Activation receipts are immutable and must be retained' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER campaign_activation_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON campaign_activation_receipt
  FOR EACH ROW EXECUTE FUNCTION protect_campaign_activation_receipt();

CREATE FUNCTION preserve_receipted_campaign_instance_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.workspace_id,NEW.campaign_id,NEW.campaign_version_id,NEW.requested_by,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.workspace_id,OLD.campaign_id,OLD.campaign_version_id,OLD.requested_by,OLD.created_at)
    AND EXISTS(SELECT 1 FROM campaign_activation_receipt WHERE instance_id=OLD.id) THEN
    RAISE EXCEPTION 'Receipted activation identity must be retained' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER campaign_instance_activation_identity_guard BEFORE UPDATE ON campaign_instance
  FOR EACH ROW EXECUTE FUNCTION preserve_receipted_campaign_instance_identity();
