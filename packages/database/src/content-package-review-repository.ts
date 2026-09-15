import { createHash, randomUUID } from "node:crypto";
import { CONTENT_ASSET_RIGHTS_CHANNELS } from "@market-me/domain";
import type { JSONValue, TransactionSql } from "postgres";
import type { DatabaseClient } from "./client";
import { WORKSPACE_ROLES, type StoredContentPackage } from "./models";
import { createContentPackageReviewFingerprint } from "./content-package-review-fingerprint";
import { evaluateReviewedEvidence } from "./content-package-reviewed-evidence";
import {
  captureContentPackageReviewInTransaction, type CapturedPackageReview, type PackageReviewIdentity,
} from "./content-package-review-loader";
import {
  ContentPackageReviewError, type ContentPackageReview, type ContentPackageReviewBlocker,
  type ContentPackageReviewExpectation, type ContentPackageApprovalInput,
  type ContentPackageApprovalResult, type ContentPackageApprovalSummary, type StoredContentPackageApproval,
} from "./content-package-review-models";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const token = /^mm-package-review-v1:sha256:[0-9a-f]{64}$/u;
export function assertPackageReviewUuid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !uuid.test(value)) throw new ContentPackageReviewError("invalid_review_input", "Use canonical lowercase UUID references.");
}
export function assertPackageReviewExpectation(input: ContentPackageReviewExpectation): void {
  for (const value of [input.workspaceId, input.packageId, input.actorUserId]) assertPackageReviewUuid(value);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || input.expectedVersion > 2_147_483_647
    || typeof input.expectedReviewFingerprint !== "string" || !token.test(input.expectedReviewFingerprint)) {
    throw new ContentPackageReviewError("invalid_review_input", "Submit the exact displayed package version and review fingerprint.");
  }
}

/** Current membership is locked through the transaction, never inferred from a
 * browser role or possession of an approval key. Viewer access is read-only. */
export async function assertPackageReviewAccessInTransaction(tx: TransactionSql,
  input: { workspaceId: string; actorUserId: string }, mode: "read" | "write" | "approve" = "read"): Promise<void> {
  assertPackageReviewUuid(input.workspaceId); assertPackageReviewUuid(input.actorUserId);
  // Match the established ancestor-first authorization order. Audit/receipt FK
  // insertion must never wait on an ancestor whose deletion waits on our root.
  await tx`SELECT id FROM organization WHERE id=(SELECT organization_id FROM workspace WHERE id=${input.workspaceId}) FOR KEY SHARE`;
  const workspace = await tx`SELECT id FROM workspace WHERE id=${input.workspaceId} FOR SHARE`;
  const actor = await tx`SELECT id FROM app_user WHERE id=${input.actorUserId} FOR KEY SHARE`;
  const row = (await tx<{ role: string }[]>`
    SELECT role FROM workspace_membership WHERE workspace_id=${input.workspaceId}
      AND user_id=${input.actorUserId} FOR SHARE
  `)[0];
  const roles: readonly string[] = mode === "approve" ? ["owner", "admin", "approver"]
    : mode === "write" ? ["owner", "admin", "editor"] : WORKSPACE_ROLES;
  if (!workspace[0] || !actor[0] || !row || !roles.includes(row.role)) {
    throw new ContentPackageReviewError("access_denied", "Current workspace permission for this review action is required.");
  }
}
export async function lockContentPackageReviewInTransaction(tx: TransactionSql, input: PackageReviewIdentity,
  mode: "share" | "update" = "share"): Promise<void> {
  assertPackageReviewUuid(input.workspaceId); assertPackageReviewUuid(input.packageId);
  const rows = mode === "update"
    ? await tx`SELECT id FROM content_package WHERE workspace_id=${input.workspaceId} AND id=${input.packageId} FOR UPDATE`
    : await tx`SELECT id FROM content_package WHERE workspace_id=${input.workspaceId} AND id=${input.packageId} FOR SHARE`;
  if (!rows[0]) throw new ContentPackageReviewError("package_unavailable", "Content Package is unavailable in this workspace.");
}

