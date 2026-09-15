-- Exact package approval is a new attestation, never a backfill from a legacy
-- approved flag. Existing generations retain NULL proof and their old history.
CREATE TABLE content_package_approval (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  content_package_id uuid NOT NULL REFERENCES content_package(id) ON DELETE RESTRICT,
  content_package_version integer NOT NULL CHECK (content_package_version > 0),
  idempotency_key uuid NOT NULL,
  contract_version integer NOT NULL DEFAULT 1 CHECK (contract_version = 1),
  review_fingerprint text NOT NULL CHECK (review_fingerprint ~ '^mm-package-review-v1:sha256:[0-9a-f]{64}$'),
  canonical_review_snapshot text NOT NULL CHECK (octet_length(canonical_review_snapshot) BETWEEN 2 AND 8388608),
  effective_evidence_ids uuid[] NOT NULL CHECK (cardinality(effective_evidence_ids) BETWEEN 1 AND 10000),
  evidence_contract text NOT NULL DEFAULT 'effective-evidence-v1' CHECK (evidence_contract = 'effective-evidence-v1'),
  canonical_input text NOT NULL CHECK (octet_length(canonical_input) BETWEEN 2 AND 65536),
  configuration_hash text NOT NULL CHECK (configuration_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  learning_review_id uuid NOT NULL UNIQUE REFERENCES learning_review(id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, idempotency_key),
  CHECK (configuration_hash = encode(sha256(convert_to(canonical_input, 'UTF8')), 'hex')),
  CHECK (review_fingerprint = 'mm-package-review-v1:sha256:' || encode(sha256(
    convert_to(E'market-me:content-package-review:v1\n' || canonical_review_snapshot, 'UTF8')), 'hex'))
);

CREATE INDEX content_package_approval_package_time_idx
  ON content_package_approval(content_package_id, created_at DESC, id);

ALTER TABLE content_package ADD COLUMN current_approval_id uuid
  REFERENCES content_package_approval(id) ON DELETE SET NULL;
ALTER TABLE draft_generation ADD COLUMN content_package_approval_id uuid
  REFERENCES content_package_approval(id) ON DELETE RESTRICT;

CREATE TABLE learning_review_proof (
  learning_review_id uuid PRIMARY KEY REFERENCES learning_review(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  content_package_id uuid NOT NULL REFERENCES content_package(id) ON DELETE CASCADE,
  content_package_version integer NOT NULL CHECK (content_package_version > 0),
  action text NOT NULL CHECK (action IN ('accepted', 'rejected', 'corrected', 'conflict_resolved', 'package_approved')),
  before_review_fingerprint text NOT NULL CHECK (before_review_fingerprint ~ '^mm-package-review-v1:sha256:[0-9a-f]{64}$'),
  after_review_fingerprint text NOT NULL CHECK (after_review_fingerprint ~ '^mm-package-review-v1:sha256:[0-9a-f]{64}$'),
  decision_snapshot jsonb NOT NULL CHECK (jsonb_typeof(decision_snapshot) = 'object'
    AND octet_length(decision_snapshot::text) BETWEEN 2 AND 16777216),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- A bounded relational re-derivation of effective-evidence-v1. The application
-- validates the complete snapshot schema/canonical encoding. This SQL boundary
-- independently proves the exact effective identities and their retained facts.
-- NULL means invalid/unresolved; an empty result is also ineligible for approval.
CREATE FUNCTION content_package_review_effective_evidence(snapshot jsonb)
RETURNS uuid[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  evidence jsonb;
  evidence_by_id jsonb;
  predecessors jsonb;
  excluded_by_id jsonb;
  conflicts jsonb;
  conflict jsonb;
  candidates jsonb;
  selected_id text;
  losers text[] := '{}';
  winners text[] := '{}';
  result uuid[];
BEGIN
  IF jsonb_typeof(snapshot) IS DISTINCT FROM 'object'
    OR snapshot->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR snapshot->>'reviewContract' IS DISTINCT FROM 'content-package-review-v1'
    OR jsonb_typeof(snapshot->'package') IS DISTINCT FROM 'object'
    OR jsonb_typeof(snapshot->'evidence') IS DISTINCT FROM 'array'
    OR jsonb_typeof(snapshot->'conflicts') IS DISTINCT FROM 'array'
    OR jsonb_typeof(snapshot->'assets') IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
  evidence := snapshot->'evidence';
  conflicts := snapshot->'conflicts';
  IF jsonb_array_length(evidence) NOT BETWEEN 1 AND 10000
    OR jsonb_array_length(conflicts) > 2000 OR jsonb_array_length(snapshot->'assets') > 1000 THEN RETURN NULL; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(evidence) e
    WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
      OR jsonb_typeof(e->'id') IS DISTINCT FROM 'string'
      OR (e->>'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') IS NOT TRUE
      OR e->>'id' = '00000000-0000-0000-0000-000000000000'
      OR jsonb_typeof(e->'claim') IS DISTINCT FROM 'string' OR length(e->>'claim') = 0
      OR e->>'provenance' NOT IN ('observed', 'authoritative_context', 'inferred', 'unresolved')
      OR e->>'provenance' IS NULL
      OR jsonb_typeof(e->'sourceReferences') IS DISTINCT FROM 'array'
      OR jsonb_typeof(e->'factKey') NOT IN ('null', 'string') OR NOT (e ? 'factKey')
      OR (jsonb_typeof(e->'factKey') = 'string' AND length(e->>'factKey') = 0)
      OR jsonb_typeof(e->'confidence') NOT IN ('null', 'number') OR NOT (e ? 'confidence')
      OR jsonb_typeof(e->'createdAtUtcMicros') IS DISTINCT FROM 'string'
      OR jsonb_typeof(e->'supersededByEvidenceId') NOT IN ('null', 'string') OR NOT (e ? 'supersededByEvidenceId')
  ) THEN RETURN NULL; END IF;
  IF (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(evidence) e) <> jsonb_array_length(evidence) THEN RETURN NULL; END IF;
  SELECT jsonb_object_agg(e->>'id', e) INTO evidence_by_id FROM jsonb_array_elements(evidence) e;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(evidence) e,
      LATERAL jsonb_array_elements(e->'sourceReferences') ref WHERE jsonb_typeof(ref) <> 'string')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(evidence) e
      WHERE e->>'supersededByEvidenceId' IS NOT NULL AND (e->>'supersededByEvidenceId' = e->>'id'
        OR NOT (evidence_by_id ? (e->>'supersededByEvidenceId'))))
    OR EXISTS (SELECT e->>'supersededByEvidenceId' FROM jsonb_array_elements(evidence) e
      WHERE e->>'supersededByEvidenceId' IS NOT NULL GROUP BY e->>'supersededByEvidenceId' HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(evidence) e
      WHERE e->>'supersededByEvidenceId' IS NULL AND e->>'provenance' = 'unresolved') THEN RETURN NULL; END IF;
  -- Indexed JSON lookup avoids scanning all evidence for every conflict/chain
  -- edge at the 10,000-row bound. Incoming targets were proved unique above.
  SELECT COALESCE(jsonb_object_agg(e->>'supersededByEvidenceId', e->'id'), '{}') INTO predecessors
    FROM jsonb_array_elements(evidence) e WHERE e->>'supersededByEvidenceId' IS NOT NULL;
  -- Traverse backwards from active ends. A cycle has no reachable active end
  -- and leaves rows unvisited; every valid edge is visited exactly once.
  IF (WITH RECURSIVE reached(id) AS (
    SELECT e->>'id' FROM jsonb_array_elements(evidence) e WHERE e->>'supersededByEvidenceId' IS NULL
    UNION ALL
    SELECT predecessors->>r.id FROM reached r WHERE predecessors ? r.id
  ) SELECT count(*) FROM reached) <> jsonb_array_length(evidence) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(conflicts) c
      WHERE jsonb_typeof(c) IS DISTINCT FROM 'object' OR jsonb_typeof(c->'id') IS DISTINCT FROM 'string'
        OR (c->>'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') IS NOT TRUE
        OR c->>'id' = '00000000-0000-0000-0000-000000000000'
        OR jsonb_typeof(c->'factKey') IS DISTINCT FROM 'string' OR length(c->>'factKey') = 0)
    OR (SELECT count(DISTINCT c->>'id') FROM jsonb_array_elements(conflicts) c) <> jsonb_array_length(conflicts) THEN RETURN NULL; END IF;
  FOR conflict IN SELECT value FROM jsonb_array_elements(conflicts) LOOP
    IF conflict->>'status' IS DISTINCT FROM 'resolved'
      OR jsonb_typeof(conflict->'candidateEvidenceIds') IS DISTINCT FROM 'array'
      OR jsonb_typeof(conflict->'resolutionEvidenceId') IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
    candidates := conflict->'candidateEvidenceIds';
    selected_id := conflict->>'resolutionEvidenceId';
    IF jsonb_array_length(candidates) NOT BETWEEN 1 AND 1000
      OR (SELECT count(DISTINCT candidate) FROM jsonb_array_elements(candidates) candidate) <> jsonb_array_length(candidates)
      OR NOT (candidates @> jsonb_build_array(selected_id))
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(candidates) candidate
        WHERE jsonb_typeof(candidate) <> 'string' OR NOT (evidence_by_id ? (candidate#>>'{}'))
          OR evidence_by_id->(candidate#>>'{}')->>'supersededByEvidenceId' IS NOT NULL)
      OR NOT (evidence_by_id ? selected_id) OR evidence_by_id->selected_id->>'supersededByEvidenceId' IS NOT NULL
      OR evidence_by_id->selected_id->>'provenance' = 'unresolved' THEN RETURN NULL; END IF;
    winners := array_append(winners, selected_id);
    losers := losers || ARRAY(SELECT value FROM jsonb_array_elements_text(candidates) WHERE value <> selected_id);
  END LOOP;
  IF winners && losers THEN RETURN NULL; END IF;
  SELECT COALESCE(jsonb_object_agg(id, true), '{}') INTO excluded_by_id FROM unnest(losers) id;
  SELECT COALESCE(array_agg((e->>'id')::uuid ORDER BY (e->>'id') COLLATE "C"), '{}') INTO result
  FROM jsonb_array_elements(evidence) e
  WHERE e->>'supersededByEvidenceId' IS NULL AND e->>'provenance' <> 'unresolved'
    AND NOT (excluded_by_id ? (e->>'id'));
  RETURN result;
END;
$$;

CREATE FUNCTION content_package_approval_generation_evidence(snapshot jsonb, effective_ids uuid[])
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', e->'id', 'claim', e->'claim', 'provenance', e->'provenance',
    'sourceReferences', e->'sourceReferences', 'confidence', e->'confidence')
      || CASE WHEN e->>'factKey' IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('factKey', e->'factKey') END
    ORDER BY (e->>'createdAtUtcMicros') COLLATE "C", (e->>'id') COLLATE "C"), '[]'::jsonb)
  FROM jsonb_array_elements(snapshot->'evidence') e
  WHERE e->>'id' = ANY(ARRAY(SELECT id::text FROM unnest(effective_ids) id));
