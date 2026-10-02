import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { PackageWorkRepository } from "./package-work-repository";
import { makeCampaignFinalizationFixture, type CampaignFinalizationFixture } from "./test-support/campaign-finalization-fixture";
const url = process.env.DATABASE_URL;
if (url && new URL(url).pathname !== "/market_me_ci" && !new URL(url).pathname.startsWith("/market_me_qa_135_")) throw new Error("Package work tests require isolated market_me_ci or market_me_qa_135_*.");
let sql: DatabaseClient;
async function using(run: (f: CampaignFinalizationFixture, repository: PackageWorkRepository) => Promise<void>) {
  const f = await makeCampaignFinalizationFixture(sql); try { await run(f, new PackageWorkRepository(sql)); } finally { await f.cleanup(); }
}
describe.skipIf(!url)("exact read-only package work lineage", () => {
  beforeAll(() => { sql = createDatabaseClient(url!); }); afterAll(async () => { await sql?.end(); });
  it.each(["owner", "admin", "editor", "approver", "analyst", "viewer"])("reads the current %s role and only its exact preparation/drafts", role => using(async (f, repository) => {
    await sql`UPDATE workspace_membership SET role=${role} WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`;
    const result = await repository.getSnapshot(f.workspace.workspaceId, f.contentPackage.id, f.user.id);
    expect(result).toMatchObject({ packageId: f.contentPackage.id, workspaceId: f.workspace.workspaceId, role, hasMore: false, page: 1 });
    expect(result?.preparations).toHaveLength(1);
    expect(result?.preparations[0]).toMatchObject({ id: f.receipt.id, campaignId: f.receipt.campaignId, packageVersion: f.contentPackage.version, finalization: null });
    expect(result?.preparations[0]?.drafts.map(d => d.draftId)).toEqual(f.receipt.preparedDrafts.map(d => d.draftId));
    expect(result?.preparations[0]?.drafts.map(d => d.audienceLabel)).toEqual(["Second audience", "First audience"]);
    expect(result?.preparations[0]?.drafts[1]).toMatchObject({ initialVersionId: f.receipt.preparedDrafts[1]!.versionId,
      current: { versionId: f.approvedDraft.currentVersion.id, versionNumber: 2, status: "approved" } });
  }));
  it("denies absent/revoked/foreign scope even for an organization owner", async () => using(async (f, repository) => using(async other => {
    expect(await repository.getSnapshot(f.workspace.workspaceId, other.contentPackage.id, f.user.id)).toBeUndefined();
    expect(await repository.getSnapshot(other.workspace.workspaceId, other.contentPackage.id, f.user.id)).toBeUndefined();
    expect(await repository.getSnapshot(f.workspace.workspaceId, randomUUID(), f.user.id)).toBeUndefined();
    await sql`UPDATE workspace_membership SET revoked_at=clock_timestamp() WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`;
    expect(await repository.getSnapshot(f.workspace.workspaceId, f.contentPackage.id, f.user.id)).toBeUndefined();
  })));
  it("returns a real empty package rather than treating absence or pending work as a preparation", async () => using(async (f, repository) => {
    await f.core.applySourceItemChanges({ workspaceId: f.workspace.workspaceId, smartSourceId: f.source.id,
      upserts: [{ workspaceId: f.workspace.workspaceId, smartSourceId: f.source.id, providerItemId: "unprepared", name: "unprepared.txt",
        displayPath: "/FinalizationQA/unprepared.txt", mimeType: "text/plain", isFolder: false, contentHash: "sha256:unprepared-fixture" }], deletedProviderItemIds: [] });
    const item = (await f.core.getSourceItemByProviderId(f.source.id, "unprepared"))!;
    const other = await f.core.saveContentPackage({ ...f.packageInput, title: "Separate synthetic package", rootSourceItemId: item.id,
      evidence: f.packageInput.evidence.map(e => ({ ...e, id: randomUUID() })) });
    expect(await repository.getSnapshot(f.workspace.workspaceId, other.id, f.user.id)).toMatchObject({ packageId: other.id, preparations: [], hasMore: false });
  }));
  it("pages completed receipts without mixing another package and bounds query input", async () => using(async (f, repository) => {
    const ids = [f.receipt.id];
    for (let n = 0; n < 10; n++) ids.push((await f.preparations.prepare(f.preparationInput, randomUUID(), f.user.id, f.reviewOptions)).preparation.id);
    const first = (await repository.getSnapshot(f.workspace.workspaceId, f.contentPackage.id, f.user.id))!;
    const second = (await repository.getSnapshot(f.workspace.workspaceId, f.contentPackage.id, f.user.id, 2))!;
    expect(first.preparations).toHaveLength(10); expect(first.hasMore).toBe(true); expect(second.preparations).toHaveLength(1); expect(second.hasMore).toBe(false);
    expect(new Set([...first.preparations, ...second.preparations].map(p => p.id))).toEqual(new Set(ids));
    expect(await repository.getSnapshot(f.workspace.workspaceId, f.contentPackage.id, f.user.id, 3)).toMatchObject({ preparations: [], hasMore: false });
    await expect(repository.getSnapshot(f.workspace.workspaceId, f.contentPackage.id, f.user.id, 1001)).rejects.toThrow("unavailable");
  }));
  it("keeps archived drafts visible and rejects a current pointer owned by another draft", async () => using(async (f, repository) => {
    const [first, second] = f.receipt.preparedDrafts;
    await sql`UPDATE content_draft SET status='archived' WHERE id=${first!.draftId}`;
    expect((await repository.getSnapshot(f.workspace.workspaceId, f.contentPackage.id, f.user.id))?.preparations[0]?.drafts[0]?.current?.status).toBe("archived");
    await sql`UPDATE content_draft SET current_version_id=${second!.versionId} WHERE id=${first!.draftId}`;
    expect((await repository.getSnapshot(f.workspace.workspaceId, f.contentPackage.id, f.user.id))?.preparations[0]?.drafts[0]?.current).toBeNull();
  }));
  it("links only exact finalization-version runs with honest lookahead and no external delivery inference", async () => using(async (f, repository) => {
    const finalized = (await f.finalizations.finalize(f.input, f.key, f.user.id)).finalization;
    expect((await repository.getSnapshot(f.workspace.workspaceId, f.contentPackage.id, f.user.id))?.preparations[0]?.finalization)
      .toMatchObject({ id: finalized.id, runs: [], hasMoreRuns: false });
    const expected: string[] = [];
    for (let n = 0; n < 7; n++) {
      const runId = randomUUID(); expected.push(runId);
      await sql`INSERT INTO campaign_instance(id,workspace_id,campaign_id,campaign_version_id,status,requested_by)
        VALUES (${runId},${f.workspace.workspaceId},${f.receipt.campaignId},${finalized.finalizedVersionId},'completed',${f.user.id})`;
    }
    const unrelated = randomUUID();
    await sql`INSERT INTO campaign_instance(id,workspace_id,campaign_id,campaign_version_id,status,requested_by)
      VALUES (${unrelated},${f.workspace.workspaceId},${f.receipt.campaignId},${f.receipt.planningVersionId},'failed',${f.user.id})`;
    const result = (await repository.getSnapshot(f.workspace.workspaceId, f.contentPackage.id, f.user.id))!.preparations[0]!.finalization!;
    expect(result).toMatchObject({ id: finalized.id, selectedDraftId: f.input.draftId, finalizedVersionId: finalized.finalizedVersionId, hasMoreRuns: true });
    expect(result.runs).toHaveLength(5); expect(result.runs.every(r => expected.includes(r.id) && r.status === "completed")).toBe(true);
    expect(result.runs.map(r => r.id)).not.toContain(unrelated);
  }));
  it("executes under SQL read-only enforcement without new audit, preparation or run writes", async () => using(async (f, repository) => {
    const state = () => sql`SELECT (SELECT count(*) FROM audit_event WHERE workspace_id=${f.workspace.workspaceId}) AS audits,
      (SELECT count(*) FROM campaign_preparation WHERE workspace_id=${f.workspace.workspaceId}) AS preparations,
      (SELECT count(*) FROM campaign_instance WHERE workspace_id=${f.workspace.workspaceId}) AS runs`;
    const before = await state();
    await sql.begin("read only", async tx => { expect((await new PackageWorkRepository(tx as unknown as DatabaseClient).getSnapshot(f.workspace.workspaceId, f.contentPackage.id, f.user.id))?.preparations).toHaveLength(1); });
    expect(await state()).toEqual(before);
    expect(await repository.getSnapshot(f.workspace.workspaceId, f.contentPackage.id, f.user.id)).toBeDefined();
  }));
  it("keeps the captured package revision after ingestion replaces current material", async () => using(async (f, repository) => {
    await f.core.saveContentPackage({ ...f.packageInput, title: "Replacement package material", evidence: [
      { id: randomUUID(), claim: "A different reviewed event.", provenance: "observed", sourceReferences: ["revision:2"] }] });
    const result = (await repository.getSnapshot(f.workspace.workspaceId, f.contentPackage.id, f.user.id))!;
    expect(result).toMatchObject({ packageVersion: 2, title: "Replacement package material", packageStatus: "ready" });
    expect(result.preparations[0]).toMatchObject({ id: f.receipt.id, packageVersion: 1 });
  }));
  it("never substitutes a draft moved to another preparation generation", async () => using(async (f, repository) => {
    const sibling = (await f.preparations.prepare(f.preparationInput, randomUUID(), f.user.id, f.reviewOptions)).preparation;
    // Simulate a legacy administrative inconsistency; immutable receipt identities remain unchanged.
    await sql`UPDATE content_draft SET draft_generation_id=${sibling.generationId},audience_profile_version_id=NULL WHERE id=${f.receipt.preparedDrafts[0]!.draftId}`;
    const result = (await repository.getSnapshot(f.workspace.workspaceId, f.contentPackage.id, f.user.id))!;
    expect(result.preparations.find(p => p.id === f.receipt.id)?.drafts[0]?.current).toBeNull();
    expect(result.preparations.find(p => p.id === sibling.id)?.drafts.map(d => d.draftId)).toEqual(sibling.preparedDrafts.map(d => d.draftId));
  }));
  it("reads immutable planning lineage independently of mutable current Campaign pointers", async () => using(async (f, repository) => {
    await sql`UPDATE campaign SET current_version_id=NULL,status='archived' WHERE id=${f.receipt.campaignId}`;
    expect((await repository.getSnapshot(f.workspace.workspaceId, f.contentPackage.id, f.user.id))?.preparations[0])
      .toMatchObject({ id: f.receipt.id, campaignId: f.receipt.campaignId, finalization: null });
  }));
  it("fails malformed scope before SQL and propagates actual database failures", async () => {
    const reader = new PackageWorkRepository((() => { throw new Error("synthetic outage"); }) as unknown as DatabaseClient);
    await expect(reader.getSnapshot("bad", randomUUID(), randomUUID())).rejects.toThrow("unavailable");
    await expect(reader.getSnapshot(randomUUID(), randomUUID(), randomUUID())).rejects.toThrow("synthetic outage");
  });
});
