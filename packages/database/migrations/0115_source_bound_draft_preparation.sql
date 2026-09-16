-- One mutable, explicitly configured preparation binding per Smart Source.
-- Commands retain their own immutable snapshots; disabling a binding governs
-- only approval transitions that occur after the disable commits.
CREATE TABLE smart_source_preparation_binding (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  smart_source_id uuid NOT NULL UNIQUE REFERENCES smart_source(id) ON DELETE CASCADE,
  writer_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  template_key text NOT NULL CHECK (template_key = 'general_announcement'),
  template_version integer NOT NULL CHECK (template_version = 1),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description text NOT NULL CHECK (char_length(description) <= 5000),
  brand_profile_version_id uuid REFERENCES brand_profile_version(id) ON DELETE RESTRICT,
  destination_id uuid REFERENCES destination(id) ON DELETE RESTRICT,
  information_depth text NOT NULL CHECK (information_depth IN ('minimal', 'teaser', 'contextual', 'detailed', 'comprehensive', 'custom')),
  promotional_strength text NOT NULL CHECK (promotional_strength IN ('informational', 'subtle', 'light', 'standard', 'strong', 'campaign_push', 'custom')),
  timezone text NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 100),
  enabled boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX smart_source_preparation_binding_workspace_idx
  ON smart_source_preparation_binding(workspace_id, updated_at DESC, id);

CREATE TABLE smart_source_preparation_binding_audience (
  binding_id uuid NOT NULL REFERENCES smart_source_preparation_binding(id) ON DELETE CASCADE,
  audience_profile_version_id uuid NOT NULL REFERENCES audience_profile_version(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL CHECK (sort_order BETWEEN 0 AND 19),
  PRIMARY KEY (binding_id, audience_profile_version_id),
  UNIQUE (binding_id, sort_order)
);

CREATE FUNCTION validate_source_preparation_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.workspace_id, NEW.smart_source_id, NEW.created_by, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id, OLD.workspace_id, OLD.smart_source_id, OLD.created_by, OLD.created_at)
      OR NEW.revision <> OLD.revision + 1 THEN
      RAISE EXCEPTION 'Source preparation binding identity and revision are protected' USING ERRCODE = '23514';
    END IF;
    IF NEW.writer_user_id <> NEW.updated_by THEN
      RAISE EXCEPTION 'Source preparation binding writer must be the current saver' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.revision <> 1 THEN
    RAISE EXCEPTION 'New source preparation bindings start at revision one' USING ERRCODE = '23514';
  ELSIF NEW.writer_user_id <> NEW.created_by OR NEW.writer_user_id <> NEW.updated_by THEN
    RAISE EXCEPTION 'Source preparation binding writer must be the creating saver' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM smart_source source
    WHERE source.id = NEW.smart_source_id AND source.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Source preparation binding source scope is invalid' USING ERRCODE = '23514';
  END IF;
  IF NEW.enabled AND NOT EXISTS (
    SELECT 1 FROM workspace_membership member
    WHERE member.workspace_id = NEW.workspace_id AND member.user_id = NEW.writer_user_id
      AND member.role IN ('owner', 'admin', 'editor')
  ) THEN
    RAISE EXCEPTION 'Source preparation binding requires a current workspace writer' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM workspace_membership member
    WHERE member.workspace_id = NEW.workspace_id AND member.user_id = NEW.updated_by
      AND member.role IN ('owner', 'admin', 'editor')
  ) THEN
    RAISE EXCEPTION 'Source preparation binding update requires a current workspace writer' USING ERRCODE = '23514';
  END IF;
  IF NEW.brand_profile_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM brand_profile_version version
    JOIN brand_profile profile ON profile.id = version.brand_profile_id
    WHERE version.id = NEW.brand_profile_version_id AND version.status = 'published'
      AND profile.workspace_id = NEW.workspace_id AND profile.status = 'published'
      AND profile.current_version_id = version.id
  ) THEN
    RAISE EXCEPTION 'Source preparation binding Brand Profile is not current and published' USING ERRCODE = '23514';
  END IF;
  IF NEW.destination_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM destination
    WHERE id = NEW.destination_id AND workspace_id = NEW.workspace_id AND status = 'published'
  ) THEN
    RAISE EXCEPTION 'Source preparation binding Destination is not published' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER source_preparation_binding_guard
