import type { TransactionSql } from "postgres";
import {
  CONTENT_PACKAGE_REVIEW_LIMITS, createContentPackageReviewFingerprint,
  ContentPackageReviewFingerprintValidationError, type ContentPackageReviewFingerprintResult,
} from "./content-package-review-fingerprint";
import { ContentPackageReviewError } from "./content-package-review-models";

export interface PackageReviewIdentity { readonly workspaceId: string; readonly packageId: string }
export interface CapturedPackageReview extends ContentPackageReviewFingerprintResult {
  readonly status: string; readonly currentApprovalId: string | null;
}

// Column names are static application code, never user input. Every timestamp is
// SQL-formatted UTC with six digits. The AD marker rejects BC lookalikes as well
// as infinity and years outside 0001..9999 in the pure schema validator.
const utc = (column: string) => `CASE WHEN ${column} IS NULL THEN NULL WHEN ${column} >= '0001-01-01Z'::timestamptz AND ${column} < '10000-01-01Z'::timestamptz THEN to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') ELSE 'invalid-timestamp' END`;
const projection = `
SELECT p.status, p.current_approval_id, jsonb_build_object(
 'schemaVersion',1, 'reviewContract','content-package-review-v1',
 'package',jsonb_build_object('id',p.id::text,'workspaceId',p.workspace_id::text,
   'smartSourceId',p.smart_source_id::text,'rootSourceItemId',p.root_source_item_id::text,
   'version',p.version,'title',p.title,'confidence',p.confidence,
   'contextPackVersionIds',p.context_pack_version_ids,'createdAtUtcMicros',${utc("p.created_at")}),
 'evidence',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',e.id::text,'factKey',e.fact_key,'claim',e.claim,'provenance',e.provenance,
   'sourceReferences',e.source_references,'confidence',e.confidence,
   'contextPackVersionId',e.context_pack_version_id::text,
   'supersededByEvidenceId',e.superseded_by_evidence_id::text,
   'createdAtUtcMicros',${utc("e.created_at")}) ORDER BY e.id)
   FROM evidence_item e WHERE e.content_package_id=p.id),'[]'::jsonb),
 'conflicts',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',c.id::text,'factKey',c.fact_key,'candidateEvidenceIds',c.candidate_evidence_ids,
   'status',c.status,'resolutionEvidenceId',c.resolution_evidence_id::text,
   'resolutionNote',c.resolution_note,'createdAtUtcMicros',${utc("c.created_at")},
   'resolvedAtUtcMicros',${utc("c.resolved_at")}) ORDER BY c.id)
   FROM evidence_conflict c WHERE c.content_package_id=p.id),'[]'::jsonb),
 'assets',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',a.id::text,'sourceItemId',a.source_item_id::text,'sourceAssetId',a.source_asset_id::text,
   'role',a.role,'fileName',a.file_name,'mimeType',a.mime_type,'contentHash',a.content_hash,
   'objectKey',a.object_key,'byteSizeDecimal',a.byte_size::text,'processingVersion',a.processing_version,
   'recipe',a.recipe,'mediaStatus',a.media_status,
   'extraction',jsonb_build_object('status',a.extraction_status,'text',a.extracted_text,'error',a.extraction_error),
   'scan',jsonb_build_object('status',a.scan_status,'engine',a.scan_engine,
     'scannedAtUtcMicros',${utc("a.scan_scanned_at")},'revision',a.scan_revision),
   'accessibility',jsonb_build_object('altText',a.alt_text,'status',a.alt_text_status,'notes',a.accessibility_notes),
   'rights',jsonb_build_object('status',a.rights_status,'owner',a.rights_owner,
     'licenseOwner',a.rights_license_owner,'sourceReference',a.rights_source_reference,
     'proofReference',a.rights_proof_reference,'commercialUseAllowed',a.rights_commercial_use_allowed,
     'derivativeUseAllowed',a.rights_derivative_use_allowed,'worldwideUseAllowed',a.rights_worldwide_use_allowed,
     'permittedChannels',a.rights_permitted_channels,
     'permittedChannelConnectionIds',COALESCE((SELECT jsonb_agg(s.channel_connection_id::text ORDER BY s.channel_connection_id)
       FROM content_asset_rights_channel_connection s WHERE s.content_asset_id=a.id),'[]'::jsonb),
     'permittedCampaignIds',COALESCE((SELECT jsonb_agg(s.campaign_id::text ORDER BY s.campaign_id)
       FROM content_asset_rights_campaign s WHERE s.content_asset_id=a.id),'[]'::jsonb),
     'permittedBrandProfileIds',COALESCE((SELECT jsonb_agg(s.brand_profile_id::text ORDER BY s.brand_profile_id)
       FROM content_asset_rights_brand_profile s WHERE s.content_asset_id=a.id),'[]'::jsonb),
     'validFromUtcMicros',${utc("a.rights_valid_from")},'expiresAtUtcMicros',${utc("a.rights_expires_at")},
     'attributionRequirement',a.rights_attribution_requirement,'watermarkRequirement',a.rights_watermark_requirement,
     'disclaimerRequirement',a.rights_disclaimer_requirement,'reviewNote',a.rights_review_note,
     'reviewedBy',a.rights_reviewed_by::text,'reviewedAtUtcMicros',${utc("a.rights_reviewed_at")},'revision',a.rights_revision),
   'metadata',a.metadata,'createdAtUtcMicros',${utc("a.created_at")}) ORDER BY a.id)
   FROM content_asset a WHERE a.content_package_id=p.id),'[]'::jsonb)
 )::text AS snapshot_json
FROM content_package p WHERE p.workspace_id=$1 AND p.id=$2`;

