import type { EvidenceItem } from "@market-me/domain";
import type { assertCurrentContentPackageApprovalInTransaction } from "./content-package-review-repository";

type ApprovedEvidence = Awaited<ReturnType<typeof assertCurrentContentPackageApprovalInTransaction>>["effectiveEvidence"];

/** Preserve the established snapshot order and projection; no live evidence or new claims. */
export function approvedDraftEvidence(items: ApprovedEvidence) {
  const effective = [...items].sort((left, right) =>
    left.createdAtUtcMicros < right.createdAtUtcMicros ? -1 : left.createdAtUtcMicros > right.createdAtUtcMicros ? 1
      : left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const usable: EvidenceItem[] = effective.map(item => ({
    id: item.id, claim: item.claim, provenance: item.provenance, sourceReferences: item.sourceReferences,
    ...(item.factKey === null ? {} : { factKey: item.factKey }),
    ...(item.confidence === null ? {} : { confidence: item.confidence }),
    ...(item.contextPackVersionId === null ? {} : { contextPackVersionId: item.contextPackVersionId }),
  }));
  const snapshot = effective.map(({ id, factKey, claim, provenance, sourceReferences, confidence }) => ({
    id, ...(factKey === null ? {} : { factKey }), claim, provenance, sourceReferences, confidence,
  }));
  return { usable, snapshot };
}