interface ApprovalRow extends ContentPackageApprovalSummary {
  idempotencyKey: string; contractVersion: 1; evidenceContract: "effective-evidence-v1";
  effectiveEvidenceIds: string[]; canonicalReviewSnapshot: string; canonicalInput: string; configurationHash: string;
}
async function readApproval(tx: TransactionSql, workspaceId: string,
  selector: { id: string } | { key: string }): Promise<ApprovalRow | undefined> {
  const selected = "id" in selector ? tx`id=${selector.id}` : tx`idempotency_key=${selector.key}`;
  return (await tx<ApprovalRow[]>`
    SELECT id, workspace_id, content_package_id, content_package_version, idempotency_key,
      contract_version, review_fingerprint, canonical_review_snapshot, effective_evidence_ids,
      evidence_contract, canonical_input, configuration_hash, created_by,
      to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
    FROM content_package_approval WHERE workspace_id=${workspaceId} AND ${selected}
  `)[0];
}
function summary(row: ContentPackageApprovalSummary): ContentPackageApprovalSummary {
  return { id: row.id, workspaceId: row.workspaceId, contentPackageId: row.contentPackageId,
    contentPackageVersion: row.contentPackageVersion, reviewFingerprint: row.reviewFingerprint,
    createdBy: row.createdBy, createdAt: row.createdAt };
}
function intent(input: Pick<ContentPackageReviewExpectation, "workspaceId" | "packageId" | "expectedVersion" | "expectedReviewFingerprint">): string {
  return JSON.stringify({ contract: "market-me:content-package-approval:v1", workspaceId: input.workspaceId,
    packageId: input.packageId, expectedVersion: input.expectedVersion, expectedReviewFingerprint: input.expectedReviewFingerprint });
}
async function publicApproval(tx: TransactionSql, row: ApprovalRow): Promise<StoredContentPackageApproval> {
  try {
    const captured = createContentPackageReviewFingerprint(JSON.parse(row.canonicalReviewSnapshot));
    const evidence = evaluateReviewedEvidence(captured.snapshot);
    if (captured.canonicalSnapshot !== row.canonicalReviewSnapshot || captured.token !== row.reviewFingerprint
      || captured.snapshot.package.id !== row.contentPackageId || captured.snapshot.package.workspaceId !== row.workspaceId
      || captured.snapshot.package.version !== row.contentPackageVersion || evidence.blockers.length
      || JSON.stringify(evidence.effectiveEvidenceIds) !== JSON.stringify(row.effectiveEvidenceIds)
      || row.contractVersion !== 1 || row.evidenceContract !== "effective-evidence-v1"
      || row.canonicalInput !== intent({ workspaceId: row.workspaceId, packageId: row.contentPackageId,
        expectedVersion: row.contentPackageVersion, expectedReviewFingerprint: row.reviewFingerprint })
      || createHash("sha256").update(row.canonicalInput).digest("hex") !== row.configurationHash) {
      throw new Error("Invalid receipt proof");
    }
    // Raw receipt is immutable text, and canonical-byte equality above also
    // detects any historical number silently rounded by JSON.parse.
    return { ...summary(row), idempotencyKey: row.idempotencyKey, contractVersion: 1,
      evidenceContract: "effective-evidence-v1", effectiveEvidenceIds: evidence.effectiveEvidenceIds,
      reviewSnapshot: captured.snapshot, configurationHash: row.configurationHash };
  } catch {
    throw new ContentPackageReviewError("historical_approval_unavailable", "The stored approval does not have a valid exact review proof.");
  }
}

/** All content originates in one raw projection under the root lock. Eligibility
 * is evaluated at a fresh database clock after lock waits and JSON verification;
 * clock and mutable workflow status are deliberately not fingerprint inputs. */
