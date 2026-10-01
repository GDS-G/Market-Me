import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { WorkspaceManagementRepository } from "./workspace-management-repository";
import { MANAGED_MEMBER_ROLES, normalizeWorkspaceMemberRoleRequest } from "./workspace-member-role-models";
import { WorkspaceMemberRoleRepository } from "./workspace-member-role-repository";

const url = process.env.DATABASE_URL;
if (url && new URL(url).pathname !== "/market_me_ci" && !new URL(url).pathname.startsWith("/market_me_qa_133_")) {
  throw new Error("Member-role integration requires isolated market_me_ci or market_me_qa_133_*.");
}
let sql: DatabaseClient;
async function fixture() {
  const { user, workspace } = await new MarketMeRepository(sql).bootstrapDevelopmentWorkspace({ email: `member-role-${randomUUID()}@market-me.local`, displayName: "Role QA owner" });
  const actors = [user.id];
  return { user, workspace, actors, repository: new WorkspaceMemberRoleRepository(sql),
    cleanup: async () => { await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`; await sql`DELETE FROM app_user WHERE id IN ${sql(actors)}`; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function using(run: (f: Fixture) => Promise<void>) { const f = await fixture(); try { await run(f); } finally { await f.cleanup(); } }
async function member(f: Fixture, role = "editor") {
  const id = randomUUID(), email = `member-${id}@market-me.local`;
  await sql`INSERT INTO app_user(id,email,normalized_email,display_name) VALUES (${id},${email},${email},'Synthetic collaborator')`;
  f.actors.push(id);
  await sql`INSERT INTO organization_membership(organization_id,user_id,role) VALUES (${f.workspace.organizationId},${id},'member')`;
  await sql`INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES (${f.workspace.workspaceId},${id},${role})`;
  return id;
}
const change = (f: Fixture, targetUserId: string, newRole = "viewer", expectedRevision = 1) => ({
  workspaceId: f.workspace.workspaceId, targetUserId, newRole, expectedRevision, requestId: randomUUID(), reason: "Reviewed synthetic team access" });
async function savedMember(f: Fixture, id: string) {
  return (await sql`SELECT * FROM workspace_membership WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${id}`)[0]!;
}
async function receiptCount(f: Fixture) {
  return (await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM workspace_member_role_receipt WHERE workspace_id=${f.workspace.workspaceId}`)[0]!.count;
}
async function waitForAdvisory(key: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const waiting = (await sql<{ waiting: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted
      AND classid=((hashtextextended(${key},0)>>32)&4294967295)::oid
      AND objid=(hashtextextended(${key},0)&4294967295)::oid) AS waiting`)[0]!.waiting;
    if (waiting) return;
    await delay(20);
  }
  throw new Error("Role mutation never reached the held advisory lock");
}

describe.skipIf(!url)("existing workspace member roles", () => {
  beforeAll(() => { sql = createDatabaseClient(url!); });
  afterAll(async () => { await sql?.end(); });

  it.each(MANAGED_MEMBER_ROLES.flatMap(previous => MANAGED_MEMBER_ROLES.filter(next => next !== previous).map(next => [previous, next] as const)))
    ("changes existing %s to %s without changing membership identity/count", async (previous, next) => using(async f => {
      const target = await member(f, previous), before = await savedMember(f, target), request = change(f, target, next);
      const result = await f.repository.mutate(request, f.user.id);
      expect(result).toMatchObject({ replayed: false, receipt: { workspaceId: request.workspaceId, targetUserId: target,
        requestId: request.requestId, newRole: next, reason: request.reason, previousRole: previous, revision: 2 } });
      expect(await savedMember(f, target)).toEqual({ ...before, role: next, roleRevision: 2 });
      expect(await sql`SELECT user_id FROM workspace_membership WHERE workspace_id=${f.workspace.workspaceId}`).toHaveLength(2);
    }));

  it("atomically records only the changed role, next revision and minimized review audit", async () => using(async f => {
    const target = await member(f), before = await savedMember(f, target), request = change(f, target, "approver");
    const result = await f.repository.mutate(request, f.user.id);
    expect(result.receipt).toMatchObject({ workspaceId: f.workspace.workspaceId, targetUserId: target, previousRole: "editor", newRole: "approver", revision: 2 });
    expect(await savedMember(f, target)).toEqual({ ...before, role: "approver", roleRevision: 2 });
    expect(await sql`SELECT user_id FROM workspace_membership WHERE workspace_id=${f.workspace.workspaceId}`).toHaveLength(2);
    expect(await sql`SELECT actor_user_id,subject_id,data FROM audit_event WHERE workspace_id=${f.workspace.workspaceId} AND event_type='workspace.member_role_changed'`)
      .toEqual([{ actorUserId: f.user.id, subjectId: target, data: { previousRole: "editor", newRole: "approver", revision: 2, reason: request.reason, sourceInterface: "team_role_editor" } }]);
    expect(JSON.stringify(result.receipt)).not.toMatch(/canonical|createdBy|email|expectedRevision/);
    expect(await sql`SELECT role FROM organization_membership WHERE organization_id=${f.workspace.organizationId} AND user_id=${target}`).toEqual([{ role: "member" }]);
  }));

  it.each(["editor", "approver", "analyst", "viewer"])("denies a current %s even when organization owner", async role => using(async f => {
    const actor = await member(f, role), target = await member(f);
    await sql`UPDATE organization_membership SET role='owner' WHERE organization_id=${f.workspace.organizationId} AND user_id=${actor}`;
    await expect(f.repository.mutate(change(f, target), actor)).rejects.toMatchObject({ code: "access_denied" });
    await expect(f.repository.getReceipt(f.workspace.workspaceId, randomUUID(), actor)).rejects.toMatchObject({ code: "access_denied" });
    const page = await f.repository.listMembers(f.workspace.workspaceId, actor);
    expect(page.canManage).toBe(false); expect(page.members.every(m => !m.canChangeRole)).toBe(true);
    expect(await receiptCount(f)).toBe(0);
  }));

  it("allows an administrator to change another non-owner, but never owner/self/owner assignment", async () => using(async f => {
    const admin = await member(f, "admin"), target = await member(f);
    expect((await f.repository.mutate(change(f, target, "admin"), admin)).receipt.newRole).toBe("admin");
    for (const id of [admin, f.user.id]) await expect(f.repository.mutate(change(f, id), admin)).rejects.toMatchObject({ code: "protected_member" });
    await expect(f.repository.mutate(change(f, target, "owner", 2), admin)).rejects.toMatchObject({ code: "invalid_input" });
    const page = await f.repository.listMembers(f.workspace.workspaceId, admin);
    expect(page.members.find(m => m.userId === admin)?.canChangeRole).toBe(false);
    expect(page.members.find(m => m.userId === f.user.id)?.canChangeRole).toBe(false);
    expect(page.members.find(m => m.userId === target)?.canChangeRole).toBe(true);
  }));

  it("rejects absent/foreign targets and never grants an organization owner implicit workspace access", async () => using(async f => using(async other => {
    const target = await member(f);
    await expect(f.repository.mutate(change(f, other.user.id), f.user.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(f.repository.mutate(change(f, randomUUID()), f.user.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(f.repository.mutate(change(f, target), other.user.id)).rejects.toMatchObject({ code: "access_denied" });
    await expect(f.repository.listMembers(f.workspace.workspaceId, other.user.id)).rejects.toMatchObject({ code: "access_denied" });
    await sql`INSERT INTO organization_membership(organization_id,user_id,role) VALUES (${f.workspace.organizationId},${other.user.id},'owner')`;
    await expect(f.repository.mutate(change(f, target), other.user.id)).rejects.toMatchObject({ code: "access_denied" });
    expect(await receiptCount(f)).toBe(0);
  })));

  it("serializes six exact requests to one role/audit/receipt result", async () => using(async f => {
    const target = await member(f), request = change(f, target);
    const results = await Promise.all(Array.from({ length: 6 }, () => f.repository.mutate(request, f.user.id)));
    expect(results.filter(r => !r.replayed)).toHaveLength(1);
    expect(results.every(r => JSON.stringify(r.receipt) === JSON.stringify(results[0]!.receipt))).toBe(true);
    expect(await receiptCount(f)).toBe(1); expect((await savedMember(f, target)).roleRevision).toBe(2);
    expect(await sql`SELECT id FROM audit_event WHERE workspace_id=${f.workspace.workspaceId} AND event_type='workspace.member_role_changed'`).toHaveLength(1);
  }));

  it("replays historical results after later role changes without resetting current access", async () => using(async f => {
    const target = await member(f), request = change(f, target), first = await f.repository.mutate(request, f.user.id);
    await f.repository.mutate(change(f, target, "analyst", 2), f.user.id);
    expect(await f.repository.mutate(request, f.user.id)).toEqual({ ...first, replayed: true });
    expect(await f.repository.getReceipt(f.workspace.workspaceId, request.requestId, f.user.id)).toEqual(first.receipt);
    expect(await savedMember(f, target)).toMatchObject({ role: "analyst", roleRevision: 3 });
  }));

  it("keeps receipts actor-private and rejects changed canonical reuse", async () => using(async f => {
    const target = await member(f), admin = await member(f, "admin"), request = change(f, target);
    await f.repository.mutate(request, f.user.id);
    for (const altered of [{ reason: "Changed reason" }, { newRole: "admin" }, { targetUserId: admin }, { expectedRevision: 2 }]) {
      await expect(f.repository.mutate({ ...request, ...altered }, f.user.id)).rejects.toMatchObject({ code: "request_conflict" });
    }
    await expect(f.repository.mutate(request, admin)).rejects.toMatchObject({ code: "request_conflict" });
    expect(await f.repository.getReceipt(f.workspace.workspaceId, request.requestId, admin)).toBeUndefined();
    await using(async other => { expect(await f.repository.getReceipt(other.workspace.workspaceId, request.requestId, other.user.id)).toBeUndefined(); });
  }));

  it("admits one stale concurrent target edit and rejects a no-op without history", async () => using(async f => {
    const target = await member(f), admin = await member(f, "admin");
    const results = await Promise.allSettled([f.repository.mutate(change(f, target, "analyst"), f.user.id), f.repository.mutate(change(f, target, "viewer"), admin)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "revision_conflict" } });
    const current = await savedMember(f, target);
    await expect(f.repository.mutate(change(f, target, current.role, 2), f.user.id)).rejects.toMatchObject({ code: "invalid_input" });
    expect(await receiptCount(f)).toBe(1);
  }));

  it("orders both administrator rows consistently during reciprocal demotion", async () => using(async f => {
    const a = await member(f, "admin"), b = await member(f, "admin");
    const results = await Promise.allSettled([f.repository.mutate(change(f, b), a), f.repository.mutate(change(f, a), b)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "access_denied" } });
    expect(await receiptCount(f)).toBe(1);
    expect([ (await savedMember(f, a)).role, (await savedMember(f, b)).role ].sort()).toEqual(["admin", "viewer"]);
  }));

  it("advances trusted SQL role changes and detects revoke/regrant cycles without altering creation identity", async () => using(async f => {
    const target = await member(f), before = await savedMember(f, target);
    await sql`UPDATE workspace_membership SET role='viewer' WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${target}`;
    await sql`UPDATE workspace_membership SET role='editor' WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${target}`;
    await sql`UPDATE workspace_membership SET role='editor' WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${target}`;
    expect(await savedMember(f, target)).toEqual({ ...before, roleRevision: 3 });
    await expect(f.repository.mutate(change(f, target), f.user.id)).rejects.toMatchObject({ code: "revision_conflict" });
    await expect(sql`UPDATE workspace_membership SET role_revision=1 WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${target}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE workspace_membership SET role='viewer',role_revision=10 WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${target}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE workspace_membership SET created_at=clock_timestamp() WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${target}`).rejects.toMatchObject({ code: "23514" });
  }));

  it("retains immutable role history across membership removal but permits whole-workspace erasure", async () => using(async f => {
    const target = await member(f), request = change(f, target), first = await f.repository.mutate(request, f.user.id);
    await expect(sql`UPDATE workspace_member_role_receipt SET reason='Rewritten' WHERE workspace_id=${f.workspace.workspaceId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`DELETE FROM workspace_member_role_receipt WHERE workspace_id=${f.workspace.workspaceId}`).rejects.toMatchObject({ code: "23514" });
    await sql`DELETE FROM workspace_membership WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${target}`;
    expect(await f.repository.mutate(request, f.user.id)).toEqual({ ...first, replayed: true });
    await expect(sql`DELETE FROM app_user WHERE id=${target}`).rejects.toMatchObject({ code: "23001" });
    await sql`DELETE FROM workspace WHERE id=${f.workspace.workspaceId}`;
    expect(await receiptCount(f)).toBe(0);
  }));

  it("checks SQL canonical shape and current target result on direct receipt insertion", async () => using(async f => {
    const target = await member(f), request = normalizeWorkspaceMemberRoleRequest(change(f, target));
    await sql`UPDATE workspace_membership SET role='viewer' WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${target}`;
    for (const canonical of [JSON.stringify({ ...request, actorUserId: f.user.id }), JSON.stringify({ ...request, expectedRevision: 2 }), JSON.stringify({ ...request, reason: 123 })]) {
      await expect(sql`INSERT INTO workspace_member_role_receipt(workspace_id,request_id,target_user_id,created_by,previous_role,new_role,revision,reason,canonical_request)
        VALUES (${f.workspace.workspaceId},${request.requestId},${target},${f.user.id},'editor','viewer',2,${request.reason},${canonical})`).rejects.toMatchObject({ code: "23514" });
    }
    await sql`UPDATE workspace_membership SET role='analyst' WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${target}`;
    await expect(sql`INSERT INTO workspace_member_role_receipt(workspace_id,request_id,target_user_id,created_by,previous_role,new_role,revision,reason,canonical_request)
      VALUES (${f.workspace.workspaceId},${request.requestId},${target},${f.user.id},'editor','viewer',2,${request.reason},${JSON.stringify(request)})`).rejects.toMatchObject({ code: "23514" });
  }));

  it("holds admitted authority until commit, then rejects revoked replay and lookup", async () => using(async f => {
    const target = await member(f), admin = await member(f, "admin"), request = change(f, target), key = `workspace-member-role:${f.workspace.workspaceId}:${request.requestId}`;
    let release!: () => void, locked!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), acquired = new Promise<void>(resolve => { locked = resolve; });
    const blocker = sql.begin(async tx => { await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`; locked(); await held; });
    await acquired;
    const changing = f.repository.mutate(request, admin); let revocation: Promise<void> | undefined;
    try {
      await waitForAdvisory(key);
      let revoked = false;
      revocation = sql`UPDATE workspace_membership SET role='viewer' WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${admin}`.then(() => { revoked = true; });
      await delay(30); expect(revoked).toBe(false); release(); await blocker;
      expect((await changing).replayed).toBe(false); await revocation;
      await expect(f.repository.mutate(request, admin)).rejects.toMatchObject({ code: "access_denied" });
      await expect(f.repository.getReceipt(f.workspace.workspaceId, request.requestId, admin)).rejects.toMatchObject({ code: "access_denied" });
    } finally { release(); await blocker; await changing.catch(() => undefined); await revocation; }
  }));

  it("rechecks authority when a preceding role revocation commits while mutation waits", async () => using(async f => {
    const target = await member(f), admin = await member(f, "admin"); let release!: () => void, locked!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), acquired = new Promise<void>(resolve => { locked = resolve; });
    const blocker = sql.begin(async tx => { await tx`UPDATE workspace_membership SET role='viewer' WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${admin}`; locked(); await held; });
    await acquired;
    let finished = false;
    const changing = f.repository.mutate(change(f, target), admin).then(value => ({ value }), error => ({ error })).finally(() => { finished = true; });
    try { await delay(30); expect(finished).toBe(false); release(); await blocker; expect(await changing).toMatchObject({ error: { code: "access_denied" } }); }
    finally { release(); await blocker; await changing; }
    expect(await receiptCount(f)).toBe(0); expect((await savedMember(f, target)).role).toBe("editor");
  }));

  it("immediately changes representative downstream authority without changing unrelated data", async () => using(async f => {
    const target = await member(f, "viewer"), core = new MarketMeRepository(sql), settings = new WorkspaceManagementRepository(sql);
    const invitation = { workspaceId: f.workspace.workspaceId, email: `not-sent-${randomUUID()}@market-me.local`, role: "viewer" as const,
      invitedBy: target, expiresAt: new Date(Date.now() + 60_000) };
    await expect(core.createWorkspaceInvitation(invitation)).rejects.toThrow("Only workspace owners");
    await f.repository.mutate(change(f, target, "admin"), f.user.id);
    expect((await settings.getSettings(f.workspace.workspaceId, target))?.canRename).toBe(true);
    expect((await core.createWorkspaceInvitation(invitation)).role).toBe("viewer");
    await f.repository.mutate(change(f, target, "viewer", 2), f.user.id);
    expect((await settings.getSettings(f.workspace.workspaceId, target))?.canRename).toBe(false);
    await expect(core.createWorkspaceInvitation({ ...invitation, email: `not-sent-${randomUUID()}@market-me.local` })).rejects.toThrow("Only workspace owners");
    expect(await sql`SELECT id FROM smart_source WHERE workspace_id=${f.workspace.workspaceId}`).toHaveLength(0);
  }));

  it("bounds member pages and returns scoped projections without emails or private history", async () => using(async f => {
    for (let i = 0; i < 51; i++) await member(f, "viewer");
    const first = await f.repository.listMembers(f.workspace.workspaceId, f.user.id), second = await f.repository.listMembers(f.workspace.workspaceId, f.user.id, 2);
    expect(first.members).toHaveLength(50); expect(first.more).toBe(true); expect(second.members).toHaveLength(2); expect(second.more).toBe(false);
    expect(new Set([...first.members, ...second.members].map(m => m.userId)).size).toBe(52);
    expect(JSON.stringify(first)).not.toMatch(/email|reason|createdBy|canonical/);
    for (const page of [0, -1, 1.5, 2001, NaN]) await expect(f.repository.listMembers(f.workspace.workspaceId, f.user.id, page)).rejects.toMatchObject({ code: "invalid_input" });
  }));
});
