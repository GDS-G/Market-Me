import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { AssetCatalogRepository } from "./asset-catalog-repository";
import { ASSET_CATALOG_ROLES, normalizeAssetCatalogQuery } from "./asset-catalog-models";
const url = process.env.DATABASE_URL;
if (url && new URL(url).pathname !== "/market_me_ci" && !new URL(url).pathname.startsWith("/market_me_qa_149_")) throw new Error("Asset catalog tests require isolated market_me_ci or market_me_qa_149_*.");
let sql: DatabaseClient;
async function fixture() {
  const core = new MarketMeRepository(sql), { user, workspace } = await core.bootstrapDevelopmentWorkspace({ email: `assets-${randomUUID()}@market-me.local`, displayName: "Synthetic asset QA" });
  const source = await core.createSmartSource({ workspaceId: workspace.workspaceId, name: "Synthetic asset source", provider: "local", locations: [{ providerLocationId: randomUUID(), displayPath: "/Synthetic" }], recursive: true, readinessMode: "immediate", stabilizationWindowSeconds: 30, allowedMimeTypes: [], ignorePatterns: [], contextPackIds: [], autonomyMode: "draft_only", enabled: false }, user.id);
  const root = randomUUID(), packageId = randomUUID();
  await sql`INSERT INTO source_item(id,workspace_id,smart_source_id,provider_item_id,name,display_path,mime_type,is_folder) VALUES (${root},${workspace.workspaceId},${source.id},${root},'root.txt','/Synthetic/root.txt','text/plain',false)`;
  await sql`INSERT INTO content_package(id,workspace_id,smart_source_id,root_source_item_id,title,status) VALUES (${packageId},${workspace.workspaceId},${source.id},${root},'Café source package','needs_review')`;
  return { user, workspace, source, root, packageId, repository: new AssetCatalogRepository(sql), cleanup: async () => { await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`; await sql`DELETE FROM app_user WHERE id=${user.id}`; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function using(run: (f: Fixture) => Promise<void>) { const f = await fixture(); try { await run(f); } finally { await f.cleanup(); } }
async function asset(f: Fixture, options: { name?: string; role?: string; mime?: string; bytes?: string | null; time?: string; source?: string | null; parent?: string | null } = {}) {
  const id = randomUUID();
  await sql`INSERT INTO content_asset(id,content_package_id,source_item_id,source_asset_id,role,file_name,mime_type,byte_size,content_hash,extracted_text,extraction_status,metadata,object_key,recipe,created_at)
    VALUES (${id},${f.packageId},${options.source ?? null},${options.parent ?? null},${options.role ?? "original"},${options.name ?? "Synthetic.txt"},${options.mime ?? "text/plain"},${options.bytes ?? null}::text::bigint,
    'private-hash','private extracted body','completed','{"private":"metadata"}','private/object/key','{"private":"recipe"}',${options.time ?? "2026-10-02T05:00:00.123456Z"}::text::timestamptz)`;
  return id;
}
describe.skipIf(!url)("current-member metadata-only asset catalog", () => {
  beforeAll(() => { sql = createDatabaseClient(url!); }); afterAll(async () => { await sql?.end(); });
  it.each(["owner", "admin", "editor", "approver", "analyst", "viewer"])("allows current %s and observes subsequent revocation", async role => using(async f => {
    await asset(f); await sql`UPDATE workspace_membership SET role=${role} WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`;
    expect((await f.repository.getPage(f.workspace.workspaceId, f.user.id))?.totalAssets).toBe("1");
    await sql`UPDATE workspace_membership SET revoked_at=clock_timestamp() WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`; expect(await f.repository.getPage(f.workspace.workspaceId, f.user.id)).toBeUndefined();
  }));
  it("distinguishes an empty inventory from inaccessible or organization-only scope", async () => using(async f => {
    expect(await f.repository.getPage(f.workspace.workspaceId, f.user.id)).toMatchObject({ totalAssets: "0", totalMatches: "0", items: [], nextCursor: null, filters: { query: "", role: null } });
    await using(async other => { await asset(other); expect(await f.repository.getPage(other.workspace.workspaceId, f.user.id)).toBeUndefined(); });
    await sql`UPDATE workspace_membership SET revoked_at=clock_timestamp() WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`; expect(await f.repository.getPage(f.workspace.workspaceId, f.user.id)).toBeUndefined();
  }));
  it("searches literal filenames, MIME and package titles, not private bodies or keys", async () => using(async f => {
    const a = await asset(f, { name: "Quote'\\launch_100%.PDF", mime: "application/pdf" }); await asset(f, { name: "Other.txt" });
    for (const query of ["quote'\\", "_100%", "APPLICATION/PDF"]) { const page = await f.repository.getPage(f.workspace.workspaceId, f.user.id, { query }); expect(page?.totalAssets).toBe("2"); expect(page?.items.map(i => i.id)).toEqual([a]); }
    expect((await f.repository.getPage(f.workspace.workspaceId, f.user.id, { query: "CAFÉ" }))?.totalMatches).toBe("2");
    for (const query of ["private extracted", "private/object", "private-hash", "' OR true --"]) expect((await f.repository.getPage(f.workspace.workspaceId, f.user.id, { query }))?.totalMatches).toBe("0");
  }));
  it("filters the three existing roles with complete independent totals", async () => using(async f => {
    for (const role of ASSET_CATALOG_ROLES) await asset(f, { role });
    for (const role of ASSET_CATALOG_ROLES) { const page = await f.repository.getPage(f.workspace.workspaceId, f.user.id, { role }); expect(page?.totalAssets).toBe("3"); expect(page?.totalMatches).toBe("1"); expect(page?.items[0].role).toBe(role); }
  }));
  it("preserves null, zero and beyond-safe-integer byte sizes without exposing private fields", async () => using(async f => {
    const ids = [await asset(f), await asset(f, { bytes: "0" }), await asset(f, { bytes: "9007199254740995" })];
    const page = (await f.repository.getPage(f.workspace.workspaceId, f.user.id))!;
    expect(ids.map(id => page.items.find(i => i.id === id)?.byteSize)).toEqual([null, "0", "9007199254740995"]);
    expect(Object.keys(page.items[0]).sort()).toEqual(["id", "packageId", "packageTitle", "fileName", "mimeType", "role", "byteSize", "createdAt", "extractionStatus", "mediaStatus", "scanStatus", "rightsStatus"].sort());
    expect(JSON.stringify(page)).not.toContain("private"); expect(JSON.stringify(page)).not.toContain("objectKey"); expect(page.items[0].createdAt).toBe("2026-10-02T05:00:00.123456Z");
  }));
  it("pages65 tied added times deterministically and never calls them update times", async () => using(async f => {
    const ids = []; for (let i=0;i<65;i++) ids.push(await asset(f, { name: `Page${i}` }));
    const first = (await f.repository.getPage(f.workspace.workspaceId, f.user.id))!, second = (await f.repository.getPage(f.workspace.workspaceId, f.user.id, { cursor: first.nextCursor! }))!, third = (await f.repository.getPage(f.workspace.workspaceId, f.user.id, { cursor: second.nextCursor! }))!;
    expect([first.items.length, second.items.length, third.items.length]).toEqual([30,30,5]); expect(third.nextCursor).toBeNull();
    expect([...first.items,...second.items,...third.items].map(i=>i.id)).toEqual(ids.sort().reverse()); expect(third.totalMatches).toBe("65");
    expect(normalizeAssetCatalogQuery(f.workspace.workspaceId, { cursor: first.nextCursor! }).cursor?.at).toBe("2026-10-02T05:00:00.123456Z"); expect(JSON.stringify(first)).not.toContain("updatedAt");
  }));
  it("retains adjacent microseconds across an exclusive page boundary", async () => using(async f => {
    for (let i=0;i<30;i++) await asset(f); const older=await asset(f,{time:"2026-10-02T05:00:00.123455Z"});
    const first=(await f.repository.getPage(f.workspace.workspaceId,f.user.id))!, next=(await f.repository.getPage(f.workspace.workspaceId,f.user.id,{cursor:first.nextCursor!}))!;
    expect(next.items.map(i=>i.id)).toEqual([older]); expect(next.items[0].createdAt).toBe("2026-10-02T05:00:00.123455Z");
  }));
  it("excludes foreign source-item and immediate-parent lineage while admitting null and same-workspace references", async () => using(async f => using(async other => {
    const own = await asset(f), parent = await asset(other); await asset(f,{source:other.root}); await asset(f,{parent}); const linked=await asset(f,{parent:own,source:f.root});
    const page=(await f.repository.getPage(f.workspace.workspaceId,f.user.id))!; expect(page.totalAssets).toBe("2"); expect(new Set(page.items.map(i=>i.id))).toEqual(new Set([own,linked]));
  })));
  it("excludes mismatched package root/source workspace lineage", async () => using(async f => using(async other => {
    await asset(f); await sql`UPDATE content_package SET root_source_item_id=${other.root} WHERE id=${f.packageId}`;
    expect((await f.repository.getPage(f.workspace.workspaceId,f.user.id))?.totalAssets).toBe("0");
  })));
  it("returns stored states without inventing safety or rights clearance", async () => using(async f => {
    const id=await asset(f); await sql`UPDATE content_asset SET extraction_status='failed',media_status='failed',scan_status='infected',rights_status='restricted' WHERE id=${id}`;
    expect((await f.repository.getPage(f.workspace.workspaceId,f.user.id))?.items[0]).toMatchObject({extractionStatus:"failed",mediaStatus:"failed",scanStatus:"infected",rightsStatus:"restricted"});
  }));
  it("executes under a read-only transaction without writes or provider work", async () => using(async f => {
    await asset(f); await sql.begin(async tx=>{await tx`SET TRANSACTION READ ONLY`; expect((await new AssetCatalogRepository(tx as unknown as DatabaseClient).getPage(f.workspace.workspaceId,f.user.id))?.totalAssets).toBe("1");});
  }));
});