$$;

CREATE FUNCTION enforce_content_package_approval_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot jsonb; intent jsonb; derived uuid[];
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Content Package approval receipts are immutable' USING ERRCODE = '23514'; END IF;
  -- Compatibility/admission fence, not authorization against a privileged SQL
  -- owner. Only current application code sets this scoped transaction-local
  -- marker after validating the complete live review under its package lock.
  IF NULLIF(current_setting('market_me.content_package_approval_admission', true), '')::jsonb
    IS DISTINCT FROM jsonb_build_object('approvalId', NEW.id::text, 'workspaceId', NEW.workspace_id::text,
      'contentPackageId', NEW.content_package_id::text, 'version', NEW.content_package_version,
      'reviewFingerprint', NEW.review_fingerprint, 'configurationHash', NEW.configuration_hash,
      'createdBy', NEW.created_by::text, 'learningReviewId', NEW.learning_review_id::text) THEN
    RAISE EXCEPTION 'Content Package approval requires current locked review admission' USING ERRCODE = '23514';
  END IF;
  snapshot := NEW.canonical_review_snapshot::jsonb;
  intent := NEW.canonical_input::jsonb;
  derived := content_package_review_effective_evidence(snapshot);
  IF derived IS NULL OR cardinality(derived) = 0 OR NEW.effective_evidence_ids IS DISTINCT FROM derived
    OR snapshot->'package'->>'id' IS DISTINCT FROM NEW.content_package_id::text
    OR snapshot->'package'->>'workspaceId' IS DISTINCT FROM NEW.workspace_id::text
    OR snapshot->'package'->'version' IS DISTINCT FROM to_jsonb(NEW.content_package_version)
    OR intent IS DISTINCT FROM jsonb_build_object('contract', 'market-me:content-package-approval:v1',
      'workspaceId', NEW.workspace_id::text, 'packageId', NEW.content_package_id::text,
      'expectedVersion', NEW.content_package_version, 'expectedReviewFingerprint', NEW.review_fingerprint)
    OR NOT EXISTS (SELECT 1 FROM content_package package JOIN learning_review review ON review.content_package_id = package.id
      WHERE package.id = NEW.content_package_id AND package.workspace_id = NEW.workspace_id
        AND package.version = NEW.content_package_version AND review.id = NEW.learning_review_id
        AND review.workspace_id = NEW.workspace_id AND review.actor_user_id = NEW.created_by AND review.action = 'package_approved') THEN
    RAISE EXCEPTION 'Content Package approval proof or lineage is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER content_package_approval_receipt_guard BEFORE INSERT OR UPDATE ON content_package_approval
  FOR EACH ROW EXECUTE FUNCTION enforce_content_package_approval_receipt();

