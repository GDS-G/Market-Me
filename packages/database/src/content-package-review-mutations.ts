import { randomUUID } from "node:crypto";
import { CONTENT_ASSET_RIGHTS_CHANNELS } from "@market-me/domain";
import type { JSONValue, TransactionSql } from "postgres";
import type { DatabaseClient } from "./client";
import type { ContentAssetRightsReviewWrite } from "./models";
import { ContentPackageReviewError, type ContentPackageReview, type ContentPackageReviewExpectation } from "./content-package-review-models";
import {
  assertPackageReviewAccessInTransaction, assertPackageReviewExpectation, assertPackageReviewUuid,
  assertExpectedContentPackageReviewInTransaction, invalidateContentPackageApprovalInTransaction,
  insertLearningReviewProofInTransaction,
} from "./content-package-review-repository";

export interface PackageAssetAccessibilityInput extends ContentPackageReviewExpectation {
  readonly assetId: string; readonly altText?: string; readonly decorative: boolean; readonly notes?: string;
}
export interface PackageEvidenceConflictInput extends ContentPackageReviewExpectation {
  readonly conflictId: string; readonly evidenceId: string; readonly note?: string;
}
export interface PackageUnresolvedEvidenceInput extends ContentPackageReviewExpectation {
  readonly evidenceId: string; readonly correctedClaim: string; readonly note?: string;
}
function invalid(message: string): never { throw new ContentPackageReviewError("invalid_review_input", message); }
function requireMutableReview(review: ContentPackageReview): void {
  if (!["ready", "needs_review", "approved"].includes(review.status)) {
    throw new ContentPackageReviewError("review_blocked", "This package is not in a human-review state. Wait for ingestion or resolve its current workflow first.");
  }
}
function text(value: unknown, label: string, maximum: number, minimum = 0): string {
  if (typeof value !== "string" || value.trim().length < minimum || value.trim().length > maximum) invalid(`${label} is missing or outside its supported length.`);
  return value.trim();
}
function optionalText(value: unknown, label: string, maximum: number): string | null {
  return value === undefined ? null : text(value, label, maximum) || null;
}
function referenceIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 100) invalid(`${label} must be a bounded array of exact IDs.`);
  for (const item of value) assertPackageReviewUuid(item);
  return [...new Set(value as string[])].sort();
}
function monthDays(year: number, month: number): number {
  return [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}
/** Exact RFC3339 offset arithmetic; never rounds fractions through Date. */
export function normalizePackageReviewRightsInstant(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") invalid("Asset permission times must be exact RFC3339 instants.");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) invalid("Asset permission times require UTC or an explicit offset and at most six fractional digits.");
  let year = Number(match[1]); let month = Number(match[2]); let day = Number(match[3]);
  const hour = Number(match[4]); const minute = Number(match[5]); const second = Number(match[6]);
  const zone = match[8]!;
  const zoneHours = zone === "Z" ? 0 : Number(zone.slice(1, 3));
  const zoneMinutes = zone === "Z" ? 0 : Number(zone.slice(4, 6));
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays(year, month)
    || hour > 23 || minute > 59 || second > 59 || zoneHours > 23 || zoneMinutes > 59) invalid("Asset permission time is outside the finite Gregorian range.");
  let minutes = hour * 60 + minute - (zone.startsWith("-") ? -1 : 1) * (zoneHours * 60 + zoneMinutes);
  if (minutes < 0) {
    minutes += 1440; day -= 1;
    if (day === 0) { month -= 1; if (month === 0) { month = 12; year -= 1; } day = monthDays(year, month); }
  } else if (minutes >= 1440) {
    minutes -= 1440; day += 1;
    if (day > monthDays(year, month)) { day = 1; month += 1; if (month === 13) { month = 1; year += 1; } }
  }
  if (year < 1 || year > 9999) invalid("Asset permission UTC time is outside years 0001 through 9999.");
  const two = (n: number) => n.toString().padStart(2, "0");
  return `${year.toString().padStart(4, "0")}-${two(month)}-${two(day)}T${two(Math.floor(minutes / 60))}:${two(minutes % 60)}:${two(second)}.${(match[7] ?? "").padEnd(6, "0")}Z`;
}
async function audit(tx: TransactionSql, input: ContentPackageReviewExpectation, eventType: string,
  subjectType: string, subjectId: string, data: Record<string, unknown>): Promise<void> {
  await tx`INSERT INTO audit_event(id,workspace_id,actor_user_id,event_type,subject_type,subject_id,data,created_at)
    VALUES (${randomUUID()},${input.workspaceId},${input.actorUserId},${eventType},${subjectType},${subjectId},${tx.json(data as JSONValue)},clock_timestamp())`;
}

