import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentPackageReviewError, type ContentPackageReview } from "./content-package-review-models";
import type { DatabaseClient } from "./client";
import type { TransactionSql } from "postgres";
import type { ContentPackageReviewConflictV1 } from "./content-package-review-fingerprint";
import * as reviewRepository from "./content-package-review-repository";
import { normalizePackageReviewRightsInstant, reviewPackageAssetRights, resolvePackageEvidenceConflict, resolvePackageUnresolvedEvidence, updatePackageAssetAccessibility } from "./content-package-review-mutations";

describe("lossless package rights instants", () => {
  it.each([
    [undefined, null],
    ["2026-09-10T03:04:05Z", "2026-09-10T03:04:05.000000Z"],
    ["2026-09-10T03:04:05.1Z", "2026-09-10T03:04:05.100000Z"],
    ["2026-09-10T03:04:05.123456Z", "2026-09-10T03:04:05.123456Z"],
    ["2026-09-10T03:04:05.123456+05:30", "2026-09-09T21:34:05.123456Z"],
    ["2026-09-10T23:59:59.123457-01:15", "2026-09-11T01:14:59.123457Z"],
    ["2026-01-01T00:00:00+00:01", "2025-12-31T23:59:00.000000Z"],
    ["2026-12-31T23:59:59-00:01", "2027-01-01T00:00:59.000000Z"],
    ["2000-03-01T00:00:00+01:00", "2000-02-29T23:00:00.000000Z"],
    ["1900-03-01T00:00:00+01:00", "1900-02-28T23:00:00.000000Z"],
    ["2000-02-29T23:59:00-01:00", "2000-03-01T00:59:00.000000Z"],
    ["0001-01-01T00:00:00Z", "0001-01-01T00:00:00.000000Z"],
    ["9999-12-31T23:59:59.999999Z", "9999-12-31T23:59:59.999999Z"],
    ["2026-09-10T00:00:00+23:59", "2026-09-09T00:01:00.000000Z"],
    ["2026-09-10T23:59:59-23:59", "2026-09-11T23:58:59.000000Z"],
  ])("normalizes %s to exact UTC %s", (input, expected) => {
    expect(normalizePackageReviewRightsInstant(input)).toBe(expected);
  });
  it.each([null, 0, new Date(), "", "2026-09-10", "2026-09-10T01:00:00", "2026-09-10T01:00:00.1234567Z",
    "2026-09-10T01:00:00+24:00", "2026-09-10T01:00:00+01:60", "2026-09-10T24:00:00Z", "2026-09-10T01:60:00Z",
    "2026-09-10T01:00:60Z", "0000-01-01T00:00:00Z", "0001-01-01T00:00:00+00:01", "9999-12-31T23:59:59-00:01",
    "2026-02-29T00:00:00Z", "1900-02-29T00:00:00Z", "2026-00-01T00:00:00Z", "2026-13-01T00:00:00Z", "2026-01-00T00:00:00Z",
    "2026-04-31T00:00:00Z", "infinity", "2026-01-01T00:00:00.000000Z "])("rejects invalid instant %s", (value) => {
    expect(() => normalizePackageReviewRightsInstant(value)).toThrow(ContentPackageReviewError);
  });
  it("preserves adjacent microseconds and orders equivalent offsets by the exact UTC result", () => {
    const one = normalizePackageReviewRightsInstant("2026-09-10T03:04:05.123456+00:00")!;
    const two = normalizePackageReviewRightsInstant("2026-09-10T08:34:05.123457+05:30")!;
    expect(one < two).toBe(true);
    expect(one).toBe("2026-09-10T03:04:05.123456Z"); expect(two).toBe("2026-09-10T03:04:05.123457Z");
  });
});

