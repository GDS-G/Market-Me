import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiRepository } from "./ai-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (name !== "market_me_ci" && !name.startsWith("market_me_qa_142_")) throw new Error("Budget recovery tests require disposable CI or 142 QA.");
}
let sql: DatabaseClient;
const asOf = new Date("2026-10-01T12:00:00.000Z");
type Fixture = { ai: AiRepository; owner: string; editor: string; approver: string; viewer: string; workspaceId: string; alertId: string; deniedId: string };
async function fixture(work: (f: Fixture) => Promise<void>) {
  const { user, workspace } = await new MarketMeRepository(sql).bootstrapDevelopmentWorkspace({ email: `budget-recovery-${randomUUID()}@market-me.local`, displayName: "Synthetic Budget Owner" });
  const editor = randomUUID(), approver = randomUUID(), viewer = randomUUID(), workspaceId = workspace.workspaceId, ai = new AiRepository(sql);
  try {
    for (const [id, role] of [[editor, "editor"], [approver, "approver"], [viewer, "viewer"]]) {
      const email = `budget-recovery-${id}@market-me.local`;
      await sql`INSERT INTO app_user(id,email,normalized_email,display_name) VALUES(${id},${email},${email},'Synthetic Budget Collaborator')`;
      await sql`INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES(${workspaceId},${id},${role})`;
    }
    await ai.savePolicy({ workspaceId, mode: "recommended", maximumPrivacyClass: "cloud", failoverMode: "ask_before_switching", capBehavior: "require_approval", currency: "USD", dailyBudgetMinor: 100, alertThresholdPercentages: [50] }, user.id);
    for (let i = 0; i < 2; i++) await ai.reserveSpend({ workspaceId, idempotencyKey: randomUUID(), capability: "generate_text", feature: "synthetic_budget_recovery", currency: "USD", estimatedCostMinor: 60 }, user.id, asOf);
    const alert = (await ai.listBudgetAlerts(workspaceId, "USD"))[0]!;
    const [denied] = await sql<{ id: string }[]>`SELECT id FROM ai_spend_reservation WHERE workspace_id=${workspaceId} AND status='denied'`;
    await work({ ai, owner: user.id, editor, approver, viewer, workspaceId, alertId: alert.id, deniedId: denied!.id });
  } finally {
    await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`;
    await sql`DELETE FROM app_user WHERE id IN (${user.id},${editor},${approver},${viewer})`;
  }
}
const input = (f: Fixture) => ({ workspaceId: f.workspaceId, deniedReservationId: f.deniedId, justification: "Synthetic exact estimate explanation" });
async function snapshot(workspaceId: string) {
  const result: Record<string, unknown> = {};
  for (const table of ["ai_budget_alert", "ai_spend_exception_request", "ai_spend_reservation", "ai_usage_event", "audit_event"]) {
    result[table] = await sql`SELECT to_jsonb(t) AS value FROM ${sql(table)} t WHERE workspace_id=${workspaceId} ORDER BY id`;
  }
  return result;
}
async function waitForLock(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if ((await sql`SELECT 1 FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock'`).length) return;
    await delay(10);
  }
  throw new Error("Synthetic contender did not reach its expected database lock");
}
describe.skipIf(!databaseUrl)("budget action current-state recovery", () => {
  beforeAll(() => { sql = createDatabaseClient(databaseUrl!); }); afterAll(async () => { await sql?.end(); });
  it("recovers exact alert/request/decision entities without modifying records", () => fixture(async f => {
    const created = await f.ai.requestSpendException(input(f), f.editor, asOf);
    const acknowledged = await f.ai.acknowledgeBudgetAlert(f.workspaceId, f.alertId, f.editor, asOf);
    const approved = await f.ai.decideSpendException(f.workspaceId, created.id, "approved", f.approver, "Reviewed synthetic estimate", asOf);
    const before = await snapshot(f.workspaceId);
    expect(await f.ai.getBudgetActionState(f.workspaceId, "acknowledge_alert", f.alertId, f.editor, asOf)).toEqual(acknowledged);
    expect(await f.ai.getBudgetActionState(f.workspaceId, "request_exception", f.deniedId, f.editor, asOf)).toEqual(approved);
    expect(await f.ai.getBudgetActionState(f.workspaceId, "decide_exception", created.id, f.approver, asOf)).toEqual(approved);
    expect(await snapshot(f.workspaceId)).toEqual(before);
  }));
  it("keeps original request details and terminal authorship when existing operations deduplicate", () => fixture(async f => {
    const created = await f.ai.requestSpendException(input(f), f.editor, asOf);
    const acknowledged = await f.ai.acknowledgeBudgetAlert(f.workspaceId, f.alertId, f.editor, asOf);
    const approved = await f.ai.decideSpendException(f.workspaceId, created.id, "approved", f.approver, "Original note", asOf);
    const before = await snapshot(f.workspaceId);
    expect(await f.ai.requestSpendException({ ...input(f), justification: "Different author and explanation" }, f.owner, asOf)).toEqual(approved);
    expect(await f.ai.acknowledgeBudgetAlert(f.workspaceId, f.alertId, f.owner, asOf)).toEqual(acknowledged);
    expect(await f.ai.decideSpendException(f.workspaceId, created.id, "approved", f.owner, "Different note", asOf)).toEqual(approved);
    await expect(f.ai.decideSpendException(f.workspaceId, created.id, "rejected", f.owner, undefined, asOf)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
    expect(await snapshot(f.workspaceId)).toEqual(before);
  }));
  it("requires current action-specific role, denies cross-workspace lookup and does not fall back to another target", () => fixture(async f => {
    const created = await f.ai.requestSpendException(input(f), f.editor, asOf);
    for (const [kind, target, deniedActor] of [["acknowledge_alert", f.alertId, f.approver], ["request_exception", f.deniedId, f.approver], ["decide_exception", created.id, f.editor]] as const) {
      await expect(f.ai.getBudgetActionState(f.workspaceId, kind, target, deniedActor, asOf)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      await expect(f.ai.getBudgetActionState(f.workspaceId, kind, target, f.viewer, asOf)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      await expect(f.ai.getBudgetActionState(randomUUID(), kind, target, f.owner, asOf)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      expect(await f.ai.getBudgetActionState(f.workspaceId, kind, randomUUID(), f.owner, asOf)).toBeUndefined();
    }
    await sql`UPDATE workspace_membership SET role='viewer' WHERE workspace_id=${f.workspaceId} AND user_id=${f.editor}`;
    await expect(f.ai.getBudgetActionState(f.workspaceId, "request_exception", f.deniedId, f.editor, asOf)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
  }));
  it("reports expiration without mutating a pending record or authorizing a reservation", () => fixture(async f => {
    const created = await f.ai.requestSpendException(input(f), f.editor, asOf), before = await snapshot(f.workspaceId);
    expect(await f.ai.getBudgetActionState(f.workspaceId, "decide_exception", created.id, f.approver, new Date(asOf.getTime() + 86400001))).toMatchObject({ status: "expired", resolvedBy: undefined, consumedAt: undefined });
    expect(await snapshot(f.workspaceId)).toEqual(before);
  }));
  it("deduplicates concurrent requests and acknowledgements and admits one terminal decision", () => fixture(async f => {
    const requests = await Promise.all([f.ai.requestSpendException(input(f), f.editor, asOf), f.ai.requestSpendException(input(f), f.owner, asOf)]);
    expect(requests[0]!.id).toBe(requests[1]!.id);
    const alerts = await Promise.all([f.ai.acknowledgeBudgetAlert(f.workspaceId, f.alertId, f.editor, asOf), f.ai.acknowledgeBudgetAlert(f.workspaceId, f.alertId, f.owner, asOf)]);
    expect(alerts[0]).toEqual(alerts[1]);
    const decisions = await Promise.allSettled([f.ai.decideSpendException(f.workspaceId, requests[0]!.id, "approved", f.approver, undefined, asOf), f.ai.decideSpendException(f.workspaceId, requests[0]!.id, "rejected", f.owner, undefined, asOf)]);
    expect(decisions.filter(value => value.status === "fulfilled")).toHaveLength(1);
    const audits = await sql`SELECT event_type,count(*)::int AS count FROM audit_event WHERE workspace_id=${f.workspaceId} AND event_type IN ('ai.spend_exception_requested','ai.spend_exception_approved','ai.spend_exception_rejected','ai.budget_alert_acknowledged') GROUP BY event_type`;
    expect(audits).toHaveLength(3); expect(audits.every(row => row.count === 1)).toBe(true);
    expect((await sql`SELECT count(*)::int AS count FROM ai_spend_reservation WHERE workspace_id=${f.workspaceId}`)[0]!.count).toBe(2);
  }));
  it.each(["acknowledge_alert", "request_exception", "decide_exception"] as const)("holds %s authority through commit while a proven concurrent demotion waits", kind => fixture(async f => {
    const created = kind === "decide_exception" ? await f.ai.requestSpendException(input(f), f.editor, asOf) : undefined;
    const target = kind === "acknowledge_alert" ? f.alertId : kind === "request_exception" ? f.deniedId : created!.id;
    const table = kind === "acknowledge_alert" ? "ai_budget_alert" : kind === "request_exception" ? "ai_spend_reservation" : "ai_spend_exception_request";
    const actor = kind === "decide_exception" ? f.approver : f.editor;
    const writer = createDatabaseClient(databaseUrl!, { max: 1 }), demoter = createDatabaseClient(databaseUrl!, { max: 1 });
    let release!: () => void, locked!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { locked = resolve; });
    const blocker = sql.begin(async tx => { await tx`SELECT id FROM ${tx(table)} WHERE workspace_id=${f.workspaceId} AND id=${target} FOR UPDATE`; locked(); await hold; });
    let mutation: Promise<unknown> | undefined, demotion: Promise<unknown> | undefined;
    try {
      await ready;
      const [{ pid: writerPid }] = await writer<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      const [{ pid: demoterPid }] = await demoter<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      const repository = new AiRepository(writer);
      mutation = kind === "acknowledge_alert" ? repository.acknowledgeBudgetAlert(f.workspaceId, target, actor, asOf)
        : kind === "request_exception" ? repository.requestSpendException(input(f), actor, asOf)
        : repository.decideSpendException(f.workspaceId, target, "approved", actor, undefined, asOf);
      void mutation.catch(() => undefined); await waitForLock(writerPid!);
      demotion = demoter`UPDATE workspace_membership SET role='viewer' WHERE workspace_id=${f.workspaceId} AND user_id=${actor}`.then(rows => rows);
      void demotion.catch(() => undefined); await waitForLock(demoterPid!);
      release(); await blocker; await expect(mutation).resolves.toBeDefined(); await demotion;
      await expect(f.ai.getBudgetActionState(f.workspaceId, kind, target, actor, asOf)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
    } finally { release(); await blocker; await mutation?.catch(() => undefined); await demotion?.catch(() => undefined); await writer.end(); await demoter.end(); }
  }), 15000);
});
