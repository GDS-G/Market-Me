-- Forward-only hardening for the source-preparation outbox introduced by 0115.
-- A binding must always remain disableable after a reference goes stale, while
-- re-enabling it must revalidate all retained references. Command leases must
-- also stop at the documented attempt cap instead of allowing crash recovery
-- to increment the attempt counter without bound.

CREATE OR REPLACE FUNCTION validate_source_preparation_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  validate_brand_reference boolean := true;
  validate_destination_reference boolean := true;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Repository saves take this key before inspecting absence. Repeat it in
    -- the database guard so direct SQL cannot make first creation race an
    -- approval transaction that already observed no binding.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'source-preparation-binding:' || NEW.workspace_id::text || ':' || NEW.smart_source_id::text, 0));
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.workspace_id, NEW.smart_source_id, NEW.created_by, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id, OLD.workspace_id, OLD.smart_source_id, OLD.created_by, OLD.created_at)
      OR NEW.revision <> OLD.revision + 1 THEN
      RAISE EXCEPTION 'Source preparation binding identity and revision are protected' USING ERRCODE = '23514';
    END IF;
    IF NEW.writer_user_id <> NEW.updated_by THEN
      RAISE EXCEPTION 'Source preparation binding writer must be the current saver' USING ERRCODE = '23514';
    END IF;
    -- An unchanged optional reference can be retained while disabling an
    -- already-saved binding. Inserts, changed references, and enabled states
    -- still require current workspace-scoped resources.
    validate_brand_reference := NEW.enabled
      OR NEW.brand_profile_version_id IS DISTINCT FROM OLD.brand_profile_version_id;
    validate_destination_reference := NEW.enabled
      OR NEW.destination_id IS DISTINCT FROM OLD.destination_id;
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
  IF validate_brand_reference AND NEW.brand_profile_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM brand_profile_version version
    JOIN brand_profile profile ON profile.id = version.brand_profile_id
    WHERE version.id = NEW.brand_profile_version_id AND version.status = 'published'
      AND profile.workspace_id = NEW.workspace_id AND profile.status = 'published'
      AND profile.current_version_id = version.id
  ) THEN
    RAISE EXCEPTION 'Source preparation binding Brand Profile is not current and published' USING ERRCODE = '23514';
  END IF;
  IF validate_destination_reference AND NEW.destination_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM destination
    WHERE id = NEW.destination_id AND workspace_id = NEW.workspace_id AND status = 'published'
  ) THEN
    RAISE EXCEPTION 'Source preparation binding Destination is not published' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Audience rows are part of the parent binding revision. Reject independent
-- child mutations; the repository opens a transaction-local admission only
-- after it has advanced the authenticated parent revision.
CREATE OR REPLACE FUNCTION validate_source_preparation_binding_audience() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_binding_id uuid;
  target_audience_id uuid;
  parent_xmin xid;
  parent_revision integer;
  parent_updated_by uuid;
  admission jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_binding_id := OLD.binding_id;
    target_audience_id := OLD.audience_profile_version_id;
  ELSE
    target_binding_id := NEW.binding_id;
    target_audience_id := NEW.audience_profile_version_id;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.binding_id <> OLD.binding_id
    OR NEW.audience_profile_version_id <> OLD.audience_profile_version_id) THEN
    RAISE EXCEPTION 'Source preparation Audience identity is immutable' USING ERRCODE = '23514';
  END IF;

  SELECT xmin, revision, updated_by INTO parent_xmin, parent_revision, parent_updated_by
  FROM smart_source_preparation_binding WHERE id = target_binding_id;
  IF NOT FOUND THEN
    -- Parent/workspace/source cascade cleanup is not a configuration edit.
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Source preparation Audience binding is unavailable' USING ERRCODE = '23514';
  END IF;
  BEGIN
    admission := current_setting('market_me.source_preparation_audience_admission', true)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Source preparation Audience mutation admission is invalid' USING ERRCODE = '23514';
  END;
  -- A custom setting is routing metadata, not authority: require proof that
  -- this transaction actually inserted or revised the parent row. Otherwise a
  -- direct SQL caller could copy the visible revision into set_config and
  -- mutate ordered children without advancing the binding snapshot revision.
  IF parent_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid
    OR admission->>'bindingId' IS DISTINCT FROM target_binding_id::text
    OR admission->>'revision' IS DISTINCT FROM parent_revision::text
    OR admission->>'updatedBy' IS DISTINCT FROM parent_updated_by::text THEN
    RAISE EXCEPTION 'Source preparation Audience mutation requires its authenticated parent revision' USING ERRCODE = '23514';
  END IF;

  IF TG_OP <> 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM smart_source_preparation_binding binding
    JOIN audience_profile_version version ON version.id = target_audience_id
    JOIN audience_profile profile ON profile.id = version.audience_profile_id
    WHERE binding.id = target_binding_id AND profile.workspace_id = binding.workspace_id
      AND profile.status = 'published' AND profile.current_version_id = version.id
      AND version.status = 'published'
  ) THEN
    RAISE EXCEPTION 'Source preparation binding Audience Profile is not current and published' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER source_preparation_binding_audience_guard ON smart_source_preparation_binding_audience;
