import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CampaignPreparationRepository, ContentPackageReviewRepository, createDatabaseClient,
  DraftRepository, MarketMeRepository, type ContentPackageReview, type DatabaseClient } from "@market-me/database";
import type { MediaProcessor } from "@market-me/media";
import { ContentPackageService } from "./content-package-service";
import type { StorageIngestionService } from "./service";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (name !== "market_me_ci" && !name.startsWith("market_me_qa_140_")) {
    throw new Error("Source evidence integration requires the empty CI or dedicated 140 QA database.");
  }
}
let sql: DatabaseClient;
const correction = "Admission is free only for registered members.";
const longText = `${"Synthetic background details. ".repeat(20)}${correction}`;

async function fixture(text: string, partial: boolean) {
  // The real claim method is global; never consume an unrelated fixture's event.
  expect((await sql`SELECT id FROM ingestion_event`)).toHaveLength(0);
  const core = new MarketMeRepository(sql), reviews = new ContentPackageReviewRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({
    email: `source-integrity-${randomUUID()}@market-me.local`, displayName: "Synthetic Source Integrity" });
  const cleanup = async () => {
    await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`;
    await sql`DELETE FROM app_user WHERE id=${user.id}`;
  };
  try {
    const source = await core.createSmartSource({ workspaceId: workspace.workspaceId, name: "Synthetic source", provider: "local",
      locations: [{ providerLocationId: "synthetic", displayPath: "/Synthetic" }], recursive: false, readinessMode: "immediate",
      stabilizationWindowSeconds: 0, allowedMimeTypes: ["text/plain"], ignorePatterns: [], contextPackIds: [],
      autonomyMode: "draft_only", enabled: false }, user.id);
    const bytes = new TextEncoder().encode(text), contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    await core.applySourceItemChanges({ workspaceId: workspace.workspaceId, smartSourceId: source.id, upserts: [{
      workspaceId: workspace.workspaceId, smartSourceId: source.id, providerItemId: "synthetic", name: "source.txt",
      displayPath: "/Synthetic/source.txt", mimeType: "text/plain", isFolder: false, contentHash,
    }], deletedProviderItemIds: [] });
    expect(await core.setLocalSourceObjectKey({ workspaceId: workspace.workspaceId, smartSourceId: source.id,
      providerItemId: "synthetic", contentHash, objectKey: "synthetic/source" })).toBe(true);
    const mediaProcessor = partial ? { process: async () => [{ clientKey: "original", role: "original", fileName: "source.txt",
      mimeType: "text/plain", contentHash, objectKey: "synthetic/source", byteSize: bytes.length,
      processingVersion: "synthetic-v1", recipe: {}, mediaStatus: "processed", scanStatus: "not_configured",
      altTextStatus: "not_applicable", extractedText: "Admission is free", extractionStatus: "completed",
      metadata: { documentExtraction: { state: "truncated" } } }] } as unknown as MediaProcessor : undefined;
    const service = new ContentPackageService({ repository: core, ingestion: {} as StorageIngestionService, mediaProcessor,
      objectStore: { read: async (key) => { expect(key).toBe("synthetic/source"); return bytes; }, putImmutable: async () => undefined } });
    expect(await service.processReadyEvents()).toEqual({ processed: 1, failed: 0, deferred: 0, ignored: 0 });
    const [row] = await sql`SELECT id FROM content_package WHERE workspace_id=${workspace.workspaceId}`;
    expect(row).toBeDefined();
    const identity = { workspaceId: workspace.workspaceId, packageId: row!.id as string, actorUserId: user.id };
    const read = async () => (await reviews.getReview(identity.workspaceId, identity.packageId, user.id))!;
    const expectation = (review: ContentPackageReview) => ({ ...identity, expectedVersion: review.version, expectedReviewFingerprint: review.reviewFingerprint });
    const prepare = (review: ContentPackageReview) => new CampaignPreparationRepository(sql).prepare({
      workspaceId: identity.workspaceId, contentPackageId: identity.packageId, expectedPackageVersion: review.version,
      name: "Synthetic evidence preparation", informationDepth: "contextual", promotionalStrength: "informational",
    }, randomUUID(), user.id, { expectedReviewFingerprint: review.reviewFingerprint });
    return { core, reviews, identity, read, expectation, prepare, cleanup, text: partial ? "Admission is free" : text.trim() };
  } catch (error) { await cleanup(); throw error; }
}

describe.skipIf(!databaseUrl)("ingestion evidence through exact approval and draft preparation", () => {
  beforeAll(() => { sql = createDatabaseClient(databaseUrl!); });
  afterAll(async () => { await sql?.end(); });

  it.each([
    { name: "oversized source", text: longText, partial: false },
    { name: "truncated extraction", text: longText, partial: true },
    { name: "empty extraction", text: "  ", partial: false },
  ])("requires explicit correction and separate approval for $name", async ({ text, partial }) => {
    const f = await fixture(text, partial);
    try {
      const before = await f.read(), original = before.snapshot.evidence[0]!;
      expect(before.status).toBe("needs_review"); expect(before.effectiveEvidenceIds).toEqual([]);
      expect(before.snapshot.evidence).toHaveLength(1); expect(original.provenance).toBe("unresolved");
      expect(original.confidence).toBeNull(); expect(before.snapshot.assets[0]!.extraction.text).toBe(f.text);
      expect(before.blockers.map((row) => row.code)).toContain("unresolved_evidence");
      await expect(f.reviews.approve({ ...f.expectation(before), idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "review_blocked" });
      await expect(f.prepare(before)).rejects.toMatchObject({ code: "approval_unavailable" });
      const corrected = (await f.core.resolveUnresolvedEvidence({ ...f.expectation(before), evidenceId: original.id,
        correctedClaim: correction, note: "Synthetic explicit source review; qualification retained." }))!;
      expect(corrected.currentApprovalValid).toBe(false); expect(corrected.blockers).toEqual([]);
      expect(corrected.snapshot.assets).toEqual(before.snapshot.assets);
      const successor = corrected.snapshot.evidence.find((row) => row.id !== original.id)!;
      expect(successor).toMatchObject({ claim: correction, provenance: "authoritative_context" });
      expect(corrected.snapshot.evidence.find((row) => row.id === original.id)).toEqual({ ...original, supersededByEvidenceId: successor.id });
      expect(corrected.effectiveEvidenceIds).toEqual([successor.id]);
      await expect(f.prepare(corrected)).rejects.toMatchObject({ code: "approval_unavailable" });
      await expect(f.core.resolveUnresolvedEvidence({ ...f.expectation(before), evidenceId: original.id, correctedClaim: correction }))
        .rejects.toMatchObject({ code: "review_changed" });
      const approval = await f.reviews.approve({ ...f.expectation(corrected), idempotencyKey: randomUUID() });
      expect(approval.approval.reviewSnapshot).toEqual(corrected.snapshot);
      await f.prepare(await f.read());
      const [draftRow] = await sql`SELECT id FROM content_draft WHERE workspace_id=${f.identity.workspaceId}`;
      const draft = (await new DraftRepository(sql).get(f.identity.workspaceId, draftRow!.id))!;
      expect(draft.currentVersion?.body).toBe(correction);
      expect(JSON.stringify(draft.generation.evidenceSnapshot)).not.toContain(original.claim);
      expect(await f.reviews.getApproval(f.identity.workspaceId, approval.approval.id, f.identity.actorUserId)).toEqual(approval.approval);
      expect((await sql`SELECT id FROM publication_action WHERE workspace_id=${f.identity.workspaceId}`)).toHaveLength(0);
      expect((await sql`SELECT id FROM campaign_instance WHERE workspace_id=${f.identity.workspaceId}`)).toHaveLength(0);
    } finally { await f.cleanup(); }
  });

  it("requires ordinary approval even for a whole short extraction", async () => {
    const f = await fixture(correction, false);
    try {
      const review = await f.read();
      expect(review.status).toBe("ready"); expect(review.blockers).toEqual([]);
      expect(review.snapshot.evidence).toHaveLength(1);
      expect(review.snapshot.evidence[0]!.claim).toBe(correction);
      expect(review.snapshot.assets[0]!.metadata.sourceEvidence).toMatchObject({ state: "whole_text", reasons: [] });
      await expect(f.prepare(review)).rejects.toMatchObject({ code: "approval_unavailable" });
      await f.reviews.approve({ ...f.expectation(review), idempotencyKey: randomUUID() });
      await f.prepare(await f.read());
      const [row] = await sql`SELECT id FROM content_draft WHERE workspace_id=${f.identity.workspaceId}`;
      expect((await new DraftRepository(sql).get(f.identity.workspaceId, row!.id))!.currentVersion!.body).toBe(correction);
    } finally { await f.cleanup(); }
  });

  it("does not let an editor resolve or approve the new source review item", async () => {
    const f = await fixture(longText, false), editorId = randomUUID();
    try {
      const email = `source-integrity-editor-${editorId}@market-me.local`;
      await sql`INSERT INTO app_user(id,email,normalized_email,display_name) VALUES(${editorId},${email},${email},'Synthetic Editor')`;
      await sql`INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES(${f.identity.workspaceId},${editorId},'editor')`;
      const before = await f.read();
      const input = { ...f.expectation(before), actorUserId: editorId };
      await expect(f.core.resolveUnresolvedEvidence({ ...input, evidenceId: before.snapshot.evidence[0]!.id, correctedClaim: correction }))
        .rejects.toMatchObject({ code: "access_denied" });
      await expect(f.reviews.approve({ ...input, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "access_denied" });
      expect((await f.read()).snapshot).toEqual(before.snapshot);
      expect((await sql`SELECT id FROM learning_review WHERE content_package_id=${f.identity.packageId}`)).toHaveLength(0);
    } finally { await f.cleanup(); await sql`DELETE FROM app_user WHERE id=${editorId}`; }
  });
});