export async function updatePackageAssetAccessibility(sql: DatabaseClient, input: PackageAssetAccessibilityInput): Promise<ContentPackageReview | undefined> {
  assertPackageReviewExpectation(input); assertPackageReviewUuid(input.assetId);
  if (typeof input.decorative !== "boolean") invalid("Choose whether this asset is decorative.");
  const altText = optionalText(input.altText, "Alternative text", 2000);
  const notes = optionalText(input.notes, "Accessibility notes", 2000);
  if (!input.decorative && !altText) invalid("Informative images require reviewed alternative text.");
  return sql.begin(async (tx) => {
    const before = (await assertExpectedContentPackageReviewInTransaction(tx, input, "write")).review;
    requireMutableReview(before);
    const asset = before.snapshot.assets.find((row) => row.id === input.assetId && row.role === "original" && row.mimeType.startsWith("image/"));
    if (!asset) return undefined;
    await tx`UPDATE content_asset SET alt_text=${input.decorative ? null : altText},
      alt_text_status=${input.decorative ? "decorative" : "approved"},accessibility_notes=${notes}
      WHERE id=${input.assetId} AND content_package_id=${input.packageId}`;
    const after = (await invalidateContentPackageApprovalInTransaction(tx, input)).review;
    const afterAccessibility = after.snapshot.assets.find((row) => row.id === input.assetId)!.accessibility;
    await audit(tx, input, "content_asset.accessibility_updated", "content_asset", input.assetId, {
      contract: "content-package-review-mutation-v1", beforeFingerprint: before.reviewFingerprint, afterFingerprint: after.reviewFingerprint,
      beforeStatus: asset.accessibility.status, afterStatus: afterAccessibility.status,
      decorative: input.decorative, altTextLength: afterAccessibility.altText?.length ?? 0, notesPresent: Boolean(afterAccessibility.notes),
    });
    return after;
  });
}