CREATE TRIGGER source_preparation_binding_audience_guard
BEFORE INSERT OR UPDATE OR DELETE ON smart_source_preparation_binding_audience
FOR EACH ROW EXECUTE FUNCTION validate_source_preparation_binding_audience();

-- A disabled binding may retain historical Audience references that later go
-- stale, but it cannot be re-enabled until every retained Audience is current.
-- Deferral lets a complete binding save replace stale children in the same
-- transaction before the final enabled state is checked.
CREATE FUNCTION validate_enabled_source_preparation_audiences() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM smart_source_preparation_binding binding
    WHERE binding.id = NEW.id AND binding.enabled
      AND EXISTS (
        SELECT 1 FROM smart_source_preparation_binding_audience audience
        WHERE audience.binding_id = binding.id AND NOT EXISTS (
          SELECT 1 FROM audience_profile_version version
          JOIN audience_profile profile ON profile.id = version.audience_profile_id
          WHERE version.id = audience.audience_profile_version_id
            AND profile.workspace_id = binding.workspace_id
            AND profile.status = 'published' AND profile.current_version_id = version.id
            AND version.status = 'published'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Enabled source preparation binding Audience Profile is not current and published' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER source_preparation_binding_enabled_audience_guard
AFTER INSERT OR UPDATE ON smart_source_preparation_binding
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_enabled_source_preparation_audiences();

-- Command UUIDs are a reserved preparation-idempotency namespace. Taking a
-- SHARE lock makes a concurrent expired-lease reconciler skip or wait until the
-- exact receipt transaction commits, so it cannot orphan in-flight work.
CREATE FUNCTION guard_source_command_preparation_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  command source_preparation_command%ROWTYPE;
BEGIN
  SELECT * INTO command FROM source_preparation_command
  WHERE workspace_id = NEW.workspace_id AND preparation_idempotency_key = NEW.idempotency_key
  FOR SHARE;
  IF FOUND AND (
    command.status <> 'processing'
    OR command.writer_user_id <> NEW.created_by
    OR command.content_package_id <> NEW.content_package_id
    OR command.content_package_version <> NEW.content_package_version
    OR command.configuration_snapshot <> NEW.configuration_snapshot
    OR command.expected_approval_id::text
      IS DISTINCT FROM NEW.reference_snapshot->'contentPackage'->>'approvalId'
    OR command.expected_review_fingerprint
      IS DISTINCT FROM NEW.reference_snapshot->'contentPackage'->>'reviewFingerprint'
  ) THEN
    RAISE EXCEPTION 'Campaign preparation key is reserved for an exact claimed source command' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER campaign_preparation_source_command_reservation_guard
BEFORE INSERT ON campaign_preparation
FOR EACH ROW EXECUTE FUNCTION guard_source_command_preparation_receipt();

-- Linearize binding enable/disable against the approval transaction. Once an
-- approval observes an enabled binding, SHARE keeps a concurrent disable from
-- committing first; if disable wins first, this locking read observes disabled
-- state and no command is admitted.
CREATE OR REPLACE FUNCTION enqueue_source_preparation_command() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  command_id uuid;
  binding_id_value uuid;
BEGIN
  IF NEW.current_approval_id IS NULL OR NEW.current_approval_id IS NOT DISTINCT FROM OLD.current_approval_id THEN
    RETURN NEW;
  END IF;

  -- The transaction advisory key also serializes the absence of a binding, so
  -- first creation and approval have one unambiguous commit order.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'source-preparation-binding:' || NEW.workspace_id::text || ':' || NEW.smart_source_id::text, 0));

  SELECT binding.id INTO binding_id_value
  FROM smart_source_preparation_binding binding
  WHERE binding.workspace_id = NEW.workspace_id
    AND binding.smart_source_id = NEW.smart_source_id
    AND binding.enabled
  FOR SHARE;
  IF binding_id_value IS NULL THEN
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
  WHERE binding.id = binding_id_value AND binding.enabled
    AND binding.workspace_id = NEW.workspace_id AND binding.smart_source_id = NEW.smart_source_id
    AND approval.workspace_id = NEW.workspace_id AND approval.content_package_id = NEW.id
    AND approval.content_package_version = NEW.version
  ON CONFLICT (expected_approval_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_source_preparation_command() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF OLD.attempt_count >= 8
      OR (OLD.status IN ('pending', 'failed')
        AND (OLD.next_attempt_at IS NULL OR OLD.next_attempt_at > clock_timestamp()))
      OR (OLD.status = 'processing'
        AND (OLD.lease_expires_at IS NULL OR OLD.lease_expires_at > clock_timestamp()))
      OR NEW.attempt_count <> OLD.attempt_count + 1 OR NEW.next_attempt_at IS NOT NULL
      OR NEW.claimed_at IS NULL OR NEW.lease_expires_at IS NULL
      OR NEW.claimed_at > clock_timestamp()
      OR NEW.lease_expires_at > NEW.claimed_at + interval '1 hour'
      OR NEW.last_error_code IS NOT NULL OR NEW.safe_error IS NOT NULL
      OR NEW.preparation_id IS NOT NULL OR NEW.campaign_id IS NOT NULL OR NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Source preparation command claim transition is invalid' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.status = 'processing' AND NEW.status IN ('failed', 'dead_letter', 'completed') THEN
    IF NEW.attempt_count <> OLD.attempt_count OR NEW.claimed_at IS NOT NULL OR NEW.lease_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'Source preparation command settlement transition is invalid' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'failed' AND (NEW.attempt_count >= 8
      OR NEW.next_attempt_at IS NULL OR NEW.last_error_code IS NULL OR NEW.safe_error IS NULL
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
          AND preparation.configuration_snapshot = NEW.configuration_snapshot
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

COMMENT ON FUNCTION validate_source_preparation_binding() IS
  'Permits safe disablement with unchanged stale references while revalidating every new, changed, or enabled binding reference.';
COMMENT ON FUNCTION validate_source_preparation_binding_audience() IS
  'Requires a same-transaction parent revision, binds ordered Audience mutations to it, and validates inserted references.';
COMMENT ON FUNCTION validate_enabled_source_preparation_audiences() IS
  'Deferred final-state validation for retained Audience references when a source preparation binding is enabled.';
COMMENT ON FUNCTION guard_source_command_preparation_receipt() IS
  'Reserves source command UUIDs for an exact in-flight writer, configuration, package approval, and receipt.';
COMMENT ON FUNCTION enqueue_source_preparation_command() IS
  'Queues one exact-approval command while holding the observed enabled binding through approval commit.';
COMMENT ON FUNCTION guard_source_preparation_command() IS
  'Protects immutable command identity and due/lease/attempt-fenced lifecycle transitions through the eight-attempt cap.';
