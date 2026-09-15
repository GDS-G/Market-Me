import type { ContentPackageReviewSnapshotV1 } from "./content-package-review-fingerprint";
import type { StoredContentPackage } from "./models";

/** Safe, server-derived review diagnostics. IDs identify captured rows, not authority. */
export interface ContentPackageReviewBlocker {
  readonly code: string;
  readonly message: string;
  readonly evidenceId?: string;
  readonly conflictId?: string;
  readonly assetId?: string;
}

export interface ContentPackageApprovalSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly contentPackageId: string;
  readonly contentPackageVersion: number;
  readonly reviewFingerprint: string;
  readonly createdBy: string;
  /** SQL UTC microseconds, never serialized through JavaScript Date. */
  readonly createdAt: string;
}

/** Immutable history. It is never silently hydrated with current child rows. */
export interface StoredContentPackageApproval extends ContentPackageApprovalSummary {
  readonly idempotencyKey: string;
  readonly contractVersion: 1;
  readonly evidenceContract: "effective-evidence-v1";
  readonly effectiveEvidenceIds: readonly string[];
  readonly reviewSnapshot: ContentPackageReviewSnapshotV1;
  readonly configurationHash: string;
}

/** All display content and its optimistic token originate in one coherent read. */
export interface ContentPackageReview {
  readonly snapshot: ContentPackageReviewSnapshotV1;
  readonly version: number;
  readonly reviewFingerprint: string;
  /** Status/evaluation/current pointer are not part of the content fingerprint. */
  readonly status: StoredContentPackage["status"];
  readonly effectiveEvidenceIds: readonly string[];
  readonly excludedEvidenceIds: readonly string[];
  readonly blockers: readonly ContentPackageReviewBlocker[];
  readonly evaluatedAt: string;
  readonly currentApproval: ContentPackageApprovalSummary | null;
  readonly currentApprovalValid: boolean;
  readonly historicalApproval: boolean;
}

export interface ContentPackageReviewExpectation {
  readonly workspaceId: string;
  readonly packageId: string;
  readonly expectedVersion: number;
  readonly expectedReviewFingerprint: string;
  readonly actorUserId: string;
}
export interface ContentPackageApprovalInput extends ContentPackageReviewExpectation {
  readonly idempotencyKey: string;
}
export interface ContentPackageApprovalResult {
  readonly approval: StoredContentPackageApproval;
  readonly replayed: boolean;
  /** Completed replay cannot depend on a mutable current package still being eligible. */
  readonly review?: ContentPackageReview;
}

export type ContentPackageReviewErrorCode = "invalid_review_input" | "review_snapshot_too_large"
  | "review_snapshot_lossy" | "review_changed" | "package_version_mismatch" | "review_blocked"
  | "conflict_not_open" | "approval_unavailable" | "historical_approval_unavailable"
  | "package_unavailable" | "access_denied" | "idempotency_conflict";
export class ContentPackageReviewError extends Error {
  constructor(
    readonly code: ContentPackageReviewErrorCode,
    message: string,
    readonly blockers: readonly ContentPackageReviewBlocker[] = [],
    readonly existingApprovalId?: string,
  ) { super(message); this.name = "ContentPackageReviewError"; }
}
