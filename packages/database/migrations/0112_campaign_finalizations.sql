-- Completed-only receipt: inserting the executable draft and its proof is one
-- transaction. No provider action, publication, or activation is implied here.
CREATE TABLE campaign_finalization (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  preparation_id uuid NOT NULL UNIQUE REFERENCES campaign_preparation(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL UNIQUE REFERENCES campaign(id) ON DELETE RESTRICT,
  planning_version_id uuid NOT NULL REFERENCES campaign_version(id) ON DELETE RESTRICT,
  finalized_version_id uuid NOT NULL UNIQUE REFERENCES campaign_version(id) ON DELETE RESTRICT,
  content_draft_id uuid NOT NULL REFERENCES content_draft(id) ON DELETE RESTRICT,
  content_draft_version_id uuid NOT NULL REFERENCES content_draft_version(id) ON DELETE RESTRICT,
  draft_channel_preview_id uuid NOT NULL REFERENCES draft_channel_preview(id) ON DELETE RESTRICT,
  preview_fingerprint text NOT NULL CHECK (preview_fingerprint ~ '^mm-preview-v1:sha256:[0-9a-f]{64}$'),
  canonical_preview_snapshot text NOT NULL CHECK (octet_length(canonical_preview_snapshot) BETWEEN 1 AND 1048576),
  canonical_input text NOT NULL CHECK (octet_length(canonical_input) BETWEEN 1 AND 65536),
  compiled_definition jsonb NOT NULL CHECK (jsonb_typeof(compiled_definition) = 'object'),
  configuration_hash text NOT NULL CHECK (configuration_hash ~ '^[0-9a-f]{64}$'),
  template_version integer NOT NULL CHECK (template_version = 1),
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key),
  CHECK (planning_version_id <> finalized_version_id),
  CHECK (configuration_hash = encode(sha256(convert_to(canonical_input, 'UTF8')), 'hex')),
  CHECK (preview_fingerprint = 'mm-preview-v1:sha256:' ||
    encode(sha256(convert_to(E'market-me:exact-preview:v1\n' || canonical_preview_snapshot, 'UTF8')), 'hex'))
);

CREATE INDEX campaign_finalization_workspace_time_idx ON campaign_finalization(workspace_id, created_at DESC);