BEFORE INSERT OR UPDATE ON smart_source_preparation_binding
FOR EACH ROW EXECUTE FUNCTION validate_source_preparation_binding();

CREATE FUNCTION validate_source_preparation_binding_audience() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM smart_source_preparation_binding binding
    JOIN audience_profile_version version ON version.id = NEW.audience_profile_version_id
    JOIN audience_profile profile ON profile.id = version.audience_profile_id
    WHERE binding.id = NEW.binding_id AND profile.workspace_id = binding.workspace_id
      AND profile.status = 'published' AND profile.current_version_id = version.id
      AND version.status = 'published'
  ) THEN
    RAISE EXCEPTION 'Source preparation binding Audience Profile is not current and published' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER source_preparation_binding_audience_guard
BEFORE INSERT OR UPDATE ON smart_source_preparation_binding_audience
FOR EACH ROW EXECUTE FUNCTION validate_source_preparation_binding_audience();

CREATE FUNCTION source_preparation_configuration(binding_id_value uuid, package_id_value uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'templateKey', binding.template_key,
    'templateVersion', binding.template_version,
    'workspaceId', binding.workspace_id::text,
    'contentPackageId', package.id::text,
    'expectedPackageVersion', package.version,
    'name', binding.name,
    'description', binding.description,
    'brandProfileVersionId', binding.brand_profile_version_id::text,
    'audienceProfileVersionIds', COALESCE((
      SELECT jsonb_agg(audience.audience_profile_version_id::text ORDER BY audience.sort_order)
      FROM smart_source_preparation_binding_audience audience WHERE audience.binding_id = binding.id
    ), '[]'::jsonb),
    'destinationId', binding.destination_id::text,
    'informationDepth', binding.information_depth,
    'promotionalStrength', binding.promotional_strength,
    'timezone', binding.timezone
  ))
  FROM smart_source_preparation_binding binding
  JOIN content_package package ON package.id = package_id_value
  WHERE binding.id = binding_id_value
    AND package.workspace_id = binding.workspace_id
    AND package.smart_source_id = binding.smart_source_id
$$;

CREATE FUNCTION source_preparation_binding_snapshot(binding_id_value uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'bindingId', binding.id::text,
    'workspaceId', binding.workspace_id::text,
    'smartSourceId', binding.smart_source_id::text,
    'writerUserId', binding.writer_user_id::text,
    'revision', binding.revision,
    'enabled', binding.enabled,
    'templateKey', binding.template_key,
    'templateVersion', binding.template_version,
    'name', binding.name,
    'description', binding.description,
    'brandProfileVersionId', binding.brand_profile_version_id::text,
    'audienceProfileVersionIds', COALESCE((
      SELECT jsonb_agg(audience.audience_profile_version_id::text ORDER BY audience.sort_order)
      FROM smart_source_preparation_binding_audience audience WHERE audience.binding_id = binding.id
    ), '[]'::jsonb),
    'destinationId', binding.destination_id::text,
    'informationDepth', binding.information_depth,
    'promotionalStrength', binding.promotional_strength,
    'timezone', binding.timezone
  ))
  FROM smart_source_preparation_binding binding WHERE binding.id = binding_id_value
$$;

