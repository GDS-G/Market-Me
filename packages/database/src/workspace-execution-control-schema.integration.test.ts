import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";

const url = process.env.DATABASE_URL;
if (url && new URL(url).pathname !== "/market_me_ci") throw new Error("Execution-control migration tests require isolated market_me_ci.");
let sql: DatabaseClient;
type Fixture = { tx: TransactionSql; workspace: string; actor: string; incarnation: string; createdAt: Date };
async function migrated(run: (f: Fixture) => Promise<void>) {
  const rollback = new Error("Rollback isolated execution-control schema");
  await expect(sql.begin(async tx => {
    const schema = `qa_execution_${randomUUID().replaceAll("-", "")}`;
    const workspace = randomUUID(), actor = randomUUID(), incarnation = randomUUID();
    await tx`CREATE SCHEMA ${tx(schema)}`; await tx`SET LOCAL search_path TO ${tx(schema)},public`;
    await tx`CREATE TABLE workspace(id uuid PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now())`;
    await tx`CREATE TABLE app_user(id uuid PRIMARY KEY)`;
    await tx`CREATE TABLE workspace_membership(workspace_id uuid REFERENCES workspace ON DELETE CASCADE,
      user_id uuid REFERENCES app_user ON DELETE CASCADE,role text NOT NULL,incarnation_id uuid NOT NULL,revoked_at timestamptz)`;
    await tx`CREATE VIEW active_workspace_membership WITH(security_invoker=true) AS SELECT * FROM workspace_membership WHERE revoked_at IS NULL`;
    const [before] = await tx`INSERT INTO workspace(id) VALUES(${workspace}) RETURNING created_at`;
    await tx`INSERT INTO app_user VALUES(${actor})`;
    await tx`INSERT INTO workspace_membership(workspace_id,user_id,role,incarnation_id) VALUES(${workspace},${actor},'owner',${incarnation})`;
    await tx.unsafe(await readFile(new URL("../migrations/0127_workspace_execution_control.sql", import.meta.url), "utf8"));
    await run({ tx, workspace, actor, incarnation, createdAt: before!.createdAt }); throw rollback;
  })).rejects.toBe(rollback);
}
async function pause(f: Fixture) {
  await f.tx`UPDATE workspace_execution_control SET state='paused',revision=2,reason='Synthetic pause',
    updated_by=${f.actor},updated_by_incarnation_id=${f.incarnation},updated_at=clock_timestamp() WHERE workspace_id=${f.workspace}`;
}
function request(f: Fixture) {
  return { workspaceId: f.workspace, requestId: randomUUID(), expectedActorIncarnationId: f.incarnation,
    expectedRevision: 1, state: "paused", reason: "Synthetic pause" };
}
async function insertReceipt(f: Fixture, canonical = request(f), overrides: Record<string, unknown> = {}) {
  const row = { workspaceId: f.workspace, requestId: canonical.requestId,
    createdBy: f.actor, expectedActorIncarnationId: f.incarnation, expectedRevision: 1, previousState: "open", state: "paused",
    revision: 2, reason: "Synthetic pause", canonicalRequest: JSON.stringify(canonical), ...overrides };
  const changedAt = overrides.changedAt === undefined ? f.tx`updated_at`
    : f.tx`${overrides.changedAt instanceof Date ? overrides.changedAt.toISOString() : String(overrides.changedAt)}::text::timestamptz`;
  return f.tx`INSERT INTO workspace_execution_control_receipt
    (workspace_id,request_id,created_by,expected_actor_incarnation_id,expected_revision,previous_state,state,revision,reason,changed_at,canonical_request)
    SELECT ${row.workspaceId},${row.requestId},${row.createdBy},${row.expectedActorIncarnationId},${row.expectedRevision},${row.previousState},
      ${row.state},${row.revision},${row.reason},${changedAt},${row.canonicalRequest}
    FROM workspace_execution_control WHERE workspace_id=${f.workspace}`;
}

