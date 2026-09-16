import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "./client";
import { DraftRepository } from "./draft-repository";
import { CampaignPreparationRepository } from "./campaign-preparation-repository";
import { CampaignFinalizationRepository } from "./campaign-finalization-repository";
import { compileGeneralAnnouncementPreparation } from "./campaign-preparation-template";
import { ContentPackageReviewError } from "./content-package-review-models";
import { createContentPackageReviewFingerprint, type ContentPackageReviewSnapshotV1 } from "./content-package-review-fingerprint";

const { checkApproval, checkAccess, lockPreview } = vi.hoisted(() => ({ checkApproval: vi.fn(), checkAccess: vi.fn(), lockPreview: vi.fn() }));
vi.mock("./content-package-review-repository", () => ({ assertCurrentContentPackageApprovalInTransaction: checkApproval, assertPackageReviewAccessInTransaction: checkAccess }));
vi.mock("./exact-preview-repository", async (original) => ({
  ...await original<typeof import("./exact-preview-repository")>(), lockExactTextPreviewInTransaction: lockPreview,
}));

const id = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const workspaceId = id(1), packageId = id(2), campaignId = id(3), versionId = id(4), actorId = id(5), approvalId = id(6);
const preparationId = id(7), generationId = id(8), draftId = id(9), draftVersionId = id(10), previewId = id(11);
const stamp = "2026-09-09T12:00:00.123456Z";
function snapshot(): ContentPackageReviewSnapshotV1 {
  return { schemaVersion: 1, reviewContract: "content-package-review-v1",
    package: { id: packageId, workspaceId, smartSourceId: id(12), rootSourceItemId: id(13), version: 2,
      title: "Exact reviewed title", confidence: null, contextPackVersionIds: [], createdAtUtcMicros: stamp },
    evidence: [
      { id: id(20), factKey: null, claim: "Admission is free.", provenance: "observed", sourceReferences: ["source:one"],
        confidence: null, contextPackVersionId: null, supersededByEvidenceId: null, createdAtUtcMicros: stamp },
      { id: id(21), factKey: "place", claim: "The venue is Central Hall.", provenance: "authoritative_context", sourceReferences: ["source:two"],
        confidence: 1, contextPackVersionId: null, supersededByEvidenceId: null, createdAtUtcMicros: "2026-09-09T12:00:00.123455Z" },
      { id: id(22), factKey: "place", claim: "The venue is the rejected address.", provenance: "observed", sourceReferences: ["source:old"],
        confidence: 1, contextPackVersionId: null, supersededByEvidenceId: null, createdAtUtcMicros: stamp },
    ], conflicts: [{ id: id(23), factKey: "place", candidateEvidenceIds: [id(21), id(22)], status: "resolved",
      resolutionEvidenceId: id(21), resolutionNote: "Reviewed exact venue", createdAtUtcMicros: stamp, resolvedAtUtcMicros: stamp }], assets: [] };
}
const captured = createContentPackageReviewFingerprint(snapshot());
const expectedReviewFingerprint = captured.token;
const preparationInput = { workspaceId, contentPackageId: packageId, expectedPackageVersion: 2, promotionalStrength: "informational" };
const compiled = compileGeneralAnnouncementPreparation(preparationInput);

function mockDatabase(respond: (query: string, values: unknown[]) => unknown[] = () => []) {
  const statements: { query: string; values: unknown[] }[] = [];
  const tagged = vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.join("?").replace(/\s+/g, " ").trim(); statements.push({ query, values });
    return respond(query, values);
  });
  const transaction = Object.assign(tagged, { json: (value: unknown) => value }) as unknown as TransactionSql;
  const outside = vi.fn(() => { throw new Error("Unexpected outside read"); });
  const begin = vi.fn(async (run: (tx: TransactionSql) => Promise<unknown>) => run(transaction));
  const sql = Object.assign(outside, { begin }) as unknown as DatabaseClient;
  return { sql, transaction, statements, outside, begin };
}
beforeEach(() => {
  vi.clearAllMocks();
  checkAccess.mockResolvedValue(undefined);
  checkApproval.mockResolvedValue({ approvalId, reviewFingerprint: expectedReviewFingerprint,
    snapshot: captured.snapshot, effectiveEvidence: captured.snapshot.evidence.slice(0, 2) });
});