export async function reviewPackageAssetRights(sql: DatabaseClient, values: ContentAssetRightsReviewWrite, actorUserId: string): Promise<ContentPackageReview | undefined> {
  const input = { ...values, actorUserId };
  assertPackageReviewExpectation(input); assertPackageReviewUuid(input.assetId);
  if (input.status !== "cleared" && input.status !== "restricted") invalid("Choose cleared or restricted rights.");
  const owner = text(input.owner, "Rights owner", 200, 1); const licenseOwner = optionalText(input.licenseOwner, "License owner", 200);
  const sourceReference = text(input.sourceReference, "Rights source reference", 1000, 3);
  const proofReference = text(input.proofReference, "Rights proof reference", 1000, 3);
  const reviewNote = text(input.reviewNote, "Rights review note", 2000, 3);
  const attributionRequirement = optionalText(input.attributionRequirement, "Attribution requirement", 1000);
  const watermarkRequirement = optionalText(input.watermarkRequirement, "Watermark requirement", 1000);
  const disclaimerRequirement = optionalText(input.disclaimerRequirement, "Disclaimer requirement", 1000);
  for (const allowed of [input.commercialUseAllowed, input.derivativeUseAllowed, input.worldwideUseAllowed]) if (typeof allowed !== "boolean") invalid("Rights permission decisions must be booleans.");
  if (!Array.isArray(input.permittedChannels) || input.permittedChannels.length > 20
    || input.permittedChannels.some((channel) => !(CONTENT_ASSET_RIGHTS_CHANNELS as readonly string[]).includes(channel))) invalid("Choose supported rights channels only.");
  const permittedChannels = [...new Set(input.permittedChannels)];
  const connectionIds = referenceIds(input.permittedChannelConnectionIds, "Permitted Channel Connections");
  const campaignIds = referenceIds(input.permittedCampaignIds, "Permitted Campaigns");
  const brandIds = referenceIds(input.permittedBrandProfileIds, "Permitted Brand Profiles");
  const validFrom = normalizePackageReviewRightsInstant(input.validFrom); const expiresAt = normalizePackageReviewRightsInstant(input.expiresAt);
  if (validFrom && expiresAt && expiresAt <= validFrom) invalid("Asset rights expiration must follow its valid-from time.");
  if (input.status === "cleared" && (!input.commercialUseAllowed || !input.derivativeUseAllowed || !input.worldwideUseAllowed
    || !permittedChannels.length || !connectionIds.length || attributionRequirement || watermarkRequirement || disclaimerRequirement)) invalid("Clearance requires worldwide commercial and derivative permission for exact supported accounts without outstanding obligations.");
  return sql.begin(async (tx) => {
    await assertPackageReviewAccessInTransaction(tx, input, "write");
    // Finalizer owns Campaign before package. Prelock deferred FK references before
    // package/asset to avoid a commit-time Campaign→package / package→Campaign cycle.
    if (campaignIds.length) {
      const rows = await tx`SELECT id FROM campaign WHERE workspace_id=${input.workspaceId} AND id IN ${tx(campaignIds)} ORDER BY id FOR KEY SHARE`;
      if (rows.length !== campaignIds.length) invalid("Every permitted Campaign must belong to this workspace.");
    }
    if (connectionIds.length) {
      const rows = await tx`SELECT id FROM channel_connection WHERE workspace_id=${input.workspaceId}
        AND id IN ${tx(connectionIds)} AND provider=ANY(${permittedChannels}) ORDER BY id FOR KEY SHARE`;
      if (rows.length !== connectionIds.length) invalid("Every permitted Channel Connection must belong to this workspace and match a permitted provider.");
    }
    if (brandIds.length) {
      const rows = await tx`SELECT id FROM brand_profile WHERE workspace_id=${input.workspaceId} AND id IN ${tx(brandIds)} ORDER BY id FOR KEY SHARE`;
      if (rows.length !== brandIds.length) invalid("Every permitted Brand Profile must belong to this workspace.");
    }
    const before = (await assertExpectedContentPackageReviewInTransaction(tx, input, "write")).review;
    requireMutableReview(before);
    const asset = before.snapshot.assets.find((row) => row.id === input.assetId && row.role === "original" && row.mimeType.startsWith("image/"));
    if (!asset) return undefined;
    await tx`SELECT id FROM content_asset WHERE id=${input.assetId} AND content_package_id=${input.packageId} FOR UPDATE`;
    const now = (await tx<{ now: string }[]>`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`)[0]!.now;
    if (input.status === "cleared" && ((validFrom && validFrom > now) || (expiresAt && expiresAt <= now))) invalid("Cleared rights must be valid at the current database time.");
    await tx`UPDATE content_asset SET rights_status=${input.status},rights_owner=${owner},rights_license_owner=${licenseOwner},
      rights_source_reference=${sourceReference},rights_proof_reference=${proofReference},
      rights_commercial_use_allowed=${input.commercialUseAllowed},rights_derivative_use_allowed=${input.derivativeUseAllowed},
      rights_worldwide_use_allowed=${input.worldwideUseAllowed},rights_permitted_channels=${permittedChannels},
      rights_valid_from=${validFrom}::text::timestamptz,rights_expires_at=${expiresAt}::text::timestamptz,
      rights_attribution_requirement=${attributionRequirement},rights_watermark_requirement=${watermarkRequirement},
      rights_disclaimer_requirement=${disclaimerRequirement},rights_review_note=${reviewNote},rights_reviewed_by=${actorUserId},
      rights_reviewed_at=clock_timestamp(),rights_revision=rights_revision+1 WHERE id=${input.assetId} AND content_package_id=${input.packageId}`;
    await tx`DELETE FROM content_asset_rights_channel_connection WHERE content_asset_id=${input.assetId}`;
    for (const connectionId of connectionIds) await tx`INSERT INTO content_asset_rights_channel_connection(content_asset_id,channel_connection_id) VALUES (${input.assetId},${connectionId})`;
    await tx`DELETE FROM content_asset_rights_campaign WHERE content_asset_id=${input.assetId}`;
    for (const campaignId of campaignIds) await tx`INSERT INTO content_asset_rights_campaign(content_asset_id,campaign_id) VALUES (${input.assetId},${campaignId})`;
    await tx`DELETE FROM content_asset_rights_brand_profile WHERE content_asset_id=${input.assetId}`;
    for (const brandId of brandIds) await tx`INSERT INTO content_asset_rights_brand_profile(content_asset_id,brand_profile_id) VALUES (${input.assetId},${brandId})`;
    const after = (await invalidateContentPackageApprovalInTransaction(tx, input)).review;
    const afterRights = after.snapshot.assets.find((row) => row.id === input.assetId)!.rights;
    // Expiry can pass while scope/audit constraints wait. A final fresh clock must
    // still permit a new clearance; no timestamp from transaction start is a lease.
    await audit(tx, input, "content_asset.rights_reviewed", "content_asset", input.assetId, {
      contract: "content-package-review-mutation-v1", beforeFingerprint: before.reviewFingerprint, afterFingerprint: after.reviewFingerprint,
      beforeStatus: asset.rights.status, afterStatus: afterRights.status,
      beforeRevision: asset.rights.revision, afterRevision: afterRights.revision,
      commercialUseAllowed: afterRights.commercialUseAllowed === true,
      derivativeUseAllowed: afterRights.derivativeUseAllowed === true,
      worldwideUseAllowed: afterRights.worldwideUseAllowed === true,
      permittedChannelCount: afterRights.permittedChannels.length,
      permittedChannelConnectionCount: afterRights.permittedChannelConnectionIds.length,
      permittedCampaignCount: afterRights.permittedCampaignIds.length,
      permittedBrandProfileCount: afterRights.permittedBrandProfileIds.length,
      hasValidFrom: afterRights.validFromUtcMicros !== null,
      hasExpiration: afterRights.expiresAtUtcMicros !== null,
      hasOutstandingRequirements: Boolean(afterRights.attributionRequirement || afterRights.watermarkRequirement || afterRights.disclaimerRequirement),
    });
    if (input.status === "cleared" && expiresAt) {
      const expired = (await tx<{ expired: boolean }[]>`SELECT ${expiresAt}::text::timestamptz <= clock_timestamp() AS expired`)[0]!.expired;
      if (expired) invalid("The asset permission expired before its review completed.");
    }
    return after;
  });
}