describe.skipIf(!url)("workspace execution-control migration in rollback-only schemas", () => {
  beforeAll(() => { sql = createDatabaseClient(url!); }); afterAll(async () => { await sql?.end(); });
  it("backfills one unattributed open revision while preserving workspace creation time", async () => migrated(async f => {
    expect(await f.tx`SELECT * FROM workspace_execution_control`).toEqual([{ workspaceId: f.workspace, state: "open", revision: 1,
      reason: "", updatedBy: null, updatedByIncarnationId: null, createdAt: f.createdAt, updatedAt: f.createdAt }]);
  }));
  it("initializes every subsequent workspace independently with matching timestamps", async () => migrated(async f => {
    const next = randomUUID(); await f.tx`INSERT INTO workspace(id) VALUES(${next})`;
    expect(await f.tx`SELECT state,revision,reason,updated_by,updated_at=created_at AS same_time FROM workspace_execution_control WHERE workspace_id=${next}`)
      .toEqual([{ state: "open", revision: 1, reason: "", updatedBy: null, sameTime: true }]);
    expect(await f.tx`SELECT * FROM workspace_execution_control`).toHaveLength(2);
  }));
  it.each(["editor", "approver", "analyst", "viewer"])("does not accept a direct %s state transition", async role => migrated(async f => {
    await f.tx`UPDATE workspace_membership SET role=${role}`;
    await expect(f.tx.savepoint(tx => pause({ ...f, tx }))).rejects.toMatchObject({ code: "23514" });
  }));
  it("rejects revoked or replaced administrator grants", async () => migrated(async f => {
    await f.tx`UPDATE workspace_membership SET revoked_at=clock_timestamp()`;
    await expect(f.tx.savepoint(tx => pause({ ...f, tx }))).rejects.toMatchObject({ code: "23514" });
    await f.tx`UPDATE workspace_membership SET revoked_at=NULL,incarnation_id=gen_random_uuid()`;
    await expect(f.tx.savepoint(tx => pause({ ...f, tx }))).rejects.toMatchObject({ code: "23514" });
  }));
  it("requires an actual state change and exactly one revision while preserving identity", async () => migrated(async f => {
    await pause(f);
    for (const values of [{ revision: 1 }, { revision: 4, state: "open" }, { revision: 3, reason: "Another reason" },
      { revision: 3, state: "open", createdAt: new Date(0) }, { revision: 3, state: "open", reason: "" }]) {
      await expect(f.tx.savepoint(tx => tx`UPDATE workspace_execution_control SET ${tx(values)} WHERE workspace_id=${f.workspace}`))
        .rejects.toMatchObject({ code: "23514" });
    }
    await f.tx`UPDATE workspace_execution_control SET state=state WHERE workspace_id=${f.workspace}`;
    await f.tx`UPDATE workspace_execution_control SET state='open',revision=3,reason='Reviewed reopening',updated_at=clock_timestamp() WHERE workspace_id=${f.workspace}`;
    expect(await f.tx`SELECT state,revision FROM workspace_execution_control`).toEqual([{ state: "open", revision: 3 }]);
  }));
  it("requires exact transition evidence for the receipt, including sub-millisecond timestamp", async () => migrated(async f => {
    await pause(f);
    for (const override of [{ changedAt: new Date(0) }, { createdBy: randomUUID() }, { expectedActorIncarnationId: randomUUID() },
      { state: "open" }, { revision: 3 }, { reason: "Changed reason" }]) {
      await expect(f.tx.savepoint(tx => insertReceipt({ ...f, tx }, request(f), override))).rejects.toMatchObject({ code: "23514" });
    }
    await insertReceipt(f);
    expect(await f.tx`SELECT r.changed_at=c.updated_at AS exact_time FROM workspace_execution_control_receipt r
      JOIN workspace_execution_control c USING(workspace_id)`).toEqual([{ exactTime: true }]);
  }));
  it.each(["missing", "extra", "wrong-type", "wrong-scope", "array", "null"])("rejects %s canonical evidence", async variant => migrated(async f => {
    await pause(f); const canonical = request(f); const raw: Record<string, unknown> = { ...canonical };
    if (variant === "missing") delete raw.reason;
    if (variant === "extra") raw.actorUserId = f.actor;
    if (variant === "wrong-type") raw.expectedRevision = "1";
    if (variant === "wrong-scope") raw.workspaceId = randomUUID();
    const canonicalRequest = JSON.stringify(variant === "array" ? [raw] : variant === "null" ? null : raw);
    await expect(f.tx.savepoint(tx => insertReceipt({ ...f, tx }, canonical, { canonicalRequest }))).rejects.toMatchObject({ code: "23514" });
  }));
  it("retains immutable control/history under direct deletion but allows parent-workspace cascade", async () => migrated(async f => {
    await pause(f); await insertReceipt(f);
    await expect(f.tx.savepoint(tx => tx`DELETE FROM workspace_execution_control`)).rejects.toMatchObject({ code: "23514" });
    await expect(f.tx.savepoint(tx => tx`DELETE FROM workspace_execution_control_receipt`)).rejects.toMatchObject({ code: "23514" });
    await expect(f.tx.savepoint(tx => tx`UPDATE workspace_execution_control_receipt SET reason=reason`)).rejects.toMatchObject({ code: "23514" });
    await expect(f.tx.savepoint(tx => tx`DELETE FROM app_user WHERE id=${f.actor}`)).rejects.toMatchObject({ code: "23001" });
    await f.tx`DELETE FROM workspace WHERE id=${f.workspace}`;
    expect(await f.tx`SELECT * FROM workspace_execution_control`).toHaveLength(0);
    expect(await f.tx`SELECT * FROM workspace_execution_control_receipt`).toHaveLength(0);
  }));
});