describe("new draft generation package approval", () => {
  it.each([
    {}, { expectedPackageVersion: 2 }, { expectedReviewFingerprint },
    { expectedPackageVersion: 0, expectedReviewFingerprint },
    { expectedPackageVersion: 2, expectedReviewFingerprint: "approved" },
  ])("requires displayed version and fingerprint before new direct generation %#", async (expectation) => {
    const h = mockDatabase();
    await expect(new DraftRepository(h.sql).generate({ workspaceId, campaignId, contentPackageId: packageId, ...expectation }, actorId)).rejects.toThrow();
    expect(h.begin).not.toHaveBeenCalled(); expect(checkApproval).not.toHaveBeenCalled();
  });
  function generationHarness() {
    const h = mockDatabase((query) => query.startsWith("SELECT cv.id AS campaign_version_id")
      ? [{ campaignVersionId: versionId, campaignName: "Campaign", contentPackageIds: [packageId],
        informationDepth: "comprehensive", promotionalStrength: "informational" }] : []);
    return { ...h, generate: () => new DraftRepository(h.sql).generateDraftsInTransaction(h.transaction,
      { workspaceId, campaignId, campaignVersionId: versionId, contentPackageId: packageId,
        expectedContentPackageVersion: 2, expectedReviewFingerprint }, actorId) };
  }
  it("pins the exact attestation and excludes rejected facts without rereading live evidence", async () => {
    const h = generationHarness();
    const result = await h.generate();
    expect(result.drafts).toHaveLength(1);
    expect(checkApproval).toHaveBeenCalledExactlyOnceWith(h.transaction,
      { workspaceId, contentPackageId: packageId, expectedPackageVersion: 2, expectedReviewFingerprint });
    expect(checkAccess).toHaveBeenCalledExactlyOnceWith(h.transaction, { workspaceId, actorUserId: actorId }, "write");
    expect(checkAccess.mock.invocationCallOrder[0]).toBeLessThan(checkApproval.mock.invocationCallOrder[0]!);
    const inserted = h.statements.find((entry) => entry.query.startsWith("INSERT INTO draft_generation"))!;
    expect(inserted.query).toContain("content_package_approval_id"); expect(inserted.values).toContain(approvalId);
    const evidence = inserted.values.find(Array.isArray);
    expect(evidence).toEqual([
      { id: id(21), factKey: "place", claim: "The venue is Central Hall.", provenance: "authoritative_context", sourceReferences: ["source:two"], confidence: 1 },
      { id: id(20), claim: "Admission is free.", provenance: "observed", sourceReferences: ["source:one"], confidence: null },
    ]);
    expect(JSON.stringify(h.statements)).not.toContain("rejected address");
    expect(h.statements.some((entry) => /FROM evidence_item|FROM content_package/.test(entry.query))).toBe(false);
    expect(h.begin).not.toHaveBeenCalled(); expect(h.outside).not.toHaveBeenCalled();
  });
  it.each(["approval_unavailable", "review_changed", "review_blocked", "package_version_mismatch"] as const)(
    "does not create any new work when approval check fails: %s", async (code) => {
      const h = generationHarness(); checkApproval.mockRejectedValue(new ContentPackageReviewError(code, "Current review unavailable"));
      await expect(h.generate()).rejects.toMatchObject({ issues: [{ code }] });
      expect(h.statements.some((entry) => /^(INSERT|UPDATE|DELETE)/.test(entry.query))).toBe(false);
    });
  it("does not treat a valid display token as writer authority", async () => {
    const h = generationHarness(); checkAccess.mockRejectedValue(new ContentPackageReviewError("access_denied", "Writer access revoked"));
    await expect(h.generate()).rejects.toMatchObject({ code: "access_denied" });
    expect(h.statements).toHaveLength(0); expect(checkApproval).not.toHaveBeenCalled();
  });
});

describe("preparation display-token compatibility", () => {
  function replayHarness(proved: boolean) {
    const receipt = { id: preparationId, workspaceId, canonicalPayload: compiled.canonicalPayload,
      referenceSnapshot: { contentPackage: { id: packageId, title: "Historical", version: 2,
        ...(proved ? { approvalId, reviewFingerprint: expectedReviewFingerprint } : {}) }, audiences: [] }, createdAt: stamp };
    const h = mockDatabase((query) => query.startsWith("SELECT status, writer_user_id") ? []
      : query.includes("FROM workspace_membership") ? [{ role: "editor" }]
      : query.startsWith("SELECT * FROM campaign_preparation") ? [receipt] : [{ id: actorId }]);
    return { ...h, repository: new CampaignPreparationRepository(h.sql) };
  }
  it("replays a completed legacy receipt without inventing approval provenance or querying current state", async () => {
    const h = replayHarness(false);
    const result = await h.repository.prepare(preparationInput, id(30), actorId);
    expect(result.replayed).toBe(true); expect(result.preparation.referenceSnapshot.contentPackage.approvalId).toBeUndefined();
    expect(checkApproval).not.toHaveBeenCalled();
  });
  it("replays a proved receipt only with the identical displayed fingerprint", async () => {
    const h = replayHarness(true);
    await expect(h.repository.prepare(preparationInput, id(30), actorId, { expectedReviewFingerprint })).resolves.toMatchObject({ replayed: true });
    expect(checkApproval).not.toHaveBeenCalled();
  });
  it.each([undefined, `mm-package-review-v1:sha256:${"0".repeat(64)}`])("rejects omitted/changed new-receipt replay token %#", async (token) => {
    const h = replayHarness(true);
    await expect(h.repository.prepare(preparationInput, id(30), actorId, { expectedReviewFingerprint: token }))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(checkApproval).not.toHaveBeenCalled();
  });
  it("requires a display token for new preparation even though template1 canonical input stays unchanged", async () => {
    const h = mockDatabase((query) => query.startsWith("SELECT status, writer_user_id") ? []
      : query.includes("FROM workspace_membership") ? [{ role: "editor" }]
      : query.startsWith("SELECT * FROM campaign_preparation") ? [] : [{ id: actorId }]);
    await expect(new CampaignPreparationRepository(h.sql).prepare(preparationInput, id(30), actorId))
      .rejects.toMatchObject({ code: "invalid_review_input" });
    expect(h.statements.some((entry) => /^(INSERT|UPDATE|DELETE)/.test(entry.query))).toBe(false);
    expect(compiled.normalizedInput).not.toHaveProperty("expectedReviewFingerprint");
  });
});