CREATE FUNCTION enforce_content_package_current_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_approval_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM content_package_approval approval WHERE approval.id = NEW.current_approval_id
      AND approval.workspace_id = NEW.workspace_id AND approval.content_package_id = NEW.id
      AND approval.content_package_version = NEW.version
  ) THEN RAISE EXCEPTION 'Current Content Package approval has mismatched lineage' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER content_package_current_approval_guard BEFORE INSERT OR UPDATE ON content_package
  FOR EACH ROW EXECUTE FUNCTION enforce_content_package_current_approval();

CREATE FUNCTION enforce_learning_review_proof() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Learning Review proof is immutable' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM learning_review review JOIN content_package package ON package.id = review.content_package_id
      WHERE review.id = NEW.learning_review_id AND review.workspace_id = NEW.workspace_id
        AND review.content_package_id = NEW.content_package_id AND review.action = NEW.action
        AND package.workspace_id = NEW.workspace_id AND package.version = NEW.content_package_version)
    OR (NEW.action = 'package_approved' AND (NEW.before_review_fingerprint IS DISTINCT FROM NEW.after_review_fingerprint
      OR NOT EXISTS (SELECT 1 FROM content_package_approval approval
        WHERE approval.learning_review_id = NEW.learning_review_id AND approval.workspace_id = NEW.workspace_id
          AND approval.content_package_id = NEW.content_package_id AND approval.content_package_version = NEW.content_package_version
          AND approval.review_fingerprint = NEW.after_review_fingerprint))) THEN
    RAISE EXCEPTION 'Learning Review proof has mismatched lineage' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER learning_review_proof_guard BEFORE INSERT OR UPDATE ON learning_review_proof
  FOR EACH ROW EXECUTE FUNCTION enforce_learning_review_proof();

