import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { AccountProfileRepository } from "./account-profile-repository";
import type { TransactionSql } from "postgres";

const url = process.env.DATABASE_URL;
if (url && new URL(url).pathname !== "/market_me_ci" && !new URL(url).pathname.startsWith("/market_me_qa_150_")) {
  throw new Error("Account profile integration requires isolated market_me_ci or market_me_qa_150_*.");
}
let sql: DatabaseClient;
async function fixture() {
  const core = new MarketMeRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({ email: `profile-${randomUUID()}@market-me.local`, displayName: "Synthetic profile" });
  return { core, user, workspace, repository: new AccountProfileRepository(sql),
    request: { accountId: user.id, requestId: randomUUID(), expectedRevision: 1, displayName: "Café Reader" },
    cleanup: async () => {
      await sql`DELETE FROM audit_event WHERE actor_user_id=${user.id} AND subject_type='account_profile'`;
      await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`;
      await sql`DELETE FROM app_user WHERE id=${user.id}`;
    } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function using(run: (f: Fixture) => Promise<void>) { const f = await fixture(); try { await run(f); } finally { await f.cleanup(); } }
const counts = async (id: string) => (await sql`SELECT
  (SELECT count(*)::int FROM account_profile_receipt WHERE account_id=${id}) AS receipts,
  (SELECT count(*)::int FROM audit_event WHERE actor_user_id=${id} AND subject_type='account_profile') AS audits`)[0];

describe.skipIf(!url)("account display-name persistence", () => {
  beforeAll(() => { sql = createDatabaseClient(url!); });
  afterAll(async () => { await sql?.end(); });

  it.each(["owner", "admin", "approver", "editor", "analyst", "viewer"])("allows only the own account independently of workspace role %s", async role => using(async f => {
    await sql`UPDATE workspace_membership SET role=${role} WHERE user_id=${f.user.id}`;
    const before = (await sql`SELECT * FROM app_user WHERE id=${f.user.id}`)[0]!;
    const memberships = await sql`SELECT * FROM workspace_membership WHERE user_id=${f.user.id}`;
    const orgMemberships = await sql`SELECT * FROM organization_membership WHERE user_id=${f.user.id}`;
    const result = await f.repository.save(f.request, f.user.id);
    expect(result).toMatchObject({ replayed: false, receipt: { accountId: f.user.id, requestId: f.request.requestId, displayName: "Café Reader", revision: 2, changed: true } });
    expect(await f.repository.getProfile(f.user.id, f.user.id)).toEqual({ accountId: f.user.id, displayName: "Café Reader", revision: 2 });
    const after = (await sql`SELECT * FROM app_user WHERE id=${f.user.id}`)[0]!;
    expect(after).toMatchObject({ id: before.id, email: before.email, normalizedEmail: before.normalizedEmail, createdAt: before.createdAt });
    expect(await sql`SELECT * FROM workspace_membership WHERE user_id=${f.user.id}`).toEqual(memberships);
    expect(await sql`SELECT * FROM organization_membership WHERE user_id=${f.user.id}`).toEqual(orgMemberships);
    expect(JSON.stringify(result)).not.toMatch(/email|canonical|issuer|subject|workspace|actor/);
    expect(await counts(f.user.id)).toEqual({ receipts: 1, audits: 1 });
  }));

  it("does not require any workspace membership to edit the own label", async () => using(async f => {
    await sql`UPDATE workspace_membership SET revoked_at=clock_timestamp() WHERE user_id=${f.user.id}`;
    expect((await f.repository.save(f.request, f.user.id)).receipt.revision).toBe(2);
  }));

  it("rejects a foreign account hint before any SQL and never reveals foreign receipts", async () => {
    const query = vi.fn(); const repository = new AccountProfileRepository(query as unknown as DatabaseClient);
    const account = randomUUID(), actor = randomUUID(), key = randomUUID();
    await expect(repository.getProfile(account, actor)).rejects.toMatchObject({ code: "access_denied" });
    await expect(repository.getReceipt(account, key, actor)).rejects.toMatchObject({ code: "access_denied" });
    await expect(repository.save({ accountId: account, requestId: key, expectedRevision: 1, displayName: "Other" }, actor)).rejects.toMatchObject({ code: "access_denied" });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns no profile/receipt and cannot create a missing account", async () => {
    const id = randomUUID(), repository = new AccountProfileRepository(sql);
    expect(await repository.getProfile(id, id)).toBeUndefined();
    expect(await repository.getReceipt(id, randomUUID(), id)).toBeUndefined();
    await expect(repository.save({ accountId: id, requestId: randomUUID(), expectedRevision: 1, displayName: "Ghost" }, id)).rejects.toMatchObject({ code: "not_found" });
    expect(await sql`SELECT id FROM app_user WHERE id=${id}`).toEqual([]);
  });

  it("replays one original result after a later name without reapplying it or adding audit rows", async () => using(async f => {
    const original = await f.repository.save({ ...f.request, displayName: " Cafe\u0301  Reader " }, f.user.id);
    await f.repository.save({ ...f.request, requestId: randomUUID(), expectedRevision: 2, displayName: "Later name" }, f.user.id);
    expect(await f.repository.save(f.request, f.user.id)).toEqual({ receipt: original.receipt, replayed: true });
    expect(await f.repository.getReceipt(f.user.id, f.request.requestId, f.user.id)).toEqual(original.receipt);
    expect(await f.repository.getProfile(f.user.id, f.user.id)).toMatchObject({ displayName: "Later name", revision: 3 });
    expect(await counts(f.user.id)).toEqual({ receipts: 2, audits: 2 });
  }));

  it("serializes six exact retries to one change, one receipt and one audit", async () => using(async f => {
    const results = await Promise.all(Array.from({ length: 6 }, () => f.repository.save(f.request, f.user.id)));
    expect(results.filter(result => !result.replayed)).toHaveLength(1);
    expect(new Set(results.map(result => JSON.stringify(result.receipt))).size).toBe(1);
    expect(await counts(f.user.id)).toEqual({ receipts: 1, audits: 1 });
  }));

  it("permits only one different-name winner at the same revision", async () => using(async f => {
    const results = await Promise.allSettled(["First", "Second"].map(displayName => f.repository.save({ ...f.request, requestId: randomUUID(), displayName }, f.user.id)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "revision_conflict" } });
    expect(await counts(f.user.id)).toEqual({ receipts: 1, audits: 1 });
  }));

  it.each(["displayName", "expectedRevision"])("rejects reuse of a key with changed %s", async field => using(async f => {
    await f.repository.save(f.request, f.user.id);
    await expect(f.repository.save({ ...f.request, [field]: field === "displayName" ? "Changed" : 2 }, f.user.id)).rejects.toMatchObject({ code: "request_conflict" });
    expect(await counts(f.user.id)).toEqual({ receipts: 1, audits: 1 });
  }));

  it("records an explicit no-op without changing revision or account timestamp", async () => using(async f => {
    const before = (await sql`SELECT * FROM app_user WHERE id=${f.user.id}`)[0];
    const request = { ...f.request, displayName: f.user.displayName };
    const saved = await f.repository.save(request, f.user.id);
    expect(saved.receipt).toMatchObject({ changed: false, revision: 1, displayName: f.user.displayName });
    expect((await sql`SELECT * FROM app_user WHERE id=${f.user.id}`)[0]).toEqual(before);
    expect(await f.repository.save(request, f.user.id)).toEqual({ receipt: saved.receipt, replayed: true });
    expect(await sql`SELECT organization_id,workspace_id,actor_user_id,event_type,subject_type,subject_id,data FROM audit_event
      WHERE actor_user_id=${f.user.id} AND subject_type='account_profile'`).toEqual([{
      organizationId: null, workspaceId: null, actorUserId: f.user.id, eventType: "account.profile_saved", subjectType: "account_profile", subjectId: f.user.id,
      data: { requestId: request.requestId, previousName: f.user.displayName, previousNameTruncated: false, displayName: f.user.displayName, previousRevision: 1, revision: 1, changed: false },
    }]);
  }));

  it("rejects a stale no-op and allows a maximum-revision no-op but not a change", async () => using(async f => {
    await f.repository.save(f.request, f.user.id);
    await expect(f.repository.save({ ...f.request, requestId: randomUUID() }, f.user.id)).rejects.toMatchObject({ code: "revision_conflict" });
    const id = randomUUID(), email = `profile-limit-${id}@market-me.local`;
    await sql`INSERT INTO app_user(id,email,normalized_email,display_name,profile_revision) VALUES (${id},${email},${email},'Maximum',2147483647)`;
    try {
      const request = { accountId: id, requestId: randomUUID(), expectedRevision: 2_147_483_647, displayName: "Maximum" };
      expect((await f.repository.save(request, id)).receipt).toMatchObject({ changed: false, revision: 2_147_483_647 });
      await expect(f.repository.save({ ...request, requestId: randomUUID(), displayName: "Changed" }, id)).rejects.toMatchObject({ code: "revision_conflict" });
    } finally { await sql`DELETE FROM audit_event WHERE actor_user_id=${id}`; await sql`DELETE FROM app_user WHERE id=${id}`; }
  }));

  it("preserves chosen labels across development and linked OIDC reauthentication", async () => using(async f => {
    const issuer = "https://profile.example.test", subject = `subject-${f.user.id}`;
    await f.core.completeOidcSignIn({ issuer, subject, email: f.user.email, displayName: "Provider label", allowBootstrap: false });
    await f.repository.save(f.request, f.user.id);
    expect((await f.core.bootstrapDevelopmentWorkspace({ email: f.user.email.toUpperCase(), displayName: "Development label" })).user).toEqual({ ...f.user, displayName: "Café Reader" });
    expect(await f.core.completeOidcSignIn({ issuer, subject, email: "provider-changed@example.test", displayName: "New provider label", allowBootstrap: false }))
      .toEqual({ status: "authenticated", user: { ...f.user, displayName: "Café Reader" } });
    expect(await f.repository.getProfile(f.user.id, f.user.id)).toMatchObject({ revision: 2, displayName: "Café Reader" });
    expect(await sql`SELECT issuer,subject FROM oidc_identity WHERE user_id=${f.user.id}`).toEqual([{ issuer, subject }]);
  }));

  it("preserves a chosen name when a verified identity is linked for the first time", async () => using(async f => {
    await f.repository.save(f.request, f.user.id);
    expect(await f.core.completeOidcSignIn({ issuer: "https://profile.example.test", subject: `link-${f.user.id}`, email: f.user.email, displayName: "Provider label", allowBootstrap: false }))
      .toEqual({ status: "authenticated", user: { ...f.user, displayName: "Café Reader" } });
  }));

  it("guards direct unrevisioned edits, revision-only edits, immutable receipts and deletion while the account exists", async () => using(async f => {
    await f.repository.save(f.request, f.user.id);
    await expect(sql`UPDATE app_user SET display_name='Bypass' WHERE id=${f.user.id}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE app_user SET profile_revision=3 WHERE id=${f.user.id}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE account_profile_receipt SET display_name='Bypass' WHERE account_id=${f.user.id}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`DELETE FROM account_profile_receipt WHERE account_id=${f.user.id}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`INSERT INTO account_profile_receipt(account_id,request_id,display_name,revision,changed,canonical_request)
      VALUES (${f.user.id},${randomUUID()},'Wrong',2,true,${JSON.stringify(f.request)})`).rejects.toMatchObject({ code: "23514" });
    expect(await counts(f.user.id)).toEqual({ receipts: 1, audits: 1 });
  }));

  it("rejects a canonical receipt containing a numeric rather than string display name", async () => using(async f => {
    await f.repository.save({ ...f.request, displayName: "123" }, f.user.id);
    const requestId = randomUUID(), canonical = JSON.stringify({ accountId: f.user.id, requestId, expectedRevision: 2, displayName: 123 });
    await expect(sql`INSERT INTO account_profile_receipt(account_id,request_id,display_name,revision,changed,canonical_request)
      VALUES (${f.user.id},${requestId},'123',2,false,${canonical})`).rejects.toMatchObject({ code: "23514" });
  }));

  it("rolls back the name, revision and receipt if the account-scoped audit cannot commit", async () => using(async f => {
    const before = (await sql`SELECT * FROM app_user WHERE id=${f.user.id}`)[0];
    const failing = { begin: (callback: (tx: TransactionSql) => Promise<unknown>) => sql.begin(tx => callback(new Proxy(tx, {
      apply(target, thisArg, args) {
        if ((args[0] as TemplateStringsArray).join("").includes("INSERT INTO audit_event")) throw new Error("Synthetic audit failure");
        return Reflect.apply(target, thisArg, args);
      },
    }))) } as unknown as DatabaseClient;
    await expect(new AccountProfileRepository(failing).save(f.request, f.user.id)).rejects.toThrow("Synthetic audit failure");
    expect((await sql`SELECT * FROM app_user WHERE id=${f.user.id}`)[0]).toEqual(before);
    expect(await counts(f.user.id)).toEqual({ receipts: 0, audits: 0 });
  }));

  it("keeps a session and its identity authoritative while loading the newly saved label", async () => using(async f => {
    const tokenHash = `profile-session-${randomUUID()}`;
    await f.core.createSession({ tokenHash, userId: f.user.id, expiresAt: new Date(Date.now() + 60_000) });
    const before = (await sql`SELECT token_hash,user_id,expires_at,created_at FROM app_session WHERE token_hash=${tokenHash}`)[0];
    await f.repository.save(f.request, f.user.id);
    expect(await f.core.getSession(tokenHash)).toEqual({ ...f.user, displayName: "Café Reader" });
    expect((await sql`SELECT token_hash,user_id,expires_at,created_at FROM app_session WHERE token_hash=${tokenHash}`)[0]).toEqual(before);
  }));

  it.each(["x".repeat(300), "x".repeat(119) + "😀"])("bounds legacy previous-name audit data without splitting Unicode scalars: %s", async oldName => using(async f => {
    const id = randomUUID(), email = `profile-legacy-${id}@market-me.local`;
    await sql`INSERT INTO app_user(id,email,normalized_email,display_name) VALUES (${id},${email},${email},${oldName})`;
    try {
      expect(await f.repository.getProfile(id, id)).toMatchObject({ displayName: oldName, revision: 1 });
      await f.repository.save({ accountId: id, requestId: randomUUID(), expectedRevision: 1, displayName: "Short name" }, id);
      expect((await sql`SELECT data FROM audit_event WHERE actor_user_id=${id}`)[0]!.data).toMatchObject({ previousName: "x".repeat(oldName.length === 300 ? 120 : 119), previousNameTruncated: true });
    } finally { await sql`DELETE FROM audit_event WHERE actor_user_id=${id}`; await sql`DELETE FROM app_user WHERE id=${id}`; }
  }));

  it.each([true, false])("honors the committed row-lock ordering (prior transaction commits=%s)", async commit => using(async f => {
    let unlock!: () => void, locked!: () => void;
    const release = new Promise<void>(resolve => { unlock = resolve; });
    const acquired = new Promise<void>(resolve => { locked = resolve; });
    const rollback = new Error("Synthetic rollback");
    const blocker = sql.begin(async tx => {
      await tx`UPDATE app_user SET display_name='Earlier transaction',profile_revision=2 WHERE id=${f.user.id}`;
      locked(); await release; if (!commit) throw rollback;
    }).catch(error => { if (error !== rollback) throw error; });
    await acquired;
    let settled = false;
    const saving = f.repository.save(f.request, f.user.id).then(value => { settled = true; return value; }, error => { settled = true; throw error; });
    // Observe an actual ungranted transaction lock rather than treating a sleep as race proof.
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        waiting = (await sql<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity a
          WHERE a.datname=current_database() AND a.wait_event_type='Lock' AND a.query LIKE '%profile_revision AS revision%'
          AND a.query LIKE '%FOR UPDATE%') AS waiting`)[0]!.waiting;
        if (waiting) break; await delay(20);
      }
      expect(waiting).toBe(true); expect(settled).toBe(false);
      unlock(); await blocker;
      if (commit) await expect(saving).rejects.toMatchObject({ code: "revision_conflict" });
      else expect((await saving).receipt.revision).toBe(2);
      expect(await counts(f.user.id)).toEqual({ receipts: commit ? 0 : 1, audits: commit ? 0 : 1 });
    } finally { unlock(); await blocker; await saving.catch(() => undefined); }
  }));
});