CREATE FUNCTION enforce_campaign_finalization_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  preparation campaign_preparation%ROWTYPE;
  final_version campaign_version%ROWTYPE;
  selected_step campaign_step%ROWTYPE;
  snapshot jsonb;
  intent jsonb;
  timing jsonb;
  expected_inputs jsonb;
  actual_definition jsonb;
  expected_configuration jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Campaign finalization receipts are immutable' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO preparation FROM campaign_preparation p
  WHERE p.id = NEW.preparation_id AND p.workspace_id = NEW.workspace_id
    AND p.campaign_id = NEW.campaign_id AND p.planning_version_id = NEW.planning_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign finalization preparation lineage is invalid' USING ERRCODE = '23514';
  END IF;
  SELECT final.* INTO final_version FROM campaign_version final
  JOIN campaign c ON c.id = final.campaign_id
  JOIN campaign_version planning ON planning.id = NEW.planning_version_id AND planning.campaign_id = c.id
  WHERE final.id = NEW.finalized_version_id AND final.status = 'draft'
    AND c.id = NEW.campaign_id AND c.workspace_id = NEW.workspace_id AND c.status <> 'archived'
    AND c.current_version_id = planning.id AND planning.status = 'published' AND planning.autonomy_mode = 'draft_only';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign finalization version lineage is invalid' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM content_draft d
    JOIN content_draft_version v ON v.id = NEW.content_draft_version_id AND v.content_draft_id = d.id
    JOIN draft_channel_preview preview ON preview.id = NEW.draft_channel_preview_id
      AND preview.content_draft_id = d.id AND preview.content_draft_version_id = v.id
    WHERE d.id = NEW.content_draft_id AND d.workspace_id = NEW.workspace_id
      AND d.draft_generation_id = preparation.generation_id AND d.current_version_id = v.id
      AND d.status = 'approved' AND v.status = 'approved' AND preview.workspace_id = NEW.workspace_id
      AND preview.status = 'ready'
      AND EXISTS (SELECT 1 FROM content_draft_approval a WHERE a.content_draft_version_id = v.id
        AND a.workspace_id = NEW.workspace_id AND a.content_draft_id = d.id AND a.status = 'approved')
      AND NOT EXISTS (SELECT 1 FROM draft_channel_preview_asset asset WHERE asset.draft_channel_preview_id = preview.id)
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(preparation.prepared_drafts) entry WHERE entry->>'draftId' = d.id::text)
  ) THEN
    RAISE EXCEPTION 'Campaign finalization approved draft lineage is invalid' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM campaign_step WHERE campaign_version_id = final_version.id) <> 1 THEN
    RAISE EXCEPTION 'Campaign finalization must retain exactly one reviewed publication step' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO selected_step FROM campaign_step WHERE campaign_version_id = final_version.id;
  snapshot := NEW.canonical_preview_snapshot::jsonb;
  intent := NEW.canonical_input::jsonb;
  IF snapshot->>'schemaVersion' IS DISTINCT FROM '1'
    OR snapshot->>'rendererContract' IS DISTINCT FROM 'stored-channel-preview-text-v1'
    OR snapshot->'lineage' IS DISTINCT FROM jsonb_build_object(
      'workspaceId', NEW.workspace_id::text, 'campaignId', NEW.campaign_id::text,
      'sourceCampaignVersionId', NEW.planning_version_id::text, 'generationId', preparation.generation_id::text,
      'previewId', NEW.draft_channel_preview_id::text, 'contentDraftId', NEW.content_draft_id::text,
      'contentDraftVersionId', NEW.content_draft_version_id::text)
    OR snapshot#>'{preview,assets}' IS DISTINCT FROM '[]'::jsonb
    OR snapshot#>>'{preview,provider}' NOT IN ('discord_webhook', 'slack_webhook', 'mastodon_account')
    OR NOT EXISTS (SELECT 1 FROM draft_channel_preview preview
      WHERE preview.id = NEW.draft_channel_preview_id
        AND preview.channel_connection_id::text = snapshot#>>'{preview,channelConnectionId}'
        AND preview.provider = snapshot#>>'{preview,provider}'
        AND preview.destination_id::text IS NOT DISTINCT FROM snapshot#>>'{preview,destinationId}') THEN
    RAISE EXCEPTION 'Campaign finalization snapshot lineage is invalid' USING ERRCODE = '23514';
  END IF;
  expected_inputs := jsonb_build_object('draftChannelPreviewId', NEW.draft_channel_preview_id::text,
    'draftChannelPreviewFingerprint', NEW.preview_fingerprint,
    'channelConnectionId', snapshot#>>'{preview,channelConnectionId}');
  IF selected_step.step_key <> 'publish_prepared_preview' OR selected_step.name <> 'Publish reviewed preview'
    OR selected_step.operation_type <> 'publish_content' OR selected_step.desired_capability <> 'publish_content'
    OR selected_step.depends_on <> '{}'::text[] OR selected_step.dependency_delay_seconds <> 0
    OR selected_step.inputs IS DISTINCT FROM expected_inputs OR selected_step.outputs <> '{}'::jsonb
    OR selected_step.execution_methods <> ARRAY['official_api']::text[] OR NOT selected_step.approval_required
    OR selected_step.condition <> '{}'::jsonb OR selected_step.max_attempts <> 3
    OR selected_step.timeout_seconds <> 300 OR selected_step.optional OR selected_step.sort_order <> 0 THEN
    RAISE EXCEPTION 'Campaign finalization step does not match the fixed reviewed template' USING ERRCODE = '23514';
  END IF;
  IF selected_step.schedule_type = 'immediate' AND selected_step.scheduled_at IS NULL
    AND selected_step.preferred_window_start IS NULL AND selected_step.preferred_window_end IS NULL THEN
    timing := jsonb_build_object('type', 'immediate');
  ELSIF selected_step.schedule_type = 'exact_time' AND selected_step.scheduled_at >= '0001-01-01 00:00:00+00'::timestamptz
    AND selected_step.scheduled_at < '10000-01-01 00:00:00+00'::timestamptz
    AND date_trunc('milliseconds', selected_step.scheduled_at) = selected_step.scheduled_at
    AND selected_step.preferred_window_start IS NULL AND selected_step.preferred_window_end IS NULL THEN
    timing := jsonb_build_object('type', 'exact_time', 'scheduledAt', to_char(selected_step.scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  ELSIF selected_step.schedule_type = 'preferred_window' AND selected_step.scheduled_at IS NULL
    AND selected_step.preferred_window_start >= '0001-01-01 00:00:00+00'::timestamptz
    AND selected_step.preferred_window_end < '10000-01-01 00:00:00+00'::timestamptz
    AND selected_step.preferred_window_start < selected_step.preferred_window_end
    AND date_trunc('milliseconds', selected_step.preferred_window_start) = selected_step.preferred_window_start
    AND date_trunc('milliseconds', selected_step.preferred_window_end) = selected_step.preferred_window_end THEN
    timing := jsonb_build_object('type', 'preferred_window',
      'start', to_char(selected_step.preferred_window_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'end', to_char(selected_step.preferred_window_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  ELSE
    RAISE EXCEPTION 'Campaign finalization timing is invalid' USING ERRCODE = '23514';
  END IF;
  IF intent IS DISTINCT FROM jsonb_build_object('compiler', 'market-me:campaign-finalization', 'input', jsonb_build_object(
    'templateVersion', 1, 'workspaceId', NEW.workspace_id::text, 'preparationId', NEW.preparation_id::text,
    'expectedPlanningVersionId', NEW.planning_version_id::text, 'draftId', NEW.content_draft_id::text,
    'expectedDraftVersionId', NEW.content_draft_version_id::text, 'previewId', NEW.draft_channel_preview_id::text,
    'expectedPreviewFingerprint', NEW.preview_fingerprint, 'timing', timing)) THEN
    RAISE EXCEPTION 'Campaign finalization intent does not match its receipt' USING ERRCODE = '23514';
  END IF;
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'workspaceId', NEW.workspace_id::text, 'name', c.name, 'description', c.description,
    'objective', final_version.objective, 'contentPackageIds', to_jsonb(final_version.content_package_ids),
    'brandProfileVersionId', final_version.brand_profile_version_id::text,
    'audienceProfileVersionIds', COALESCE((SELECT jsonb_agg(binding.audience_profile_version_id::text ORDER BY binding.sort_order)
      FROM campaign_version_audience_profile binding WHERE binding.campaign_version_id = final_version.id), '[]'::jsonb),
    'destinationId', final_version.destination_id::text, 'informationDepth', final_version.information_depth,
    'promotionalStrength', final_version.promotional_strength, 'autonomyMode', final_version.autonomy_mode,
    'timezone', final_version.timezone, 'context', final_version.context,
    'successCriteria', final_version.success_criteria, 'successAction', final_version.success_action,
    'steps', jsonb_build_array(jsonb_build_object('id', selected_step.step_key, 'name', selected_step.name,
      'operationType', selected_step.operation_type, 'desiredCapability', selected_step.desired_capability,
      'dependsOn', to_jsonb(selected_step.depends_on), 'dependencyDelaySeconds', selected_step.dependency_delay_seconds,
      'inputs', selected_step.inputs, 'outputs', selected_step.outputs, 'executionMethods', to_jsonb(selected_step.execution_methods),
      'approvalRequired', selected_step.approval_required, 'scheduleType', selected_step.schedule_type,
      'scheduledAt', CASE WHEN selected_step.scheduled_at IS NOT NULL THEN timing->>'scheduledAt' END,
      'preferredWindowStart', CASE WHEN selected_step.preferred_window_start IS NOT NULL THEN timing->>'start' END,
      'preferredWindowEnd', CASE WHEN selected_step.preferred_window_end IS NOT NULL THEN timing->>'end' END,
      'condition', selected_step.condition, 'maxAttempts', selected_step.max_attempts, 'timeoutSeconds', selected_step.timeout_seconds,
      'optional', selected_step.optional)))) INTO actual_definition FROM campaign c WHERE c.id = NEW.campaign_id;
  expected_configuration := jsonb_strip_nulls(jsonb_build_object(
    'workspaceId', NEW.workspace_id::text, 'name', preparation.configuration_snapshot->'name',
    'description', preparation.configuration_snapshot->'description', 'objective', 'awareness',
    'contentPackageIds', jsonb_build_array(preparation.content_package_id::text),
    'brandProfileVersionId', preparation.configuration_snapshot->'brandProfileVersionId',
    'audienceProfileVersionIds', preparation.configuration_snapshot->'audienceProfileVersionIds',
    'destinationId', preparation.configuration_snapshot->'destinationId',
    'informationDepth', preparation.configuration_snapshot->'informationDepth',
    'promotionalStrength', preparation.configuration_snapshot->'promotionalStrength',
    'autonomyMode', 'approval_required', 'timezone', preparation.configuration_snapshot->'timezone',
    'context', '{}'::jsonb, 'successCriteria', '[]'::jsonb, 'successAction', 'notify_only'));
  IF NEW.compiled_definition IS DISTINCT FROM actual_definition
    OR (actual_definition - 'steps') IS DISTINCT FROM expected_configuration THEN
    RAISE EXCEPTION 'Campaign finalization definition does not match its prepared configuration and stored version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER campaign_finalization_receipt_guard BEFORE INSERT OR UPDATE ON campaign_finalization
FOR EACH ROW EXECUTE FUNCTION enforce_campaign_finalization_receipt();

-- Protection follows durable Campaign provenance, not an editable input or a
-- step FK that an old advanced editor could delete. Publishing status changes
-- are allowed; first-slice finalization does not support later advanced edits.
CREATE FUNCTION enforce_finalized_campaign_version_content() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Same parent lock as old saveCampaignDraft and the new finalizer. This also
    -- serializes version insertion racing the first finalization receipt.
    PERFORM id FROM campaign WHERE id = NEW.campaign_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM campaign_finalization WHERE campaign_id = NEW.campaign_id) THEN
      RAISE EXCEPTION 'Finalized Campaign versions cannot be replaced' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM campaign_finalization WHERE campaign_id = OLD.campaign_id)
    OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM campaign_finalization WHERE campaign_id = NEW.campaign_id)) THEN
    IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - ARRAY['status','published_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','published_at']) THEN
      RAISE EXCEPTION 'Finalized Campaign version content is read-only' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER finalized_campaign_version_content_guard BEFORE INSERT OR UPDATE OR DELETE ON campaign_version
