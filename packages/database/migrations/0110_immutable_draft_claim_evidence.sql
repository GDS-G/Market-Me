-- A claim references its immutable generation snapshot, not the replaceable
-- evidence_item row for the current package revision. Keep the existing IDs.
ALTER TABLE content_draft_claim_evidence
  DROP CONSTRAINT IF EXISTS content_draft_claim_evidence_evidence_item_id_fkey;

CREATE FUNCTION draft_claim_snapshot_reference_valid(claim_id uuid, evidence_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH lineage AS (
    SELECT claim.id, claim.content_draft_version_id, claim.kind, claim.sort_order,
      CASE WHEN jsonb_typeof(version.presentation_choices->'factOrder') = 'array'
        THEN version.presentation_choices->'factOrder' ELSE '[]'::jsonb END AS fact_order,
      CASE WHEN jsonb_typeof(generation.evidence_snapshot) = 'array'
        THEN generation.evidence_snapshot ELSE '[]'::jsonb END AS evidence
    FROM content_draft_claim claim
    JOIN content_draft_version version ON version.id = claim.content_draft_version_id
    JOIN content_draft draft ON draft.id = version.content_draft_id
    JOIN draft_generation generation ON generation.id = draft.draft_generation_id
      AND generation.workspace_id = draft.workspace_id
    JOIN campaign_version campaign_version ON campaign_version.id = generation.campaign_version_id
      AND generation.content_package_id = ANY(campaign_version.content_package_ids)
    JOIN campaign ON campaign.id = campaign_version.campaign_id
      AND campaign.workspace_id = generation.workspace_id
    JOIN content_package package ON package.id = generation.content_package_id
      AND package.workspace_id = generation.workspace_id
    WHERE claim.id = claim_id
  )
  SELECT COALESCE((
    SELECT lineage.kind = 'fact'
      AND lineage.fact_order->>lineage.sort_order = evidence_id::text
      -- Check the whole version, not merely this text/ordinal: older partial
      -- revisions may have dropped a fact and retained an obsolete factOrder.
      AND jsonb_array_length(lineage.fact_order) > 0
      AND (SELECT count(*) FROM content_draft_claim fact
        WHERE fact.content_draft_version_id = lineage.content_draft_version_id AND fact.kind = 'fact')
        = jsonb_array_length(lineage.fact_order)
      AND (SELECT count(DISTINCT fact.sort_order) FROM content_draft_claim fact
        WHERE fact.content_draft_version_id = lineage.content_draft_version_id AND fact.kind = 'fact')
        = jsonb_array_length(lineage.fact_order)
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(lineage.fact_order) item
        WHERE jsonb_typeof(item) <> 'string' OR (item#>>'{}'
          ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') IS NOT TRUE
      )
      AND NOT EXISTS (
        SELECT 1 FROM content_draft_claim fact
        WHERE fact.content_draft_version_id = lineage.content_draft_version_id AND fact.kind = 'fact'
          AND (fact.sort_order < 0 OR fact.sort_order >= jsonb_array_length(lineage.fact_order)
            OR (SELECT count(*) FROM jsonb_array_elements(lineage.evidence) snapshot
              WHERE snapshot->>'id' = lineage.fact_order->>fact.sort_order) <> 1
            OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(lineage.evidence) snapshot
              WHERE snapshot->>'id' = lineage.fact_order->>fact.sort_order
                AND snapshot->>'claim' = fact.claim_text
                AND snapshot->>'provenance' IN ('observed', 'authoritative_context', 'inferred')))
      )
      AND (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(lineage.fact_order))
        = jsonb_array_length(lineage.fact_order)
    FROM lineage
  ), false);
$$;

CREATE FUNCTION enforce_draft_claim_snapshot_reference()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.content_draft_claim_id, NEW.evidence_item_id)
      IS DISTINCT FROM (OLD.content_draft_claim_id, OLD.evidence_item_id) THEN
    RAISE EXCEPTION 'An immutable draft claim evidence reference cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF NOT draft_claim_snapshot_reference_valid(NEW.content_draft_claim_id, NEW.evidence_item_id) THEN
    RAISE EXCEPTION 'Draft claim evidence must match its exact version and generation snapshot' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER content_draft_claim_snapshot_reference
BEFORE INSERT OR UPDATE ON content_draft_claim_evidence
FOR EACH ROW EXECUTE FUNCTION enforce_draft_claim_snapshot_reference();

-- Restore only IDs captured in a complete, consistent immutable factOrder.
-- No current-package or text-only lookup is allowed. Versions without sufficient
-- proof remain unlinked; their missing provenance must not be invented.
WITH candidates AS (
  SELECT claim.id AS claim_id,
    CASE WHEN version.presentation_choices->'factOrder'->>claim.sort_order
        ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN (version.presentation_choices->'factOrder'->>claim.sort_order)::uuid END AS evidence_id
  FROM content_draft_claim claim
  JOIN content_draft_version version ON version.id = claim.content_draft_version_id
  WHERE claim.kind = 'fact'
)
INSERT INTO content_draft_claim_evidence (content_draft_claim_id, evidence_item_id)
SELECT claim_id, evidence_id FROM candidates
WHERE evidence_id IS NOT NULL AND draft_claim_snapshot_reference_valid(claim_id, evidence_id)
  AND NOT EXISTS (SELECT 1 FROM content_draft_claim_evidence surviving WHERE surviving.content_draft_claim_id = claim_id)
ON CONFLICT (content_draft_claim_id, evidence_item_id) DO NOTHING;

COMMENT ON COLUMN content_draft_claim_evidence.evidence_item_id IS
  'Historical evidence UUID in the exact draft generation snapshot; the current evidence_item row may no longer exist.';