export async function loadContentPackageReviewInTransaction(tx: TransactionSql, input: PackageReviewIdentity): Promise<{
  review: ContentPackageReview; canonicalSnapshot: string;
}> {
  const captured = await captureContentPackageReviewInTransaction(tx, input);
  const evidence = evaluateReviewedEvidence(captured.snapshot);
  const blockers: ContentPackageReviewBlocker[] = evidence.blockers.map((item) => ({
    code: item.code, message: item.message, ...(item.evidenceIds[0] ? { evidenceId: item.evidenceIds[0] } : {}),
    ...(item.conflictIds[0] ? { conflictId: item.conflictIds[0] } : {}),
  }));
  if (!["ready", "needs_review", "approved"].includes(captured.status)) {
    blockers.push({ code: "package_state_ineligible", message: "Finish ingestion before reviewing this package." });
  }
  const prior = captured.currentApprovalId ? await readApproval(tx, input.workspaceId, { id: captured.currentApprovalId }) : undefined;
  if (prior) await publicApproval(tx, prior);
  // Sample after all potentially large canonical/evidence and receipt checks.
  // Only the permission window can advance while this root lock is held.
  const evaluatedAt = (await tx<{ now: string }[]>`
    SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now
  `)[0]!.now;
  appendAssetBlockers(captured, evaluatedAt, blockers);
  const valid = prior !== undefined && !blockers.length && captured.status === "approved" && prior.contentPackageId === input.packageId
      && prior.contentPackageVersion === captured.snapshot.package.version
      && prior.reviewFingerprint === captured.token && prior.canonicalReviewSnapshot === captured.canonicalSnapshot;
  return { canonicalSnapshot: captured.canonicalSnapshot, review: {
    snapshot: captured.snapshot, version: captured.snapshot.package.version, reviewFingerprint: captured.token,
    status: captured.status as StoredContentPackage["status"], effectiveEvidenceIds: evidence.effectiveEvidenceIds,
    excludedEvidenceIds: evidence.excludedEvidenceIds, blockers, evaluatedAt,
    currentApproval: prior ? summary(prior) : null, currentApprovalValid: valid,
    historicalApproval: captured.status === "approved" && !prior,
  } };
}
function appendAssetBlockers(captured: CapturedPackageReview, now: string, blockers: ContentPackageReviewBlocker[]): void {
  const assetsById = new Map(captured.snapshot.assets.map((asset) => [asset.id, asset]));
  for (const asset of captured.snapshot.assets) {
    const block = (code: string, message: string) => blockers.push({ code, message, assetId: asset.id });
    // A derivative inherits safety/accessibility/rights only from one exact
    // original in the same captured package. Reject self/foreign references,
    // chains and source pointers on non-derivatives before they can be approved.
    if (asset.role === "derivative") {
      const source = asset.sourceAssetId ? assetsById.get(asset.sourceAssetId) : undefined;
      if (!source || source.id === asset.id || source.role !== "original" || source.sourceAssetId !== null) {
        block("asset_source_invalid", "Derivative lineage must resolve directly to an original in this package.");
      }
    } else if (asset.sourceAssetId !== null) {
      block("asset_source_invalid", "Only derivatives may reference a source asset.");
    }
    const originalImage = asset.role === "original" && asset.mimeType.startsWith("image/");
    if (asset.accessibility.status === "needs_review" && !originalImage) {
      block("accessibility_review_required", "Review this asset's accessibility text.");
    }
    if (!originalImage) continue;
    if (!["approved", "decorative"].includes(asset.accessibility.status)
      || (asset.accessibility.status === "approved" && !asset.accessibility.altText?.trim())) {
      block("accessibility_review_required", "Original images require approved alternative text or a decorative decision.");
    }
    if (asset.scan.status !== "clean" || !asset.scan.engine || !asset.scan.scannedAtUtcMicros || asset.scan.revision < 1) {
      block("clean_scan_required", "Original images require a recorded clean malware scan.");
    }
    const rights = asset.rights;
    if (rights.status !== "cleared" || rights.revision < 1 || !rights.reviewedBy || !rights.reviewedAtUtcMicros
      || !rights.owner?.trim() || !rights.sourceReference?.trim() || !rights.proofReference?.trim() || !rights.reviewNote?.trim()
      || rights.commercialUseAllowed !== true || rights.derivativeUseAllowed !== true || rights.worldwideUseAllowed !== true
      || !rights.permittedChannels.length || rights.permittedChannels.some((channel) => !(CONTENT_ASSET_RIGHTS_CHANNELS as readonly string[]).includes(channel))
      || !rights.permittedChannelConnectionIds.length || rights.attributionRequirement?.trim()
      || rights.watermarkRequirement?.trim() || rights.disclaimerRequirement?.trim()) {
      block("rights_review_required", "Record supported commercial, derivative and worldwide rights for exact permitted accounts.");
    }
    if (rights.validFromUtcMicros && rights.validFromUtcMicros > now) block("rights_not_yet_valid", "This asset's permission window has not started.");
    if (rights.expiresAtUtcMicros && rights.expiresAtUtcMicros <= now) block("rights_expired", "This asset's permission window has expired.");
    if (rights.validFromUtcMicros && rights.expiresAtUtcMicros && rights.expiresAtUtcMicros <= rights.validFromUtcMicros) {
      block("rights_window_invalid", "Asset permission expiration must follow its start.");
    }
  }
}