-- Defer erasure checks so an authorized whole-workspace cascade can remove
-- parents and receipts in any FK trigger order. Any delete/reinsert is denied
-- while history survives: a temporary proof gap must not unlock parent edits.
CREATE FUNCTION preserve_deleted_learning_review_proof() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM workspace WHERE id = OLD.workspace_id) THEN
    RAISE EXCEPTION 'Surviving Learning Review decisions require their original immutable proof' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER learning_review_proof_delete_guard AFTER DELETE ON learning_review_proof
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION preserve_deleted_learning_review_proof();

CREATE FUNCTION preserve_deleted_content_package_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM workspace WHERE id = OLD.workspace_id) THEN
    RAISE EXCEPTION 'Surviving approval history requires its original immutable receipt' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER content_package_approval_delete_guard AFTER DELETE ON content_package_approval
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION preserve_deleted_content_package_approval();

-- Protect the parent as well: deleting a non-approval decision must not bypass
-- proof immutability by cascading its child. Only workspace/org erasure may
-- remove retained history, including legacy decisions; no proof is backfilled.
CREATE FUNCTION preserve_deleted_learning_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM workspace WHERE id = OLD.workspace_id) THEN
    RAISE EXCEPTION 'Learning Review history cannot be deleted while its owning workspace survives' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER learning_review_delete_guard AFTER DELETE ON learning_review
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION preserve_deleted_learning_review();

