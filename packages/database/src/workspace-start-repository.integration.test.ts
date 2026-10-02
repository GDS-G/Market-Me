import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { WorkspaceStartRepository } from "./workspace-start-repository";
import { WORKSPACE_START_COUNT_KEYS } from "./workspace-start-models";
import { CampaignPreparationRepository } from "./campaign-preparation-repository";
import { packageReviewPrecondition } from "./test-support/package-review-fixture";

const url = process.env.DATABASE_URL;
if (url && new URL(url).pathname !== "/market_me_ci" && !new URL(url).pathname.startsWith("/market_me_qa_134_")) {
  throw new Error("Start-guide integration requires isolated market_me_ci or market_me_qa_134_*.");
}
let sql: DatabaseClient;
async function using(run: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const f = await fixture(); try { await run(f); } finally { await f.cleanup(); }
}
async function fixture() {
  const core = new MarketMeRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({ email: `start-guide-${randomUUID()}@market-me.local`, displayName: "Start guide QA" });
  return { core, user, workspace, repository: new WorkspaceStartRepository(sql),
    cleanup: async () => { await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`; await sql`DELETE FROM app_user WHERE id=${user.id}`; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function content(f: Fixture) {
  const source = await f.core.createSmartSource({ workspaceId: f.workspace.workspaceId, name: "Synthetic start source", provider: "local",
    locations: [{ providerLocationId: "synthetic", displayPath: "/Synthetic" }], recursive: false, readinessMode: "immediate",
    stabilizationWindowSeconds: 0, allowedMimeTypes: [], ignorePatterns: [], contextPackIds: [], autonomyMode: "draft_only", enabled: false }, f.user.id);
  await f.core.applySourceItemChanges({ workspaceId: f.workspace.workspaceId, smartSourceId: source.id,
    upserts: [{ workspaceId: f.workspace.workspaceId, smartSourceId: source.id, providerItemId: "synthetic", name: "synthetic.txt",
      displayPath: "/Synthetic/synthetic.txt", mimeType: "text/plain", isFolder: false, contentHash: "sha256:guide-fixture" }], deletedProviderItemIds: [] });
  const item = (await f.core.getSourceItemByProviderId(source.id, "synthetic"))!;
  const pkg = await f.core.saveContentPackage({ workspaceId: f.workspace.workspaceId, smartSourceId: source.id, rootSourceItemId: item.id,
    title: "Synthetic guide package", status: "ready", contextPackVersionIds: [], assets: [], conflicts: [],
    evidence: [{ id: randomUUID(), claim: "The synthetic event starts at noon.", provenance: "observed", sourceReferences: ["source:synthetic"], confidence: 1 }] });
  return { source, pkg };
}
async function campaign(f: Fixture, autonomyMode = "draft_only", versionStatus = "published") {
  const id = randomUUID(), versionId = randomUUID();
  await sql`INSERT INTO campaign(id,workspace_id,name,created_by) VALUES (${id},${f.workspace.workspaceId},'Synthetic guide campaign',${f.user.id})`;
  await sql`INSERT INTO campaign_version(id,campaign_id,version_number,status,objective,information_depth,promotional_strength,autonomy_mode,created_by)
    VALUES (${versionId},${id},1,${versionStatus},'awareness','contextual','informational',${autonomyMode},${f.user.id})`;
  await sql`UPDATE campaign SET current_version_id=${versionId} WHERE id=${id}`;
  return { id, versionId };
}
async function draft(f: Fixture, packageId: string, status: string) {
  const proof = await packageReviewPrecondition(sql, f.workspace.workspaceId, packageId, f.user.id);
  const prepared = await new CampaignPreparationRepository(sql).prepare({ workspaceId: f.workspace.workspaceId,
    contentPackageId: packageId, expectedPackageVersion: proof.expectedVersion }, randomUUID(), f.user.id,
    { expectedReviewFingerprint: proof.expectedReviewFingerprint });
  const { draftId: id, versionId: draftVersionId } = prepared.preparation.preparedDrafts[0]!;
  // Fixture-only lifecycle states; generation still goes through exact approval and the real preparation path.
  await sql`UPDATE content_draft SET status=${status} WHERE id=${id}`;
  await sql`UPDATE content_draft_version SET status=${status === "archived" ? "working" : status} WHERE id=${draftVersionId}`;
  return { id, draftVersionId };
}

describe.skipIf(!url)("read-only workspace start guide", () => {
  beforeAll(() => { sql = createDatabaseClient(url!); });
  afterAll(async () => { await sql?.end(); });
  it("returns all exact zero counts for a real empty workspace, not absence", async () => using(async f => {
    const snapshot = await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id);
    expect(snapshot).toMatchObject({ workspaceId: f.workspace.workspaceId, role: "owner", ...Object.fromEntries(WORKSPACE_START_COUNT_KEYS.map(key => [key, 0])) });
    expect(snapshot?.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  }));
  it.each(["owner", "admin", "editor", "approver", "analyst", "viewer"])("reads the current %s membership rather than a cached grant", async role => using(async f => {
    await sql`UPDATE workspace_membership SET role=${role} WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`;
    expect((await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id))?.role).toBe(role);
    await sql`UPDATE workspace_membership SET role='viewer' WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`;
    expect((await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id))?.role).toBe("viewer");
  }));
  it("returns no snapshot after membership removal even for an organization owner", async () => using(async f => {
    await content(f);
    await sql`UPDATE workspace_membership SET revoked_at=clock_timestamp() WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`;
    expect(await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id)).toBeUndefined();
    expect(await sql`SELECT role FROM organization_membership WHERE organization_id=${f.workspace.organizationId} AND user_id=${f.user.id}`).toEqual([{ role: "owner" }]);
  }));
  it("never includes sibling/foreign workspace activity or absent workspace data", async () => using(async f => using(async other => {
    await content(other); await campaign(other);
    expect(await f.repository.getSnapshot(other.workspace.workspaceId, f.user.id)).toBeUndefined();
    expect(await f.repository.getSnapshot(randomUUID(), f.user.id)).toBeUndefined();
    expect(await f.repository.getSnapshot(f.workspace.workspaceId, randomUUID())).toBeUndefined();
    expect(await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id)).toMatchObject({ sourceCount: 0, packageCount: 0, campaignCount: 0 });
  })));
  it("distinguishes enabled sources and all package states without checking health or approval validity", async () => using(async f => {
    const { source, pkg } = await content(f);
    expect(await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id)).toMatchObject({ sourceCount: 1, enabledSourceCount: 0, packageCount: 1, packagesToReview: 1, approvedPackageCount: 0 });
    await sql`UPDATE smart_source SET enabled=true WHERE id=${source.id}`;
    for (const status of ["detecting", "stabilizing", "analyzing", "needs_review", "ready", "approved", "executing", "completed", "failed"]) {
      await sql`UPDATE content_package SET status=${status} WHERE id=${pkg.id}`;
      expect(await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id)).toMatchObject({ sourceCount: 1, enabledSourceCount: 1, packageCount: 1,
        packagesToReview: ["ready", "needs_review"].includes(status) ? 1 : 0, approvedPackageCount: status === "approved" ? 1 : 0, failedPackageCount: status === "failed" ? 1 : 0 });
    }
  }));
  it("counts active drafts and pending requests separately from historic decisions", async () => using(async f => {
    const { pkg } = await content(f);
    const proof = await packageReviewPrecondition(sql, f.workspace.workspaceId, pkg.id, f.user.id);
    await f.core.approveContentPackage({ workspaceId: f.workspace.workspaceId, packageId: pkg.id, actorUserId: f.user.id, ...proof, idempotencyKey: randomUUID() });
    for (const status of ["working", "pending_review", "approved", "rejected", "changes_requested", "archived"]) {
      const d = await draft(f, pkg.id, status);
      await sql`INSERT INTO content_draft_approval(id,workspace_id,content_draft_id,content_draft_version_id,status,request_snapshot,requested_by)
        VALUES (${randomUUID()},${f.workspace.workspaceId},${d.id},${d.draftVersionId},${status === "pending_review" ? "pending" : "approved"},'{}',${f.user.id})`;
    }
    expect(await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id)).toMatchObject({ draftCount: 5, draftsToEdit: 3, approvedDraftCount: 1, pendingDraftApprovals: 1 });
  }));
  it("does not mistake a draft-only, unpublished, superseded or archived plan for a current non-draft-only plan", async () => using(async f => {
    await campaign(f); await campaign(f, "approval_required"); await campaign(f, "fully_autonomous", "draft"); await campaign(f, "approval_required", "superseded");
    const archived = await campaign(f, "approval_required"); await sql`UPDATE campaign SET status='archived' WHERE id=${archived.id}`;
    expect(await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id)).toMatchObject({ campaignCount: 4, draftOnlyPlanCount: 1, otherPublishedPlanCount: 1, runCount: 0 });
  }));
  it("classifies persisted run states and pending workflow requests without asserting delivery", async () => using(async f => {
    const c = await campaign(f, "approval_required");
    for (const status of ["awaiting_approval", "scheduled", "active", "paused", "completed", "failed", "canceled"]) {
      const id = randomUUID();
      await sql`INSERT INTO campaign_instance(id,workspace_id,campaign_id,campaign_version_id,status,requested_by)
        VALUES (${id},${f.workspace.workspaceId},${c.id},${c.versionId},${status},${f.user.id})`;
      await sql`INSERT INTO campaign_approval(id,workspace_id,campaign_instance_id,status,request_snapshot,requested_by)
        VALUES (${randomUUID()},${f.workspace.workspaceId},${id},${status === "awaiting_approval" ? "pending" : "approved"},'{}',${f.user.id})`;
    }
    expect(await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id)).toMatchObject({ runCount: 7, openRunCount: 4, attentionRunCount: 2, completedRunCount: 1, pendingWorkflowApprovals: 1 });
  }));
  it("runs under a database-enforced read-only transaction and does not alter state or audit", async () => using(async f => {
    await content(f);
    const before = await sql`SELECT id,event_type,data FROM audit_event WHERE workspace_id=${f.workspace.workspaceId} ORDER BY id`;
    await sql.begin("read only", async tx => {
      const reader = new WorkspaceStartRepository(tx as unknown as DatabaseClient);
      expect(await reader.getSnapshot(f.workspace.workspaceId, f.user.id)).toMatchObject({ packageCount: 1, runCount: 0 });
    });
    expect(await sql`SELECT id,event_type,data FROM audit_event WHERE workspace_id=${f.workspace.workspaceId} ORDER BY id`).toEqual(before);
  }));
  it("rejects malformed identities before issuing a query and propagates database failure", async () => {
    const broken = (() => { throw new Error("synthetic database unavailable"); }) as unknown as DatabaseClient;
    const reader = new WorkspaceStartRepository(broken);
    await expect(reader.getSnapshot("invalid", randomUUID())).rejects.toThrow("valid workspace");
    await expect(reader.getSnapshot(randomUUID(), randomUUID())).rejects.toThrow("synthetic database unavailable");
  });
});