export async function assertExpectedContentPackageReviewInTransaction(tx: TransactionSql, input: ContentPackageReviewExpectation,
  mode: "write" | "approve" = "write") {
  assertPackageReviewExpectation(input);
  await assertPackageReviewAccessInTransaction(tx, input, mode);
  await lockContentPackageReviewInTransaction(tx, input, "update");
  const captured = await loadContentPackageReviewInTransaction(tx, input);
  if (captured.review.version !== input.expectedVersion) throw new ContentPackageReviewError("package_version_mismatch", "Package ingestion changed. Reload and review its new version.");
  if (captured.review.reviewFingerprint !== input.expectedReviewFingerprint) throw new ContentPackageReviewError("review_changed", "Package review content changed. Reload before deciding.");
  return captured;
}
/** Invalidation never edits an old receipt, generation or approved draft. */
export async function invalidateContentPackageApprovalInTransaction(tx: TransactionSql, input: PackageReviewIdentity) {
  await tx`UPDATE content_package SET current_approval_id=NULL, status='needs_review', updated_at=clock_timestamp()
    WHERE id=${input.packageId} AND workspace_id=${input.workspaceId}`;
  const captured = await loadContentPackageReviewInTransaction(tx, input);
  if (!captured.review.blockers.length) {
    await tx`UPDATE content_package SET status='ready' WHERE id=${input.packageId} AND workspace_id=${input.workspaceId}`;
    return { ...captured, review: { ...captured.review, status: "ready" as const } };
  }
  return captured;
}
export async function insertLearningReviewProofInTransaction(tx: TransactionSql, input: {
  learningReviewId: string; workspaceId: string; packageId: string; version: number;
  action: "corrected" | "conflict_resolved" | "package_approved";
  beforeFingerprint: string; afterFingerprint: string; decisionSnapshot: Record<string, unknown>;
}): Promise<void> {
  await tx`INSERT INTO learning_review_proof (learning_review_id,workspace_id,content_package_id,content_package_version,
    action,before_review_fingerprint,after_review_fingerprint,decision_snapshot,created_at)
    VALUES (${input.learningReviewId},${input.workspaceId},${input.packageId},${input.version},${input.action},
      ${input.beforeFingerprint},${input.afterFingerprint},${tx.json(input.decisionSnapshot as JSONValue)},clock_timestamp())`;
}

/** Internal consumer: caller already owns writer authorization and Campaign
 * locks. Root SHARE only, never assets; see loader lock-order documentation. */