export async function resolvePackageEvidenceConflict(sql: DatabaseClient, input: PackageEvidenceConflictInput): Promise<ContentPackageReview | undefined> {
  assertPackageReviewExpectation(input); assertPackageReviewUuid(input.conflictId); assertPackageReviewUuid(input.evidenceId);
  const note = optionalText(input.note, "Conflict review note", 2000);
  return sql.begin(async (tx) => {
    const before = (await assertExpectedContentPackageReviewInTransaction(tx, input, "approve")).review;
    requireMutableReview(before);
    const conflict = before.snapshot.conflicts.find((row) => row.id === input.conflictId);
    if (!conflict) return undefined;
    if (conflict.status !== "open") throw new ContentPackageReviewError("conflict_not_open", "This conflict has already been decided. Reload its current review.");
    const candidates = new Set(conflict.candidateEvidenceIds);
    const candidateEvidence = before.snapshot.evidence.filter((row) => candidates.has(row.id));
    const selected = candidateEvidence.find((row) => row.id === input.evidenceId);
    if (!candidates.size || candidates.size !== conflict.candidateEvidenceIds.length || candidateEvidence.length !== candidates.size
      || candidateEvidence.some((row) => row.supersededByEvidenceId !== null) || !selected || selected.provenance === "unresolved") {
      throw new ContentPackageReviewError("review_blocked", "Select one active usable candidate from this exact conflict.");
    }
    // A conflicting decision would close the last editable conflict while leaving
    // the package permanently blocked. Reject it before writing, not after commit.
    const contradiction = before.snapshot.conflicts.find((row) => row.status === "resolved" && row.resolutionEvidenceId !== null
      && ((row.candidateEvidenceIds.includes(input.evidenceId) && row.resolutionEvidenceId !== input.evidenceId)
        || (candidates.has(row.resolutionEvidenceId) && row.resolutionEvidenceId !== input.evidenceId)));
    if (contradiction) throw new ContentPackageReviewError("review_blocked", "This selection contradicts an existing reviewed conflict. Keep a consistent winner across overlapping conflicts.",
      [{ code: "conflict_decisions_inconsistent", message: "The proposed selection would select an excluded fact or exclude an existing winner.", conflictId: contradiction.id }]);
    await tx`SELECT id FROM evidence_item WHERE content_package_id=${input.packageId} AND id IN ${tx([...candidates].sort())} ORDER BY id FOR UPDATE`;
    await tx`SELECT id FROM evidence_conflict WHERE content_package_id=${input.packageId} AND id=${input.conflictId} FOR UPDATE`;
    await tx`UPDATE evidence_conflict SET status='resolved',resolution_evidence_id=${input.evidenceId},resolution_note=${note},resolved_at=clock_timestamp()
      WHERE id=${input.conflictId} AND content_package_id=${input.packageId}`;
    const learningId = randomUUID();
    await tx`INSERT INTO learning_review(id,workspace_id,content_package_id,evidence_item_id,actor_user_id,action,notes,created_at)
      VALUES (${learningId},${input.workspaceId},${input.packageId},${input.evidenceId},${input.actorUserId},'conflict_resolved',${note},clock_timestamp())`;
    const after = (await invalidateContentPackageApprovalInTransaction(tx, input)).review;
    await insertLearningReviewProofInTransaction(tx, { learningReviewId: learningId, workspaceId: input.workspaceId, packageId: input.packageId,
      version: before.version, action: "conflict_resolved", beforeFingerprint: before.reviewFingerprint, afterFingerprint: after.reviewFingerprint,
      decisionSnapshot: { contract: "content-package-review-decision-v1", selectedEvidenceId: input.evidenceId, candidateEvidence,
        beforeConflict: conflict, afterConflict: after.snapshot.conflicts.find((row) => row.id === input.conflictId)! } });
    await audit(tx, input, "content_package.conflict_resolved", "learning_review", learningId, { conflictId: input.conflictId,
      beforeFingerprint: before.reviewFingerprint, afterFingerprint: after.reviewFingerprint });
    return after;
  });
}