CREATE FUNCTION preserve_proved_learning_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Legacy rows are retained decisions too. Their lack of an exact proof must
  -- not allow retargeting into a disposable workspace to bypass erasure policy.
  IF (to_jsonb(NEW) - 'evidence_item_id') IS DISTINCT FROM (to_jsonb(OLD) - 'evidence_item_id') THEN
    RAISE EXCEPTION 'Learning Review decisions are immutable' USING ERRCODE = '23514';
  END IF;
  -- A replaced live evidence row can still SET NULL its old FK. The immutable
  -- decision snapshot, not that optional live pointer, preserves original IDs.
  IF NEW.evidence_item_id IS DISTINCT FROM OLD.evidence_item_id AND NEW.evidence_item_id IS NOT NULL THEN
    RAISE EXCEPTION 'Learning Review evidence cannot be retargeted' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER learning_review_proved_history_guard BEFORE UPDATE ON learning_review
  FOR EACH ROW EXECUTE FUNCTION preserve_proved_learning_review();

-- A deferred check allows the learning row, approval and decision proof to be
-- inserted in that order in one transaction. Old historical rows are untouched.
CREATE FUNCTION require_new_learning_review_proof() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM learning_review WHERE id = NEW.id)
    AND NOT EXISTS (SELECT 1 FROM learning_review_proof WHERE learning_review_id = NEW.id) THEN
    RAISE EXCEPTION 'New Learning Review decisions require immutable proof' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER learning_review_requires_proof AFTER INSERT ON learning_review
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_new_learning_review_proof();

CREATE FUNCTION enforce_draft_generation_package_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE approval content_package_approval%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- No retroactive proof promotion. New proof-bearing generations are immutable;
    -- legacy generations retain their existing read/revision/recovery semantics.
    IF NEW.content_package_approval_id IS DISTINCT FROM OLD.content_package_approval_id
      OR (OLD.content_package_approval_id IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN
      RAISE EXCEPTION 'Draft generation approval and proved content are immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.content_package_approval_id IS NULL THEN
    RAISE EXCEPTION 'New draft generation requires exact Content Package approval' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO approval FROM content_package_approval WHERE id = NEW.content_package_approval_id;
  IF NOT FOUND OR approval.workspace_id <> NEW.workspace_id OR approval.content_package_id <> NEW.content_package_id
    OR approval.content_package_version <> NEW.content_package_version
    OR NOT EXISTS (SELECT 1 FROM content_package package WHERE package.id = NEW.content_package_id
      AND package.workspace_id = NEW.workspace_id AND package.version = NEW.content_package_version
      AND package.status = 'approved' AND package.current_approval_id = approval.id)
    OR NOT EXISTS (SELECT 1 FROM campaign_version version JOIN campaign ON campaign.id = version.campaign_id
      WHERE version.id = NEW.campaign_version_id AND campaign.workspace_id = NEW.workspace_id
        AND NEW.content_package_id = ANY(version.content_package_ids))
    OR NEW.evidence_snapshot IS DISTINCT FROM content_package_approval_generation_evidence(
      approval.canonical_review_snapshot::jsonb, approval.effective_evidence_ids) THEN
    RAISE EXCEPTION 'Draft generation must retain its exact approved effective facts and lineage' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER draft_generation_package_approval_guard BEFORE INSERT OR UPDATE ON draft_generation
  FOR EACH ROW EXECUTE FUNCTION enforce_draft_generation_package_approval();

-- An unprepared generation has no preparation FK to retain it. Protect proved
-- generation history independently so delete/reinsert cannot replace provenance
-- or silently cascade away its drafts while the owning workspace survives.
CREATE FUNCTION preserve_deleted_proved_draft_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.content_package_approval_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM workspace WHERE id = OLD.workspace_id) THEN
    RAISE EXCEPTION 'Proved draft generation history cannot be deleted while its owning workspace survives' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER draft_generation_proved_delete_guard AFTER DELETE ON draft_generation
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION preserve_deleted_proved_draft_generation();

