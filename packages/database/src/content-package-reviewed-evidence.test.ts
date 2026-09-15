import { describe, expect, it, vi } from "vitest";
import { ContentPackageReviewFingerprintValidationError, type ContentPackageReviewConflictV1, type ContentPackageReviewEvidenceV1, type ContentPackageReviewSnapshotV1 } from "./content-package-review-fingerprint";
import { CONTENT_PACKAGE_REVIEWED_EVIDENCE_CONTRACT, evaluateReviewedEvidence, type ContentPackageReviewedEvidenceBlockerCode } from "./content-package-reviewed-evidence";

const id = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const stamp = "2026-09-09T12:34:56.123456Z";
function fact(n: number, overrides: Partial<ContentPackageReviewEvidenceV1> = {}): ContentPackageReviewEvidenceV1 {
  return { id: id(n), factKey: "date", claim: "Identical text is not identity", provenance: "observed", sourceReferences: [`file:${n}`],
    confidence: null, contextPackVersionId: null, supersededByEvidenceId: null, createdAtUtcMicros: stamp, ...overrides };
}
function conflict(n: number, candidates: number[], winner: number | null, overrides: Partial<ContentPackageReviewConflictV1> = {}): ContentPackageReviewConflictV1 {
  return { id: id(n), factKey: `conflict-${n}`, candidateEvidenceIds: candidates.map(id), status: "resolved", resolutionEvidenceId: winner === null ? null : id(winner),
    resolutionNote: null, createdAtUtcMicros: stamp, resolvedAtUtcMicros: stamp, ...overrides };
}
function snapshot(evidence: readonly ContentPackageReviewEvidenceV1[] = [fact(10)], conflicts: readonly ContentPackageReviewConflictV1[] = []): ContentPackageReviewSnapshotV1 {
  return { schemaVersion: 1, reviewContract: "content-package-review-v1",
    package: { id: id(1), workspaceId: id(2), smartSourceId: id(3), rootSourceItemId: id(4), version: 1, title: "Review", confidence: null, contextPackVersionIds: [], createdAtUtcMicros: stamp },
    evidence, conflicts, assets: [] };
}
function expectBlocked(input: unknown, code: ContentPackageReviewedEvidenceBlockerCode): void {
  const result = evaluateReviewedEvidence(input);
  expect(result.effectiveEvidenceIds).toEqual([]);
  expect(result.blockers.some((item) => item.code === code)).toBe(true);
}

