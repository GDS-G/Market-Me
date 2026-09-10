-- A completed-only idempotency receipt. All preparation writes share one transaction;
-- there is no visible pending row that can outlive a failed draft generation.
CREATE TABLE campaign_preparation (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  template_key text NOT NULL CHECK (template_key = 'general_announcement'),
  template_version integer NOT NULL CHECK (template_version = 1),
  content_package_id uuid NOT NULL REFERENCES content_package(id) ON DELETE RESTRICT,
  content_package_version integer NOT NULL CHECK (content_package_version > 0),
  canonical_payload text NOT NULL,
  configuration_hash text NOT NULL CHECK (configuration_hash ~ '^[0-9a-f]{64}$'),
  configuration_snapshot jsonb NOT NULL CHECK (jsonb_typeof(configuration_snapshot) = 'object'),
  reference_snapshot jsonb NOT NULL CHECK (jsonb_typeof(reference_snapshot) = 'object'),
  campaign_id uuid NOT NULL UNIQUE REFERENCES campaign(id) ON DELETE RESTRICT,
  planning_version_id uuid NOT NULL UNIQUE REFERENCES campaign_version(id) ON DELETE RESTRICT,
  generation_id uuid NOT NULL UNIQUE REFERENCES draft_generation(id) ON DELETE RESTRICT,
  prepared_drafts jsonb NOT NULL CHECK (jsonb_typeof(prepared_drafts) = 'array'
    AND jsonb_array_length(prepared_drafts) BETWEEN 1 AND 20),
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX campaign_preparation_workspace_time_idx ON campaign_preparation(workspace_id, created_at DESC);

CREATE FUNCTION enforce_campaign_preparation_receipt() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Campaign preparation receipts are immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM campaign c
    JOIN campaign_version cv ON cv.campaign_id = c.id
    JOIN draft_generation g ON g.campaign_version_id = cv.id
    JOIN content_package p ON p.id = g.content_package_id
    WHERE c.id = NEW.campaign_id AND c.workspace_id = NEW.workspace_id
      AND cv.id = NEW.planning_version_id AND cv.autonomy_mode = 'draft_only'
      AND cv.status = 'published' AND c.current_version_id = cv.id
      AND g.id = NEW.generation_id AND g.workspace_id = NEW.workspace_id
      AND p.id = NEW.content_package_id AND p.workspace_id = NEW.workspace_id
      AND g.content_package_version = NEW.content_package_version
      AND p.id = ANY(cv.content_package_ids)
  ) THEN
    RAISE EXCEPTION 'Campaign preparation lineage is invalid' USING ERRCODE = '23514';
  END IF;
  -- Compare identifiers as text: malformed JSON must fail validation, not be cast
  -- into a foreign ID. Persist exactly every initial draft/version in the generation.
  IF (SELECT count(*) FROM content_draft WHERE draft_generation_id = NEW.generation_id)
       <> jsonb_array_length(NEW.prepared_drafts)
    OR (SELECT count(DISTINCT value->>'draftId') FROM jsonb_array_elements(NEW.prepared_drafts))
       <> jsonb_array_length(NEW.prepared_drafts)
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.prepared_drafts) entry
      WHERE NOT EXISTS (
        SELECT 1 FROM content_draft d JOIN content_draft_version v ON v.content_draft_id = d.id
        WHERE d.draft_generation_id = NEW.generation_id AND d.workspace_id = NEW.workspace_id
          AND d.id::text = entry->>'draftId' AND v.id::text = entry->>'versionId'
          AND v.version_number = 1 AND d.current_version_id = v.id
      )
    ) THEN
    RAISE EXCEPTION 'Campaign preparation draft references are invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER campaign_preparation_receipt_guard
BEFORE INSERT OR UPDATE ON campaign_preparation
FOR EACH ROW EXECUTE FUNCTION enforce_campaign_preparation_receipt();