export async function assertCurrentContentPackageApprovalInTransaction(tx: TransactionSql, input: {
  workspaceId: string; contentPackageId: string; expectedPackageVersion: number; expectedReviewFingerprint?: string;
}) {
  const identity = { workspaceId: input.workspaceId, packageId: input.contentPackageId };
  await lockContentPackageReviewInTransaction(tx, identity);
  const current = await loadContentPackageReviewInTransaction(tx, identity);
  if (current.review.version !== input.expectedPackageVersion) throw new ContentPackageReviewError("package_version_mismatch", "Package ingestion version changed.");
  if (input.expectedReviewFingerprint !== undefined && input.expectedReviewFingerprint !== current.review.reviewFingerprint) {
    throw new ContentPackageReviewError("review_changed", "Review the current approved package before creating new work.");
  }
  if (!current.review.currentApprovalValid || !current.review.currentApproval) throw new ContentPackageReviewError(
    "approval_unavailable", "New work requires exact current Content Package approval.", current.review.blockers);
  const effective = new Set(current.review.effectiveEvidenceIds);
  return { approvalId: current.review.currentApproval.id, reviewFingerprint: current.review.reviewFingerprint,
    snapshot: current.review.snapshot,
    effectiveEvidence: current.review.snapshot.evidence.filter((row) => effective.has(row.id)).sort((left, right) =>
      left.createdAtUtcMicros < right.createdAtUtcMicros ? -1 : left.createdAtUtcMicros > right.createdAtUtcMicros ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0) };
}

