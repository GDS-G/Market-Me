import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PACKAGE_STATUSES } from "@market-me/domain";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { ContentCatalogRepository } from "./content-catalog-repository";
import { normalizeContentCatalogQuery } from "./content-catalog-models";
const url = process.env.DATABASE_URL;
if (url && new URL(url).pathname !== "/market_me_ci" && !new URL(url).pathname.startsWith("/market_me_qa_147_")) throw new Error("Catalog tests require isolated market_me_ci or market_me_qa_147_*.");
let sql: DatabaseClient;
async function fixture() {
  const core = new MarketMeRepository(sql), { user, workspace } = await core.bootstrapDevelopmentWorkspace({ email: `catalog-${randomUUID()}@market-me.local`, displayName: "Synthetic catalog QA" });
  const source = await core.createSmartSource({ workspaceId: workspace.workspaceId, name: "Synthetic catalog source", provider: "local", locations: [{ providerLocationId: randomUUID(), displayPath: "/Synthetic" }], recursive: true, readinessMode: "immediate", stabilizationWindowSeconds: 30, allowedMimeTypes: [], ignorePatterns: [], contextPackIds: [], autonomyMode: "draft_only", enabled: false }, user.id);
  return { user, workspace, source, repository: new ContentCatalogRepository(sql), cleanup: async () => { await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`; await sql`DELETE FROM app_user WHERE id=${user.id}`; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function using(run: (f: Fixture) => Promise<void>) { const f = await fixture(); try { await run(f); } finally { await f.cleanup(); } }
async function pkg(f: Fixture, options: { title?: string; status?: string; time?: string; files?: string[] } = {}) {
  const root = randomUUID(), id = randomUUID();
  await sql`INSERT INTO source_item(id,workspace_id,smart_source_id,provider_item_id,name,display_path,mime_type,is_folder) VALUES (${root},${f.workspace.workspaceId},${f.source.id},${root},'root.txt','/Synthetic/root.txt','text/plain',false)`;
  await sql`INSERT INTO content_package(id,workspace_id,smart_source_id,root_source_item_id,title,status,confidence,updated_at) VALUES (${id},${f.workspace.workspaceId},${f.source.id},${root},${options.title ?? "Synthetic package"},${options.status ?? "needs_review"},0.75,${options.time ?? "2026-10-02T05:00:00.123456Z"}::text::timestamptz)`;
  for (const name of options.files ?? []) await sql`INSERT INTO content_asset(id,content_package_id,role,file_name,mime_type,content_hash,extracted_text,extraction_status,metadata) VALUES (${randomUUID()},${id},'original',${name},'text/plain','synthetic-hash','private extracted document','completed','{"private":"metadata"}')`;
  await sql`INSERT INTO evidence_item(id,content_package_id,claim,provenance,source_references) VALUES (${randomUUID()},${id},'private evidence claim','observed','{}')`;
  return { id, root };
}
describe.skipIf(!url)("authorized lightweight content catalog", () => {
  beforeAll(() => { sql = createDatabaseClient(url!); }); afterAll(async () => { await sql?.end(); });
  it.each(["owner", "admin", "editor", "approver", "analyst", "viewer"])("allows current %s membership and observes subsequent revocation", async role => using(async f => {
    await pkg(f); await sql`UPDATE workspace_membership SET role=${role} WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`;
    expect((await f.repository.getPage(f.workspace.workspaceId, f.user.id))?.totalMatches).toBe("1");
    await sql`UPDATE workspace_membership SET revoked_at=clock_timestamp() WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`; expect(await f.repository.getPage(f.workspace.workspaceId, f.user.id)).toBeUndefined();
  }));
  it("returns genuine empty metadata but denies organization-only/foreign scope", async () => using(async f => {
    const result = await f.repository.getPage(f.workspace.workspaceId, f.user.id); expect(result).toMatchObject({ totalPackages: "0", totalMatches: "0", items: [], nextCursor: null, filters: { query: "", status: null } });
    await using(async other => { await pkg(other); expect(await f.repository.getPage(other.workspace.workspaceId, f.user.id)).toBeUndefined(); });
    await sql`UPDATE workspace_membership SET revoked_at=clock_timestamp() WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`; expect(await f.repository.getPage(f.workspace.workspaceId, f.user.id)).toBeUndefined();
  }));
  it("matches literal title/filename substrings without reading private bodies or treating SQL/wildcards as syntax", async () => using(async f => {
    const a = await pkg(f, { title: "Café launch_100%", files: ["Brand quote'\\Guide.txt"] }); await pkg(f, { title: "Other package", files: ["sale.pdf"] });
    for (const query of ["CAFÉ", "_100%", "quote'\\", "guide.TXT", "%"]) { const result = await f.repository.getPage(f.workspace.workspaceId, f.user.id, { query }); expect(result?.totalPackages).toBe("2"); expect(result?.items.map(row => row.id)).toEqual([a.id]); }
    for (const query of ["private extracted", "private evidence", "' OR true --", "absent"]) expect((await f.repository.getPage(f.workspace.workspaceId, f.user.id, { query }))?.totalMatches).toBe("0");
  }));
  it("filters every existing status and keeps total catalog count separate", async () => using(async f => {
    for (const status of PACKAGE_STATUSES) await pkg(f, { title: status, status });
    for (const status of PACKAGE_STATUSES) { const result = await f.repository.getPage(f.workspace.workspaceId, f.user.id, { status }); expect(result?.totalPackages).toBe(String(PACKAGE_STATUSES.length)); expect(result?.totalMatches).toBe("1"); expect(result?.items[0].status).toBe(status); }
  }));
  it("pages tied microsecond timestamps deterministically without repeats and retains complete counts", async () => using(async f => {
    const ids = []; for (let i = 0; i < 65; i++) ids.push((await pkg(f, { title: `Page ${i}` })).id);
    const first = (await f.repository.getPage(f.workspace.workspaceId, f.user.id))!; expect(first.items).toHaveLength(30); expect(first.totalMatches).toBe("65");
    const cursor = normalizeContentCatalogQuery(f.workspace.workspaceId, { cursor: first.nextCursor! }).cursor!; expect(cursor.at).toBe("2026-10-02T05:00:00.123456Z");
    const second = (await f.repository.getPage(f.workspace.workspaceId, f.user.id, { cursor: first.nextCursor! }))!, third = (await f.repository.getPage(f.workspace.workspaceId, f.user.id, { cursor: second.nextCursor! }))!;
    expect(second.items).toHaveLength(30); expect(third.items).toHaveLength(5); expect(third.nextCursor).toBeNull(); expect(third.totalMatches).toBe("65");
    expect([...first.items, ...second.items, ...third.items].map(row => row.id)).toEqual(ids.sort().reverse());
  }));
  it("does not lose adjacent records whose timestamps differ only below millisecond precision", async () => using(async f => {
    const older = await pkg(f, { time: "2026-10-02T05:00:00.123455Z" }); for (let i = 0; i < 30; i++) await pkg(f);
    const first = (await f.repository.getPage(f.workspace.workspaceId, f.user.id))!, next = (await f.repository.getPage(f.workspace.workspaceId, f.user.id, { cursor: first.nextCursor! }))!;
    expect(next.items.map(row => row.id)).toEqual([older.id]); expect(next.items[0].updatedAt).toBe("2026-10-02T05:00:00.123455Z");
  }));
  it("bounds filename previews but matches filenames outside the preview and omits all private details", async () => using(async f => {
    const p = await pkg(f, { files: ["a.txt", "b.txt", "c.txt", "d.txt", "last-special.txt"] }); const result = (await f.repository.getPage(f.workspace.workspaceId, f.user.id, { query: "last-special" }))!;
    expect(result.items[0]).toMatchObject({ id: p.id, assetCount: "5", evidenceCount: "1", fileNames: ["a.txt", "b.txt", "c.txt"] });
    const serialized = JSON.stringify(result); for (const secret of ["private extracted", "private evidence", "synthetic-hash", "metadata", "source_references", "storage"]) expect(serialized).not.toContain(secret);
  }));
  it("excludes corrupt cross-workspace source/root/asset lineage without modifying it", async () => using(async f => using(async other => {
    const p = await pkg(f), foreign = await pkg(other, { files: ["foreign-name.txt"] });
    await sql`INSERT INTO content_asset(id,content_package_id,source_item_id,role,file_name,mime_type,content_hash,extraction_status) VALUES (${randomUUID()},${p.id},${foreign.root},'original','foreign-secret.txt','text/plain','x','skipped')`;
    expect((await f.repository.getPage(f.workspace.workspaceId, f.user.id, { query: "foreign-secret" }))?.totalMatches).toBe("0"); expect((await f.repository.getPage(f.workspace.workspaceId, f.user.id))?.items[0].assetCount).toBe("0");
    await sql`UPDATE content_package SET root_source_item_id=${foreign.root} WHERE id=${p.id}`; expect((await f.repository.getPage(f.workspace.workspaceId, f.user.id))?.totalPackages).toBe("0");
    await sql`UPDATE content_package SET root_source_item_id=${p.root},smart_source_id=${other.source.id} WHERE id=${p.id}`; expect((await f.repository.getPage(f.workspace.workspaceId, f.user.id))?.totalPackages).toBe("0");
  })));
  it("supports a PostgreSQL READ ONLY transaction, proving no catalog writes", async () => using(async f => {
    await pkg(f); await sql.begin(async tx => { await tx`SET TRANSACTION READ ONLY`; const result = await new ContentCatalogRepository(tx as unknown as DatabaseClient).getPage(f.workspace.workspaceId, f.user.id, { query: "Synthetic" }); expect(result?.totalMatches).toBe("1"); });
  }));
});