export async function resolvePackageUnresolvedEvidence(sql: DatabaseClient, input: PackageUnresolvedEvidenceInput): Promise<ContentPackageReview | undefined> {
  assertPackageReviewExpectation(input); assertPackageReviewUuid(input.evidenceId);
  const correctedClaim = text(input.correctedClaim, "Corrected claim", 5000, 1); const note = optionalText(input.note, "Correction note", 2000);
  return sql.begin(async (tx) => {
    const before = (await assertExpectedContentPackageReviewInTransaction(tx, input, "approve")).review;
    requireMutableReview(before);
    const original = before.snapshot.evidence.find((row) => row.id === input.evidenceId && row.provenance === "unresolved" && row.supersededByEvidenceId === null);
    if (!original) return undefined;
    const affected = before.snapshot.conflicts.filter((row) => row.candidateEvidenceIds.includes(input.evidenceId));
    await tx`SELECT id FROM evidence_item WHERE content_package_id=${input.packageId} AND id=${input.evidenceId} FOR UPDATE`;
    if (affected.length) await tx`SELECT id FROM evidence_conflict WHERE content_package_id=${input.packageId} AND id IN ${tx(affected.map((row) => row.id).sort())} ORDER BY id FOR UPDATE`;
    const correctedId = randomUUID(); const learningId = randomUUID();
    await tx`INSERT INTO evidence_item(id,content_package_id,fact_key,claim,provenance,source_references,confidence)
      VALUES (${correctedId},${input.packageId},${original.factKey},${correctedClaim},'authoritative_context',${[`learning-review:${learningId}`]},1)`;
    await tx`UPDATE evidence_item SET superseded_by_evidence_id=${correctedId} WHERE id=${input.evidenceId} AND content_package_id=${input.packageId}`;
    for (const conflict of affected) {
      const candidates = conflict.candidateEvidenceIds.map((id) => id === input.evidenceId ? correctedId : id);
      await tx`UPDATE evidence_conflict SET candidate_evidence_ids=${candidates},status='open',resolution_evidence_id=NULL,resolution_note=NULL,resolved_at=NULL
        WHERE id=${conflict.id} AND content_package_id=${input.packageId}`;
    }
    await tx`INSERT INTO learning_review(id,workspace_id,content_package_id,evidence_item_id,actor_user_id,action,original_claim,corrected_claim,notes,created_at)
      VALUES (${learningId},${input.workspaceId},${input.packageId},${input.evidenceId},${input.actorUserId},'corrected',${original.claim},${correctedClaim},${note},clock_timestamp())`;
    const after = (await invalidateContentPackageApprovalInTransaction(tx, input)).review;
    const affectedIds = new Set(affected.map((row) => row.id));
    const candidateIds = new Set(affected.flatMap((row) => row.candidateEvidenceIds)); candidateIds.add(input.evidenceId);
    await insertLearningReviewProofInTransaction(tx, { learningReviewId: learningId, workspaceId: input.workspaceId, packageId: input.packageId,
      version: before.version, action: "corrected", beforeFingerprint: before.reviewFingerprint, afterFingerprint: after.reviewFingerprint,
      decisionSnapshot: { contract: "content-package-review-decision-v1", originalEvidenceId: input.evidenceId, correctedEvidenceId: correctedId,
        beforeEvidence: before.snapshot.evidence.filter((row) => candidateIds.has(row.id)),
        afterEvidence: after.snapshot.evidence.filter((row) => candidateIds.has(row.id) || row.id === correctedId),
        beforeConflicts: affected, afterConflicts: after.snapshot.conflicts.filter((row) => affectedIds.has(row.id)) } });
    await audit(tx, input, "content_package.evidence_corrected", "learning_review", learningId, { originalEvidenceId: input.evidenceId, correctedEvidenceId: correctedId,
      beforeFingerprint: before.reviewFingerprint, afterFingerprint: after.reviewFingerprint });
    return after;
  });
}