CREATE TABLE source_preparation_command (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  binding_id uuid NOT NULL REFERENCES smart_source_preparation_binding(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  binding_revision integer NOT NULL CHECK (binding_revision > 0),
  smart_source_id uuid NOT NULL REFERENCES smart_source(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  content_package_id uuid NOT NULL REFERENCES content_package(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  content_package_version integer NOT NULL CHECK (content_package_version > 0),
  expected_approval_id uuid NOT NULL REFERENCES content_package_approval(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  expected_review_fingerprint text NOT NULL CHECK (expected_review_fingerprint ~ '^mm-package-review-v1:sha256:[0-9a-f]{64}$'),
  preparation_idempotency_key uuid NOT NULL,
  writer_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  configuration_snapshot jsonb NOT NULL CHECK (jsonb_typeof(configuration_snapshot) = 'object'),
  binding_snapshot jsonb NOT NULL CHECK (jsonb_typeof(binding_snapshot) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'failed', 'completed', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  last_error_code text,
  safe_error text,
  preparation_id uuid REFERENCES campaign_preparation(id) ON DELETE RESTRICT,
  campaign_id uuid REFERENCES campaign(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (expected_approval_id),
  UNIQUE (workspace_id, preparation_idempotency_key),
  CHECK (preparation_idempotency_key = id),
  CHECK (lease_expires_at IS NULL OR claimed_at IS NOT NULL),
  CHECK (lease_expires_at IS NULL OR lease_expires_at > claimed_at),
  CHECK ((preparation_id IS NULL) = (campaign_id IS NULL)),
  CHECK (last_error_code IS NULL OR char_length(last_error_code) BETWEEN 1 AND 100),
  CHECK (safe_error IS NULL OR char_length(safe_error) BETWEEN 1 AND 2000)
);

CREATE INDEX source_preparation_command_ready_idx
  ON source_preparation_command(next_attempt_at, created_at, id)
  WHERE status IN ('pending', 'failed');
CREATE INDEX source_preparation_command_lease_idx
  ON source_preparation_command(lease_expires_at, created_at, id)
  WHERE status = 'processing';
CREATE INDEX source_preparation_command_source_time_idx
  ON source_preparation_command(workspace_id, smart_source_id, created_at DESC, id DESC);

CREATE FUNCTION guard_source_preparation_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.attempt_count <> 0 OR NEW.next_attempt_at IS NULL
      OR NEW.claimed_at IS NOT NULL OR NEW.lease_expires_at IS NOT NULL
      OR NEW.last_error_code IS NOT NULL OR NEW.safe_error IS NOT NULL
      OR NEW.preparation_id IS NOT NULL OR NEW.campaign_id IS NOT NULL OR NEW.completed_at IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM smart_source_preparation_binding binding
        JOIN smart_source source ON source.id = binding.smart_source_id
        JOIN content_package package ON package.id = NEW.content_package_id
        JOIN content_package_approval approval ON approval.id = NEW.expected_approval_id
        WHERE binding.id = NEW.binding_id AND binding.enabled
          AND binding.workspace_id = NEW.workspace_id AND binding.revision = NEW.binding_revision
          AND source.id = NEW.smart_source_id AND source.workspace_id = NEW.workspace_id
          AND package.workspace_id = NEW.workspace_id AND package.smart_source_id = NEW.smart_source_id
          AND package.version = NEW.content_package_version AND package.current_approval_id = approval.id
          AND approval.workspace_id = NEW.workspace_id AND approval.content_package_id = package.id
          AND approval.content_package_version = package.version
          AND approval.review_fingerprint = NEW.expected_review_fingerprint
          AND binding.writer_user_id = NEW.writer_user_id
          AND NEW.configuration_snapshot = source_preparation_configuration(binding.id, package.id)
          AND NEW.binding_snapshot = source_preparation_binding_snapshot(binding.id)
      ) THEN
      RAISE EXCEPTION 'Source preparation command admission is invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - ARRAY['status','attempt_count','next_attempt_at','claimed_at','lease_expires_at',
      'last_error_code','safe_error','preparation_id','campaign_id','updated_at','completed_at'])
    IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','attempt_count','next_attempt_at','claimed_at','lease_expires_at',
      'last_error_code','safe_error','preparation_id','campaign_id','updated_at','completed_at']) THEN
    RAISE EXCEPTION 'Source preparation command snapshots are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('completed', 'dead_letter') THEN
    RAISE EXCEPTION 'Finished source preparation commands are immutable' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'processing' AND OLD.status IN ('pending', 'failed', 'processing') THEN
    IF NEW.attempt_count <> OLD.attempt_count + 1 OR NEW.next_attempt_at IS NOT NULL
      OR NEW.claimed_at IS NULL OR NEW.lease_expires_at IS NULL
      OR NEW.last_error_code IS NOT NULL OR NEW.safe_error IS NOT NULL
      OR NEW.preparation_id IS NOT NULL OR NEW.campaign_id IS NOT NULL OR NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Source preparation command claim transition is invalid' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status = 'processing' AND NEW.status IN ('failed', 'dead_letter', 'completed') THEN
    IF NEW.attempt_count <> OLD.attempt_count OR NEW.claimed_at IS NOT NULL OR NEW.lease_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'Source preparation command settlement transition is invalid' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'failed' AND (NEW.next_attempt_at IS NULL OR NEW.last_error_code IS NULL OR NEW.safe_error IS NULL
      OR NEW.preparation_id IS NOT NULL OR NEW.completed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Retryable source preparation failure is incomplete' USING ERRCODE = '23514';
    ELSIF NEW.status = 'dead_letter' AND (NEW.next_attempt_at IS NOT NULL OR NEW.last_error_code IS NULL OR NEW.safe_error IS NULL
      OR NEW.preparation_id IS NOT NULL OR NEW.completed_at IS NULL) THEN
      RAISE EXCEPTION 'Terminal source preparation failure is incomplete' USING ERRCODE = '23514';
    ELSIF NEW.status = 'completed' AND (NEW.next_attempt_at IS NOT NULL OR NEW.last_error_code IS NOT NULL OR NEW.safe_error IS NOT NULL
      OR NEW.preparation_id IS NULL OR NEW.campaign_id IS NULL OR NEW.completed_at IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM campaign_preparation preparation
        WHERE preparation.id = NEW.preparation_id AND preparation.workspace_id = NEW.workspace_id
          AND preparation.idempotency_key = NEW.preparation_idempotency_key
          AND preparation.content_package_id = NEW.content_package_id
          AND preparation.content_package_version = NEW.content_package_version
          AND preparation.created_by = NEW.writer_user_id AND preparation.campaign_id = NEW.campaign_id
          AND preparation.reference_snapshot->'contentPackage'->>'approvalId' = NEW.expected_approval_id::text
          AND preparation.reference_snapshot->'contentPackage'->>'reviewFingerprint' = NEW.expected_review_fingerprint
      )) THEN
      RAISE EXCEPTION 'Completed source preparation lineage is invalid' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Source preparation command status transition is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER source_preparation_command_guard
BEFORE INSERT OR UPDATE ON source_preparation_command
FOR EACH ROW EXECUTE FUNCTION guard_source_preparation_command();

-- This AFTER UPDATE trigger intentionally has no migration-time backfill. Only a
-- future exact current-approval transition can create a command.
CREATE FUNCTION enqueue_source_preparation_command() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  command_id uuid;
BEGIN
  IF NEW.current_approval_id IS NULL OR NEW.current_approval_id IS NOT DISTINCT FROM OLD.current_approval_id THEN
    RETURN NEW;
  END IF;

  command_id := gen_random_uuid();
  INSERT INTO source_preparation_command (
    id, workspace_id, binding_id, binding_revision, smart_source_id,
    content_package_id, content_package_version, expected_approval_id,
    expected_review_fingerprint, preparation_idempotency_key, writer_user_id,
    configuration_snapshot, binding_snapshot, next_attempt_at
  )
  SELECT command_id, binding.workspace_id, binding.id, binding.revision, binding.smart_source_id,
    NEW.id, NEW.version, approval.id, approval.review_fingerprint, command_id, binding.writer_user_id,
    source_preparation_configuration(binding.id, NEW.id), source_preparation_binding_snapshot(binding.id),
    clock_timestamp()
  FROM smart_source_preparation_binding binding
  JOIN smart_source source ON source.id = binding.smart_source_id
  JOIN content_package_approval approval ON approval.id = NEW.current_approval_id
  WHERE binding.workspace_id = NEW.workspace_id AND binding.smart_source_id = NEW.smart_source_id
    AND binding.enabled
    AND approval.workspace_id = NEW.workspace_id AND approval.content_package_id = NEW.id
    AND approval.content_package_version = NEW.version
  ON CONFLICT (expected_approval_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER content_package_source_preparation_enqueue
AFTER UPDATE OF current_approval_id ON content_package
FOR EACH ROW EXECUTE FUNCTION enqueue_source_preparation_command();

COMMENT ON TABLE smart_source_preparation_binding IS
  'Mutable Smart Source-to-General Announcement preparation configuration; ordered audiences live in the child table.';
COMMENT ON TABLE source_preparation_command IS
  'Durable exact-approval outbox with immutable configuration snapshots, leased attempts, fencing, and preparation lineage.';