FOR EACH ROW EXECUTE FUNCTION enforce_finalized_campaign_version_content();

CREATE FUNCTION enforce_finalized_campaign_child_content() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM campaign_version v JOIN campaign_finalization f ON f.campaign_id = v.campaign_id WHERE v.id = OLD.campaign_version_id))
    OR (TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM campaign_version v JOIN campaign_finalization f ON f.campaign_id = v.campaign_id WHERE v.id = NEW.campaign_version_id)) THEN
    RAISE EXCEPTION 'Finalized Campaign steps and audience bindings are read-only' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER finalized_campaign_step_content_guard BEFORE INSERT OR UPDATE OR DELETE ON campaign_step
FOR EACH ROW EXECUTE FUNCTION enforce_finalized_campaign_child_content();
CREATE TRIGGER finalized_campaign_audience_content_guard BEFORE INSERT OR UPDATE OR DELETE ON campaign_version_audience_profile
FOR EACH ROW EXECUTE FUNCTION enforce_finalized_campaign_child_content();

-- Rollout fence, not hostile-SQL-client authorization: only compatible new app
-- admission sets this transaction-local marker after a locked current proof
-- check. A persisted token alone must not let an old worker retry the write.
CREATE FUNCTION enforce_exact_preview_publication_admission() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  protected campaign_finalization%ROWTYPE;
  instance_version uuid;
  instance_workspace uuid;
  step_id uuid;
  step_version uuid;
  step_inputs jsonb;
  marker jsonb;
  new_protected boolean;
  old_protected boolean;
