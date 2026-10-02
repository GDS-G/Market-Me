import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { AiRepository } from "./ai-repository";
import { ConversationRepository } from "./conversation-repository";
import { RelationshipRepository } from "./relationship-repository";
import { WorkspaceMemberRoleRepository } from "./workspace-member-role-repository";
import { WorkspaceMemberLifecycleRepository } from "./workspace-member-lifecycle-repository";
import { WORKSPACE_MEMBER_IMPACT_KEYS, type WorkspaceMemberRemovalRequest } from "./workspace-member-lifecycle-models";

const url = process.env.DATABASE_URL;
if (url && new URL(url).pathname !== "/market_me_ci") throw new Error("Member lifecycle integration requires isolated market_me_ci.");
let sql: DatabaseClient;
async function fixture() {
  const core = new MarketMeRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({ email: `removal-${randomUUID()}@market-me.local`, displayName: "Synthetic lifecycle owner" });
  const actors = [user.id];
  return { core, user, workspace, actors, repository: new WorkspaceMemberLifecycleRepository(sql),
    cleanup: async () => { await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`; await sql`DELETE FROM app_user WHERE id IN ${sql(actors)}`; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function using(run: (f: Fixture) => Promise<void>) { const f = await fixture(); try { await run(f); } finally { await f.cleanup(); } }
async function member(f: Fixture, role = "editor") {
  const id = randomUUID(), email = `removal-member-${id}@market-me.local`;
  await sql`INSERT INTO app_user(id,email,normalized_email,display_name) VALUES (${id},${email},${email},'Synthetic retained collaborator')`;
  f.actors.push(id);
  await sql`INSERT INTO organization_membership(organization_id,user_id,role) VALUES (${f.workspace.organizationId},${id},'member')`;
  await sql`INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES (${f.workspace.workspaceId},${id},${role})`;
  return id;
}
async function saved(f: Fixture, id: string) {
  return (await sql`SELECT * FROM workspace_membership WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${id}`)[0]!;
}
async function intent(f: Fixture, target: string, actor = f.user.id): Promise<WorkspaceMemberRemovalRequest> {
  const preview = await f.repository.preview(f.workspace.workspaceId, target, actor);
  return { workspaceId: preview.workspaceId, targetUserId: target, requestId: randomUUID(), expectedIncarnationId: preview.target.incarnationId,
    expectedRevision: preview.target.revision, impactFingerprint: preview.impactFingerprint, reason: "Reviewed synthetic offboarding" };
}
async function counts(f: Fixture) {
  return (await sql`SELECT (SELECT count(*)::int FROM workspace_member_removal_receipt WHERE workspace_id=${f.workspace.workspaceId}) AS receipts,
    (SELECT count(*)::int FROM audit_event WHERE workspace_id=${f.workspace.workspaceId} AND event_type='workspace.member_access_removed') AS audits`)[0]!;
}
async function invite(f: Fixture, target: string, actor = f.user.id, role: "editor" | "viewer" = "viewer") {
  const [user] = await sql`SELECT email FROM app_user WHERE id=${target}`;
  return f.core.createWorkspaceInvitation({ workspaceId: f.workspace.workspaceId, email: user!.email, role, invitedBy: actor, expiresAt: new Date(Date.now() + 60_000) });
}
async function signIn(f: Fixture, target: string) {
  const [user] = await sql`SELECT email FROM app_user WHERE id=${target}`;
  return f.core.completeOidcSignIn({ issuer: "https://identity.example.test/lifecycle", subject: target, email: user!.email,
    displayName: "Provider name must not replace the account", allowBootstrap: false });
}
const emptyImpact = Object.fromEntries(WORKSPACE_MEMBER_IMPACT_KEYS.map(key => [key, "0"]));
function latch() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function waitForAdvisory(key: string) {
  for (let i = 0; i < 150; i++) {
    const [row] = await sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted
      AND classid=((hashtextextended(${key},0)>>32)&4294967295)::oid AND objid=(hashtextextended(${key},0)&4294967295)::oid) AS waiting`;
    if (row!.waiting) return; await delay(20);
  }
  throw new Error("Expected operation did not reach its held grant/request lock");
}
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
    throw new Error("Expected operation did not wait for a database lock");
  } };
}

