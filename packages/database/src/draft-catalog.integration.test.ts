import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DRAFT_STATUSES } from "@market-me/domain";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { CampaignRepository } from "./campaign-repository";
import { DraftCatalogRepository } from "./draft-catalog-repository";
import { normalizeDraftCatalogQuery } from "./draft-catalog-models";
import { packageReviewPrecondition } from "./test-support/package-review-fixture";
const url = process.env.DATABASE_URL;
if (url && new URL(url).pathname !== "/market_me_ci" && !new URL(url).pathname.startsWith("/market_me_qa_148_")) throw new Error("Draft catalog tests require isolated market_me_ci or market_me_qa_148_*.");
let sql: DatabaseClient;
async function fixture() {
  const core = new MarketMeRepository(sql), campaigns = new CampaignRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({ email: `draft-catalog-${randomUUID()}@market-me.local`, displayName: "Synthetic draft catalog QA" });
  const source = await core.createSmartSource({ workspaceId: workspace.workspaceId, name: "Synthetic draft source", provider: "local", locations: [{ providerLocationId: randomUUID(), displayPath: "/Synthetic" }], recursive: true, readinessMode: "immediate", stabilizationWindowSeconds: 30, allowedMimeTypes: [], ignorePatterns: [], contextPackIds: [], autonomyMode: "draft_only", enabled: false }, user.id);
  const root = randomUUID();
  await sql`INSERT INTO source_item(id,workspace_id,smart_source_id,provider_item_id,name,display_path,mime_type,is_folder) VALUES (${root},${workspace.workspaceId},${source.id},${root},'facts.txt','/Synthetic/facts.txt','text/plain',false)`;
  const pkg = await core.saveContentPackage({ workspaceId: workspace.workspaceId, smartSourceId: source.id, rootSourceItemId: root, title: "Café source package", status: "ready", contextPackVersionIds: [], assets: [], conflicts: [], evidence: [{ id: randomUUID(), claim: "Synthetic private evidence.", provenance: "observed", sourceReferences: [`source-item:${root}`], confidence: 1 }] });
  await core.approveContentPackage({ ...await packageReviewPrecondition(sql, workspace.workspaceId, pkg.id, user.id), idempotencyKey: randomUUID(), workspaceId: workspace.workspaceId, packageId: pkg.id, actorUserId: user.id });
  const campaign = await campaigns.createCampaign({ workspaceId: workspace.workspaceId, name: "Community plan", description: "Synthetic", objective: "awareness", contentPackageIds: [pkg.id], audienceProfileVersionIds: [], informationDepth: "contextual", promotionalStrength: "informational", autonomyMode: "draft_only", timezone: "UTC", context: {}, steps: [{ id: "review", name: "Manual review", operationType: "manual_handoff", desiredCapability: "manual.handoff", dependsOn: [], inputs: {}, outputs: {}, executionMethods: ["manual_handoff"], approvalRequired: true }] }, user.id);
  const published = (await campaigns.publishCampaign(workspace.workspaceId, campaign.id))!, generationId = randomUUID();
  await sql`INSERT INTO draft_generation(id,workspace_id,campaign_version_id,content_package_id,content_package_version,information_depth,promotional_strength,evidence_snapshot,generator_provider,generator_model,generator_version,prompt_version,created_by,content_package_approval_id)
    SELECT ${generationId},p.workspace_id,${published.currentVersion!.id},p.id,p.version,'contextual','informational',content_package_approval_generation_evidence(a.canonical_review_snapshot::jsonb,a.effective_evidence_ids),'synthetic','synthetic','1','1',${user.id},a.id
    FROM content_package p JOIN content_package_approval a ON a.id=p.current_approval_id WHERE p.id=${pkg.id}`;
  const audienceId = randomUUID(), audienceVersionId = randomUUID();
  await sql`INSERT INTO audience_profile(id,workspace_id,name,created_by) VALUES (${audienceId},${workspace.workspaceId},'Members audience',${user.id})`;
  await sql`INSERT INTO audience_profile_version(id,audience_profile_id,version_number,status,audience_type,profile,created_by) VALUES (${audienceVersionId},${audienceId},1,'published','community','{"private":"profile"}',${user.id})`;
  return { user, workspace, pkg, campaign, generationId, audienceVersionId, repository: new DraftCatalogRepository(sql), cleanup: async () => { await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`; await sql`DELETE FROM app_user WHERE id=${user.id}`; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function using(run: (f: Fixture) => Promise<void>) { const f = await fixture(); try { await run(f); } finally { await f.cleanup(); } }
async function draft(f: Fixture, options: { headline?: string; body?: string; status?: string; time?: string; audience?: string; generation?: string } = {}) {
  const id = randomUUID(), versionId = randomUUID(), generationId = randomUUID();
  // Every synthetic variant has a distinct genuine proof-bearing generation;
  // production permits only one General variant in each generation.
  await sql`INSERT INTO draft_generation(id,workspace_id,campaign_version_id,content_package_id,content_package_version,information_depth,promotional_strength,evidence_snapshot,generator_provider,generator_model,generator_version,prompt_version,created_by,content_package_approval_id)
    SELECT ${generationId},workspace_id,campaign_version_id,content_package_id,content_package_version,information_depth,promotional_strength,evidence_snapshot,generator_provider,generator_model,generator_version,prompt_version,created_by,content_package_approval_id FROM draft_generation WHERE id=${options.generation ?? f.generationId}`;
  await sql`INSERT INTO content_draft(id,workspace_id,draft_generation_id,audience_profile_version_id,status,created_by,updated_at) VALUES (${id},${f.workspace.workspaceId},${generationId},${options.audience ?? null},${options.status ?? "working"},${f.user.id},${options.time ?? "2026-10-02T05:00:00.123456Z"}::text::timestamptz)`;
  await sql`INSERT INTO content_draft_version(id,content_draft_id,version_number,headline,body,rationale,presentation_choices,created_by) VALUES (${versionId},${id},1,${options.headline ?? "Synthetic headline"},${options.body ?? "Synthetic draft body"},'private rationale','{"private":"presentation"}',${f.user.id})`;
  await sql`UPDATE content_draft SET current_version_id=${versionId} WHERE id=${id}`;
  return { id, versionId };
}
describe.skipIf(!url)("current-member draft catalog", () => {
  beforeAll(() => { sql = createDatabaseClient(url!); }); afterAll(async () => { await sql?.end(); });
  it.each(["owner", "admin", "editor", "approver", "analyst", "viewer"])("allows current %s access and observes revocation", async role => using(async f => {
    await draft(f); await sql`UPDATE workspace_membership SET role=${role} WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`;
    expect((await f.repository.getPage(f.workspace.workspaceId, f.user.id))?.totalDrafts).toBe("1");
    await sql`DELETE FROM workspace_membership WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`; expect(await f.repository.getPage(f.workspace.workspaceId, f.user.id)).toBeUndefined();
  }));
  it("distinguishes genuine empty from absent and foreign scope", async () => using(async f => {
    expect(await f.repository.getPage(f.workspace.workspaceId, f.user.id)).toMatchObject({ totalDrafts: "0", totalMatches: "0", items: [], nextCursor: null });
    await using(async other => { await draft(other); expect(await f.repository.getPage(other.workspace.workspaceId, f.user.id)).toBeUndefined(); });
  }));
  it("searches literal current copy and labels, not historical versions or private metadata", async () => using(async f => {
    const a = await draft(f, { headline: "Launch_100%", body: "Quote'\\ and CAFÉ copy", audience: f.audienceVersionId }); await draft(f, { headline: "Other headline", body: "Other body" });
    for (const query of ["_100%", "quote'\\", "CAFÉ copy", "Members audience"]) expect((await f.repository.getPage(f.workspace.workspaceId, f.user.id, { query }))?.items.map(x => x.id)).toEqual([a.id]);
    for (const query of ["café source", "community plan"]) expect((await f.repository.getPage(f.workspace.workspaceId, f.user.id, { query }))?.totalMatches).toBe("2");
    await sql`INSERT INTO content_draft_version(id,content_draft_id,version_number,status,headline,body,rationale,created_by) VALUES (${randomUUID()},${a.id},2,'superseded','Historical-only headline','Historical-only body','private rationale',${f.user.id})`;
    for (const query of ["Historical-only", "private rationale", "private evidence", "' OR true --"]) expect((await f.repository.getPage(f.workspace.workspaceId, f.user.id, { query }))?.totalMatches).toBe("0");
  }));
  it("filters every recorded draft status while preserving total coverage", async () => using(async f => {
    for (const status of DRAFT_STATUSES) await draft(f, { status });
    for (const status of DRAFT_STATUSES) expect(await f.repository.getPage(f.workspace.workspaceId, f.user.id, { status })).toMatchObject({ totalDrafts: "6", totalMatches: "1", items: [{ status }] });
  }));
  it("matches outside a code-point-safe excerpt and distinguishes General from a named audience", async () => using(async f => {
    const body = "😀".repeat(320) + "end-marker", p = await draft(f, { body });
    const result = (await f.repository.getPage(f.workspace.workspaceId, f.user.id, { query: "end-marker" }))!;
    expect(result.items[0]).toMatchObject({ id: p.id, bodyPreview: "😀".repeat(320), bodyCharacters: "330", bodyTruncated: true, audienceName: null });
    const a = await draft(f, { audience: f.audienceVersionId, body: "short" });
    const named = (await f.repository.getPage(f.workspace.workspaceId, f.user.id, { query: "short" }))!;
    expect(named.items[0]).toMatchObject({ id: a.id, bodyPreview: "short", bodyCharacters: "5", bodyTruncated: false, audienceName: "Members audience" });
    for (const privateValue of ["private rationale", "private evidence", "presentation", "evidenceSnapshot", "claim", "profile"]) expect(JSON.stringify(result)).not.toContain(privateValue);
  }));
  it("pages65 tied microsecond records without gaps or duplicates", async () => using(async f => {
    const ids = []; for (let i = 0; i < 65; i++) ids.push((await draft(f)).id);
    const first = (await f.repository.getPage(f.workspace.workspaceId, f.user.id))!;
    expect(normalizeDraftCatalogQuery(f.workspace.workspaceId, { cursor: first.nextCursor! }).cursor?.at).toBe("2026-10-02T05:00:00.123456Z");
    const second = (await f.repository.getPage(f.workspace.workspaceId, f.user.id, { cursor: first.nextCursor! }))!, third = (await f.repository.getPage(f.workspace.workspaceId, f.user.id, { cursor: second.nextCursor! }))!;
    expect([first.items.length, second.items.length, third.items.length]).toEqual([30, 30, 5]); expect(third.nextCursor).toBeNull(); expect(third.totalMatches).toBe("65");
    expect([...first.items, ...second.items, ...third.items].map(x => x.id)).toEqual(ids.sort().reverse());
  }));
  it("preserves a one-microsecond difference across the page boundary", async () => using(async f => {
    const old = await draft(f, { time: "2026-10-02T05:00:00.123455Z" }); for (let i = 0; i < 30; i++) await draft(f);
    const first = (await f.repository.getPage(f.workspace.workspaceId, f.user.id))!, next = (await f.repository.getPage(f.workspace.workspaceId, f.user.id, { cursor: first.nextCursor! }))!;
    expect(next.items.map(x => x.id)).toEqual([old.id]); expect(next.items[0].updatedAt).toBe("2026-10-02T05:00:00.123455Z");
  }));
  it("excludes foreign generation/audience and mismatched current-version lineage", async () => using(async f => using(async other => {
    const good = await draft(f), foreign = await draft(other);
    await draft(f, { generation: other.generationId });
    const foreignAudience = await draft(f, { audience: other.audienceVersionId });
    expect((await f.repository.getPage(f.workspace.workspaceId, f.user.id))?.items.map(x => x.id)).toEqual([good.id]);
    await sql`UPDATE content_draft SET current_version_id=${foreign.versionId} WHERE id=${good.id}`; expect((await f.repository.getPage(f.workspace.workspaceId, f.user.id))?.totalDrafts).toBe("0");
    await sql`UPDATE content_draft SET audience_profile_version_id=NULL WHERE id=${foreignAudience.id}`;
  })));
  it("executes successfully inside READ ONLY SQL", async () => using(async f => {
    await draft(f); await sql.begin(async tx => { await tx`SET TRANSACTION READ ONLY`; expect((await new DraftCatalogRepository(tx as unknown as DatabaseClient).getPage(f.workspace.workspaceId, f.user.id))?.totalMatches).toBe("1"); });
  }));
});