describe("reviewed effective evidence v1", () => {
  it("has a fixed independent evaluator contract", () => { expect(CONTENT_PACKAGE_REVIEWED_EVIDENCE_CONTRACT).toBe("effective-evidence-v1"); });
  it("retains every unconflicted observed/context/inferred active fact sorted by ID", () => {
    const input = snapshot([fact(30, { provenance: "inferred" }), fact(20, { provenance: "authoritative_context" }), fact(10, { factKey: null })]);
    expect(evaluateReviewedEvidence(input)).toEqual({ effectiveEvidenceIds: [id(10), id(20), id(30)], excludedEvidenceIds: [], blockers: [] });
  });
  it("excludes exact resolved losers, not same-text unrelated evidence", () => {
    expect(evaluateReviewedEvidence(snapshot([fact(10), fact(20), fact(30)], [conflict(100, [10, 20], 20)])))
      .toEqual({ effectiveEvidenceIds: [id(20), id(30)], excludedEvidenceIds: [id(10)], blockers: [] });
  });
  it("deduplicates repeated consistent winners across overlapping conflicts", () => {
    expect(evaluateReviewedEvidence(snapshot([fact(10), fact(20), fact(30), fact(40)], [conflict(100, [10, 20], 10), conflict(200, [10, 30], 10)])))
      .toEqual({ effectiveEvidenceIds: [id(10), id(40)], excludedEvidenceIds: [id(20), id(30)], blockers: [] });
  });
  it("rejects conflicting overlapping selections with exact winner/conflict evidence", () => {
    const input = snapshot([fact(10), fact(20), fact(30)], [conflict(100, [10, 20], 10), conflict(200, [10, 30], 30)]);
    const result = evaluateReviewedEvidence(input);
    expect(result.effectiveEvidenceIds).toEqual([]);
    expect(result.blockers).toEqual([{ code: "conflict_decisions_inconsistent", evidenceIds: [id(10)], conflictIds: [id(100), id(200)], message: expect.any(String) }]);
    expect(evaluateReviewedEvidence({ ...input, evidence: [...input.evidence].reverse(), conflicts: [...input.conflicts].reverse() })).toEqual(result);
  });
  it("never repairs mutually contradictory decisions by conflict order", () => {
    expectBlocked(snapshot([fact(10), fact(20)], [conflict(100, [10, 20], 10), conflict(200, [10, 20], 20)]), "conflict_decisions_inconsistent");
  });
  it("allows multiple distinct conflicts with one common losing candidate", () => {
    expect(evaluateReviewedEvidence(snapshot([fact(10), fact(20), fact(30)], [conflict(100, [10, 20], 10), conflict(200, [20, 30], 30)])))
      .toEqual({ effectiveEvidenceIds: [id(10), id(30)], excludedEvidenceIds: [id(20)], blockers: [] });
  });
  it.each(["open", "dismissed"] as const)("blocks %s conflicts without implicitly restoring candidates", (status) => {
    expectBlocked(snapshot([fact(10), fact(20)], [conflict(100, [10, 20], null, { status, resolvedAtUtcMicros: null })]), status === "open" ? "conflict_open" : "conflict_dismissed");
  });
  it.each([
    ["missing", conflict(100, [10, 20], null)], ["noncandidate", conflict(100, [10, 20], 30)], ["foreign", conflict(100, [10, 20], 99)],
  ] as const)("blocks %s resolved winner", (_label, item) => { expectBlocked(snapshot([fact(10), fact(20), fact(30)], [item]), "conflict_resolution_invalid"); });
  it.each([
    ["empty", []], ["duplicate", [10, 10]], ["foreign", [10, 99]],
  ] as const)("blocks %s candidate arrays", (_label, candidates) => {
    expectBlocked(snapshot([fact(10)], [conflict(100, [...candidates], 10)]), "conflict_candidates_invalid");
  });
  it("blocks an obsolete losing candidate rather than leaking its replacement as unconflicted", () => {
    const input = snapshot([fact(10), fact(20, { supersededByEvidenceId: id(30) }), fact(30)], [conflict(100, [10, 20], 10)]);
    expectBlocked(input, "conflict_candidates_invalid");
  });
  it("never implicitly follows a superseded winner", () => {
    const input = snapshot([fact(10, { supersededByEvidenceId: id(30) }), fact(20), fact(30)], [conflict(100, [10, 20], 10)]);
    expectBlocked(input, "conflict_resolution_invalid");
  });
  it("requires explicit new conflict selection after correction replaces the candidate", () => {
    const evidence = [fact(10, { provenance: "unresolved", supersededByEvidenceId: id(30) }), fact(20), fact(30, { provenance: "authoritative_context" })];
    expectBlocked(snapshot(evidence, [conflict(100, [30, 20], null, { status: "open", resolvedAtUtcMicros: null })]), "conflict_open");
    expect(evaluateReviewedEvidence(snapshot(evidence, [conflict(100, [30, 20], 30)])))
      .toEqual({ effectiveEvidenceIds: [id(30)], excludedEvidenceIds: [id(10), id(20)], blockers: [] });
  });
  it("blocks active unresolved evidence including an explicitly losing candidate", () => {
    const input = snapshot([fact(10), fact(20, { provenance: "unresolved" })], [conflict(100, [10, 20], 10)]);
    expectBlocked(input, "unresolved_evidence");
    expect(evaluateReviewedEvidence(input).excludedEvidenceIds).toEqual([id(20)]);
  });
  it("blocks unresolved selected evidence", () => {
    expectBlocked(snapshot([fact(10, { provenance: "unresolved" }), fact(20)], [conflict(100, [10, 20], 10)]), "conflict_resolution_invalid");
  });
  it("keeps superseded unresolved history without blocking its exact authoritative replacement", () => {
    expect(evaluateReviewedEvidence(snapshot([fact(10, { provenance: "unresolved", supersededByEvidenceId: id(20) }), fact(20, { provenance: "authoritative_context" })])))
      .toEqual({ effectiveEvidenceIds: [id(20)], excludedEvidenceIds: [id(10)], blockers: [] });
  });
  it("handles an ordinary longer one-to-one correction chain", () => {
    expect(evaluateReviewedEvidence(snapshot([fact(10, { supersededByEvidenceId: id(20) }), fact(20, { supersededByEvidenceId: id(30) }), fact(30)])))
      .toEqual({ effectiveEvidenceIds: [id(30)], excludedEvidenceIds: [id(10), id(20)], blockers: [] });
  });
  it.each([
    ["self", [fact(10, { supersededByEvidenceId: id(10) })]],
    ["missing", [fact(10, { supersededByEvidenceId: id(99) })]],
    ["two-cycle", [fact(10, { supersededByEvidenceId: id(20) }), fact(20, { supersededByEvidenceId: id(10) })]],
    ["three-cycle", [fact(10, { supersededByEvidenceId: id(20) }), fact(20, { supersededByEvidenceId: id(30) }), fact(30, { supersededByEvidenceId: id(10) })]],
    ["merge", [fact(10, { supersededByEvidenceId: id(30) }), fact(20, { supersededByEvidenceId: id(30) }), fact(30)]],
  ] as const)("blocks %s supersession corruption", (_label, facts) => { expectBlocked(snapshot(facts), "supersession_invalid"); });
  it("does not treat a valid identical-text fact as a substitute for a missing target", () => { expectBlocked(snapshot([fact(10, { supersededByEvidenceId: id(99) }), fact(20)]), "supersession_invalid"); });
  it("rejects duplicate evidence identities without choosing first or last", () => {
    const facts = [fact(10), fact(10, { supersededByEvidenceId: id(20) }), fact(20)];
    expectBlocked(snapshot(facts), "duplicate_evidence_id");
    expect(evaluateReviewedEvidence(snapshot(facts))).toEqual(evaluateReviewedEvidence(snapshot([...facts].reverse())));
  });
  it("rejects duplicate conflict identities without choosing first or last", () => {
    const items = [conflict(100, [10, 20], 10), conflict(100, [10, 20], 20)];
    expectBlocked(snapshot([fact(10), fact(20)], items), "duplicate_conflict_id");
    expect(evaluateReviewedEvidence(snapshot([fact(10), fact(20)], items))).toEqual(evaluateReviewedEvidence(snapshot([fact(10), fact(20)], [...items].reverse())));
  });
  it("blocks empty packages and never returns usable IDs beside an unrelated blocker", () => {
    expectBlocked(snapshot([]), "no_effective_evidence");
    expect(evaluateReviewedEvidence(snapshot([fact(10), fact(20, { provenance: "unresolved" })])).effectiveEvidenceIds).toEqual([]);
  });
  it("rejects malformed raw schema without invoking caller accessors", () => {
    const input = snapshot(); const getter = vi.fn(() => { throw new Error("must not run"); });
    Object.defineProperty(input, "evidence", { enumerable: true, get: getter });
    expect(() => evaluateReviewedEvidence(input)).toThrow(ContentPackageReviewFingerprintValidationError); expect(getter).not.toHaveBeenCalled();
  });
  it("produces frozen detached deterministic IDs/blockers without input mutation", () => {
    const input = snapshot([fact(30, { provenance: "unresolved" }), fact(20), fact(10)], [conflict(200, [10, 20], null, { status: "open" }), conflict(100, [10, 20], null, { status: "dismissed" })]);
    const before = JSON.stringify(input); const result = evaluateReviewedEvidence(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(evaluateReviewedEvidence({ ...input, evidence: [...input.evidence].reverse(), conflicts: [...input.conflicts].reverse() })).toEqual(result);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.blockers)).toBe(true);
    expect(Object.isFrozen(result.blockers[0])).toBe(true); expect(Object.isFrozen(result.blockers[0]!.evidenceIds)).toBe(true);
  });
  it("walks the full 10,000-item correction limit without recursion or quadratic path traversal", () => {
    const facts = Array.from({ length: 10_000 }, (_, index) => fact(index + 10, { supersededByEvidenceId: index === 9_999 ? null : id(index + 11) }));
    const result = evaluateReviewedEvidence(snapshot(facts));
    expect(result.blockers).toEqual([]); expect(result.effectiveEvidenceIds).toEqual([id(10_009)]); expect(result.excludedEvidenceIds).toHaveLength(9_999);
  });
});