/** Caller holds the package root SHARE/UPDATE lock. All ordinary material child
 * writers acquire UPDATE on that root first. No child lock is taken here: draft
 * finalization subsequently takes channel locks, while publishing takes channel
 * then asset locks. Root-only reads preserve that global deadlock order. */
export async function captureContentPackageReviewInTransaction(
  tx: TransactionSql, input: PackageReviewIdentity,
): Promise<CapturedPackageReview> {
  const bounds = (await tx<{ evidenceCount: number; conflictCount: number; assetCount: number; bytes: string }[]>`
    SELECT (SELECT count(*)::integer FROM evidence_item WHERE content_package_id=p.id) AS evidence_count,
      (SELECT count(*)::integer FROM evidence_conflict WHERE content_package_id=p.id) AS conflict_count,
      (SELECT count(*)::integer FROM content_asset WHERE content_package_id=p.id) AS asset_count,
      (octet_length(row_to_json(p)::text)::bigint
       + COALESCE((SELECT sum(octet_length(row_to_json(e)::text)) FROM evidence_item e WHERE e.content_package_id=p.id),0)
       + COALESCE((SELECT sum(octet_length(row_to_json(c)::text)) FROM evidence_conflict c WHERE c.content_package_id=p.id),0)
       + COALESCE((SELECT sum(octet_length(row_to_json(a)::text)) FROM content_asset a WHERE a.content_package_id=p.id),0)
       + 40 * (SELECT count(*) FROM content_asset_rights_channel_connection s JOIN content_asset a ON a.id=s.content_asset_id WHERE a.content_package_id=p.id)
       + 40 * (SELECT count(*) FROM content_asset_rights_campaign s JOIN content_asset a ON a.id=s.content_asset_id WHERE a.content_package_id=p.id)
       + 40 * (SELECT count(*) FROM content_asset_rights_brand_profile s JOIN content_asset a ON a.id=s.content_asset_id WHERE a.content_package_id=p.id)
      )::text AS bytes
    FROM content_package p WHERE p.workspace_id=${input.workspaceId} AND p.id=${input.packageId}
  `)[0];
  if (!bounds) throw new ContentPackageReviewError("package_unavailable", "Content Package is unavailable in this workspace.");
  if (bounds.evidenceCount > CONTENT_PACKAGE_REVIEW_LIMITS.evidenceItems
    || bounds.conflictCount > CONTENT_PACKAGE_REVIEW_LIMITS.conflicts
    || bounds.assetCount > CONTENT_PACKAGE_REVIEW_LIMITS.assets
    || BigInt(bounds.bytes) > BigInt(CONTENT_PACKAGE_REVIEW_LIMITS.rawProjectionBytes)) {
    throw new ContentPackageReviewError("review_snapshot_too_large", "The package exceeds the supported exact review limits. Split it before review.");
  }
  const row = (await tx.unsafe<{ snapshotJson: string; status: string; currentApprovalId: string | null }[]>(
    projection, [input.workspaceId, input.packageId],
  ))[0];
  if (!row) throw new ContentPackageReviewError("package_unavailable", "Content Package is unavailable in this workspace.");
  if (Buffer.byteLength(row.snapshotJson, "utf8") > CONTENT_PACKAGE_REVIEW_LIMITS.rawProjectionBytes) {
    throw new ContentPackageReviewError("review_snapshot_too_large", "The package exceeds the supported exact review limits.");
  }
  let captured: ContentPackageReviewFingerprintResult;
  try { captured = createContentPackageReviewFingerprint(JSON.parse(row.snapshotJson)); }
  catch (error) {
    if (error instanceof ContentPackageReviewFingerprintValidationError) {
      throw new ContentPackageReviewError(error.issues.some((issue) => issue.code === "limit_exceeded")
        ? "review_snapshot_too_large" : "invalid_review_input", "Stored package data cannot be represented by the exact review contract.");
    }
    throw error;
  }
  // Compare the SAME captured raw JSONB, never a later live query. This detects
  // PostgreSQL arbitrary-precision numbers rounded anywhere by JSON.parse.
  const exact = (await tx<{ exact: boolean }[]>`
    SELECT ${row.snapshotJson}::text::jsonb = ${captured.canonicalSnapshot}::text::jsonb AS exact
  `)[0]?.exact;
  if (!exact) throw new ContentPackageReviewError("review_snapshot_lossy", "Stored review JSON contains numbers that cannot be represented losslessly.");
  return Object.freeze({ ...captured, status: row.status, currentApprovalId: row.currentApprovalId });
}