BEGIN
  SELECT f.* INTO protected FROM campaign_instance i JOIN campaign_finalization f ON f.campaign_id = i.campaign_id
    WHERE i.id = NEW.campaign_instance_id;
  new_protected := FOUND;
  IF TG_OP = 'UPDATE' THEN
    SELECT EXISTS (SELECT 1 FROM campaign_instance i JOIN campaign_finalization f ON f.campaign_id = i.campaign_id
      WHERE i.id = OLD.campaign_instance_id) INTO old_protected;
    -- A state/result update must never retarget protected delivery history,
    -- including moving it to an unprotected Campaign to evade this fence.
    IF (old_protected OR new_protected)
      AND ROW(NEW.workspace_id, NEW.campaign_instance_id, NEW.campaign_step_run_id, NEW.channel_connection_id, NEW.action_type, NEW.idempotency_key)
        IS DISTINCT FROM ROW(OLD.workspace_id, OLD.campaign_instance_id, OLD.campaign_step_run_id, OLD.channel_connection_id, OLD.action_type, OLD.idempotency_key) THEN
      RAISE EXCEPTION 'Protected publication history cannot be retargeted' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NOT new_protected THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'dispatching' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.request_snapshot IS NOT DISTINCT FROM OLD.request_snapshot THEN
    -- Keep result recording and unchanged in-flight observations available to
    -- all workers. Only a fresh dispatch transition needs new admission.
    IF NEW.status <> 'dispatching' OR OLD.status = 'dispatching' THEN RETURN NEW; END IF;
  END IF;
  -- A changed request snapshot (including a schedule snapshot update after the
  -- initial claim) requires the same verified scoped marker, in every status.
  SELECT campaign_version_id, workspace_id INTO instance_version, instance_workspace
    FROM campaign_instance WHERE id = NEW.campaign_instance_id;
  SELECT s.id, s.campaign_version_id, s.inputs INTO step_id, step_version, step_inputs
    FROM campaign_step_run r JOIN campaign_step s ON s.id = r.campaign_step_id
    WHERE r.id = NEW.campaign_step_run_id AND r.campaign_instance_id = NEW.campaign_instance_id;
  BEGIN
    marker := NULLIF(current_setting('market_me.exact_preview_admission', true), '')::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Exact preview admission marker is invalid' USING ERRCODE = '23514';
  END;
  IF NEW.workspace_id IS DISTINCT FROM protected.workspace_id OR instance_workspace IS DISTINCT FROM protected.workspace_id
    OR instance_version IS DISTINCT FROM protected.finalized_version_id OR step_version IS DISTINCT FROM protected.finalized_version_id
    OR step_id IS NULL OR NEW.action_type <> 'publish_content'
    OR NEW.channel_connection_id::text IS DISTINCT FROM step_inputs->>'channelConnectionId'
    OR step_inputs->>'draftChannelPreviewId' IS DISTINCT FROM protected.draft_channel_preview_id::text
    OR step_inputs->>'draftChannelPreviewFingerprint' IS DISTINCT FROM protected.preview_fingerprint
    OR NEW.request_snapshot->>'campaignFinalizationId' IS DISTINCT FROM protected.id::text
    OR NEW.request_snapshot->>'draftChannelPreviewFingerprint' IS DISTINCT FROM protected.preview_fingerprint
    OR marker IS DISTINCT FROM jsonb_build_object('finalizationId', protected.id::text,
      'campaignVersionId', protected.finalized_version_id::text, 'campaignStepId', step_id::text,
      'campaignInstanceId', NEW.campaign_instance_id::text, 'campaignStepRunId', NEW.campaign_step_run_id::text,
      'previewFingerprint', protected.preview_fingerprint) THEN
    RAISE EXCEPTION 'A compatible current exact-preview admission is required before dispatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER exact_preview_publication_admission_guard BEFORE INSERT OR UPDATE ON publication_action
FOR EACH ROW EXECUTE FUNCTION enforce_exact_preview_publication_admission();
