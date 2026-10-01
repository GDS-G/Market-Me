import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SourceSetupInput } from "@market-me/domain";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { SourceSetupRepository } from "./source-setup-repository";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl && !["market_me_ci"].includes(new URL(databaseUrl).pathname.slice(1)) && !new URL(databaseUrl).pathname.startsWith("/market_me_qa_128_")) {
  throw new Error("Guided setup tests require isolated market_me_ci or market_me_qa_128_* databases.");
}
let sql: DatabaseClient;
async function fixture() {
  const core = new MarketMeRepository(sql), setup = new SourceSetupRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({ email: `setup-qa-${randomUUID()}@market-me.local`, displayName: "Setup QA" });
  const workerId = randomUUID(), connectionId = randomUUID(), packId = randomUUID(), versionId = randomUUID();
  await sql`INSERT INTO browser_worker(id,workspace_id,name,platform,architecture,app_version,token_prefix,token_hash)
    VALUES (${workerId},${workspace.workspaceId},'Setup desktop','windows','x86_64','qa','qa',${randomUUID()})`;
  await sql`INSERT INTO storage_connection(id,workspace_id,provider,display_name,provider_account_id,status,encrypted_access_token,scopes,created_by)
    VALUES (${connectionId},${workspace.workspaceId},'google_drive','QA storage','synthetic','active','not-a-real-token',ARRAY[]::text[],${user.id})`;
  await sql`INSERT INTO context_pack(id,workspace_id,name,status,created_by) VALUES (${packId},${workspace.workspaceId},'QA context','published',${user.id})`;
  await sql`INSERT INTO context_pack_version(id,context_pack_id,version_number,status,created_by) VALUES (${versionId},${packId},1,'published',${user.id})`;
  await sql`UPDATE context_pack SET current_version_id=${versionId} WHERE id=${packId}`;
  const input: SourceSetupInput = { workspaceId: workspace.workspaceId, requestId: randomUUID(), name: "Guided source", provider: "local",
    location: { providerLocationId: workerId, displayPath: "Approved companion folder" }, recursive: false, readinessMode: "immediate",
    stabilizationWindowSeconds: 120, fileTypes: ["images", "documents"], ignoredFolders: ["Drafts"],
    contextPacks: [{ id: packId, expectedVersionId: versionId }], autonomyMode: "approval_required" };
  return { core, setup, user, workspace, workerId, connectionId, packId, versionId, input,
    cleanup: async () => { await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`; await sql`DELETE FROM app_user WHERE id=${user.id}`; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function using(run: (f: Fixture) => Promise<void>) {
  const f = await fixture(); try { await run(f); } finally { await f.cleanup(); }
}
async function counts(workspaceId: string) {
  return (await sql`SELECT
    (SELECT count(*)::int FROM smart_source WHERE workspace_id=${workspaceId}) AS sources,
    (SELECT count(*)::int FROM smart_source_setup_receipt WHERE workspace_id=${workspaceId}) AS receipts,
    (SELECT count(*)::int FROM audit_event WHERE workspace_id=${workspaceId} AND event_type='smart_source.created') AS audits,
    (SELECT count(*)::int FROM content_package WHERE workspace_id=${workspaceId}) AS packages,
    (SELECT count(*)::int FROM campaign WHERE workspace_id=${workspaceId}) AS campaigns,
    (SELECT count(*)::int FROM source_preparation_command WHERE workspace_id=${workspaceId}) AS commands`)[0];
}
describe.skipIf(!databaseUrl)("guided source setup admission and recovery", () => {
  beforeAll(() => { sql = createDatabaseClient(databaseUrl!); });
  afterAll(async () => { await sql?.end(); });
  it("atomically creates only one paused source, location, private receipt and minimized audit", async () => using(async (f) => {
    const result = await f.setup.create(f.input, f.user.id);
    expect(result.replayed).toBe(false);
    expect(result.receipt).toEqual({ workspaceId: f.workspace.workspaceId, requestId: f.input.requestId, smartSourceId: expect.any(String),
      name: "Guided source", initialState: "paused", createdAt: expect.any(String) });
    expect(await f.core.getSmartSource(f.workspace.workspaceId, result.receipt.smartSourceId)).toMatchObject({ enabled: false, version: 1,
      contextPackIds: [f.packId], locations: [{ providerLocationId: f.workerId, displayPath: "Approved companion folder" }] });
    expect(await counts(f.workspace.workspaceId)).toEqual({ sources: 1, receipts: 1, audits: 1, packages: 0, campaigns: 0, commands: 0 });
    const [audit] = await sql`SELECT data FROM audit_event WHERE workspace_id=${f.workspace.workspaceId} AND event_type='smart_source.created'`;
    expect(audit!.data).toEqual({ setup: "guided", initialState: "paused" });
    expect(JSON.stringify(result)).not.toContain("canonicalRequest");
  }));
  it("deduplicates concurrent creates and replays the historical receipt without resetting later edits", async () => using(async (f) => {
    const results = await Promise.all(Array.from({ length: 6 }, () => f.setup.create(f.input, f.user.id)));
    expect(new Set(results.map((result) => result.receipt.smartSourceId)).size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    await sql`UPDATE smart_source SET name='Later edit',enabled=true,version=version+1 WHERE id=${results[0]!.receipt.smartSourceId}`;
    await sql`UPDATE browser_worker SET status='revoked' WHERE id=${f.workerId}`;
    await sql`UPDATE context_pack SET status='archived' WHERE id=${f.packId}`;
    expect(await f.setup.create({ ...f.input, fileTypes: ["documents", "images"] }, f.user.id)).toEqual({ receipt: results[0]!.receipt, replayed: true });
    expect(await f.core.getSmartSource(f.workspace.workspaceId, results[0]!.receipt.smartSourceId)).toMatchObject({ name: "Later edit", enabled: true, version: 2 });
    expect(await counts(f.workspace.workspaceId)).toMatchObject({ sources: 1, receipts: 1, audits: 1 });
  }));
  it("refuses changed payload reuse and allows a deliberately distinct request", async () => using(async (f) => {
    const first = await f.setup.create(f.input, f.user.id);
    await expect(f.setup.create({ ...f.input, recursive: true }, f.user.id)).rejects.toMatchObject({ code: "request_conflict" });
    const second = await f.setup.create({ ...f.input, requestId: randomUUID() }, f.user.id);
    expect(second.receipt.smartSourceId).not.toBe(first.receipt.smartSourceId);
  }));
  it.each(["owner", "admin", "editor"])("admits a current %s", async (role) => using(async (f) => {
    await sql`UPDATE workspace_membership SET role=${role} WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`;
    expect((await f.setup.create(f.input, f.user.id)).receipt.initialState).toBe("paused");
  }));
  it.each(["viewer", "analyst", "approver"])("blocks a current %s before writes or receipt disclosure", async (role) => using(async (f) => {
    const result = await f.setup.create(f.input, f.user.id);
    await sql`UPDATE workspace_membership SET role=${role} WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`;
    await expect(f.setup.create(f.input, f.user.id)).rejects.toMatchObject({ code: "access_denied" });
    await expect(f.setup.getReceipt(f.workspace.workspaceId, f.input.requestId, f.user.id)).rejects.toMatchObject({ code: "access_denied" });
    expect(result.receipt.initialState).toBe("paused"); expect(await counts(f.workspace.workspaceId)).toMatchObject({ sources: 1, receipts: 1 });
  }));
  it("checks tenant and actor boundaries and returns no result for an unknown request", async () => using(async (f) => {
    expect(await f.setup.getReceipt(f.workspace.workspaceId, f.input.requestId, f.user.id)).toBeUndefined();
    await expect(f.setup.create({ ...f.input, workspaceId: randomUUID() }, f.user.id)).rejects.toMatchObject({ code: "access_denied" });
    await expect(f.setup.create(f.input, randomUUID())).rejects.toMatchObject({ code: "access_denied" });
    expect(await counts(f.workspace.workspaceId)).toMatchObject({ sources: 0, receipts: 0, audits: 0 });
  }));
  it("does not disclose or replay another current writer's private receipt", async () => using(async (f) => {
    const otherId = randomUUID(), email = `setup-other-${randomUUID()}@market-me.local`;
    await sql`INSERT INTO app_user(id,email,normalized_email,display_name) VALUES (${otherId},${email},${email},'Other setup writer')`;
    try {
      await sql`INSERT INTO organization_membership(organization_id,user_id,role) VALUES (${f.workspace.organizationId},${otherId},'member')`;
      await sql`INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES (${f.workspace.workspaceId},${otherId},'editor')`;
      const original = await f.setup.create(f.input, f.user.id);
      expect(await f.setup.getReceipt(f.workspace.workspaceId, f.input.requestId, otherId)).toBeUndefined();
      await expect(f.setup.create(f.input, otherId)).rejects.toMatchObject({ code: "request_conflict" });
      expect(await f.setup.getReceipt(f.workspace.workspaceId, f.input.requestId, f.user.id)).toEqual(original.receipt);
      expect(await counts(f.workspace.workspaceId)).toMatchObject({ sources: 1, receipts: 1, audits: 1 });
    } finally { await sql`DELETE FROM app_user WHERE id=${otherId}`; }
  }));
  it("requires a non-revoked same-workspace paired desktop", async () => using(async (f) => {
    await expect(f.setup.create({ ...f.input, location: { ...f.input.location, providerLocationId: randomUUID() } }, f.user.id)).rejects.toMatchObject({ code: "companion_unavailable" });
    await sql`UPDATE browser_worker SET status='revoked' WHERE id=${f.workerId}`;
    await expect(f.setup.create(f.input, f.user.id)).rejects.toMatchObject({ code: "companion_unavailable" });
    expect(await counts(f.workspace.workspaceId)).toMatchObject({ sources: 0, receipts: 0, audits: 0 });
  }));
  it("requires an active same-provider connection and admits explicit cloud roots without scanning", async () => using(async (f) => {
    const remote = { ...f.input, provider: "google_drive" as const, storageConnectionId: f.connectionId, location: { providerLocationId: "root", displayPath: "My Drive" } };
    await expect(f.setup.create({ ...remote, provider: "onedrive" }, f.user.id)).rejects.toMatchObject({ code: "connection_unavailable" });
    await expect(f.setup.create({ ...remote, storageConnectionId: randomUUID() }, f.user.id)).rejects.toMatchObject({ code: "connection_unavailable" });
    await sql`UPDATE storage_connection SET status='revoked' WHERE id=${f.connectionId}`;
    await expect(f.setup.create(remote, f.user.id)).rejects.toMatchObject({ code: "connection_unavailable" });
    await sql`UPDATE storage_connection SET status='active' WHERE id=${f.connectionId}`;
    expect((await f.setup.create(remote, f.user.id)).receipt.initialState).toBe("paused");
    expect(await counts(f.workspace.workspaceId)).toMatchObject({ sources: 1, packages: 0, commands: 0 });
  }));
  it.each(["version", "status", "missing"])("fails closed for a changed Context Pack %s", async (mode) => using(async (f) => {
    if (mode === "version") f.input.contextPacks = [{ id: f.packId, expectedVersionId: randomUUID() }];
    if (mode === "status") await sql`UPDATE context_pack SET status='archived' WHERE id=${f.packId}`;
    if (mode === "missing") f.input.contextPacks = [{ id: randomUUID(), expectedVersionId: f.versionId }];
    await expect(f.setup.create(f.input, f.user.id)).rejects.toMatchObject({ code: "context_changed" });
    expect(await counts(f.workspace.workspaceId)).toEqual({ sources: 0, receipts: 0, audits: 0, packages: 0, campaigns: 0, commands: 0 });
  }));
  it("protects receipts from mutation/deletion and permits whole-workspace erasure", async () => using(async (f) => {
    const created = await f.setup.create(f.input, f.user.id);
    await expect(sql`UPDATE smart_source_setup_receipt SET name='Other' WHERE request_id=${f.input.requestId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`DELETE FROM smart_source_setup_receipt WHERE request_id=${f.input.requestId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`DELETE FROM smart_source WHERE id=${created.receipt.smartSourceId}`).rejects.toBeDefined();
    await sql`DELETE FROM workspace WHERE id=${f.workspace.workspaceId}`;
    expect(await counts(f.workspace.workspaceId)).toEqual({ sources: 0, receipts: 0, audits: 0, packages: 0, campaigns: 0, commands: 0 });
  }));
  it("fences storage refresh to the exact active credential snapshot and has one concurrent winner", async () => using(async (f) => {
    const update = { connectionId: f.connectionId, workspaceId: f.workspace.workspaceId, provider: "google_drive" as const,
      expectedEncryptedAccessToken: "not-a-real-token", encryptedAccessToken: "new-synthetic-token", scopes: ["read"] };
    expect(await f.core.updateStorageConnectionTokens({ ...update, workspaceId: randomUUID() })).toBe(false);
    expect(await f.core.updateStorageConnectionTokens({ ...update, provider: "onedrive" })).toBe(false);
    expect(await f.core.updateStorageConnectionTokens({ ...update, expectedEncryptedRefreshToken: "wrong" })).toBe(false);
    const results = await Promise.all([f.core.updateStorageConnectionTokens(update), f.core.updateStorageConnectionTokens(update)]);
    expect(results.sort()).toEqual([false, true]);
    await sql`UPDATE storage_connection SET status='revoked' WHERE id=${f.connectionId}`;
    expect(await f.core.updateStorageConnectionTokens({ ...update, expectedEncryptedAccessToken: "new-synthetic-token", encryptedAccessToken: "late" })).toBe(false);
    const connection = await f.core.getStorageConnection(f.workspace.workspaceId, f.connectionId);
    expect(connection).toMatchObject({ status: "revoked", encryptedAccessToken: "new-synthetic-token", scopes: ["read"] });
  }));
});
