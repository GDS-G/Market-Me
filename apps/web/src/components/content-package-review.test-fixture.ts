import type { ContentPackageReview, ContentPackageReviewSnapshotV1, StoredContentPackageApproval } from "@market-me/database";
export const reviewTestUuid = (n: number) => `${n}aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
export const reviewTestScope = { userId: reviewTestUuid(1), workspaceId: reviewTestUuid(2), packageId: reviewTestUuid(3) };
const { workspaceId, packageId, userId } = reviewTestScope;
const instant = "2026-09-15T15:30:42.654321Z";
export const reviewTestSnapshot: ContentPackageReviewSnapshotV1 = {
  schemaVersion: 1, reviewContract: "content-package-review-v1",
  package: { id: packageId, workspaceId, smartSourceId: reviewTestUuid(4), rootSourceItemId: reviewTestUuid(5), version: 2, title: "Captured café 🚀", confidence: 1, contextPackVersionIds: [], createdAtUtcMicros: instant },
  evidence: [
    { id: reviewTestUuid(6), factKey: "admission", claim: "Admission is free.", provenance: "authoritative_context", sourceReferences: ["source:original"], confidence: 1, contextPackVersionId: null, supersededByEvidenceId: null, createdAtUtcMicros: instant },
    { id: reviewTestUuid(7), factKey: "admission", claim: "Admission costs $5.", provenance: "observed", sourceReferences: ["source:loser"], confidence: 1, contextPackVersionId: null, supersededByEvidenceId: null, createdAtUtcMicros: instant },
    { id: reviewTestUuid(8), factKey: "opening", claim: "Opening time unknown.", provenance: "unresolved", sourceReferences: [], confidence: null, contextPackVersionId: null, supersededByEvidenceId: null, createdAtUtcMicros: instant },
  ],
  conflicts: [{ id: reviewTestUuid(9), factKey: "admission", candidateEvidenceIds: [reviewTestUuid(6), reviewTestUuid(7)], status: "resolved", resolutionEvidenceId: reviewTestUuid(6), resolutionNote: "Use original announcement.", createdAtUtcMicros: instant, resolvedAtUtcMicros: instant }],
  assets: [{ id: reviewTestUuid(4), sourceItemId: reviewTestUuid(5), sourceAssetId: null, role: "original", fileName: "captured.png", mimeType: "image/png", contentHash: "sha256:captured", objectKey: "private-object-key", byteSizeDecimal: "9007199254740993", processingVersion: "1", recipe: {}, mediaStatus: "processed",
    extraction: { status: "completed", text: "Start of captured text.\n" + "x".repeat(1000) + "\nEND OF COMPLETE CAPTURE", error: null },
    scan: { status: "clean", engine: "fixture", scannedAtUtcMicros: instant, revision: 1 }, accessibility: { altText: "A blue dolphin.", status: "approved", notes: "Retain captured notes." },
    rights: { status: "cleared", owner: "Original owner", licenseOwner: null, sourceReference: "Original source", proofReference: "Original proof", commercialUseAllowed: true, derivativeUseAllowed: true, worldwideUseAllowed: true,
      permittedChannels: ["mastodon_account"], permittedChannelConnectionIds: [reviewTestUuid(9)], permittedCampaignIds: [], permittedBrandProfileIds: [], validFromUtcMicros: "2026-01-01T00:00:00.123456Z", expiresAtUtcMicros: "2027-01-01T00:00:00.987654Z",
      attributionRequirement: null, watermarkRequirement: null, disclaimerRequirement: null, reviewNote: "Original review note", reviewedBy: userId, reviewedAtUtcMicros: instant, revision: 2 },
    metadata: { raw_key: "<script>never execute</script>" }, createdAtUtcMicros: instant }],
};
export const reviewTestApproval: StoredContentPackageApproval = {
  id: reviewTestUuid(9), workspaceId, contentPackageId: packageId, contentPackageVersion: 2, reviewFingerprint: `mm-package-review-v1:sha256:${"a".repeat(64)}`, createdBy: userId, createdAt: instant,
  idempotencyKey: reviewTestUuid(8), contractVersion: 1, evidenceContract: "effective-evidence-v1", effectiveEvidenceIds: [reviewTestUuid(6)], reviewSnapshot: reviewTestSnapshot, configurationHash: "b".repeat(64),
};
export const reviewTestReview: ContentPackageReview = {
  snapshot: reviewTestSnapshot, version: 2, reviewFingerprint: reviewTestApproval.reviewFingerprint, status: "needs_review", effectiveEvidenceIds: [], excludedEvidenceIds: [reviewTestUuid(7)],
  blockers: [{ code: "unresolved_evidence", message: "Resolve the captured opening time.", evidenceId: reviewTestUuid(8) }], evaluatedAt: instant, currentApproval: null, currentApprovalValid: false, historicalApproval: false,
};
