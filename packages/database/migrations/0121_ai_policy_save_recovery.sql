-- Metadata-only revision initialization; existing policy amounts and choices are untouched.
ALTER TABLE workspace_ai_policy ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);

CREATE FUNCTION advance_workspace_ai_policy_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM workspace WHERE id=OLD.workspace_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Policy history cannot be reset by deleting its current row' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revision <> 1 THEN RAISE EXCEPTION 'Initial policy revision must be one' USING ERRCODE='23514'; END IF;
  ELSE
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.revision IS DISTINCT FROM OLD.revision THEN
      RAISE EXCEPTION 'Policy identity and revision cannot be reassigned' USING ERRCODE='23514';
    END IF;
    IF OLD.revision = 2147483647 THEN RAISE EXCEPTION 'Policy revision limit reached' USING ERRCODE='23514'; END IF;
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER workspace_ai_policy_revision BEFORE INSERT OR UPDATE OR DELETE ON workspace_ai_policy
  FOR EACH ROW EXECUTE FUNCTION advance_workspace_ai_policy_revision();

CREATE TABLE workspace_ai_policy_save_receipt (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  policy_snapshot jsonb NOT NULL,
  canonical_request text NOT NULL CHECK (octet_length(canonical_request) <= 4096),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id,request_id),
  CHECK ((jsonb_typeof(canonical_request::jsonb)='object'
    AND canonical_request::jsonb->>'workspaceId'=workspace_id::text
    AND canonical_request::jsonb->>'requestId'=request_id::text
    AND canonical_request::jsonb->'expectedRevision'=to_jsonb(revision-1)
    AND canonical_request::jsonb - ARRAY['requestId','expectedRevision'] = policy_snapshot) IS TRUE)
);
CREATE INDEX workspace_ai_policy_save_receipt_actor ON workspace_ai_policy_save_receipt(workspace_id,created_by,created_at DESC);

CREATE FUNCTION protect_workspace_ai_policy_save_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual jsonb;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT jsonb_strip_nulls(jsonb_build_object('workspaceId',p.workspace_id,'mode',p.mode,
      'maximumPrivacyClass',p.maximum_privacy_class,'failoverMode',p.failover_mode,'capBehavior',p.cap_behavior,
      'currency',p.currency,'dailyBudgetMinor',p.daily_budget_minor,'campaignBudgetMinor',p.campaign_budget_minor,
      'monthlyBudgetMinor',p.monthly_budget_minor,'alertThresholdPercentages',p.alert_threshold_percentages)) INTO actual
      FROM workspace_ai_policy p WHERE p.workspace_id=NEW.workspace_id AND p.revision=NEW.revision AND p.updated_by=NEW.created_by;
    IF actual IS NULL OR actual IS DISTINCT FROM NEW.policy_snapshot
      OR NOT EXISTS (SELECT 1 FROM workspace_membership WHERE workspace_id=NEW.workspace_id
        AND user_id=NEW.created_by AND role IN ('owner','admin','editor')) THEN
      RAISE EXCEPTION 'Policy receipt must match the committed policy and current writer' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' AND NOT EXISTS (SELECT 1 FROM workspace WHERE id=OLD.workspace_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Policy save receipts are immutable and must be retained' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER workspace_ai_policy_save_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON workspace_ai_policy_save_receipt
  FOR EACH ROW EXECUTE FUNCTION protect_workspace_ai_policy_save_receipt();
