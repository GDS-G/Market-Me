import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { lockWorkspaceExecutionAdmission } from "./workspace-execution-admission";
import { MarketMeRepository } from "./repositories";
import { WorkspaceExecutionControlRepository } from "./workspace-execution-control-repository";

const url = process.env.DATABASE_URL;
if (url && new URL(url).pathname !== "/market_me_ci") throw new Error("Execution-admission tests require isolated market_me_ci.");
let sql: DatabaseClient;
const surfaces = [
  { table: "publication_action", admitted: "dispatching", initial: "failed" },
  { table: "workspace_ai_text_invocation_attempt", admitted: "claimed", initial: "failed" },
  { table: "browser_job", admitted: "claimed", initial: "queued" },
] as const;
async function guarded(run: (tx: TransactionSql, workspace: string) => Promise<void>) {
  const rollback = new Error("Rollback isolated admission guards");
  await expect(sql.begin(async tx => {
    const schema = `qa_admission_${randomUUID().replaceAll("-", "")}`, workspace = randomUUID();
    await tx`CREATE SCHEMA ${tx(schema)}`; await tx`SET LOCAL search_path TO ${tx(schema)},public`;
    await tx`CREATE TABLE workspace_execution_control(workspace_id uuid PRIMARY KEY,state text NOT NULL)`;
    for (const surface of surfaces) await tx`CREATE TABLE ${tx(surface.table)}(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,status text NOT NULL,
      claim_token_hash text,lease_expires_at timestamptz,attempt_count integer NOT NULL DEFAULT 0)`;
    await tx`INSERT INTO workspace_execution_control VALUES(${workspace},'open')`;
    await tx.unsafe(await readFile(new URL("../migrations/0128_workspace_execution_admission_guards.sql", import.meta.url), "utf8"));
    await run(tx, workspace); throw rollback;
  })).rejects.toBe(rollback);
}
function latch() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function withWorkspace(run: (workspace: string, actor: string, incarnation: string) => Promise<void>) {
  const { workspace, user } = await new MarketMeRepository(sql).bootstrapDevelopmentWorkspace({ email: `admission-${randomUUID()}@market-me.local`, displayName: "Synthetic fence owner" });
  try {
    const [member] = await sql`SELECT incarnation_id FROM active_workspace_membership WHERE workspace_id=${workspace.workspaceId} AND user_id=${user.id}`;
    await run(workspace.workspaceId, user.id, member!.incarnationId);
  } finally { await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`; await sql`DELETE FROM app_user WHERE id=${user.id}`; }
}
async function waitForLock(pid: number) {
  for (let i = 0; i < 150; i++) {
    const [row] = await sql`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`;
    if (row?.waitEventType === "Lock") return; await delay(20);
  }
  throw new Error("Admission/hold statement did not reach the expected database lock");
}

describe.skipIf(!url)("workspace execution admission fence", () => {
  beforeAll(() => { sql = createDatabaseClient(url!); }); afterAll(async () => { await sql?.end(); });
  it.each(surfaces)("fences direct $table insert/retry but retains completion and history", async surface => guarded(async (tx, workspace) => {
    const admitted = randomUUID(), pending = randomUUID();
    await tx`INSERT INTO ${tx(surface.table)}(id,workspace_id,status) VALUES(${admitted},${workspace},${surface.admitted}),(${pending},${workspace},${surface.initial})`;
    await tx`UPDATE workspace_execution_control SET state='paused'`;
    await expect(tx.savepoint(child => child`INSERT INTO ${child(surface.table)}(id,workspace_id,status) VALUES(${randomUUID()},${workspace},${surface.admitted})`))
      .rejects.toMatchObject({ code: "MM001" });
    await expect(tx.savepoint(child => child`UPDATE ${child(surface.table)} SET status=${surface.admitted} WHERE id=${pending}`)).rejects.toMatchObject({ code: "MM001" });
    await tx`UPDATE ${tx(surface.table)} SET status='succeeded' WHERE id=${admitted}`;
    expect(await tx`SELECT status FROM ${tx(surface.table)} WHERE id=${admitted}`).toEqual([{ status: "succeeded" }]);
    expect(await tx`SELECT status FROM ${tx(surface.table)} WHERE id=${pending}`).toEqual([{ status: surface.initial }]);
    await tx`UPDATE workspace_execution_control SET state='open'`;
    await tx`UPDATE ${tx(surface.table)} SET status=${surface.admitted} WHERE id=${pending}`;
  }));
  it.each(surfaces)("fails closed for a missing $table workspace control", async surface => guarded(async (tx, workspace) => {
    await tx`DELETE FROM workspace_execution_control`;
    await expect(tx.savepoint(child => child`INSERT INTO ${child(surface.table)}(id,workspace_id,status) VALUES(${randomUUID()},${workspace},${surface.admitted})`))
      .rejects.toMatchObject({ code: "MM002" });
    await expect(lockWorkspaceExecutionAdmission(tx, workspace)).rejects.toMatchObject({ code: "control_unavailable" });
  }));
  it("blocks same-status companion reclaims/token and lease replacement while held, but allows queued storage", async () => guarded(async (tx, workspace) => {
    const id = randomUUID(); await tx`INSERT INTO browser_job(id,workspace_id,status) VALUES(${id},${workspace},'claimed')`;
    await tx`UPDATE workspace_execution_control SET state='paused'`;
    for (const patch of [{ claimTokenHash: "another-claim" }, { leaseExpiresAt: new Date() }, { attemptCount: 2 }, { status: "claimed" }]) {
      await expect(tx.savepoint(child => child`UPDATE browser_job SET ${child(patch)} WHERE id=${id}`)).rejects.toMatchObject({ code: "MM001" });
    }
    await tx`INSERT INTO browser_job(id,workspace_id,status) VALUES(${randomUUID()},${workspace},'queued')`;
    expect(await tx`SELECT * FROM browser_job`).toHaveLength(2);
  }));
  it("does not let an admitted row move into a held workspace", async () => guarded(async (tx, workspace) => {
    const other = randomUUID(); await tx`INSERT INTO workspace_execution_control VALUES(${other},'paused')`;
    for (const surface of surfaces) {
      const id = randomUUID(); await tx`INSERT INTO ${tx(surface.table)}(id,workspace_id,status) VALUES(${id},${workspace},${surface.admitted})`;
      await expect(tx.savepoint(child => child`UPDATE ${child(surface.table)} SET workspace_id=${other} WHERE id=${id}`)).rejects.toMatchObject({ code: "MM001" });
    }
  }));
  it("retains existing step state while adding held-state transitions that cannot claim manual success", async () => guarded(async tx => {
    await tx`CREATE TABLE campaign_step_run(id uuid PRIMARY KEY,status text NOT NULL CONSTRAINT campaign_step_run_status_check CHECK(status IN ('planned','running','manual_resolution','succeeded'))) `;
    const id = randomUUID(); await tx`INSERT INTO campaign_step_run VALUES(${id},'running')`;
    await tx.unsafe(await readFile(new URL("../migrations/0129_campaign_execution_hold.sql", import.meta.url), "utf8"));
    expect(await tx`SELECT status FROM campaign_step_run`).toEqual([{ status: "running" }]);
    await tx`UPDATE campaign_step_run SET status='execution_held'`;
    for (const state of ["manual_resolution", "succeeded", "partially_succeeded", "permanently_failed"]) {
      await expect(tx.savepoint(child => child`UPDATE campaign_step_run SET status=${state}`)).rejects.toMatchObject({ code: "23514" });
    }
    await tx`UPDATE campaign_step_run SET status='running'`;
    await tx`UPDATE campaign_step_run SET status='succeeded'`;
    const canceled = randomUUID(); await tx`INSERT INTO campaign_step_run VALUES(${canceled},'execution_held')`;
    await tx`UPDATE campaign_step_run SET status='canceled' WHERE id=${canceled}`;
    expect(await tx`SELECT status FROM campaign_step_run WHERE id=${canceled}`).toEqual([{ status: "canceled" }]);
  }));
  it.each(["commit", "rollback"])("an admission waits for an earlier pause %s and reads the resulting state", async outcome => withWorkspace(async (workspace, actor, incarnation) => {
    const held = latch(), release = latch(), rollback = new Error("Rollback synthetic pause");
    const pause = sql.begin(async tx => {
      await tx`UPDATE workspace_execution_control SET state='paused',revision=2,reason='Synthetic contention',updated_by=${actor},
        updated_by_incarnation_id=${incarnation},updated_at=clock_timestamp() WHERE workspace_id=${workspace}`;
      held.release(); await release.promise; if (outcome === "rollback") throw rollback;
    }).catch(error => { if (error !== rollback) throw error; });
    await held.promise;
    const contender = createDatabaseClient(url!, { max: 1 });
    try {
      const [backend] = await contender`SELECT pg_backend_pid() AS pid`;
      const admission = contender.begin(tx => lockWorkspaceExecutionAdmission(tx, workspace)).then(() => ({ admitted: true }), error => ({ error }));
      try { await waitForLock(backend!.pid); } finally { release.release(); }
      await pause;
      expect(await admission).toMatchObject(outcome === "commit" ? { error: { code: "execution_paused" } } : { admitted: true });
    } finally { release.release(); await pause; await contender.end(); }
  }));
  it.each(["commit", "rollback"])("pause waits for an earlier admission %s, then fences every later admission", async outcome => withWorkspace(async (workspace, actor, incarnation) => {
    const held = latch(), release = latch(), rollback = new Error("Rollback synthetic admission");
    const admission = sql.begin(async tx => {
      await lockWorkspaceExecutionAdmission(tx, workspace); held.release(); await release.promise;
      if (outcome === "rollback") throw rollback;
    }).catch(error => { if (error !== rollback) throw error; });
    await held.promise;
    const contender = createDatabaseClient(url!, { max: 1 });
    try {
      const [backend] = await contender`SELECT pg_backend_pid() AS pid`;
      const pause = new WorkspaceExecutionControlRepository(contender).mutate({ workspaceId: workspace, requestId: randomUUID(),
        expectedActorIncarnationId: incarnation, expectedRevision: 1, state: "paused", reason: "Synthetic later pause" }, actor);
      try { await waitForLock(backend!.pid); } finally { release.release(); }
      await admission; expect((await pause).receipt).toMatchObject({ state: "paused", revision: 2 });
      await expect(sql.begin(tx => lockWorkspaceExecutionAdmission(tx, workspace))).rejects.toMatchObject({ code: "execution_paused" });
    } finally { release.release(); await admission; await contender.end(); }
  }));
});