describe.skipIf(!url)("safe retained workspace membership lifecycle", () => {
  beforeAll(() => { sql = createDatabaseClient(url!); });
  afterAll(async () => { await sql?.end(); });

  it.each(["admin", "editor", "approver", "analyst", "viewer"])("revokes one %s grant atomically without deleting its identity", async role => using(async f => {
    const target = await member(f, role), before = await saved(f, target), request = await intent(f, target);
    const preview = await f.repository.preview(f.workspace.workspaceId, target, f.user.id);
    expect(preview).toMatchObject({ blocked: false, impact: emptyImpact, target: { userId: target, role, revision: 1, incarnationId: before.incarnationId } });
    expect(JSON.stringify(preview)).not.toMatch(/email|canonical|token|revokedAt/);
    const result = await f.repository.remove(request, f.user.id);
    expect(result).toMatchObject({ replayed: false, receipt: { ...request, previousRole: role, revision: 2, impact: emptyImpact } });
    expect(await saved(f, target)).toEqual({ ...before, roleRevision: 2, revokedAt: expect.any(Date) });
    expect(await f.core.getWorkspaceAccess(target, f.workspace.workspaceId)).toBeUndefined();
    expect(await f.core.listWorkspaceAccess(target)).toEqual([]);
    expect(await sql`SELECT id FROM app_user WHERE id=${target}`).toHaveLength(1);
    expect(await sql`SELECT role FROM organization_membership WHERE user_id=${target} AND organization_id=${f.workspace.organizationId}`).toEqual([{ role: "member" }]);
    expect(await counts(f)).toEqual({ receipts: 1, audits: 1 });
    expect(JSON.stringify(result.receipt)).not.toMatch(/createdBy|canonical|email|token/);
    expect(await sql`SELECT actor_user_id,subject_id,data FROM audit_event WHERE workspace_id=${f.workspace.workspaceId} AND event_type='workspace.member_access_removed'`)
      .toEqual([{ actorUserId: f.user.id, subjectId: target, data: { requestId: request.requestId, incarnationId: request.expectedIncarnationId,
        revision: 2, previousRole: role, reason: request.reason, impact: emptyImpact, sourceInterface: "team_member_removal" } }]);
  }));

  it.each(["editor", "approver", "analyst", "viewer"])("denies current %s despite organization ownership", async role => using(async f => {
    const actor = await member(f, role), target = await member(f), request = await intent(f, target);
    await sql`UPDATE organization_membership SET role='owner' WHERE user_id=${actor}`;
    await expect(f.repository.preview(f.workspace.workspaceId, target, actor)).rejects.toMatchObject({ code: "access_denied" });
    await expect(f.repository.remove(request, actor)).rejects.toMatchObject({ code: "access_denied" });
    await expect(f.repository.getReceipt(f.workspace.workspaceId, request.requestId, actor)).rejects.toMatchObject({ code: "access_denied" });
    expect(await counts(f)).toEqual({ receipts: 0, audits: 0 });
  }));

  it("protects self/all owners and isolates foreign workspace actors and targets", async () => using(async f => using(async other => {
    const admin = await member(f, "admin"), owner = await member(f, "owner"), target = await member(f);
    for (const id of [admin, owner, f.user.id]) await expect(f.repository.preview(f.workspace.workspaceId, id, admin)).rejects.toMatchObject({ code: "protected_member" });
    for (const id of [other.user.id, randomUUID()]) await expect(f.repository.preview(f.workspace.workspaceId, id, admin)).rejects.toMatchObject({ code: "not_found" });
    await expect(f.repository.remove(await intent(f, target), other.user.id)).rejects.toMatchObject({ code: "access_denied" });
    expect((await f.repository.remove(await intent(f, target, admin), admin)).receipt.previousRole).toBe("editor");
  })));

  it("requires independently current actor and unchanged target/impact, with no partial writes", async () => using(async f => {
    const admin = await member(f, "admin"), target = await member(f), request = await intent(f, target, admin);
    await sql`UPDATE workspace_membership SET role='viewer' WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${admin}`;
    await expect(f.repository.remove(request, admin)).rejects.toMatchObject({ code: "access_denied" });
    await sql`UPDATE workspace_membership SET role='admin' WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${admin}`;
    await sql`UPDATE workspace_membership SET role='analyst' WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${target}`;
    await expect(f.repository.remove(request, admin)).rejects.toMatchObject({ code: "revision_conflict" });
    const fresh = await intent(f, target, admin);
    await expect(f.repository.remove({ ...fresh, impactFingerprint: "0".repeat(64) }, admin)).rejects.toMatchObject({ code: "impact_conflict" });
    await expect(f.repository.remove(fresh, f.user.id)).rejects.toMatchObject({ code: "impact_conflict" });
    expect(await counts(f)).toEqual({ receipts: 0, audits: 0 });
  }));

  it("serializes six exact retries, retains actor-private recovery and rejects changed key reuse", async () => using(async f => {
    const target = await member(f), admin = await member(f, "admin"), request = await intent(f, target);
    const results = await Promise.all(Array.from({ length: 6 }, () => f.repository.remove(request, f.user.id)));
    expect(results.filter(r => !r.replayed)).toHaveLength(1);
    for (const result of results) expect(result.receipt).toEqual(results[0]!.receipt);
    expect(await f.repository.getReceipt(f.workspace.workspaceId, request.requestId, f.user.id)).toEqual(results[0]!.receipt);
    expect(await f.repository.getReceipt(f.workspace.workspaceId, request.requestId, admin)).toBeUndefined();
    for (const changed of [{ reason: "Changed intent" }, { expectedRevision: 2 }, { impactFingerprint: "0".repeat(64) }, { targetUserId: admin }]) {
      await expect(f.repository.remove({ ...request, ...changed }, f.user.id)).rejects.toMatchObject({ code: "request_conflict" });
    }
    await expect(f.repository.remove(request, admin)).rejects.toMatchObject({ code: "request_conflict" });
    expect(await counts(f)).toEqual({ receipts: 1, audits: 1 });
  }));

  it("admits one winner for competing target removals and one for reciprocal administrators", async () => using(async f => {
    const target = await member(f), a = await member(f, "admin"), b = await member(f, "admin");
    const byA = await intent(f, target, a), byB = await intent(f, target, b);
    const sameTarget = await Promise.allSettled([f.repository.remove(byA, a), f.repository.remove(byB, b)]);
    expect(sameTarget.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(sameTarget.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "not_found" } });
    const toB = await intent(f, b, a), toA = await intent(f, a, b);
    const reciprocal = await Promise.allSettled([f.repository.remove(toB, a), f.repository.remove(toA, b)]);
    expect(reciprocal.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(reciprocal.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "access_denied" } });
    expect(await counts(f)).toEqual({ receipts: 2, audits: 2 });
  }));

  it.each(["incoming", "issued"])("blocks unresolved %s invitations and detects an invitation appearing after preview", async direction => using(async f => {
    const target = await member(f, "admin"), recipient = await member(f), stale = await intent(f, target);
    const invitation = await invite(f, direction === "incoming" ? target : recipient, direction === "incoming" ? f.user.id : target);
    await expect(f.repository.remove(stale, f.user.id)).rejects.toMatchObject({ code: "impact_conflict" });
    const preview = await f.repository.preview(f.workspace.workspaceId, target, f.user.id);
    expect(preview.blocked).toBe(true);
    expect(preview.impact[direction === "incoming" ? "pendingIncomingInvitations" : "pendingIssuedInvitations"]).toBe("1");
    expect(await f.repository.listPendingInvitations(f.workspace.workspaceId, target, f.user.id)).toMatchObject([{ id: invitation.id }]);
    await expect(f.repository.remove(await intent(f, target), f.user.id)).rejects.toMatchObject({ code: "unresolved_dependencies" });
    await f.core.revokeWorkspaceInvitation({ workspaceId: f.workspace.workspaceId, invitationId: invitation.id, revokedBy: f.user.id });
    expect((await f.repository.remove(await intent(f, target), f.user.id)).replayed).toBe(false);
  }));

  it("lists a bounded member-specific pending resolution queue even behind unrelated recent history", async () => using(async f => {
    const target = await member(f, "admin"), viewer = await member(f, "viewer"), related = await invite(f, target);
    const now = new Date(), later = new Date(now.getTime() + 60_000);
    const unrelated = Array.from({ length: 201 }, () => { const id = randomUUID(), email = `unrelated-${id}@market-me.local`;
      return { id, workspaceId: f.workspace.workspaceId, email, normalizedEmail: email, role: "viewer", invitedBy: f.user.id, expiresAt: later, createdAt: now }; });
    await sql`INSERT INTO workspace_invitation ${sql(unrelated)}`;
    expect(await f.core.listWorkspaceInvitations(f.workspace.workspaceId)).toHaveLength(200);
    expect((await f.core.listWorkspaceInvitations(f.workspace.workspaceId)).some(row => row.id === related.id)).toBe(false);
    expect((await f.repository.listPendingInvitations(f.workspace.workspaceId, target, f.user.id)).map(row => row.id)).toEqual([related.id]);
    await expect(f.repository.listPendingInvitations(f.workspace.workspaceId, target, viewer)).rejects.toMatchObject({ code: "access_denied" });
    await expect(f.repository.listPendingInvitations(f.workspace.workspaceId, randomUUID(), f.user.id)).rejects.toMatchObject({ code: "not_found" });
    await f.core.revokeWorkspaceInvitation({ workspaceId: f.workspace.workspaceId, invitationId: related.id, revokedBy: f.user.id });
    expect(await f.repository.listPendingInvitations(f.workspace.workspaceId, target, f.user.id)).toEqual([]);
    expect(await sql`SELECT id FROM workspace_invitation WHERE workspace_id=${f.workspace.workspaceId} AND status='pending'`).toHaveLength(201);
    await f.repository.remove(await intent(f, target), f.user.id);
    expect(await f.repository.listPendingInvitations(f.workspace.workspaceId, target, f.user.id)).toEqual([]);
  }));

  it("rejoins only from a new invitation with monotonic revision/fresh grant, while exact old removal remains historical", async () => using(async f => {
    const target = await member(f), originalAccount = (await sql`SELECT * FROM app_user WHERE id=${target}`)[0]!, originalGrant = await saved(f, target);
    expect((await signIn(f, target)).status).toBe("authenticated");
    const oldRole = { workspaceId: f.workspace.workspaceId, targetUserId: target, newRole: "analyst", expectedRevision: 1, requestId: randomUUID(), reason: "Old draft role change" };
    const request = await intent(f, target), first = await f.repository.remove(request, f.user.id);
    expect((await signIn(f, target)).status).toBe("authenticated");
    expect(await f.core.getWorkspaceAccess(target, f.workspace.workspaceId)).toBeUndefined();
    await invite(f, target);
    expect((await signIn(f, target)).status).toBe("invited");
    const current = await saved(f, target);
    expect(current).toMatchObject({ revokedAt: null, roleRevision: 3, role: "viewer", createdAt: originalGrant.createdAt });
    expect(current.incarnationId).not.toBe(request.expectedIncarnationId);
    expect(await sql`SELECT * FROM app_user WHERE id=${target}`).toEqual([originalAccount]);
    await expect(new WorkspaceMemberRoleRepository(sql).mutate(oldRole, f.user.id)).rejects.toMatchObject({ code: "revision_conflict" });
    await expect(f.repository.remove({ ...request, requestId: randomUUID() }, f.user.id)).rejects.toMatchObject({ code: "revision_conflict" });
    expect(await f.repository.remove(request, f.user.id)).toEqual({ ...first, replayed: true });
    expect(await saved(f, target)).toEqual(current);
    expect(await counts(f)).toEqual({ receipts: 1, audits: 1 });
  }));

  it("does not regrant or change the role/revision of a still-active invited member", async () => using(async f => {
    const target = await member(f, "admin"), before = await saved(f, target);
    await invite(f, target);
    expect((await signIn(f, target)).status).toBe("invited");
    expect(await saved(f, target)).toEqual(before);
    expect((await sql`SELECT data FROM audit_event WHERE workspace_id=${f.workspace.workspaceId} AND event_type='workspace.invitation_accepted'`)[0]!.data)
      .toEqual({ role: "viewer", membershipGranted: false });
  }));

  it("invalidates a draft after the acting administrator is removed and explicitly re-invited", async () => using(async f => {
    const actor = await member(f, "admin"), target = await member(f), stale = await intent(f, target, actor);
    await f.repository.remove(await intent(f, actor), f.user.id);
    await expect(f.repository.remove(stale, actor)).rejects.toMatchObject({ code: "access_denied" });
    await invite(f, actor, f.user.id, "editor"); await signIn(f, actor);
    await sql`UPDATE workspace_membership SET role='admin' WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${actor}`;
    await expect(f.repository.remove(stale, actor)).rejects.toMatchObject({ code: "impact_conflict" });
    expect((await f.repository.remove(await intent(f, target, actor), actor)).replayed).toBe(false);
  }));

  it("keeps historical role receipts without applying them to a newly granted membership", async () => using(async f => {
    const target = await member(f), roles = new WorkspaceMemberRoleRepository(sql);
    const roleRequest = { workspaceId: f.workspace.workspaceId, targetUserId: target, newRole: "analyst", expectedRevision: 1, requestId: randomUUID(), reason: "Reviewed role" };
    const first = await roles.mutate(roleRequest, f.user.id);
    await f.repository.remove(await intent(f, target), f.user.id); await invite(f, target); await signIn(f, target);
    const current = await saved(f, target);
    expect(current).toMatchObject({ role: "viewer", roleRevision: 4, revokedAt: null });
    expect(await roles.mutate(roleRequest, f.user.id)).toEqual({ ...first, replayed: true });
    expect(await saved(f, target)).toEqual(current);
  }));

  it("rolls back revocation and receipt if minimized audit persistence fails", async () => using(async f => {
    const target = await member(f), before = await saved(f, target), request = await intent(f, target);
    const wrapped = new Proxy(sql, { get(client, property) {
      if (property !== "begin") return Reflect.get(client, property);
      return (run: (tx: TransactionSql) => Promise<unknown>) => sql.begin(tx => run(new Proxy(tx, { apply(transaction, thisArg, args) {
        if (Array.isArray(args[0]) && args[0].join("").includes("INSERT INTO audit_event")) throw new Error("Synthetic removal audit failure");
        return Reflect.apply(transaction, thisArg, args);
      } })));
    } });
    await expect(new WorkspaceMemberLifecycleRepository(wrapped).remove(request, f.user.id)).rejects.toThrow("Synthetic removal audit failure");
    expect(await saved(f, target)).toEqual(before); expect(await counts(f)).toEqual({ receipts: 0, audits: 0 });
  }));

  it("preserves real RESTRICT policy/invitation attribution, CASCADE read state, assignments, other workspace access and personal sessions", async () => using(async f => using(async other => {
    const target = await member(f, "admin"), workspaceId = f.workspace.workspaceId;
    await sql`INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES (${other.workspace.workspaceId},${target},'editor')`;
    await sql`INSERT INTO app_session(token_hash,user_id,expires_at) VALUES (${randomUUID()},${target},clock_timestamp()+interval '1 day')`;
    const ai = new AiRepository(sql), conversations = new ConversationRepository(sql);
    const policy = { workspaceId, mode: "private_local" as const, maximumPrivacyClass: "local" as const, failoverMode: "no_external_fallback" as const,
      capBehavior: "require_approval" as const, currency: "USD", dailyBudgetMinor: 500, campaignBudgetMinor: 2500, monthlyBudgetMinor: 10000, alertThresholdPercentages: [50,80,100] };
    await ai.savePolicy(policy, target);
    const history = await invite(f, f.user.id, target);
    await f.core.revokeWorkspaceInvitation({ workspaceId, invitationId: history.id, revokedBy: f.user.id });
    const relationship = await new RelationshipRepository(sql).saveRelationship({ workspaceId, displayName: "Synthetic lifecycle relationship", stage: "active_conversation",
      contactPermission: "suppressed", suppressionReason: "Synthetic, no outbound contact", observedInterests: [], sharedTopics: [], notes: "", identities: [] }, target);
    const thread = await conversations.saveThread({ workspaceId, relationshipId: relationship!.id, provider: "manual", subject: "Retained synthetic assignment",
      status: "assigned", assignedOwnerId: target }, target);
    await conversations.markRead(workspaceId, thread!.id, target);
    const before = {
      policy: await sql`SELECT * FROM workspace_ai_policy WHERE workspace_id=${workspaceId}`,
      read: await sql`SELECT * FROM conversation_read_state WHERE workspace_id=${workspaceId} AND user_id=${target}`,
      thread: await sql`SELECT * FROM conversation_thread WHERE id=${thread!.id}`,
      invitation: await sql`SELECT * FROM workspace_invitation WHERE id=${history.id}`,
      sessions: await sql`SELECT * FROM app_session WHERE user_id=${target}`,
      other: await f.core.getWorkspaceAccess(target, other.workspace.workspaceId),
    };
    expect((await f.repository.preview(workspaceId, target, f.user.id)).impact.assignedConversations).toBe("1");
    await f.repository.remove(await intent(f, target), f.user.id);
    expect(await sql`SELECT * FROM workspace_ai_policy WHERE workspace_id=${workspaceId}`).toEqual(before.policy);
    expect(await sql`SELECT * FROM conversation_read_state WHERE workspace_id=${workspaceId} AND user_id=${target}`).toEqual(before.read);
    expect(await sql`SELECT * FROM conversation_thread WHERE id=${thread!.id}`).toEqual(before.thread);
    expect(await sql`SELECT * FROM workspace_invitation WHERE id=${history.id}`).toEqual(before.invitation);
    expect(await sql`SELECT * FROM app_session WHERE user_id=${target}`).toEqual(before.sessions);
    expect(await f.core.getWorkspaceAccess(target, other.workspace.workspaceId)).toEqual(before.other);
    await expect(ai.savePolicy(policy, target)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
    expect(await conversations.markRead(workspaceId, thread!.id, target)).toBeUndefined();
    expect(await sql`SELECT * FROM conversation_read_state WHERE workspace_id=${workspaceId} AND user_id=${target}`).toEqual(before.read);
  })));

  it("enforces immutable receipt history and exact impact JSON shape in SQL", async () => using(async f => {
    const target = await member(f); await f.repository.remove(await intent(f, target), f.user.id);
    await expect(sql`UPDATE workspace_member_removal_receipt SET reason='Changed' WHERE workspace_id=${f.workspace.workspaceId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`DELETE FROM workspace_member_removal_receipt WHERE workspace_id=${f.workspace.workspaceId}`).rejects.toMatchObject({ code: "23514" });
    for (const value of [null, [], "shape", {}, { ...emptyImpact, assignedConversations: 0 }, { ...emptyImpact, assignedConversations: "01" },
      { ...emptyImpact, assignedConversations: "-1" }, { ...emptyImpact, privateContents: "1" }]) {
      const [row] = await sql`SELECT valid_workspace_member_removal_impact(${sql.json(value)}) AS valid`;
      expect(row!.valid).toBe(false);
    }
    expect((await sql`SELECT valid_workspace_member_removal_impact(${sql.json(emptyImpact)}) AS valid`)[0]!.valid).toBe(true);
    // Fixture cleanup also verifies that parent workspace cascade may remove history.
  }));

  it.each([true, false])("rechecks authority after an earlier administrator revocation commits=%s", async commit => using(async f => {
    const actor = await member(f, "admin"), target = await member(f), request = await intent(f, target, actor);
    const held = latch(), acquired = latch(), rollback = new Error("Synthetic preceding revocation rollback");
    const blocker = sql.begin(async tx => {
      await tx`UPDATE workspace_membership SET revoked_at=clock_timestamp() WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${actor}`;
      acquired.release(); await held.promise; if (!commit) throw rollback;
    }).catch(error => { if (error !== rollback) throw error; });
    await acquired.promise;
    const observed = trackedClient(), operation = new WorkspaceMemberLifecycleRepository(observed.client).remove(request, actor).then(value => ({ value }), error => ({ error }));
    try { await observed.waitForLock(); } finally { held.release(); await blocker; }
    if (commit) { expect(await operation).toMatchObject({ error: { code: "access_denied" } }); expect(await counts(f)).toEqual({ receipts: 0, audits: 0 }); }
    else { expect(await operation).toMatchObject({ value: { replayed: false } }); expect(await counts(f)).toEqual({ receipts: 1, audits: 1 }); }
  }));

  it("holds admitted actor authority through commit and then denies historical lookup/replay after demotion", async () => using(async f => {
    const actor = await member(f, "admin"), target = await member(f), request = await intent(f, target, actor);
    const key = JSON.stringify(["workspace-member-removal-v1", f.workspace.workspaceId, request.requestId]), held = latch(), acquired = latch();
    const blocker = sql.begin(async tx => { await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`; acquired.release(); await held.promise; });
    await acquired.promise;
    const operation = f.repository.remove(request, actor).then(value => ({ value }), error => ({ error }));
    let demotion: Promise<unknown> | undefined;
    try {
      await waitForAdvisory(key); const observed = trackedClient();
      demotion = observed.client.begin(tx => tx`UPDATE workspace_membership SET role='viewer' WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${actor}`);
      await observed.waitForLock();
    } finally { held.release(); await blocker; }
    expect(await operation).toMatchObject({ value: { replayed: false } }); await demotion;
    await expect(f.repository.getReceipt(f.workspace.workspaceId, request.requestId, actor)).rejects.toMatchObject({ code: "access_denied" });
    await expect(f.repository.remove(request, actor)).rejects.toMatchObject({ code: "access_denied" });
  }));

  it("serializes a new incoming invitation behind already-admitted removal as a separate subsequent grant", async () => using(async f => {
    const target = await member(f), request = await intent(f, target), key = JSON.stringify(["workspace-member-removal-v1", f.workspace.workspaceId, request.requestId]);
    const held = latch(), acquired = latch();
    const blocker = sql.begin(async tx => { await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`; acquired.release(); await held.promise; });
    await acquired.promise;
    const removing = f.repository.remove(request, f.user.id).then(value => ({ value }), error => ({ error }));
    let invitation: ReturnType<typeof invite> | undefined;
    try {
      await waitForAdvisory(key); invitation = invite(f, target);
      const [user] = await sql`SELECT normalized_email FROM app_user WHERE id=${target}`;
      await waitForAdvisory(JSON.stringify(["workspace-member-grant-v1", f.workspace.workspaceId, user!.normalizedEmail]));
    } finally { held.release(); await blocker; }
    expect(await removing).toMatchObject({ value: { replayed: false } }); expect((await invitation)!.status).toBe("pending");
    expect(await f.core.getWorkspaceAccess(target, f.workspace.workspaceId)).toBeUndefined();
    expect((await signIn(f, target)).status).toBe("invited"); expect(await saved(f, target)).toMatchObject({ roleRevision: 3, revokedAt: null });
  }));

  it("detects an earlier invitation creation that commits while removal waits for the grant key", async () => using(async f => {
    const target = await member(f), request = await intent(f, target), held = latch(), acquired = latch();
    const blocker = sql.begin(async tx => { await tx`SELECT user_id FROM workspace_membership WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${f.user.id} FOR UPDATE`;
      acquired.release(); await held.promise; });
    await acquired.promise;
    const observed = trackedClient(), [user] = await sql`SELECT email FROM app_user WHERE id=${target}`;
    const creating = new MarketMeRepository(observed.client).createWorkspaceInvitation({ workspaceId: f.workspace.workspaceId, email: user!.email,
      role: "viewer", invitedBy: f.user.id, expiresAt: new Date(Date.now() + 60_000) });
    let removing: Promise<unknown> | undefined;
    try {
      await observed.waitForLock(); removing = f.repository.remove(request, f.user.id).then(value => ({ value }), error => ({ error }));
      await waitForAdvisory(JSON.stringify(["workspace-member-grant-v1", f.workspace.workspaceId, user!.email]));
    } finally { held.release(); await blocker; }
    await creating; expect(await removing).toMatchObject({ error: { code: "impact_conflict" } }); expect(await counts(f)).toEqual({ receipts: 0, audits: 0 });
  }));

  it("rechecks invitation expiry after a real member lock wait rather than the transaction start time", async () => using(async f => {
    const target = await member(f); await signIn(f, target); await f.repository.remove(await intent(f, target), f.user.id);
    const invitation = await invite(f, target), held = latch(), acquired = latch();
    const blocker = sql.begin(async tx => {
      await tx`SELECT user_id FROM workspace_membership WHERE workspace_id=${f.workspace.workspaceId} AND user_id=${target} FOR UPDATE`;
      acquired.release(); await held.promise;
    });
    await acquired.promise;
    // A fixed short expiry is set before acceptance takes its invitation row lock.
    await sql`UPDATE workspace_invitation SET expires_at=clock_timestamp()+interval '600 milliseconds' WHERE id=${invitation.id}`;
    const observed = trackedClient(), [user] = await sql`SELECT email FROM app_user WHERE id=${target}`;
    const accepting = new MarketMeRepository(observed.client).completeOidcSignIn({ issuer: "https://identity.example.test/lifecycle", subject: target,
      email: user!.email, displayName: "Unchanged", allowBootstrap: false });
    try { await observed.waitForLock(); await delay(650); } finally { held.release(); await blocker; }
    expect((await accepting).status).toBe("authenticated"); expect(await saved(f, target)).toMatchObject({ roleRevision: 2, revokedAt: expect.any(Date) });
    expect((await sql`SELECT status FROM workspace_invitation WHERE id=${invitation.id}`)[0]!.status).toBe("pending");
  }));

  it("allows a locked role change to persist user-FK receipts while OIDC acceptance waits for that member", async () => using(async f => {
    const target = await member(f), roles = new WorkspaceMemberRoleRepository(sql);
    const request = { workspaceId: f.workspace.workspaceId, targetUserId: target, newRole: "analyst", expectedRevision: 1, requestId: randomUUID(), reason: "Concurrent reviewed role" };
    await invite(f, target);
    const key = `workspace-member-role:${f.workspace.workspaceId}:${request.requestId}`, held = latch(), acquired = latch();
    const blocker = sql.begin(async tx => { await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`; acquired.release(); await held.promise; });
    await acquired.promise;
    const changing = roles.mutate(request, f.user.id).then(value => ({ value }), error => ({ error })); let accepting: Promise<unknown> | undefined;
    try {
      await waitForAdvisory(key); const observed = trackedClient(), [user] = await sql`SELECT email FROM app_user WHERE id=${target}`;
      accepting = new MarketMeRepository(observed.client).completeOidcSignIn({ issuer: "https://identity.example.test/lifecycle", subject: target,
        email: user!.email, displayName: "Unchanged", allowBootstrap: false });
      await observed.waitForLock();
    } finally { held.release(); await blocker; }
    expect(await changing).toMatchObject({ value: { replayed: false } }); expect(await accepting).toMatchObject({ status: "invited" });
    expect(await saved(f, target)).toMatchObject({ role: "analyst", roleRevision: 2, revokedAt: null });
  }));

  it("serializes simultaneous first identity linking without duplicate account or grant", async () => using(async f => {
    const target = await member(f), before = await saved(f, target); await invite(f, target);
    const results = await Promise.all(Array.from({ length: 6 }, () => signIn(f, target)));
    expect(results.filter(r => r.status === "invited")).toHaveLength(1); expect(results.filter(r => r.status === "authenticated")).toHaveLength(5);
    expect(await sql`SELECT user_id FROM oidc_identity WHERE user_id=${target}`).toEqual([{ userId: target }]);
    expect(await saved(f, target)).toEqual(before);
  }));
});