describe("finalization keeps original approval lineage", () => {
  const intent = { workspaceId, preparationId, expectedPlanningVersionId: versionId, draftId, expectedDraftVersionId: draftVersionId,
    previewId, expectedPreviewFingerprint: `mm-preview-v1:sha256:${"a".repeat(64)}`, timing: { type: "immediate" } };
  function finalizationHarness(proved: boolean) {
    const h = mockDatabase((query) => {
      if (query.includes("FROM workspace_membership")) return [{ role: "editor" }];
      if (query.startsWith("SELECT receipt.*")) return [];
      if (query.startsWith("SELECT campaign_id FROM campaign_preparation")) return [{ campaignId }];
      if (query.startsWith("SELECT id, status, current_version_id FROM campaign")) return [{ id: campaignId, status: "published", currentVersionId: versionId }];
      if (query.startsWith("SELECT id, workspace_id, campaign_id")) return [{ id: preparationId, workspaceId, campaignId,
        planningVersionId: versionId, generationId, contentPackageId: packageId, contentPackageVersion: 2,
        templateKey: "general_announcement", templateVersion: 1, canonicalPayload: compiled.canonicalPayload,
        configurationHash: createHash("sha256").update(compiled.canonicalPayload).digest("hex"),
        configurationSnapshotJson: JSON.stringify(compiled.normalizedInput), preparedDraftsJson: JSON.stringify([{ draftId, versionId: draftVersionId }]) }];
      if (query.startsWith("SELECT id FROM campaign_finalization") || (query.startsWith("SELECT id FROM campaign_version") && query.includes("status = 'draft'"))) return [];
      if (query.startsWith("SELECT status, autonomy_mode, content_package_ids")) return [{ status: "published", autonomyMode: "draft_only", contentPackageIds: [packageId] }];
      if (query.startsWith("SELECT generation.campaign_version_id")) return [{ campaignVersionId: versionId, contentPackageId: packageId,
        contentPackageVersion: 2, approvalId: proved ? approvalId : null, reviewFingerprint: proved ? expectedReviewFingerprint : null,
        canonicalReviewSnapshot: proved ? captured.canonicalSnapshot : null }];
      return [{ id: actorId }];
    });
    return { ...h, finalize: () => new CampaignFinalizationRepository(h.sql).finalize(intent, id(30), actorId) };
  }
  it("requires re-preparation for an unfinished legacy generation without an original package approval", async () => {
    const h = finalizationHarness(false);
    await expect(h.finalize()).rejects.toMatchObject({ code: "historical_approval_unavailable" });
    expect(checkApproval).not.toHaveBeenCalled(); expect(lockPreview).not.toHaveBeenCalled();
    expect(h.statements.some((entry) => /^(INSERT|UPDATE|DELETE)/.test(entry.query))).toBe(false);
  });
  it("accepts a different current attestation ID for byte-identical original reviewed content", async () => {
    const h = finalizationHarness(true); const stop = new Error("Reached independent preview admission");
    checkApproval.mockResolvedValue({ approvalId: id(40), reviewFingerprint: expectedReviewFingerprint,
      snapshot: captured.snapshot, effectiveEvidence: captured.snapshot.evidence.slice(0, 2) });
    lockPreview.mockRejectedValue(stop);
    await expect(h.finalize()).rejects.toBe(stop);
    expect(checkApproval).toHaveBeenCalledExactlyOnceWith(h.transaction,
      { workspaceId, contentPackageId: packageId, expectedPackageVersion: 2, expectedReviewFingerprint });
    expect(lockPreview).toHaveBeenCalledOnce();
  });
  it("does not finalize different content even if a malformed helper result reports the old fingerprint", async () => {
    const h = finalizationHarness(true);
    checkApproval.mockResolvedValue({ approvalId: id(40), reviewFingerprint: expectedReviewFingerprint,
      snapshot: { ...captured.snapshot, package: { ...captured.snapshot.package, title: "Changed title" } }, effectiveEvidence: [] });
    await expect(h.finalize()).rejects.toMatchObject({ code: "review_changed" });
    expect(lockPreview).not.toHaveBeenCalled();
  });
});
