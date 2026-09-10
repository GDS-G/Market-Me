import { describe, expect, it } from "vitest";
import { describeDraftClaimTrace } from "./draft-claim-trace";

const evidence = {
  id: "captured-original-id",
  claim: "Admission is free.",
  provenance: "authoritative_context" as const,
  sourceReferences: ["Brand guide v2, page 3", "Launch notes — café 🚀"],
};

describe("draft claim evidence trace", () => {
  it("labels an unlinked historical fact as unavailable, never presentation-only", () => {
    const trace = describeDraftClaimTrace({ kind: "fact", text: evidence.claim, evidenceItemIds: [] }, [evidence]);
    expect(trace.status).toBe("unavailable");
    expect(trace.text).toBe("Historical evidence unavailable: no evidence links were recorded for this factual claim.");
    expect(trace.text).not.toContain("Presentation-only");
  });

  it("reserves the presentation-only label for an unlinked call to action", () => {
    expect(describeDraftClaimTrace({ kind: "call_to_action", text: "Join us!", evidenceItemIds: [] }, [])).toEqual({
      status: "presentation",
      text: "Presentation-only call to action; no factual evidence asserted.",
    });
  });

  it("renders the exact captured provenance and references", () => {
    expect(describeDraftClaimTrace({ kind: "fact", text: evidence.claim, evidenceItemIds: [evidence.id] }, [evidence])).toEqual({
      status: "linked",
      text: "authoritative_context: Brand guide v2, page 3, Launch notes — café 🚀",
    });
  });

  it.each(["fact", "call_to_action"] as const)("does not hide a %s reference missing from the snapshot", (kind) => {
    const trace = describeDraftClaimTrace({ kind, text: evidence.claim, evidenceItemIds: ["missing-id"] }, [evidence]);
    expect(trace).toEqual({
      status: "unavailable",
      text: "Historical evidence unavailable: linked evidence missing-id is missing from the captured snapshot.",
    });
  });

  it("keeps known references while warning about an incomplete trace", () => {
    const trace = describeDraftClaimTrace({ kind: "fact", text: evidence.claim, evidenceItemIds: [evidence.id, "missing-id"] }, [evidence]);
    expect(trace.status).toBe("unavailable");
    expect(trace.text).toContain("authoritative_context: Brand guide v2, page 3");
    expect(trace.text).toContain("linked evidence missing-id is missing");
  });

  it("makes absent source references explicit without losing the captured evidence ID", () => {
    expect(describeDraftClaimTrace({ kind: "fact", text: evidence.claim, evidenceItemIds: [evidence.id] }, [{ ...evidence, sourceReferences: [] }])).toEqual({
      status: "linked",
      text: "authoritative_context: captured evidence captured-original-id; source references not recorded.",
    });
  });

  it("does not arbitrarily choose between duplicate snapshot IDs", () => {
    expect(describeDraftClaimTrace({ kind: "fact", text: evidence.claim, evidenceItemIds: [evidence.id] }, [evidence, evidence])).toEqual({
      status: "unavailable",
      text: "Historical evidence unavailable: linked evidence captured-original-id is ambiguous in the captured snapshot.",
    });
  });

  it("warns when an existing snapshot ID records different factual text without remapping it", () => {
    const trace = describeDraftClaimTrace(
      { kind: "fact", text: evidence.claim, evidenceItemIds: ["wrong-existing-id"] },
      [evidence, { ...evidence, id: "wrong-existing-id", claim: "Admission costs ten dollars." }],
    );
    expect(trace).toEqual({
      status: "unavailable",
      text: "Historical evidence unavailable: linked evidence wrong-existing-id does not match this factual claim's captured text.",
    });
  });

  it("does not compare a call to action with factual snapshot text", () => {
    expect(describeDraftClaimTrace({ kind: "call_to_action", text: "Join us!", evidenceItemIds: [evidence.id] }, [evidence])).toEqual({
      status: "linked",
      text: "authoritative_context: Brand guide v2, page 3, Launch notes — café 🚀",
    });
  });
});
