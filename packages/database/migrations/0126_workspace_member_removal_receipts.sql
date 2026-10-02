CREATE FUNCTION valid_workspace_member_removal_impact(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(value)='object' THEN (value ?& ARRAY['assignedConversations','enabledRoutingRules','openConversationReviews','pendingCampaignApprovals',
      'pendingIncomingInvitations','pendingIssuedInvitations','enabledSourceBindings','queuedSourceCommands',
      'preparedAiIntents','activeCampaignRuns','ownedDestinations']
    AND value - ARRAY['assignedConversations','enabledRoutingRules','openConversationReviews','pendingCampaignApprovals',
      'pendingIncomingInvitations','pendingIssuedInvitations','enabledSourceBindings','queuedSourceCommands',
      'preparedAiIntents','activeCampaignRuns','ownedDestinations']='{}'::jsonb
    AND (SELECT bool_and(jsonb_typeof(entry)='string' AND (entry #>> '{}') ~ '^(0|[1-9][0-9]{0,18})$')
      FROM jsonb_each(value) AS item(name,entry))) IS TRUE ELSE false END
$$;

CREATE TABLE workspace_member_removal_receipt (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  target_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  expected_incarnation_id uuid NOT NULL,
  previous_role text NOT NULL CHECK(previous_role IN ('admin','editor','approver','analyst','viewer')),
  revision integer NOT NULL CHECK(revision>1),
  reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 500 AND reason=btrim(reason) AND reason !~ '[[:cntrl:]]'),
  impact_fingerprint text NOT NULL CHECK(impact_fingerprint ~ '^[0-9a-f]{64}$'),
  impact jsonb NOT NULL CHECK(valid_workspace_member_removal_impact(impact)),
  revoked_at timestamptz NOT NULL,
  canonical_request text NOT NULL CHECK(octet_length(canonical_request)<=4096),
  PRIMARY KEY(workspace_id,request_id),
  CHECK(created_by<>target_user_id),
  CHECK((jsonb_typeof(canonical_request::jsonb)='object'
    AND jsonb_typeof(canonical_request::jsonb->'workspaceId')='string' AND canonical_request::jsonb->>'workspaceId'=workspace_id::text
    AND jsonb_typeof(canonical_request::jsonb->'targetUserId')='string' AND canonical_request::jsonb->>'targetUserId'=target_user_id::text
    AND jsonb_typeof(canonical_request::jsonb->'requestId')='string' AND canonical_request::jsonb->>'requestId'=request_id::text
    AND jsonb_typeof(canonical_request::jsonb->'expectedIncarnationId')='string' AND canonical_request::jsonb->>'expectedIncarnationId'=expected_incarnation_id::text
    AND canonical_request::jsonb->'expectedRevision'=to_jsonb(revision-1)
    AND jsonb_typeof(canonical_request::jsonb->'reason')='string' AND canonical_request::jsonb->>'reason'=reason
    AND jsonb_typeof(canonical_request::jsonb->'impactFingerprint')='string' AND canonical_request::jsonb->>'impactFingerprint'=impact_fingerprint
    AND canonical_request::jsonb - ARRAY['workspaceId','targetUserId','requestId','expectedIncarnationId','expectedRevision','impactFingerprint','reason']='{}'::jsonb) IS TRUE)
);

CREATE FUNCTION protect_workspace_member_removal_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM active_workspace_membership WHERE workspace_id=NEW.workspace_id AND user_id=NEW.created_by AND role IN ('owner','admin'))
      OR NOT EXISTS (SELECT 1 FROM workspace_membership WHERE workspace_id=NEW.workspace_id AND user_id=NEW.target_user_id
        AND incarnation_id=NEW.expected_incarnation_id AND role=NEW.previous_role AND role_revision=NEW.revision AND revoked_at=NEW.revoked_at)
      OR NEW.impact->>'pendingIncomingInvitations'<>'0' OR NEW.impact->>'pendingIssuedInvitations'<>'0' THEN
      RAISE EXCEPTION 'Removal receipt requires current administration and the exact revoked grant result' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM workspace WHERE id=OLD.workspace_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Member removal receipts are immutable and must be retained' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER workspace_member_removal_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON workspace_member_removal_receipt
  FOR EACH ROW EXECUTE FUNCTION protect_workspace_member_removal_receipt();
