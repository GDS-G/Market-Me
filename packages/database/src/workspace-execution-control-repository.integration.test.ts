import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { WorkspaceExecutionControlRepository } from "./workspace-execution-control-repository";
import type { WorkspaceExecutionControlRequest, WorkspaceExecutionState } from "./workspace-execution-control-models";

const url = process.env.DATABASE_URL;
if (url && new URL(url).pathname !== "/market_me_ci") throw new Error("Execution-control integration requires isolated market_me_ci.");
let sql: DatabaseClient;
async function fixture() {
  const core = new MarketMeRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({ email: `execution-${randomUUID()}@market-me.local`, displayName: "Synthetic execution owner" });
  const actors = [user.id];
  return { user, workspace, actors, repository: new WorkspaceExecutionControlRepository(sql),
    cleanup: async () => { await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`; await sql`DELETE FROM app_user WHERE id IN ${sql(actors)}`; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function using(run: (f: Fixture) => Promise<void>) { const f = await fixture(); try { await run(f); } finally { await f.cleanup(); } }
async function member(f: Fixture, role: string) {
  const id = randomUUID(), email = `execution-member-${id}@market-me.local`; f.actors.push(id);
  await sql`INSERT INTO app_user(id,email,normalized_email,display_name) VALUES(${id},${email},${email},'Synthetic execution collaborator')`;
  await sql`INSERT INTO organization_membership(organization_id,user_id,role) VALUES(${f.workspace.organizationId},${id},'owner')`;
  await sql`INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES(${f.workspace.workspaceId},${id},${role})`;
  return id;
}
async function intent(f: Fixture, state: WorkspaceExecutionState = "paused", actor = f.user.id): Promise<WorkspaceExecutionControlRequest> {
  const current = await f.repository.getSnapshot(f.workspace.workspaceId, actor);
  if (!current.canManage) throw new Error("Synthetic fixture requires management");
  return { workspaceId: current.workspaceId, requestId: randomUUID(), expectedActorIncarnationId: current.actorIncarnationId,
    expectedRevision: current.revision, state, reason: "Reviewed synthetic execution boundary" };
}
async function counts(f: Fixture) {
  return (await sql`SELECT (SELECT count(*)::int FROM workspace_execution_control_receipt WHERE workspace_id=${f.workspace.workspaceId}) AS receipts,
    (SELECT count(*)::int FROM audit_event WHERE workspace_id=${f.workspace.workspaceId} AND event_type IN ('workspace.execution_paused','workspace.execution_reopened')) AS audits`)[0];
}
function latch() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
function trackedClient() {
  let identify!: (pid: number) => void; const pid = new Promise<number>(resolve => { identify = resolve; });
  const client = new Proxy(sql, { get(original, property) {
    if (property !== "begin") return Reflect.get(original, property);
    return (run: (tx: TransactionSql) => Promise<unknown>) => sql.begin(async tx => {
      const [row] = await tx`SELECT pg_backend_pid() AS pid`; identify(row!.pid); return run(tx);
    });
  } });
  return { client, async waitForLock() {
    const operationPid = await pid;
    for (let i = 0; i < 150; i++) {
      const [row] = await sql`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${operationPid}`;
      if (row?.waitEventType === "Lock") return; await delay(20);
    }
    throw new Error("Expected execution-control statement did not wait on its database lock");
  } };
}

describe.skipIf(!url)("durable workspace execution control", () => {
  beforeAll(() => { sql = createDatabaseClient(url!); }); afterAll(async () => { await sql?.end(); });
  it.each(["owner", "admin"])("lets a current %s change state, with one exact receipt and audit per transition", async role => using(async f => {
    const actor = role === "owner" ? f.user.id : await member(f, role);
    expect(await f.repository.getSnapshot(f.workspace.workspaceId, actor)).toMatchObject({ state: "open", revision: 1, canManage: true, reason: "" });
    const request = await intent(f, "paused", actor), result = await f.repository.mutate(request, actor);
    expect(result).toEqual({ replayed: false, receipt: { ...request, previousState: "open", revision: 2, changedAt: expect.any(String) } });
    expect(JSON.stringify(result)).not.toMatch(/createdBy|canonicalRequest|email|token/);
    expect(await f.repository.getReceipt(f.workspace.workspaceId, request.requestId, actor)).toEqual(result.receipt);
    expect(await counts(f)).toEqual({ receipts: 1, audits: 1 });
    expect(await sql`SELECT data FROM audit_event WHERE workspace_id=${f.workspace.workspaceId} AND event_type='workspace.execution_paused'`)
      .toEqual([{ data: { requestId: request.requestId, previousState: "open", state: "paused", revision: 2,
        actorIncarnationId: request.expectedActorIncarnationId, reason: request.reason } }]);
    expect((await f.repository.mutate(await intent(f, "open", actor), actor)).receipt).toMatchObject({ previousState: "paused", state: "open", revision: 3 });
    expect(await counts(f)).toEqual({ receipts: 2, audits: 2 });
    expect(await sql`SELECT r.changed_at=c.updated_at AS exact_time FROM workspace_execution_control_receipt r
      JOIN workspace_execution_control c USING(workspace_id) WHERE r.workspace_id=${f.workspace.workspaceId} AND r.revision=c.revision`).toEqual([{ exactTime: true }]);
  }));
  it.each(["editor", "approver", "analyst", "viewer"])("shows minimized state to a %s but denies management despite organization ownership", async role => using(async f => {
    const actor = await member(f, role), request = await intent(f);
    await f.repository.mutate(request, f.user.id);
    const view = await f.repository.getSnapshot(f.workspace.workspaceId, actor);
    expect(view).toEqual({ workspaceId: f.workspace.workspaceId, state: "paused", revision: 2, changedAt: expect.any(String), canManage: false });
    await expect(f.repository.mutate(request, actor)).rejects.toMatchObject({ code: "access_denied" });
    await expect(f.repository.getReceipt(f.workspace.workspaceId, request.requestId, actor)).rejects.toMatchObject({ code: "access_denied" });
  }));
  it("does not leak state or receipts across workspaces, and keeps receipt lookup creator-private", async () => using(async f => using(async other => {
    const admin = await member(f, "admin"), request = await intent(f);
    await f.repository.mutate(request, f.user.id);
    for (const actor of [other.user.id, randomUUID()]) {
      await expect(f.repository.getSnapshot(f.workspace.workspaceId, actor)).rejects.toMatchObject({ code: "access_denied" });
      await expect(f.repository.mutate(request, actor)).rejects.toMatchObject({ code: "access_denied" });
      await expect(f.repository.getReceipt(f.workspace.workspaceId, request.requestId, actor)).rejects.toMatchObject({ code: "access_denied" });
    }
    expect(await f.repository.getReceipt(f.workspace.workspaceId, request.requestId, admin)).toBeUndefined();
    expect(await f.repository.getReceipt(other.workspace.workspaceId, request.requestId, other.user.id)).toBeUndefined();
    expect(await other.repository.getSnapshot(other.workspace.workspaceId, other.user.id)).toMatchObject({ state: "open", revision: 1 });
  })));
  it("serializes exact concurrent retries without reapplying historical resume after a new pause", async () => using(async f => {
    const initial = await intent(f);
    const attempts = await Promise.all(Array.from({ length: 6 }, () => f.repository.mutate(initial, f.user.id)));
    expect(attempts.filter(r => !r.replayed)).toHaveLength(1);
    for (const result of attempts) expect(result.receipt).toEqual(attempts[0]!.receipt);
    const reopen = await intent(f, "open"), reopened = await f.repository.mutate(reopen, f.user.id);
    await f.repository.mutate(await intent(f), f.user.id);
    expect(await f.repository.mutate(reopen, f.user.id)).toEqual({ ...reopened, replayed: true });
    expect(await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id)).toMatchObject({ state: "paused", revision: 4 });
    expect(await counts(f)).toEqual({ receipts: 3, audits: 3 });
  }));
  it("rejects altered key reuse, stale revisions and redundant transitions without writes", async () => using(async f => {
    const request = await intent(f), admin = await member(f, "admin");
    await expect(f.repository.mutate({ ...request, state: "open" }, f.user.id)).rejects.toMatchObject({ code: "state_conflict" });
    await f.repository.mutate(request, f.user.id);
    for (const changed of [{ reason: "Changed reason" }, { state: "open" }, { expectedRevision: 2 }, { expectedActorIncarnationId: randomUUID() }]) {
      await expect(f.repository.mutate({ ...request, ...changed }, f.user.id)).rejects.toMatchObject({ code: "request_conflict" });
    }
    await expect(f.repository.mutate(request, admin)).rejects.toMatchObject({ code: "request_conflict" });
    await expect(f.repository.mutate({ ...request, requestId: randomUUID(), state: "open" }, f.user.id)).rejects.toMatchObject({ code: "revision_conflict" });
    expect(await counts(f)).toEqual({ receipts: 1, audits: 1 });
  }));
  it("lets only one competing intent advance the same revision", async () => using(async f => {
    const admin = await member(f, "admin"), a = await intent(f), b = await intent(f, "paused", admin);
    const results = await Promise.allSettled([f.repository.mutate(a, f.user.id), f.repository.mutate(b, admin)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "revision_conflict" } });
    expect(await counts(f)).toEqual({ receipts: 1, audits: 1 });
  }));
  it("denies removed administrators but retains their original history after an explicit fresh administrator grant", async () => using(async f => {
    const actor = await member(f, "admin"), request = await intent(f, "paused", actor);
    const result = await f.repository.mutate(request, actor), oldResume = await intent(f, "open", actor);
    await sql`UPDATE workspace_membership SET revoked_at=clock_timestamp() WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${actor}`;
    await expect(f.repository.mutate(request, actor)).rejects.toMatchObject({ code: "access_denied" });
    await expect(f.repository.getReceipt(f.workspace.workspaceId, request.requestId, actor)).rejects.toMatchObject({ code: "access_denied" });
    await sql`UPDATE workspace_membership SET revoked_at=NULL,incarnation_id=gen_random_uuid() WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${actor}`;
    await expect(f.repository.mutate(oldResume, actor)).rejects.toMatchObject({ code: "revision_conflict" });
    expect(await f.repository.mutate(request, actor)).toEqual({ ...result, replayed: true });
    expect(await f.repository.getReceipt(f.workspace.workspaceId, request.requestId, actor)).toEqual(result.receipt);
    expect(await counts(f)).toEqual({ receipts: 1, audits: 1 });
  }));
  it.each(["commit", "rollback"])("rechecks authority after a concurrent revocation %s", async outcome => using(async f => {
    const actor = await member(f, "admin"), request = await intent(f, "paused", actor);
    const locked = latch(), release = latch(), rollback = new Error("Synthetic membership rollback");
    const change = sql.begin(async tx => {
      await tx`UPDATE workspace_membership SET revoked_at=clock_timestamp() WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${actor}`;
      locked.release(); await release.promise; if (outcome === "rollback") throw rollback;
    }).catch(error => { if (error !== rollback) throw error; });
    await locked.promise; const tracked = trackedClient();
    const mutation = new WorkspaceExecutionControlRepository(tracked.client).mutate(request, actor).then(value => ({ value }), error => ({ error }));
    try { await tracked.waitForLock(); } finally { release.release(); }
    await change; const result = await mutation;
    if (outcome === "commit") { expect(result).toMatchObject({ error: { code: "access_denied" } }); expect(await counts(f)).toEqual({ receipts: 0, audits: 0 }); }
    else { expect(result).toMatchObject({ value: { replayed: false, receipt: { revision: 2 } } }); }
  }));
  it("rolls back state and receipt if the final audit cannot be written", async () => using(async f => {
    const broken = new Proxy(sql, { get(original, property) {
      if (property !== "begin") return Reflect.get(original, property);
      return (run: (tx: TransactionSql) => Promise<unknown>) => sql.begin(async tx => {
        await tx`CREATE TEMP TABLE audit_event(id uuid,workspace_id uuid,actor_user_id uuid,event_type text,subject_type text,subject_id text,data jsonb,
          CHECK(event_type='never_accept')) ON COMMIT DROP`;
        return run(tx);
      });
    } });
    await expect(new WorkspaceExecutionControlRepository(broken).mutate(await intent(f), f.user.id)).rejects.toMatchObject({ code: "23514" });
    expect(await f.repository.getSnapshot(f.workspace.workspaceId, f.user.id)).toMatchObject({ state: "open", revision: 1, reason: "" });
    expect(await counts(f)).toEqual({ receipts: 0, audits: 0 });
  }));
  it("fails closed for absent control state without manufacturing a new open row", async () => using(async f => {
    const request = await intent(f);
    const unavailable = new Proxy(sql, { get(original, property) {
      if (property !== "begin") return Reflect.get(original, property);
      return (run: (tx: TransactionSql) => Promise<unknown>) => sql.begin(async tx => {
        await tx`CREATE TEMP TABLE workspace_execution_control (LIKE public.workspace_execution_control) ON COMMIT DROP`;
        return run(tx);
      });
    } });
    const repository = new WorkspaceExecutionControlRepository(unavailable);
    await expect(repository.getSnapshot(f.workspace.workspaceId, f.user.id)).rejects.toMatchObject({ code: "control_unavailable" });
    await expect(repository.mutate(request, f.user.id)).rejects.toMatchObject({ code: "control_unavailable" });
    expect(await counts(f)).toEqual({ receipts: 0, audits: 0 });
  }));
});