describe("material review writer state guard", () => {
  afterEach(() => vi.restoreAllMocks());
  const id = "00000001-0000-4000-8000-000000000000";
  const input = { workspaceId: id, packageId: id, actorUserId: id, expectedVersion: 1,
    expectedReviewFingerprint: `mm-package-review-v1:sha256:${"0".repeat(64)}` };
  const writers = [
    ["accessibility", (sql: DatabaseClient) => updatePackageAssetAccessibility(sql, { ...input, assetId: id, decorative: true })],
    ["rights", (sql: DatabaseClient) => reviewPackageAssetRights(sql, { ...input, assetId: id, status: "restricted", owner: "Owner",
      sourceReference: "source:test", proofReference: "proof:test", reviewNote: "Reviewed", commercialUseAllowed: false,
      derivativeUseAllowed: false, worldwideUseAllowed: false, permittedChannels: [], permittedChannelConnectionIds: [],
      permittedCampaignIds: [], permittedBrandProfileIds: [] }, id)],
    ["conflict", (sql: DatabaseClient) => resolvePackageEvidenceConflict(sql, { ...input, conflictId: id, evidenceId: id })],
    ["correction", (sql: DatabaseClient) => resolvePackageUnresolvedEvidence(sql, { ...input, evidenceId: id, correctedClaim: "Corrected" })],
  ] as const;
  function setup(status: ContentPackageReview["status"]) {
    const transaction = vi.fn(() => { throw new Error("No SQL operation may occur after the blocked state."); });
    const sql = { begin: (operation: (tx: TransactionSql) => Promise<unknown>) => operation(transaction as unknown as TransactionSql) } as unknown as DatabaseClient;
    const review = { status, snapshot: { assets: [], evidence: [], conflicts: [] } } as unknown as ContentPackageReview;
    vi.spyOn(reviewRepository, "assertExpectedContentPackageReviewInTransaction").mockResolvedValue({ review, canonicalSnapshot: "{}" });
    vi.spyOn(reviewRepository, "assertPackageReviewAccessInTransaction").mockResolvedValue(undefined);
    const invalidate = vi.spyOn(reviewRepository, "invalidateContentPackageApprovalInTransaction");
    return { sql, transaction, invalidate };
  }
  for (const [name, writer] of writers) {
    it.each(["detecting", "stabilizing", "analyzing", "executing", "completed", "failed"] as const)(`${name} rejects %s before any data/status/audit mutation`, async (status) => {
      const { sql, transaction, invalidate } = setup(status);
      await expect(writer(sql)).rejects.toMatchObject({ code: "review_blocked" });
      expect(transaction).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
    });
    it.each(["ready", "needs_review", "approved"] as const)(`${name} permits %s to reach scoped item selection`, async (status) => {
      const { sql, transaction, invalidate } = setup(status);
      await expect(writer(sql)).resolves.toBeUndefined();
      expect(transaction).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
    });
  }
});

describe("conflict-resolution overlap admission", () => {
  afterEach(() => vi.restoreAllMocks());
  const id = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
  function setup(proposed: number[], selected: number) {
    const input = { workspaceId: id(1), packageId: id(2), actorUserId: id(3), expectedVersion: 1,
      expectedReviewFingerprint: `mm-package-review-v1:sha256:${"0".repeat(64)}`, conflictId: id(200), evidenceId: id(selected) };
    const stamp = "2026-09-15T12:00:00.123456Z";
    const conflicts: ContentPackageReviewConflictV1[] = [
      { id: id(100), factKey: "first", status: "resolved", candidateEvidenceIds: [id(10), id(20)], resolutionEvidenceId: id(10), resolutionNote: null, createdAtUtcMicros: stamp, resolvedAtUtcMicros: stamp },
      { id: id(200), factKey: "second", status: "open", candidateEvidenceIds: proposed.map(id), resolutionEvidenceId: null, resolutionNote: null, createdAtUtcMicros: stamp, resolvedAtUtcMicros: null },
    ];
    const before = { version: 1, status: "needs_review", reviewFingerprint: input.expectedReviewFingerprint,
      snapshot: { conflicts, assets: [], evidence: [10, 20, 30].map((n) => ({ id: id(n), provenance: "observed", supersededByEvidenceId: null })) } } as unknown as ContentPackageReview;
    const after: ContentPackageReview = { ...before, snapshot: { ...before.snapshot, conflicts: conflicts.map((row) => row.id === input.conflictId ? { ...row, status: "resolved", resolutionEvidenceId: input.evidenceId } : row) } };
    const transaction = Object.assign(vi.fn(async () => []), { json: (value: unknown) => value });
    const sql = { begin: (operation: (tx: TransactionSql) => Promise<unknown>) => operation(transaction as unknown as TransactionSql) } as unknown as DatabaseClient;
    vi.spyOn(reviewRepository, "assertExpectedContentPackageReviewInTransaction").mockResolvedValue({ review: before, canonicalSnapshot: "{}" });
    const invalidate = vi.spyOn(reviewRepository, "invalidateContentPackageApprovalInTransaction").mockResolvedValue({ review: after, canonicalSnapshot: "{}" });
    const proof = vi.spyOn(reviewRepository, "insertLearningReviewProofInTransaction").mockResolvedValue(undefined);
    return { sql, input, before, after, transaction, invalidate, proof };
  }
  it.each([
    ["selecting an existing loser", [20, 30], 20],
    ["excluding an existing winner", [10, 30], 30],
  ] as const)("rejects %s before writes and leaves the conflict open", async (_label, candidates, selected) => {
    const fixture = setup([...candidates], selected);
    await expect(resolvePackageEvidenceConflict(fixture.sql, fixture.input)).rejects.toMatchObject({ code: "review_blocked", blockers: [{ code: "conflict_decisions_inconsistent" }] });
    expect(fixture.transaction).not.toHaveBeenCalled(); expect(fixture.invalidate).not.toHaveBeenCalled(); expect(fixture.proof).not.toHaveBeenCalled();
    expect(fixture.before.snapshot.conflicts[1]!.status).toBe("open");
  });
  it("allows the same reviewed winner across consistent overlapping conflicts", async () => {
    const fixture = setup([10, 30], 10);
    await expect(resolvePackageEvidenceConflict(fixture.sql, fixture.input)).resolves.toEqual(fixture.after);
    expect(fixture.transaction).toHaveBeenCalled(); expect(fixture.invalidate).toHaveBeenCalledOnce(); expect(fixture.proof).toHaveBeenCalledOnce();
  });
});
