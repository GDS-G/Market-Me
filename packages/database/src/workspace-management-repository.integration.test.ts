import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { WorkspaceManagementRepository } from "./workspace-management-repository";

const url = process.env.DATABASE_URL;
if (url && new URL(url).pathname !== "/market_me_ci" && !new URL(url).pathname.startsWith("/market_me_qa_132_")) {
  throw new Error("Workspace management integration requires isolated market_me_ci or market_me_qa_132_*.");
}
let sql: DatabaseClient;
async function fixture() {
  const { user, workspace } = await new MarketMeRepository(sql).bootstrapDevelopmentWorkspace({ email: `workspace-qa-${randomUUID()}@market-me.local`, displayName: "Workspace QA" });
  const actors = [user.id];
  return { user, workspace, actors, repository: new WorkspaceManagementRepository(sql),
    create: { operation: "create", organizationId: workspace.organizationId, requestId: randomUUID(), name: "Separate client" },
    cleanup: async () => { await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`; await sql`DELETE FROM app_user WHERE id IN ${sql(actors)}`; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function using(run: (f: Fixture) => Promise<void>) { const f = await fixture(); try { await run(f); } finally { await f.cleanup(); } }
async function actor(f: Fixture, organizationRole?: string, workspaceRole?: string) {
  const id = randomUUID(), email = `workspace-actor-${id}@market-me.local`;
  await sql`INSERT INTO app_user(id,email,normalized_email,display_name) VALUES (${id},${email},${email},'Synthetic actor')`;
  f.actors.push(id);
  if (organizationRole) await sql`INSERT INTO organization_membership(organization_id,user_id,role) VALUES (${f.workspace.organizationId},${id},${organizationRole})`;
  if (workspaceRole) await sql`INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES (${f.workspace.workspaceId},${id},${workspaceRole})`;
  return id;
}
const rename = (workspaceId: string, expectedRevision: number, name = "Renamed workspace") => ({ operation: "rename", workspaceId, requestId: randomUUID(), expectedRevision, name });
async function contents(workspaceId: string) {
  return (await sql`SELECT
    (SELECT count(*)::int FROM smart_source WHERE workspace_id=${workspaceId}) AS sources,
    (SELECT count(*)::int FROM storage_connection WHERE workspace_id=${workspaceId}) AS connections,
    (SELECT count(*)::int FROM content_package WHERE workspace_id=${workspaceId}) AS packages,
    (SELECT count(*)::int FROM campaign WHERE workspace_id=${workspaceId}) AS campaigns,
    (SELECT count(*)::int FROM content_draft WHERE workspace_id=${workspaceId}) AS drafts,
    (SELECT count(*)::int FROM preparation_preset WHERE workspace_id=${workspaceId}) AS presets,
    (SELECT count(*)::int FROM source_preparation_command WHERE workspace_id=${workspaceId}) AS commands,
    (SELECT count(*)::int FROM publication_action WHERE workspace_id=${workspaceId}) AS publications`)[0];
}

describe.skipIf(!url)("workspace management authority and exact receipts", () => {
  beforeAll(() => { sql = createDatabaseClient(url!); });
  afterAll(async () => { await sql?.end(); });

  it("creates one empty sibling workspace with only its creator, a default Brand and a minimized audit", async () => using(async f => {
    const core = new MarketMeRepository(sql);
    const source = await core.createSmartSource({ workspaceId: f.workspace.workspaceId, name: "Existing private intake", provider: "local",
      locations: [{ providerLocationId: "fixture", displayPath: "/SyntheticWorkspaceQA" }], recursive: false, readinessMode: "immediate",
      stabilizationWindowSeconds: 0, allowedMimeTypes: [], ignorePatterns: [], contextPackIds: [], autonomyMode: "draft_only", enabled: false }, f.user.id);
    const result = await f.repository.mutate(f.create, f.user.id), r = result.receipt;
    expect(result).toMatchObject({ replayed: false, receipt: { organizationId: f.workspace.organizationId, name: "Separate client", revision: 1, operation: "create" } });
    expect(r.workspaceId).not.toBe(f.workspace.workspaceId);
    expect(await sql`SELECT user_id,role FROM workspace_membership WHERE workspace_id=${r.workspaceId}`).toEqual([{ userId: f.user.id, role: "owner" }]);
    expect(await sql`SELECT name,is_default FROM brand WHERE workspace_id=${r.workspaceId}`).toEqual([{ name: "Separate client", isDefault: true }]);
    expect(await sql`SELECT default_timezone,slug FROM workspace WHERE id=${r.workspaceId}`).toEqual([{ defaultTimezone: "UTC", slug: `workspace-${r.workspaceId}` }]);
    expect(Object.values((await contents(r.workspaceId))!)).toEqual(Array(8).fill(0));
    expect(await core.listSmartSources(r.workspaceId)).toEqual([]);
    expect(await core.getSmartSource(r.workspaceId, source.id)).toBeUndefined();
    expect(await core.getSmartSource(f.workspace.workspaceId, source.id)).toMatchObject({ id: source.id });
    expect(await core.listContentPackages(r.workspaceId)).toEqual([]);
    expect(await core.listContextPacks(r.workspaceId)).toEqual([]);
    const audits = await sql`SELECT data FROM audit_event WHERE workspace_id=${r.workspaceId} AND event_type='workspace.created'`;
    expect(audits).toEqual([{ data: { name: "Separate client", revision: 1 } }]);
    expect(JSON.stringify(r)).not.toMatch(/canonical|createdBy|role|credential/);
    expect(await f.repository.getSettings(r.workspaceId, f.user.id)).toMatchObject({ name: r.name, revision: 1, canCreateWorkspace: true, canRename: true });
  }));

  it("admits one winner among six exact creates and returns historical success after a later rename", async () => using(async f => {
    const results = await Promise.all(Array.from({ length: 6 }, () => f.repository.mutate(f.create, f.user.id)));
    expect(results.filter(r => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map(r => r.receipt.workspaceId)).size).toBe(1);
    const original = results[0]!.receipt;
    await f.repository.mutate(rename(original.workspaceId, 1), f.user.id);
    expect(await f.repository.mutate(f.create, f.user.id)).toEqual({ receipt: original, replayed: true });
    expect(await f.repository.getReceipt({ operation: "create", organizationId: f.workspace.organizationId }, f.create.requestId, f.user.id)).toEqual(original);
    expect((await f.repository.getSettings(original.workspaceId, f.user.id))?.name).toBe("Renamed workspace");
    expect(await sql`SELECT id FROM workspace WHERE organization_id=${f.workspace.organizationId}`).toHaveLength(2);
  }));

  it("keeps the oldest membership as the no-cookie default after creation and renaming", async () => using(async f => {
    const core = new MarketMeRepository(sql);
    const created = (await f.repository.mutate({ ...f.create, name: "Aardvark later workspace" }, f.user.id)).receipt;
    expect((await core.listWorkspaceAccess(f.user.id)).map(w => w.workspaceId)).toEqual([f.workspace.workspaceId, created.workspaceId]);
    await f.repository.mutate(rename(f.workspace.workspaceId, 1, "Zebra original workspace"), f.user.id);
    expect((await core.listWorkspaceAccess(f.user.id)).map(w => w.workspaceId)).toEqual([f.workspace.workspaceId, created.workspaceId]);
  }));

  it("renames only the display label, preserves the default Brand and replays the original revision", async () => using(async f => {
    const before = (await sql`SELECT * FROM workspace WHERE id=${f.workspace.workspaceId}`)[0]!;
    const request = rename(f.workspace.workspaceId, 1, " Café team ");
    const first = await f.repository.mutate(request, f.user.id);
    expect(first.receipt).toMatchObject({ name: "Café team", revision: 2, workspaceId: f.workspace.workspaceId });
    const after = (await sql`SELECT * FROM workspace WHERE id=${f.workspace.workspaceId}`)[0]!;
    expect(after).toMatchObject({ id: before.id, organizationId: before.organizationId, slug: before.slug, defaultTimezone: before.defaultTimezone, createdAt: before.createdAt });
    expect(await sql`SELECT name FROM brand WHERE workspace_id=${f.workspace.workspaceId}`).toEqual([{ name: "Market Me" }]);
    await f.repository.mutate(rename(f.workspace.workspaceId, 2, "Later name"), f.user.id);
    expect(await f.repository.mutate(request, f.user.id)).toEqual({ receipt: first.receipt, replayed: true });
    expect((await f.repository.getSettings(f.workspace.workspaceId, f.user.id))?.name).toBe("Later name");
    expect(await sql`SELECT data FROM audit_event WHERE workspace_id=${f.workspace.workspaceId} AND event_type='workspace.renamed' ORDER BY created_at`)
      .toEqual([{ data: { previousName: "Market Me", name: "Café team", revision: 2 } }, { data: { previousName: "Café team", name: "Later name", revision: 3 } }]);
  }));

  it("admits one concurrent rename, rejects stale/no-op proposals and retains one exact receipt", async () => using(async f => {
    const results = await Promise.allSettled(["A", "B"].map(name => f.repository.mutate(rename(f.workspace.workspaceId, 1, name), f.user.id)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "revision_conflict" } });
    const current = (await f.repository.getSettings(f.workspace.workspaceId, f.user.id))!;
    await expect(f.repository.mutate(rename(current.workspaceId, current.revision, current.name), f.user.id)).rejects.toMatchObject({ code: "invalid_input" });
    expect(await sql`SELECT request_id FROM workspace_management_receipt WHERE workspace_id=${current.workspaceId}`).toHaveLength(1);
  }));

  it.each(["admin", "member", "viewer"])("denies organization %s creation even with workspace owner access", async role => using(async f => {
    const id = await actor(f, role, "owner");
    await expect(f.repository.mutate(f.create, id)).rejects.toMatchObject({ code: "access_denied" });
    expect(await f.repository.getCreationOrganization(f.workspace.organizationId, id)).toBeUndefined();
    expect(await f.repository.getSettings(f.workspace.workspaceId, id)).toMatchObject({ canRename: true, canCreateWorkspace: false });
  }));

  it.each(["owner", "admin"])("allows a current workspace %s to rename without organization ownership", async role => using(async f => {
    const id = await actor(f, "member", role);
    expect((await f.repository.mutate(rename(f.workspace.workspaceId, 1), id)).receipt.revision).toBe(2);
  }));

  it.each(["editor", "approver", "analyst", "viewer"])("denies workspace %s renaming even for an organization owner", async role => using(async f => {
    const id = await actor(f, "owner", role);
    await expect(f.repository.mutate(rename(f.workspace.workspaceId, 1), id)).rejects.toMatchObject({ code: "access_denied" });
    expect(await f.repository.getSettings(f.workspace.workspaceId, id)).toMatchObject({ canRename: false, canCreateWorkspace: true });
  }));

  it("does not inherit existing members or grant organization owners access to sibling workspace data", async () => using(async f => {
    const secondOwner = await actor(f, "owner", "admin");
    const created = (await f.repository.mutate(f.create, f.user.id)).receipt;
    expect(await f.repository.getSettings(created.workspaceId, secondOwner)).toBeUndefined();
    await expect(f.repository.mutate(rename(created.workspaceId, 1), secondOwner)).rejects.toMatchObject({ code: "access_denied" });
    expect(await f.repository.getReceipt({ operation: "create", organizationId: created.organizationId }, created.requestId, secondOwner)).toBeUndefined();
    const separate = await f.repository.mutate({ ...f.create, requestId: randomUUID() }, secondOwner);
    expect(await f.repository.getSettings(separate.receipt.workspaceId, f.user.id)).toBeUndefined();
  }));

  it("keeps request keys actor-private, rejects changed reuse and rechecks revoked authority", async () => using(async f => {
    const other = await actor(f, "owner", "admin");
    await f.repository.mutate(f.create, f.user.id);
    await expect(f.repository.mutate({ ...f.create, name: "Changed" }, f.user.id)).rejects.toMatchObject({ code: "request_conflict" });
    await expect(f.repository.mutate(f.create, other)).rejects.toMatchObject({ code: "request_conflict" });
    await sql`UPDATE organization_membership SET role='admin' WHERE organization_id=${f.workspace.organizationId} AND user_id=${f.user.id}`;
    await expect(f.repository.mutate(f.create, f.user.id)).rejects.toMatchObject({ code: "access_denied" });
    await expect(f.repository.getReceipt({ operation: "create", organizationId: f.workspace.organizationId }, f.create.requestId, f.user.id)).rejects.toMatchObject({ code: "access_denied" });
  }));

  it("rejects cross-organization reads, renames, creates and receipts without exposing targets", async () => using(async f => {
    await using(async other => {
      const original = (await f.repository.mutate(f.create, f.user.id)).receipt;
      expect(await f.repository.getSettings(original.workspaceId, other.user.id)).toBeUndefined();
      expect(await f.repository.getCreationOrganization(f.workspace.organizationId, other.user.id)).toBeUndefined();
      await expect(f.repository.mutate(f.create, other.user.id)).rejects.toMatchObject({ code: "access_denied" });
      await expect(f.repository.mutate(rename(original.workspaceId, 1), other.user.id)).rejects.toMatchObject({ code: "access_denied" });
      await expect(f.repository.getReceipt({ operation: "create", organizationId: f.workspace.organizationId }, f.create.requestId, other.user.id)).rejects.toMatchObject({ code: "access_denied" });
      expect(await f.repository.getReceipt({ operation: "create", organizationId: other.workspace.organizationId }, f.create.requestId, other.user.id)).toBeUndefined();
    });
  }));

  it("enforces immutable receipts, scoped identity and name revision while allowing whole-workspace erasure", async () => using(async f => {
    const r = (await f.repository.mutate(f.create, f.user.id)).receipt;
    await expect(sql`UPDATE workspace_management_receipt SET name='Changed' WHERE request_id=${r.requestId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`DELETE FROM workspace_management_receipt WHERE request_id=${r.requestId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE workspace SET name='Unversioned' WHERE id=${r.workspaceId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE workspace SET slug='moved' WHERE id=${r.workspaceId}`).rejects.toMatchObject({ code: "23514" });
    await sql`DELETE FROM workspace WHERE id=${r.workspaceId}`;
    expect(await sql`SELECT request_id FROM workspace_management_receipt WHERE request_id=${r.requestId}`).toHaveLength(0);
  }));

  it.each(["create", "rename"] as const)("holds current authority until an admitted %s transaction finishes", async operation => using(async f => {
    const request = operation === "create" ? f.create : rename(f.workspace.workspaceId, 1);
    const key = `workspace-management:${f.workspace.organizationId}:${request.requestId}`;
    let release!: () => void, locked!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const acquired = new Promise<void>(resolve => { locked = resolve; });
    const blocker = sql.begin(async tx => { await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`; locked(); await held; });
    await acquired;
    const creation = f.repository.mutate(request, f.user.id);
    let waiting = false, revocation: Promise<void> | undefined;
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        waiting = (await sql<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted
          AND classid=((hashtextextended(${key},0)>>32)&4294967295)::oid
          AND objid=(hashtextextended(${key},0)&4294967295)::oid) AS waiting`)[0]!.waiting;
        if (waiting) break;
        await delay(20);
      }
      expect(waiting).toBe(true);
      let revoked = false;
      revocation = (operation === "create"
        ? sql`UPDATE organization_membership SET role='admin' WHERE organization_id=${f.workspace.organizationId} AND user_id=${f.user.id}`
        : sql`UPDATE workspace_membership SET role='viewer' WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id}`)
        .then(() => { revoked = true; });
      await delay(30);
      expect(revoked).toBe(false);
      release(); await blocker;
      expect((await creation).replayed).toBe(false);
      await revocation;
      await expect(f.repository.mutate({ ...request, requestId: randomUUID() }, f.user.id)).rejects.toMatchObject({ code: "access_denied" });
      await expect(f.repository.mutate(request, f.user.id)).rejects.toMatchObject({ code: "access_denied" });
    } finally { release(); await blocker; await creation.catch(() => undefined); await revocation; }
  }));
});
