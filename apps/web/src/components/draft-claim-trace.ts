import type { DraftClaim, EvidenceItem } from "@market-me/domain";

type CapturedEvidence = Pick<EvidenceItem, "id" | "claim" | "provenance" | "sourceReferences">;

/** Describes recorded links only; it neither verifies a claim nor substitutes live evidence. */
export function describeDraftClaimTrace(
  claim: Pick<DraftClaim, "kind" | "text" | "evidenceItemIds">,
  evidenceSnapshot: readonly CapturedEvidence[],
): { status: "linked" | "unavailable" | "presentation"; text: string } {
  if (claim.evidenceItemIds.length === 0) {
    return claim.kind === "call_to_action"
      ? { status: "presentation", text: "Presentation-only call to action; no factual evidence asserted." }
      : { status: "unavailable", text: "Historical evidence unavailable: no evidence links were recorded for this factual claim." };
  }

  let unavailable = false;
  const references = claim.evidenceItemIds.map((id) => {
    const matches = evidenceSnapshot.filter((item) => item.id === id);
    if (matches.length !== 1) {
      unavailable = true;
      return matches.length === 0
        ? `Historical evidence unavailable: linked evidence ${id} is missing from the captured snapshot.`
        : `Historical evidence unavailable: linked evidence ${id} is ambiguous in the captured snapshot.`;
    }
    const evidence = matches[0];
    if (claim.kind === "fact" && claim.text !== evidence.claim) {
      unavailable = true;
      return `Historical evidence unavailable: linked evidence ${id} does not match this factual claim's captured text.`;
    }
    return `${evidence.provenance}: ${evidence.sourceReferences.join(", ") || `captured evidence ${id}; source references not recorded.`}`;
  });
  return { status: unavailable ? "unavailable" : "linked", text: references.join(" · ") };
}
