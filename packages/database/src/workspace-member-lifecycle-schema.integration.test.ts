import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";

const url = process.env.DATABASE_URL;
if (url && new URL(url).pathname !== "/market_me_ci") throw new Error("Member grant migration tests require the isolated CI database.");
let sql: DatabaseClient;
const guardSources = [
  ["0116_source_preparation_recovery_hardening.sql", "validate_source_preparation_binding"],
  ["0117_guided_source_setup.sql", "protect_smart_source_setup_receipt"],
  ["0118_preparation_presets.sql", "protect_preparation_preset_history"],
  ["0119_workspace_management.sql", "protect_workspace_management_receipt"],
  ["0120_workspace_member_roles.sql", "protect_workspace_member_role_receipt"],
  ["0121_ai_policy_save_recovery.sql", "protect_workspace_ai_policy_save_receipt"],
] as const;
async function source(file: string) { return readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"); }
function functionBody(source: string, name: string) {
  const match = source.match(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${name}\\(\\)[\\s\\S]+?\\$\\$;`));
  if (!match) throw new Error(`Missing original guard ${name}`);
  return match[0];
}
type Fixture = { tx: TransactionSql; workspace: string; user: string; before: Record<string, unknown>; schema: string };
async function migrated(run: (fixture: Fixture) => Promise<void>) {
  const rollback = new Error("Rollback isolated member grant migration fixture");
  await expect(sql.begin(async tx => {
    const schema = `qa_member_${randomUUID().replaceAll("-", "")}`, workspace = randomUUID(), user = randomUUID();
    await tx`CREATE SCHEMA ${tx(schema)}`; await tx`SET LOCAL search_path TO ${tx(schema)},public`;
    await tx`CREATE TABLE workspace(id uuid PRIMARY KEY)`; await tx`CREATE TABLE app_user(id uuid PRIMARY KEY)`;
    await tx`CREATE TABLE workspace_membership(workspace_id uuid REFERENCES workspace(id) ON DELETE CASCADE,
      user_id uuid REFERENCES app_user(id) ON DELETE CASCADE,role text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
      role_revision integer NOT NULL DEFAULT 1 CHECK(role_revision>0),PRIMARY KEY(workspace_id,user_id))`;
    await tx.unsafe(functionBody(await source("0120_workspace_member_roles.sql"), "guard_workspace_member_role_revision"));
    await tx`CREATE TRIGGER workspace_member_role_revision_guard BEFORE INSERT OR UPDATE ON workspace_membership
      FOR EACH ROW EXECUTE FUNCTION guard_workspace_member_role_revision()`;
    for (const [file, name] of guardSources) await tx.unsafe(functionBody(await source(file), name));
    await tx`INSERT INTO workspace VALUES (${workspace})`; await tx`INSERT INTO app_user VALUES (${user})`;
    await tx`INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES (${workspace},${user},'editor')`;
    const before = (await tx`SELECT workspace_id,user_id,role,created_at,role_revision FROM workspace_membership`)[0]!;
    await tx.unsafe(await source("0125_workspace_member_grants.sql"));
    await run({ tx, workspace, user, before, schema }); throw rollback;
  })).rejects.toBe(rollback);
}
const row = async (f: Fixture) => (await f.tx`SELECT workspace_id,user_id,role,created_at,role_revision,incarnation_id,revoked_at FROM workspace_membership`)[0]!;
const revoke = async (f: Fixture) => f.tx`UPDATE workspace_membership SET revoked_at=clock_timestamp() WHERE workspace_id=${f.workspace} AND user_id=${f.user}`;

describe.skipIf(!url)("retained membership grant migration in rollback-only schemas", () => {
  beforeAll(() => { sql = createDatabaseClient(url!); }); afterAll(async () => { await sql?.end(); });
  it("preserves original identity/role/revision and exposes only an active invoker view", async () => migrated(async f => {
    expect(await row(f)).toMatchObject({ ...f.before, revokedAt: null, incarnationId: expect.any(String) });
    expect(await f.tx`SELECT * FROM active_workspace_membership`).toHaveLength(1);
    const [view] = await f.tx`SELECT reloptions FROM pg_class WHERE oid='active_workspace_membership'::regclass`;
    expect(view.reloptions).toContain("security_invoker=true"); expect(view.reloptions).toContain("check_option=local");
  }));
  it("replaces only the nine active-authority references in all six reviewed guards", async () => migrated(async f => {
    for (const [file, name] of guardSources) {
      const original = functionBody(await source(file), name);
      const originalBody = original.slice(original.indexOf("$$") + 2, original.lastIndexOf("$$"));
      const [guard] = await f.tx`SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=${f.schema} AND p.proname=${name}`;
      expect(guard.prosrc).toBe(originalBody.replace(/\bworkspace_membership\b/g, "active_workspace_membership"));
    }
  }));
  it("revokes without deleting identity and regrants with a new incarnation and monotonic revision", async () => migrated(async f => {
    const initial = await row(f); await revoke(f); const removed = await row(f);
    expect(removed).toMatchObject({ ...f.before, roleRevision: 2, incarnationId: initial.incarnationId, revokedAt: expect.any(Date) });
    expect(await f.tx`SELECT * FROM active_workspace_membership`).toHaveLength(0);
    await f.tx`UPDATE workspace_membership SET revoked_at=NULL,incarnation_id=gen_random_uuid(),role='viewer' WHERE user_id=${f.user}`;
    const joined = await row(f); expect(joined).toMatchObject({ ...f.before, role: "viewer", roleRevision: 3, revokedAt: null });
    expect(joined.incarnationId).not.toBe(initial.incarnationId); expect(await f.tx`SELECT * FROM active_workspace_membership`).toHaveLength(1);
  }));
  it("cannot recycle identity by deletion or reset a role revision", async () => migrated(async f => {
    await expect(f.tx.savepoint(tx => tx`DELETE FROM workspace_membership WHERE user_id=${f.user}`)).rejects.toMatchObject({ code: "23514" });
    await revoke(f);
    await expect(f.tx.savepoint(tx => tx`UPDATE workspace_membership SET revoked_at=NULL WHERE user_id=${f.user}`)).rejects.toMatchObject({ code: "23514" });
    await expect(f.tx.savepoint(tx => tx`UPDATE workspace_membership SET role_revision=1 WHERE user_id=${f.user}`)).rejects.toMatchObject({ code: "23514" });
    await expect(f.tx.savepoint(tx => tx`UPDATE workspace_membership SET role='admin' WHERE user_id=${f.user}`)).rejects.toMatchObject({ code: "23514" });
    await expect(f.tx.savepoint(tx => tx`UPDATE workspace_membership SET revoked_at=clock_timestamp() WHERE user_id=${f.user}`)).rejects.toMatchObject({ code: "23514" });
  }));
  it("keeps both restrictive provenance and formerly cascading member records", async () => migrated(async f => {
    await f.tx`CREATE TABLE history(workspace_id uuid,user_id uuid,note text,FOREIGN KEY(workspace_id,user_id) REFERENCES workspace_membership ON DELETE RESTRICT)`;
    await f.tx`CREATE TABLE personal_state(workspace_id uuid,user_id uuid,note text,FOREIGN KEY(workspace_id,user_id) REFERENCES workspace_membership ON DELETE CASCADE)`;
    await f.tx`INSERT INTO history VALUES (${f.workspace},${f.user},'Original attribution')`;
    await f.tx`INSERT INTO personal_state VALUES (${f.workspace},${f.user},'Original read state')`;
    const history = await f.tx`SELECT * FROM history`, personal = await f.tx`SELECT * FROM personal_state`;
    await revoke(f); expect(await f.tx`SELECT * FROM history`).toEqual(history); expect(await f.tx`SELECT * FROM personal_state`).toEqual(personal);
  }));
  it("preserves whole-workspace and account cascade semantics for unreferenced identities", async () => migrated(async f => {
    const second = randomUUID(); await f.tx`INSERT INTO app_user VALUES (${second})`;
    await f.tx`INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES (${f.workspace},${second},'viewer')`;
    await f.tx`DELETE FROM app_user WHERE id=${second}`; expect(await f.tx`SELECT * FROM workspace_membership`).toHaveLength(1);
    await f.tx`DELETE FROM workspace WHERE id=${f.workspace}`; expect(await f.tx`SELECT * FROM workspace_membership`).toHaveLength(0);
  }));
  it("supports row locks and updates through the current-grant projection", async () => migrated(async f => {
    expect(await f.tx`SELECT role FROM active_workspace_membership WHERE user_id=${f.user} FOR UPDATE`).toEqual([{ role: "editor" }]);
    await f.tx`UPDATE active_workspace_membership SET role='analyst' WHERE user_id=${f.user}`;
    expect(await row(f)).toMatchObject({ role: "analyst", roleRevision: 2 });
    await revoke(f); expect(await f.tx`UPDATE active_workspace_membership SET role='admin' WHERE user_id=${f.user} RETURNING user_id`).toHaveLength(0);
  }));
});