export class ContentPackageReviewRepository {
  constructor(private readonly sql: DatabaseClient) {}
  async getReview(workspaceId: string, packageId: string, actorUserId: string): Promise<ContentPackageReview | undefined> {
    return this.sql.begin(async (tx) => {
      await assertPackageReviewAccessInTransaction(tx, { workspaceId, actorUserId });
      try { await lockContentPackageReviewInTransaction(tx, { workspaceId, packageId }); }
      catch (error) { if (error instanceof ContentPackageReviewError && error.code === "package_unavailable") return undefined; throw error; }
      return (await loadContentPackageReviewInTransaction(tx, { workspaceId, packageId })).review;
    });
  }
  async getApproval(workspaceId: string, approvalId: string, actorUserId: string): Promise<StoredContentPackageApproval | undefined> {
    assertPackageReviewUuid(approvalId);
    return this.sql.begin(async (tx) => {
      await assertPackageReviewAccessInTransaction(tx, { workspaceId, actorUserId });
      const row = await readApproval(tx, workspaceId, { id: approvalId });
      return row ? publicApproval(tx, row) : undefined;
    });
  }
  async getApprovalByKey(workspaceId: string, idempotencyKey: string, actorUserId: string): Promise<StoredContentPackageApproval | undefined> {
    assertPackageReviewUuid(idempotencyKey);
    return this.sql.begin(async (tx) => {
      await assertPackageReviewAccessInTransaction(tx, { workspaceId, actorUserId });
      const row = await readApproval(tx, workspaceId, { key: idempotencyKey });
      return row ? publicApproval(tx, row) : undefined;
    });
  }
  async listApprovalSummaries(workspaceId: string, packageId: string, actorUserId: string): Promise<readonly ContentPackageApprovalSummary[]> {
    assertPackageReviewUuid(packageId);
    return this.sql.begin(async (tx) => {
      await assertPackageReviewAccessInTransaction(tx, { workspaceId, actorUserId });
      const rows = await tx<ContentPackageApprovalSummary[]>`SELECT id,workspace_id,content_package_id,content_package_version,
        review_fingerprint,created_by,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
        FROM content_package_approval WHERE workspace_id=${workspaceId} AND content_package_id=${packageId}
        ORDER BY created_at DESC,id DESC LIMIT 50`;
      return rows.map(summary);
    });
  }
  async approve(input: ContentPackageApprovalInput): Promise<ContentPackageApprovalResult> {
    assertPackageReviewExpectation(input); assertPackageReviewUuid(input.idempotencyKey);
    const canonicalInput = intent(input);
    const configurationHash = createHash("sha256").update(canonicalInput).digest("hex");
    return this.sql.begin(async (tx) => {
      await assertPackageReviewAccessInTransaction(tx, input, "approve");
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`package-approval:${input.workspaceId}:${input.idempotencyKey}`},0))`;
      const prior = await readApproval(tx, input.workspaceId, { key: input.idempotencyKey });
      if (prior) {
        if (prior.canonicalInput !== canonicalInput) throw new ContentPackageReviewError("idempotency_conflict", "This attempt key belongs to another review decision.", [], prior.id);
        return { approval: await publicApproval(tx, prior), replayed: true };
      }
      const captured = await assertExpectedContentPackageReviewInTransaction(tx, input, "approve");
      if (captured.review.blockers.length) throw new ContentPackageReviewError("review_blocked", "Resolve package review blockers before approval.", captured.review.blockers);
      const learningId = randomUUID(); const approvalId = randomUUID();
      await tx`INSERT INTO learning_review (id,workspace_id,content_package_id,actor_user_id,action,created_at)
        VALUES (${learningId},${input.workspaceId},${input.packageId},${input.actorUserId},'package_approved',clock_timestamp())`;
      await tx`SELECT set_config('market_me.content_package_approval_admission',${JSON.stringify({
        approvalId, workspaceId: input.workspaceId, contentPackageId: input.packageId,
        version: input.expectedVersion, reviewFingerprint: input.expectedReviewFingerprint, configurationHash,
        createdBy: input.actorUserId, learningReviewId: learningId,
      })},true)`;
      await tx`INSERT INTO content_package_approval (id,workspace_id,content_package_id,content_package_version,
        idempotency_key,review_fingerprint,canonical_review_snapshot,effective_evidence_ids,canonical_input,
        configuration_hash,created_by,created_at,learning_review_id)
        VALUES (${approvalId},${input.workspaceId},${input.packageId},${input.expectedVersion},${input.idempotencyKey},
          ${captured.review.reviewFingerprint},${captured.canonicalSnapshot},${[...captured.review.effectiveEvidenceIds]},
          ${canonicalInput},${configurationHash},${input.actorUserId},clock_timestamp(),${learningId})`;
      await insertLearningReviewProofInTransaction(tx, { learningReviewId: learningId, workspaceId: input.workspaceId,
        packageId: input.packageId, version: input.expectedVersion, action: "package_approved",
        beforeFingerprint: captured.review.reviewFingerprint, afterFingerprint: captured.review.reviewFingerprint,
        decisionSnapshot: { approvalId, effectiveEvidenceIds: captured.review.effectiveEvidenceIds } });
      await tx`UPDATE content_package SET current_approval_id=${approvalId},status='approved',updated_at=clock_timestamp()
        WHERE id=${input.packageId} AND workspace_id=${input.workspaceId}`;
      await tx`INSERT INTO audit_event (id,workspace_id,actor_user_id,event_type,subject_type,subject_id,data,created_at)
        VALUES (${randomUUID()},${input.workspaceId},${input.actorUserId},'content_package.approved','content_package',${input.packageId},
          ${tx.json({ approvalId, reviewFingerprint: captured.review.reviewFingerprint, version: input.expectedVersion,
            effectiveEvidenceCount: captured.review.effectiveEvidenceIds.length } as JSONValue)},clock_timestamp())`;
      // Last fresh database-clock evaluation before commit; expiration during a
      // lock wait or receipt insert rolls the entire decision back atomically.
      const after = await loadContentPackageReviewInTransaction(tx, input);
      if (!after.review.currentApprovalValid) throw new ContentPackageReviewError("review_blocked", "Package permissions changed or expired before approval committed.", after.review.blockers);
      return { approval: await publicApproval(tx, (await readApproval(tx, input.workspaceId, { id: approvalId }))!),
        replayed: false, review: after.review };
    });
  }
}