-- Additive rollout gates: do not rewrite frozen 0111/0112 functions or receipts.
-- In particular an old finalizer must not create NEW work from an existing
-- pre-contract generation merely because no new generation insert is needed.
CREATE FUNCTION require_preparation_package_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM draft_generation generation
    JOIN content_package_approval approval ON approval.id = generation.content_package_approval_id
    JOIN content_package package ON package.id = generation.content_package_id
    WHERE generation.id = NEW.generation_id AND generation.workspace_id = NEW.workspace_id
      AND generation.campaign_version_id = NEW.planning_version_id
      AND generation.content_package_id = NEW.content_package_id AND generation.content_package_version = NEW.content_package_version
      AND approval.workspace_id = NEW.workspace_id AND approval.content_package_id = NEW.content_package_id
      AND approval.content_package_version = NEW.content_package_version
      AND package.workspace_id = NEW.workspace_id AND package.version = NEW.content_package_version
      AND package.current_approval_id = approval.id AND package.status = 'approved'
      AND NEW.reference_snapshot->'contentPackage'->>'id' = NEW.content_package_id::text
      AND NEW.reference_snapshot->'contentPackage'->'version' = to_jsonb(NEW.content_package_version)
      AND NEW.reference_snapshot->'contentPackage'->>'approvalId' = approval.id::text
      AND NEW.reference_snapshot->'contentPackage'->>'reviewFingerprint' = approval.review_fingerprint
  ) THEN RAISE EXCEPTION 'New preparation requires its exact package approval provenance' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER campaign_preparation_package_approval_guard BEFORE INSERT ON campaign_preparation
  FOR EACH ROW EXECUTE FUNCTION require_preparation_package_approval();

CREATE FUNCTION require_finalization_package_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM campaign_preparation preparation
    JOIN draft_generation generation ON generation.id = preparation.generation_id
    JOIN content_package_approval original ON original.id = generation.content_package_approval_id
    JOIN content_package package ON package.id = generation.content_package_id
    JOIN content_package_approval current ON current.id = package.current_approval_id
    WHERE preparation.id = NEW.preparation_id AND preparation.workspace_id = NEW.workspace_id
      AND preparation.campaign_id = NEW.campaign_id AND preparation.planning_version_id = NEW.planning_version_id
      AND generation.workspace_id = NEW.workspace_id AND generation.campaign_version_id = preparation.planning_version_id
      AND generation.content_package_id = preparation.content_package_id
      AND generation.content_package_version = preparation.content_package_version
      AND original.workspace_id = NEW.workspace_id AND original.content_package_id = generation.content_package_id
      AND original.content_package_version = generation.content_package_version
      AND package.workspace_id = NEW.workspace_id AND package.version = generation.content_package_version AND package.status = 'approved'
      AND current.workspace_id = NEW.workspace_id AND current.content_package_id = package.id AND current.content_package_version = package.version
      AND current.review_fingerprint = original.review_fingerprint
      AND current.canonical_review_snapshot = original.canonical_review_snapshot
      AND current.effective_evidence_ids = original.effective_evidence_ids
  ) THEN RAISE EXCEPTION 'New finalization requires the original exact package approval content to remain approved' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER campaign_finalization_package_approval_guard BEFORE INSERT ON campaign_finalization
  FOR EACH ROW EXECUTE FUNCTION require_finalization_package_approval();

COMMENT ON COLUMN draft_generation.content_package_approval_id IS
  'Exact immutable package approval used for this generation. NULL is pre-contract history, never permission for new generation.';
COMMENT ON COLUMN content_package.current_approval_id IS
  'Current attestation hint; generation also checks the full live review fingerprint and eligibility under the package root lock.';
