import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { SourceSetupRepository } from "./source-setup-repository";
import { SourceSampleRepository } from "./source-sample-repository";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl && new URL(databaseUrl).pathname !== "/market_me_ci" && !new URL(databaseUrl).pathname.startsWith("/market_me_qa_129_")) {
  throw new Error("Source sample tests require isolated market_me_ci or market_me_qa_129_* databases.");
}
let sql: DatabaseClient;
async function fixture() {
  const core = new MarketMeRepository(sql), samples = new SourceSampleRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({ email: `sample-qa-${randomUUID()}@market-me.local`, displayName: "Sample QA" });
  const workerId = randomUUID(), packId = randomUUID(), versionId = randomUUID();
  const cleanup = async () => { await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`; await sql`DELETE FROM app_user WHERE id=${user.id}`; };
  try {
  await sql`INSERT INTO browser_worker(id,workspace_id,name,platform,architecture,app_version,token_prefix,token_hash)
    VALUES (${workerId},${workspace.workspaceId},'Sample desktop','windows','x86_64','qa','qa',${randomUUID()})`;
  await sql`INSERT INTO context_pack(id,workspace_id,name,status,created_by) VALUES (${packId},${workspace.workspaceId},'Sample context','published',${user.id})`;
  await sql`INSERT INTO context_pack_version(id,context_pack_id,version_number,status,instructions,created_by)
    VALUES (${versionId},${packId},1,'published','Never return private instructions',${user.id})`;
  await sql`UPDATE context_pack SET current_version_id=${versionId} WHERE id=${packId}`;
  const { receipt } = await new SourceSetupRepository(sql).create({ workspaceId: workspace.workspaceId, requestId: randomUUID(), name: "Paused sample", provider: "local",
    location: { providerLocationId: workerId, displayPath: "Approved desktop folder" }, recursive: true, readinessMode: "immediate",
    stabilizationWindowSeconds: 120, fileTypes: ["documents"], ignoredFolders: [], contextPacks: [{ id: packId, expectedVersionId: versionId }], autonomyMode: "approval_required" }, user.id);
  const input = { workspaceId: workspace.workspaceId, smartSourceId: receipt.smartSourceId, expectedSourceVersion: 1, locationIndex: 0 };
  return { core, samples, user, workspace, workerId, packId, versionId, input,
    cleanup };
  } catch (error) { await cleanup(); throw error; }
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function using(run: (fixture: Fixture) => Promise<void>) { const f = await fixture(); try { await run(f); } finally { await f.cleanup(); } }
async function counts(workspaceId: string) {
  return (await sql`SELECT
    (SELECT count(*)::int FROM audit_event WHERE workspace_id=${workspaceId}) AS audits,
    (SELECT count(*)::int FROM source_item WHERE workspace_id=${workspaceId}) AS items,
    (SELECT count(*)::int FROM ingestion_event WHERE workspace_id=${workspaceId}) AS events,
    (SELECT count(*)::int FROM smart_source_test_run WHERE smart_source_id IN (SELECT id FROM smart_source WHERE workspace_id=${workspaceId})) AS tests,
    (SELECT count(*)::int FROM content_package WHERE workspace_id=${workspaceId}) AS packages,
    (SELECT count(*)::int FROM campaign WHERE workspace_id=${workspaceId}) AS campaigns,
    (SELECT count(*)::int FROM source_preparation_command WHERE workspace_id=${workspaceId}) AS commands`)[0];
}

describe.skipIf(!databaseUrl)("read-only source sample captures", () => {
  beforeAll(() => { sql = createDatabaseClient(databaseUrl!); });
  afterAll(async () => { await sql?.end(); });
  it("captures paused configuration and published context with no persistence or private context text", async () => using(async (f) => {
    const before = await counts(f.workspace.workspaceId);
    const captured = await f.samples.capture(f.input, f.user.id);
    expect(captured).toMatchObject({ source: { enabled: false, version: 1 }, preparation: null, localItems: [], localTruncated: false,
      context: { packs: [{ name: "Sample context", versionNumber: 1 }], facts: [], unresolvedRecordedFacts: 0 } });
    expect(JSON.stringify(captured)).not.toContain("Never return private instructions");
    await f.samples.assertUnchanged(f.input, f.user.id, captured.fingerprint);
    expect(await counts(f.workspace.workspaceId)).toEqual(before);
  }));
  it.each(["owner", "admin", "editor"])("admits a current %s", async (role) => using(async (f) => {
    await sql`UPDATE workspace_membership SET role=${role} WHERE workspace_id=${f.input.workspaceId} AND user_id=${f.user.id}`;
    expect((await f.samples.capture(f.input, f.user.id)).source.id).toBe(f.input.smartSourceId);
  }));
  it.each(["viewer", "analyst", "approver"])("blocks a current %s and membership loss on recheck", async (role) => using(async (f) => {
    const first = await f.samples.capture(f.input, f.user.id);
    await sql`UPDATE workspace_membership SET role=${role} WHERE workspace_id=${f.input.workspaceId} AND user_id=${f.user.id}`;
    await expect(f.samples.capture(f.input, f.user.id)).rejects.toMatchObject({ code: "access_denied" });
    await expect(f.samples.assertUnchanged(f.input, f.user.id, first.fingerprint)).rejects.toMatchObject({ code: "access_denied" });
  }));
  it("rejects foreign source/workspace/actor and malformed bounds", async () => using(async (f) => {
    await expect(f.samples.capture({ ...f.input, workspaceId: randomUUID() }, f.user.id)).rejects.toMatchObject({ code: "access_denied" });
    await expect(f.samples.capture({ ...f.input, smartSourceId: randomUUID() }, f.user.id)).rejects.toMatchObject({ code: "source_unavailable" });
    await expect(f.samples.capture(f.input, randomUUID())).rejects.toMatchObject({ code: "access_denied" });
    await expect(f.samples.capture({ ...f.input, workspaceId: "bad" }, f.user.id)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(f.samples.capture({ ...f.input, locationIndex: 20 }, f.user.id)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(f.samples.capture({ ...f.input, locationIndex: 1 }, f.user.id)).rejects.toMatchObject({ code: "source_changed" });
    await expect(f.samples.capture({ ...f.input, expectedSourceVersion: 0 }, f.user.id)).rejects.toMatchObject({ code: "invalid_input" });
  }));
  it("fails recheck for changed configuration even without a version increment", async () => using(async (f) => {
    const first = await f.samples.capture(f.input, f.user.id);
    await sql`UPDATE smart_source SET recursive=false WHERE id=${f.input.smartSourceId}`;
    await expect(f.samples.assertUnchanged(f.input, f.user.id, first.fingerprint)).rejects.toMatchObject({ code: "source_changed" });
    await sql`UPDATE smart_source SET version=version+1 WHERE id=${f.input.smartSourceId}`;
    await expect(f.samples.capture(f.input, f.user.id)).rejects.toMatchObject({ code: "source_changed" });
  }));
  it("refuses unavailable context and revoked desktop without touching the index", async () => using(async (f) => {
    await sql`UPDATE context_pack SET status='archived' WHERE id=${f.packId}`;
    await expect(f.samples.capture(f.input, f.user.id)).rejects.toMatchObject({ code: "reference_unavailable" });
    await sql`UPDATE context_pack SET status='published' WHERE id=${f.packId}`;
    await sql`UPDATE browser_worker SET status='revoked' WHERE id=${f.workerId}`;
    await expect(f.samples.capture(f.input, f.user.id)).rejects.toMatchObject({ code: "reference_unavailable" });
  }));
  it("refuses ambiguous multiple local locations", async () => using(async (f) => {
    await sql`INSERT INTO smart_source_location(id,smart_source_id,provider_location_id,display_path)
      VALUES (${randomUUID()},${f.input.smartSourceId},${randomUUID()},'Another desktop')`;
    await expect(f.samples.capture(f.input, f.user.id)).rejects.toMatchObject({ code: "sample_unsupported" });
  }));
  it("bounds and minimizes historical local metadata without changing any rows", async () => using(async (f) => {
    for (let index = 0; index < 201; index++) await sql`INSERT INTO source_item(id,workspace_id,smart_source_id,provider_item_id,provider_parent_id,name,display_path,mime_type,is_folder,modified_at,web_url)
      VALUES (${randomUUID()},${f.input.workspaceId},${f.input.smartSourceId},${`file-${index}`},'folder',${`file-${index}.txt`},${`/folder/file-${index}.txt`},'text/plain',false,'2026-09-01','private-url')`;
    const before = await counts(f.input.workspaceId), captured = await f.samples.capture(f.input, f.user.id);
    expect(captured.localItems).toHaveLength(200); expect(captured.localTruncated).toBe(true);
    expect(captured.localItems[0]).toMatchObject({ parentKey: "folder", modifiedAt: "2026-09-01T00:00:00.000Z" });
    expect(JSON.stringify(captured.localItems)).not.toContain("private-url");
    expect(await counts(f.input.workspaceId)).toEqual(before);
  }));
  it("computes structured context conflicts without disclosing values and detects subsequent edits", async () => using(async (f) => {
    for (const value of ["secret-one", "secret-two"]) {
      const sourceId = randomUUID();
      await sql`INSERT INTO context_pack_source(id,context_pack_version_id,source_kind,label,source_reference)
        VALUES (${sourceId},${f.versionId},'manual_text','Reference',${sourceId})`;
      await sql`INSERT INTO context_pack_fact(id,context_pack_version_id,fact_key,value_json,source_id,status)
        VALUES (${randomUUID()},${f.versionId},'product_name',${sql.json(value)},${sourceId},'accepted')`;
    }
    const captured = await f.samples.capture(f.input, f.user.id);
    expect(captured.context.facts).toEqual([{ factKey: "product_name", status: "conflicted", reason: expect.any(String) }]);
    expect(JSON.stringify(captured.context)).not.toContain("secret-");
    await sql`UPDATE context_pack_fact SET status='unresolved' WHERE context_pack_version_id=${f.versionId}`;
    await expect(f.samples.assertUnchanged(f.input, f.user.id, captured.fingerprint)).rejects.toMatchObject({ code: "source_changed" });
  }));
  it("requires an active exact cloud connection and rejects URL-shaped saved locations", async () => using(async (f) => {
    const connectionId = randomUUID();
    await sql`INSERT INTO storage_connection(id,workspace_id,provider,display_name,status,encrypted_access_token,scopes,created_by)
      VALUES (${connectionId},${f.input.workspaceId},'google_drive','Synthetic cloud','active','private-synthetic-envelope',ARRAY[]::text[],${f.user.id})`;
    await sql`UPDATE smart_source SET provider='google_drive',storage_connection_id=${connectionId} WHERE id=${f.input.smartSourceId}`;
    await sql`UPDATE smart_source_location SET provider_location_id='root',display_path='My Drive' WHERE smart_source_id=${f.input.smartSourceId}`;
    const captured = await f.samples.capture(f.input, f.user.id);
    expect(captured.localItems).toEqual([]); expect(JSON.stringify(captured)).not.toContain("private-synthetic-envelope");
    await sql`UPDATE storage_connection SET status='revoked' WHERE id=${connectionId}`;
    await expect(f.samples.assertUnchanged(f.input, f.user.id, captured.fingerprint)).rejects.toMatchObject({ code: "reference_unavailable" });
    await sql`UPDATE storage_connection SET status='active',provider='onedrive' WHERE id=${connectionId}`;
    await expect(f.samples.capture(f.input, f.user.id)).rejects.toMatchObject({ code: "reference_unavailable" });
    await sql`UPDATE smart_source_location SET provider_location_id='https://outside.invalid/folder' WHERE smart_source_id=${f.input.smartSourceId}`;
    await expect(f.samples.capture(f.input, f.user.id)).rejects.toMatchObject({ code: "sample_unsupported" });
  }));
  it("detects instruction edits without disclosing text and refuses oversized fact values before analysis", async () => using(async (f) => {
    const captured = await f.samples.capture(f.input, f.user.id);
    await sql`UPDATE context_pack_version SET instructions='Different private instructions' WHERE id=${f.versionId}`;
    await expect(f.samples.assertUnchanged(f.input, f.user.id, captured.fingerprint)).rejects.toMatchObject({ code: "source_changed" });
    expect(JSON.stringify(await f.samples.capture(f.input, f.user.id))).not.toContain("Different private instructions");
    await sql`INSERT INTO context_pack_fact(id,context_pack_version_id,fact_key,value_json,status)
      VALUES (${randomUUID()},${f.versionId},'large',${sql.json("x".repeat(262_145))},'unresolved')`;
    await expect(f.samples.capture(f.input, f.user.id)).rejects.toMatchObject({ code: "sample_unsupported" });
  }));
  it("preserves runtime Context Pack order when authority rules disagree", async () => using(async (f) => {
    const otherPackId = randomUUID(), otherVersionId = randomUUID(), firstSource = randomUUID(), secondSource = randomUUID();
    await sql`INSERT INTO context_pack(id,workspace_id,name,status,created_by,updated_at)
      VALUES (${otherPackId},${f.input.workspaceId},'Second context','published',${f.user.id},'2026-10-01T10:00:00Z')`;
    await sql`INSERT INTO context_pack_version(id,context_pack_id,version_number,status,authority_rules,created_by)
      VALUES (${otherVersionId},${otherPackId},2,'published',${sql.json([{ factKey: "price", preferredSourceIds: [], resolution: "require_review" }])},${f.user.id})`;
    await sql`UPDATE context_pack SET current_version_id=${otherVersionId} WHERE id=${otherPackId}`;
    await sql`UPDATE context_pack SET updated_at='2026-10-01T11:00:00Z' WHERE id=${f.packId}`;
    for (const [id, version, value] of [[firstSource, f.versionId, 100], [secondSource, otherVersionId, 200]] as const) {
      await sql`INSERT INTO context_pack_source(id,context_pack_version_id,source_kind,label,source_reference)
        VALUES (${id},${version},'manual_text','Synthetic facts',${id})`;
      await sql`INSERT INTO context_pack_fact(id,context_pack_version_id,fact_key,value_json,source_id,status)
        VALUES (${randomUUID()},${version},'price',${sql.json(value)},${id},'accepted')`;
    }
    await sql`UPDATE context_pack_version SET authority_rules=${sql.json([{ factKey: "price", preferredSourceIds: [firstSource], resolution: "prefer_authority" }])} WHERE id=${f.versionId}`;
    await sql`UPDATE smart_source SET context_pack_ids=${[otherPackId, f.packId]} WHERE id=${f.input.smartSourceId}`;
    const captured = await f.samples.capture(f.input, f.user.id);
    expect(captured.context.packs.map((pack) => pack.versionNumber)).toEqual([1, 2]);
    expect(captured.context.facts[0]?.status).toBe("resolved");
    await sql`UPDATE context_pack SET updated_at='2026-10-01T12:00:00Z' WHERE id=${otherPackId}`;
    expect((await f.samples.capture(f.input, f.user.id)).context.facts[0]?.status).toBe("conflicted");
    await expect(f.samples.assertUnchanged(f.input, f.user.id, captured.fingerprint)).rejects.toMatchObject({ code: "source_changed" });
  }));
});
