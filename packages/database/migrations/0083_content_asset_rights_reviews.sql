ALTER TABLE content_asset
  ADD COLUMN rights_owner text,
  ADD COLUMN rights_license_owner text,
  ADD COLUMN rights_source_reference text,
  ADD COLUMN rights_proof_reference text,
  ADD COLUMN rights_commercial_use_allowed boolean,
  ADD COLUMN rights_derivative_use_allowed boolean,
  ADD COLUMN rights_worldwide_use_allowed boolean,
  ADD COLUMN rights_permitted_channels text[] NOT NULL DEFAULT '{}',
  ADD COLUMN rights_valid_from timestamptz,
  ADD COLUMN rights_expires_at timestamptz,
  ADD COLUMN rights_attribution_requirement text,
  ADD COLUMN rights_watermark_requirement text,
  ADD COLUMN rights_disclaimer_requirement text,
  ADD COLUMN rights_review_note text,
  ADD COLUMN rights_reviewed_by uuid REFERENCES app_user(id) ON DELETE RESTRICT,
  ADD COLUMN rights_reviewed_at timestamptz,
  ADD COLUMN rights_revision integer NOT NULL DEFAULT 0;

-- Earlier releases treated a bare `cleared` flag as sufficient. Revoke those
-- unsupported clearances so every future outbound use requires review evidence.
UPDATE content_asset
SET rights_status = 'unchecked'
WHERE rights_status = 'cleared';

ALTER TABLE content_asset
  ADD CONSTRAINT content_asset_rights_revision_check
    CHECK (rights_revision >= 0),
  ADD CONSTRAINT content_asset_rights_channel_count_check
    CHECK (cardinality(rights_permitted_channels) <= 20),
  ADD CONSTRAINT content_asset_rights_validity_check
    CHECK (
      rights_expires_at IS NULL OR rights_valid_from IS NULL
      OR rights_expires_at > rights_valid_from
    ),
  ADD CONSTRAINT content_asset_rights_cleared_evidence_check
    CHECK (
      rights_status <> 'cleared'
      OR (
        role = 'original'
        AND coalesce(length(btrim(rights_owner)), 0) BETWEEN 1 AND 200
        AND coalesce(length(btrim(rights_source_reference)), 0) BETWEEN 3 AND 1000
        AND coalesce(length(btrim(rights_proof_reference)), 0) BETWEEN 3 AND 1000
        AND rights_commercial_use_allowed IS TRUE
        AND rights_derivative_use_allowed IS TRUE
        AND rights_worldwide_use_allowed IS TRUE
        AND cardinality(rights_permitted_channels) BETWEEN 1 AND 20
        AND rights_attribution_requirement IS NULL
        AND rights_watermark_requirement IS NULL
        AND rights_disclaimer_requirement IS NULL
        AND coalesce(length(btrim(rights_review_note)), 0) BETWEEN 3 AND 2000
        AND rights_reviewed_by IS NOT NULL
        AND rights_reviewed_at IS NOT NULL
        AND rights_revision > 0
      )
    );

CREATE INDEX content_asset_rights_review_idx
  ON content_asset(content_package_id, rights_status, rights_expires_at)
  WHERE role = 'original' AND mime_type LIKE 'image/%';

ALTER TABLE draft_channel_preview_asset
  ADD COLUMN rights_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN rights_reviewed_at timestamptz,
  ADD COLUMN rights_expires_at timestamptz;

UPDATE draft_channel_preview_asset
SET rights_status = 'unchecked', rights_revision = 0,
  rights_reviewed_at = NULL, rights_expires_at = NULL
WHERE rights_status = 'cleared';

ALTER TABLE draft_channel_preview_asset
  ADD CONSTRAINT draft_preview_asset_rights_revision_check
    CHECK (
      (rights_status = 'unchecked' AND rights_revision = 0)
      OR (rights_status = 'cleared' AND rights_revision > 0 AND rights_reviewed_at IS NOT NULL)
    );
