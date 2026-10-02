import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { AccountSessionRepository } from "./account-session-repository";

const url = process.env.DATABASE_URL;
if (url && new URL(url).pathname !== "/market_me_ci" && !new URL(url).pathname.startsWith("/market_me_qa_151_")) throw new Error("Session integration requires an isolated CI or QA151 database.");
let sql: DatabaseClient;
async function fixture() {
  const core = new MarketMeRepository(sql), repository = new AccountSessionRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({ email: `session-${randomUUID()}@market-me.local`, displayName: "Synthetic session account" });
  const addSession = async (expiresAt = new Date(Date.now() + 86_400_000), createdAt = new Date()) => {
    const tokenHash = randomBytes(32).toString("base64url");
    const [row] = await sql<{ sessionId: string }[]>`INSERT INTO app_session(token_hash,user_id,expires_at,created_at)
      VALUES (${tokenHash},${user.id},${expiresAt},${createdAt}) RETURNING session_id`;
    return { sessionId: row!.sessionId, actor: { accountId: user.id, tokenHash } };
  };
  const current = await addSession(), other = await addSession();
  return { core, repository, user, workspace, current, other, addSession,
    request: { accountId: user.id, requestId: randomUUID(), targetSessionId: other.sessionId },
    cleanup: async () => {
      await sql`DELETE FROM audit_event WHERE actor_user_id=${user.id} AND subject_type='account_session'`;
      await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`;
      await sql`DELETE FROM app_user WHERE id=${user.id}`;
    } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function using(run: (f: Fixture) => Promise<void>) { const f = await fixture(); try { await run(f); } finally { await f.cleanup(); } }
const counts = async (id: string) => (await sql`SELECT (SELECT count(*)::int FROM account_session_receipt WHERE account_id=${id}) AS receipts,
  (SELECT count(*)::int FROM audit_event WHERE actor_user_id=${id} AND subject_type='account_session') AS audits`)[0];

describe.skipIf(!url)("own-account session persistence", () => {
  beforeAll(() => { sql = createDatabaseClient(url!); });
  afterAll(async () => { await sql?.end(); });

  it("migrates existing sessions without changing tokens, accounts or timestamps", async () => {
    const source = await readFile(new URL("../migrations/0124_account_session_controls.sql", import.meta.url), "utf8");
    const rollback = new Error("Rollback isolated migration fixture");
    await expect(sql.begin(async tx => {
      const schema = `qa_session_${randomUUID().replaceAll("-", "")}`;
      await tx`CREATE SCHEMA ${tx(schema)}`; await tx`SET LOCAL search_path TO ${tx(schema)},public`;
      await tx`CREATE TABLE app_user(id uuid PRIMARY KEY)`;
      await tx`CREATE TABLE app_session(token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,last_seen_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now())`;
      const account = randomUUID(); await tx`INSERT INTO app_user VALUES (${account})`;
      await tx`INSERT INTO app_session VALUES ('synthetic-migration-hash',${account},now()+interval '1 day',now(),now())`;
      const before = (await tx`SELECT * FROM app_session`)[0]; await tx.unsafe(source);
      // A changed SELECT * result invalidates PostgreSQL's prepared plan; production restarts after migration.
      const after = (await tx`SELECT token_hash,user_id,expires_at,last_seen_at,created_at,session_id FROM app_session`)[0]!; expect(after).toMatchObject(before!);
      expect(after.sessionId).toMatch(/^[0-9a-f-]{36}$/); throw rollback;
    })).rejects.toBe(rollback);
  });

  it.each(["owner", "admin", "approver", "editor", "analyst", "viewer"])("lists and revokes only its own session regardless of role %s", async role => using(async f => {
    await sql`UPDATE workspace_membership SET role=${role} WHERE user_id=${f.user.id}`;
    const users = await sql`SELECT * FROM app_user WHERE id=${f.user.id}`, memberships = await sql`SELECT * FROM workspace_membership WHERE user_id=${f.user.id}`;
    const before = await f.repository.list(f.user.id, f.current.actor);
    expect(before).toMatchObject({ accountId: f.user.id, current: { sessionId: f.current.sessionId }, totalOthers: "1", nextCursor: null });
    expect(before.others.map(s => s.sessionId)).toEqual([f.other.sessionId]);
    expect(JSON.stringify(before)).not.toMatch(/token|hash|email|device|browser|location/i);
    const result = await f.repository.revoke(f.request, f.current.actor);
    expect(result).toMatchObject({ replayed: false, receipt: f.request });
    expect(Object.keys(result.receipt)).toEqual(["accountId", "requestId", "targetSessionId", "revokedAt"]);
    expect(await f.core.getSession(f.other.actor.tokenHash)).toBeUndefined();
    expect(await f.core.getSession(f.current.actor.tokenHash)).toMatchObject({ id: f.user.id });
    expect((await f.repository.list(f.user.id, f.current.actor)).totalOthers).toBe("0");
    expect(await sql`SELECT * FROM app_user WHERE id=${f.user.id}`).toEqual(users);
    expect(await sql`SELECT * FROM workspace_membership WHERE user_id=${f.user.id}`).toEqual(memberships);
    const [audit] = await sql`SELECT * FROM audit_event WHERE actor_user_id=${f.user.id}`;
    expect(audit).toMatchObject({ eventType: "account.session_revoked", subjectType: "account_session", subjectId: f.other.sessionId,
      actorUserId: f.user.id, organizationId: null, workspaceId: null, data: { requestId: f.request.requestId, actorSessionId: f.current.sessionId, targetSessionId: f.other.sessionId } });
    expect(JSON.stringify(audit)).not.toContain(f.current.actor.tokenHash); expect(await counts(f.user.id)).toEqual({ receipts: 1, audits: 1 });
  }));

  it("requires no workspace membership and never rewrites profile settings", async () => using(async f => {
    await sql`UPDATE workspace_membership SET revoked_at=clock_timestamp() WHERE user_id=${f.user.id}`;
    expect((await f.repository.list(f.user.id, f.current.actor)).current.sessionId).toBe(f.current.sessionId);
    expect((await f.repository.revoke(f.request, f.current.actor)).replayed).toBe(false);
  }));

  it("rejects foreign account hints and invalid server context before SQL", async () => {
    const query = vi.fn(), repo = new AccountSessionRepository(query as unknown as DatabaseClient);
    const account = randomUUID(), actor = { accountId: randomUUID(), tokenHash: randomBytes(32).toString("base64url") };
    await expect(repo.list(account, actor)).rejects.toMatchObject({ code: "access_denied" });
    await expect(repo.getReceipt(account, randomUUID(), actor)).rejects.toMatchObject({ code: "access_denied" });
    await expect(repo.revoke({ accountId: account, requestId: randomUUID(), targetSessionId: randomUUID() }, actor)).rejects.toMatchObject({ code: "access_denied" });
    await expect(repo.list(account, { accountId: account, tokenHash: "not-a-hash" })).rejects.toMatchObject({ code: "authentication_required" });
    expect(query).not.toHaveBeenCalled();
  });

  it("does not reveal foreign target existence or alter another account", async () => using(async f => using(async other => {
    const before = await sql`SELECT * FROM app_session WHERE user_id=${other.user.id}`;
    for (const targetSessionId of [other.current.sessionId, randomUUID()]) await expect(f.repository.revoke({ ...f.request, targetSessionId }, f.current.actor)).rejects.toMatchObject({ code: "not_found" });
    expect(await sql`SELECT * FROM app_session WHERE user_id=${other.user.id}`).toEqual(before); expect(await counts(f.user.id)).toEqual({ receipts: 0, audits: 0 });
  })));

  it("rejects current-session targets and preserves the existing Sign out path", async () => using(async f => {
    await expect(f.repository.revoke({ ...f.request, targetSessionId: f.current.sessionId }, f.current.actor)).rejects.toMatchObject({ code: "current_session" });
    expect(await f.core.getSession(f.current.actor.tokenHash)).toMatchObject({ id: f.user.id });
    await f.core.deleteSession(f.current.actor.tokenHash);
    await expect(f.repository.list(f.user.id, f.current.actor)).rejects.toMatchObject({ code: "authentication_required" });
  }));

  it.each(["expired", "deleted", "foreign"])("rejects a %s caller for reads, replay and writes", async state => using(async f => using(async foreign => {
    await f.repository.revoke(f.request, f.current.actor);
    if (state === "expired") await sql`UPDATE app_session SET expires_at=clock_timestamp()-interval '1 second' WHERE session_id=${f.current.sessionId}`;
    if (state === "deleted") await f.core.deleteSession(f.current.actor.tokenHash);
    const actor = state === "foreign" ? { accountId: f.user.id, tokenHash: foreign.current.actor.tokenHash } : f.current.actor;
    await expect(f.repository.list(f.user.id, actor)).rejects.toMatchObject({ code: "authentication_required" });
    await expect(f.repository.getReceipt(f.user.id, f.request.requestId, actor)).rejects.toMatchObject({ code: "authentication_required" });
    await expect(f.repository.revoke(f.request, actor)).rejects.toMatchObject({ code: "authentication_required" });
    expect(await counts(f.user.id)).toEqual({ receipts: 1, audits: 1 });
  })));

  it("excludes expired targets and never fabricates a receipt for their removal", async () => using(async f => {
    await sql`UPDATE app_session SET expires_at=clock_timestamp()-interval '1 second' WHERE session_id=${f.other.sessionId}`;
    expect((await f.repository.list(f.user.id, f.current.actor)).others).toEqual([]);
    await expect(f.repository.revoke(f.request, f.current.actor)).rejects.toMatchObject({ code: "not_found" });
    expect(await f.repository.getReceipt(f.user.id, f.request.requestId, f.current.actor)).toBeUndefined();
    expect(await counts(f.user.id)).toEqual({ receipts: 0, audits: 0 });
  }));

  it("records one outcome for six concurrent exact retries, including later same-account sessions", async () => using(async f => {
    const results = await Promise.all(Array.from({ length: 6 }, () => f.repository.revoke(f.request, f.current.actor)));
    expect(results.filter(r => !r.replayed)).toHaveLength(1); expect(new Set(results.map(r => JSON.stringify(r.receipt))).size).toBe(1);
    const later = await f.addSession(); expect(await f.repository.revoke(f.request, later.actor)).toEqual({ receipt: results[0]!.receipt, replayed: true });
    expect(await f.repository.getReceipt(f.user.id, f.request.requestId, later.actor)).toEqual(results[0]!.receipt);
    expect(await counts(f.user.id)).toEqual({ receipts: 1, audits: 1 });
  }));

  it("rejects changed key reuse and a new key for an already removed target", async () => using(async f => {
    await f.repository.revoke(f.request, f.current.actor); const third = await f.addSession();
    await expect(f.repository.revoke({ ...f.request, targetSessionId: third.sessionId }, f.current.actor)).rejects.toMatchObject({ code: "request_conflict" });
    await expect(f.repository.revoke({ ...f.request, requestId: randomUUID() }, f.current.actor)).rejects.toMatchObject({ code: "not_found" });
    expect(await f.core.getSession(third.actor.tokenHash)).toMatchObject({ id: f.user.id });
  }));

  it("serializes mutually revoking sessions to one winner without stale authority", async () => using(async f => {
    const results = await Promise.allSettled([f.repository.revoke(f.request, f.current.actor),
      f.repository.revoke({ ...f.request, requestId: randomUUID(), targetSessionId: f.current.sessionId }, f.other.actor)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "authentication_required" } });
    expect(await counts(f.user.id)).toEqual({ receipts: 1, audits: 1 });
    expect(await sql`SELECT session_id FROM app_session WHERE user_id=${f.user.id}`).toHaveLength(1);
  }));

  it.each([true, false])("revalidates caller expiry after a held session lock commits=%s", async commit => using(async f => {
    let ready!: () => void, release!: () => void;
    const locked = new Promise<void>(resolve => { ready = resolve; }), unblock = new Promise<void>(resolve => { release = resolve; });
    const rollback = new Error("Synthetic expiry rollback");
    const blocker = sql.begin(async tx => {
      await tx`SELECT session_id FROM app_session WHERE session_id=${f.current.sessionId} FOR UPDATE`;
      await tx`UPDATE app_session SET expires_at=clock_timestamp()-interval '1 second' WHERE session_id=${f.current.sessionId}`;
      ready(); await unblock; if (!commit) throw rollback;
    }).catch(error => { if (error !== rollback) throw error; });
    await locked;
    const operation = f.repository.revoke(f.request, f.current.actor).then(value => ({ value }), error => ({ error }));
    try {
      let waiting = false;
      for (let tries = 0; tries < 150; tries++) {
        const [state] = await sql`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND query LIKE '%ORDER BY session_id FOR UPDATE%') AS waiting`;
        if (state!.waiting) { waiting = true; break; } await delay(20);
      }
      expect(waiting).toBe(true);
    } finally { release(); }
    await blocker; const result = await operation;
    if (commit) { expect(result).toMatchObject({ error: { code: "authentication_required" } }); expect(await counts(f.user.id)).toEqual({ receipts: 0, audits: 0 }); }
    else { expect(result).toMatchObject({ value: { replayed: false } }); expect(await counts(f.user.id)).toEqual({ receipts: 1, audits: 1 }); }
  }));

  it.each([true, false])("orders mutual revocation from either winning caller first=%s", async firstWins => using(async f => {
    const winner = firstWins ? f.current : f.other, loser = firstWins ? f.other : f.current;
    const selected = { ...f.request, targetSessionId: loser.sessionId };
    const success = await f.repository.revoke(selected, winner.actor);
    await expect(f.repository.revoke({ ...f.request, requestId: randomUUID(), targetSessionId: winner.sessionId }, loser.actor)).rejects.toMatchObject({ code: "authentication_required" });
    expect(await f.repository.getReceipt(f.user.id, selected.requestId, winner.actor)).toEqual(success.receipt);
    expect(await counts(f.user.id)).toEqual({ receipts: 1, audits: 1 });
  }));

  it("permits one new-key winner when two own sessions remove the same selected target", async () => using(async f => {
    const third = await f.addSession(); const results = await Promise.allSettled([f.repository.revoke(f.request, f.current.actor),
      f.repository.revoke({ ...f.request, requestId: randomUUID() }, third.actor)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "not_found" } });
    expect(await counts(f.user.id)).toEqual({ receipts: 1, audits: 1 });
  }));

  it("rolls back selected deletion and receipt if the audit cannot persist", async () => using(async f => {
    const wrapped = new Proxy(sql, { get(target, property) {
      if (property !== "begin") return Reflect.get(target, property);
      return (run: (tx: TransactionSql) => Promise<unknown>) => sql.begin(tx => run(new Proxy(tx, { apply(target, thisArg, args) {
        if (Array.isArray(args[0]) && args[0].join("").includes("INSERT INTO audit_event")) throw new Error("Synthetic audit failure");
        return Reflect.apply(target, thisArg, args);
      } })));
    } });
    await expect(new AccountSessionRepository(wrapped).revoke(f.request, f.current.actor)).rejects.toThrow("Synthetic audit failure");
    expect(await f.core.getSession(f.other.actor.tokenHash)).toMatchObject({ id: f.user.id }); expect(await counts(f.user.id)).toEqual({ receipts: 0, audits: 0 });
  }));

  it("protects public identity and receipt history while permitting account deletion cascade", async () => using(async f => {
    await expect(sql`UPDATE app_session SET session_id=${randomUUID()} WHERE session_id=${f.current.sessionId}`).rejects.toMatchObject({ code: "23514" });
    await f.repository.revoke(f.request, f.current.actor);
    await expect(sql`UPDATE account_session_receipt SET revoked_at=now() WHERE account_id=${f.user.id}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`DELETE FROM account_session_receipt WHERE account_id=${f.user.id}`).rejects.toMatchObject({ code: "23514" });
    await sql`DELETE FROM audit_event WHERE actor_user_id=${f.user.id} AND subject_type='account_session'`;
    await sql`DELETE FROM app_user WHERE id=${f.user.id}`;
    expect(await counts(f.user.id)).toEqual({ receipts: 0, audits: 0 });
    expect(await sql`SELECT session_id FROM app_session WHERE user_id=${f.user.id}`).toEqual([]);
  }));

  it("paginates exact microsecond ties without duplicates and keeps current session separate", async () => using(async f => {
    await f.core.deleteSession(f.other.actor.tokenHash);
    const expected: string[] = [];
    for (let i = 0; i < 65; i++) {
      const [row] = await sql<{ sessionId: string }[]>`INSERT INTO app_session(token_hash,user_id,expires_at,created_at)
        VALUES (${randomBytes(32).toString("base64url")},${f.user.id},clock_timestamp()+interval '1 day',${`2026-01-01T00:00:00.${i < 33 ? "000001" : "000002"}Z`}::text::timestamptz) RETURNING session_id`;
      expected.push(row!.sessionId);
    }
    const before = await sql`SELECT * FROM app_session WHERE user_id=${f.user.id} ORDER BY session_id`;
    const [precision] = await sql`SELECT count(DISTINCT created_at)::int AS groups,min(to_char(created_at,'US')) AS first_microsecond,max(to_char(created_at,'US')) AS last_microsecond
      FROM app_session WHERE user_id=${f.user.id} AND session_id<>${f.current.sessionId}`;
    expect(precision).toEqual({ groups: 2, firstMicrosecond: "000001", lastMicrosecond: "000002" });
    const first = await f.repository.list(f.user.id, f.current.actor); expect(first.others).toHaveLength(30); expect(first.nextCursor).not.toBeNull();
    const second = await f.repository.list(f.user.id, f.current.actor, first.nextCursor!); expect(second.others).toHaveLength(30); expect(second.nextCursor).not.toBeNull();
    const third = await f.repository.list(f.user.id, f.current.actor, second.nextCursor!);
    expect([first.others.length, second.others.length, third.others.length]).toEqual([30, 30, 5]);
    expect([first.totalOthers, second.totalOthers, third.totalOthers]).toEqual(["65", "65", "65"]); expect(third.nextCursor).toBeNull();
    const ids = [...first.others, ...second.others, ...third.others].map(s => s.sessionId); expect(new Set(ids).size).toBe(65); expect(ids.sort()).toEqual(expected.sort());
    expect(await sql`SELECT * FROM app_session WHERE user_id=${f.user.id} ORDER BY session_id`).toEqual(before);
    const later = await f.addSession(); await expect(f.repository.list(f.user.id, later.actor, first.nextCursor!)).rejects.toMatchObject({ code: "invalid_input" });
  }));
});
