import { afterEach, describe, expect, it, vi } from "vitest";
import { BUDGET_ACTION_LIMITS, budgetActionEndpoint, budgetActionResultText, budgetActionSchema, budgetActionStorageKey,
  makeBudgetActionAttempt, persistBudgetActionAttempt, readBudgetActionJson, restoreBudgetActionAttempt, runBudgetActionAttempt,
  verifyBudgetActionState, type BudgetAction, type BudgetActionState } from "./ai-budget-action-contract";

const scope = { userId: "11111111-1111-4111-8111-111111111111", workspaceId: "22222222-2222-4222-8222-222222222222" };
const targetId = "33333333-3333-4333-8333-333333333333", other = "44444444-4444-4444-8444-444444444444", timestamp = "2026-10-01T00:00:00.000Z";
const ack: BudgetAction = { kind: "acknowledge_alert", workspaceId: scope.workspaceId, targetId };
const request: BudgetAction = { ...ack, kind: "request_exception", justification: "Reviewed synthetic launch" };
const decision: BudgetAction = { ...ack, kind: "decide_exception", decision: "approved" };
const alert: BudgetActionState = { kind: "alert", id: targetId, workspaceId: scope.workspaceId, status: "acknowledged", acknowledgedBy: scope.userId, acknowledgedAt: timestamp };
const exception: BudgetActionState = { kind: "exception", workspaceId: scope.workspaceId, id: targetId, deniedReservationId: targetId, status: "approved", justification: request.justification, requestedBy: scope.userId, resolvedBy: scope.userId, expiresAt: timestamp, resolvedAt: timestamp };
const storage = () => { const map = new Map<string, string>(); return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } }; };
afterEach(() => vi.unstubAllGlobals());
describe("closed budget-action recovery contract", () => {
  it("copies, normalizes and freezes request details", () => {
    const attempt = makeBudgetActionAttempt(scope, { ...request, justification: "  Reviewed synthetic launch  " });
    expect(attempt.action).toEqual(request); expect(Object.isFrozen(attempt.action)).toBe(true); expect(Object.isFrozen(attempt)).toBe(true);
    expect(attempt.action).not.toBe(request);
  });
  for (const invalid of [{ ...ack, actor: other }, { ...request, justification: " " }, { ...request, justification: "a".repeat(1001) },
    { ...decision, decision: "expired" }, { ...decision, note: " " }, { ...ack, kind: "consume" }, { ...ack, targetId: "bad" }]) {
    it(`rejects invalid action ${JSON.stringify(invalid).slice(0, 80)}`, () => expect(budgetActionSchema.safeParse(invalid).success).toBe(false));
  }
  it("rejects foreign account/workspace and unknown recovery versions", () => {
    const attempt = makeBudgetActionAttempt(scope, ack);
    expect(() => restoreBudgetActionAttempt(JSON.stringify({ ...attempt, userId: other }), scope)).toThrow();
    expect(() => makeBudgetActionAttempt(scope, { ...ack, workspaceId: other })).toThrow();
    expect(() => restoreBudgetActionAttempt(JSON.stringify({ ...attempt, version: 2 }), scope)).toThrow();
    expect(budgetActionStorageKey(scope)).not.toBe(budgetActionStorageKey({ ...scope, userId: other }));
  });
  it("restores only bounded valid recovery JSON", () => {
    expect(restoreBudgetActionAttempt(null, scope)).toBeUndefined();
    for (const raw of ["not-json", "x".repeat(BUDGET_ACTION_LIMITS.recoveryBytes + 1), "{}"]) expect(() => restoreBudgetActionAttempt(raw, scope)).toThrow();
  });
  it("requires readback and refuses replacement of a different saved action", () => {
    const memory = storage(), attempt = makeBudgetActionAttempt(scope, ack);
    persistBudgetActionAttempt(memory, scope, attempt); expect(memory.map.size).toBe(1);
    expect(() => persistBudgetActionAttempt(memory, scope, makeBudgetActionAttempt(scope, decision))).toThrow();
    expect(() => persistBudgetActionAttempt({ getItem: () => null, setItem: () => undefined }, scope, attempt)).toThrow();
  });
  it("maps only supported endpoints without actor authority fields", () => {
    expect(budgetActionEndpoint(ack)).toEqual({ url: `/api/v1/ai-budget-alerts/${targetId}/acknowledge`, method: "PATCH", body: { workspaceId: scope.workspaceId } });
    expect(budgetActionEndpoint(request).body).toEqual({ workspaceId: scope.workspaceId, deniedReservationId: targetId, justification: request.justification });
    expect(budgetActionEndpoint(decision).body).toEqual({ workspaceId: scope.workspaceId, decision: "approved" });
  });
  for (const [action, state] of [[ack, alert], [request, exception], [decision, exception]] as const) {
    it(`sends one ${action.kind} only after storage verification`, async () => {
      const memory = storage(), attempt = makeBudgetActionAttempt(scope, action);
      const send = vi.fn(async (_url: string, init: RequestInit) => {
        expect(memory.getItem(budgetActionStorageKey(scope))).toBe(JSON.stringify(attempt));
        expect(init.cache).toBe("no-store"); expect(init.signal).toBeInstanceOf(AbortSignal);
        return Response.json({ data: state }, { status: action.kind === "request_exception" ? 201 : 200 });
      }); vi.stubGlobal("fetch", send);
      expect(await runBudgetActionAttempt(memory, scope, attempt, false)).toEqual(state); expect(send).toHaveBeenCalledOnce();
    });
    it(`recovers ${action.kind} with GET only`, async () => {
      const send = vi.fn().mockResolvedValue(Response.json({ data: state })); vi.stubGlobal("fetch", send);
      await runBudgetActionAttempt(storage(), scope, makeBudgetActionAttempt(scope, action), true);
      expect(send).toHaveBeenCalledOnce(); expect(send.mock.calls[0]![0]).toContain("/api/v1/ai-budget-actions/state?");
      expect(send.mock.calls[0]![1]).toMatchObject({ method: "GET", cache: "no-store" }); expect(send.mock.calls[0]![1]).not.toHaveProperty("body");
    });
  }
  for (const response of [() => new Response("invalid", { status: 200 }), () => Response.json({ data: alert }, { status: 202 }),
    () => Response.json({ data: { ...alert, workspaceId: other } }), () => Response.json({ data: alert, extra: true }),
    () => Response.json({ error: { message: "private synthetic message" } }, { status: 503 })]) {
    it("rejects unconfirmed responses without reflecting server text", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
      await expect(runBudgetActionAttempt(storage(), scope, makeBudgetActionAttempt(scope, ack), false)).rejects.toThrow();
    });
  }
  it("404 is uncertainty, not cancellation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({}, { status: 404 })));
    await expect(runBudgetActionAttempt(storage(), scope, makeBudgetActionAttempt(scope, ack), true)).rejects.toThrow("could still finish");
  });
  it("bounds advertised and streamed bytes and rejects invalid UTF-8", async () => {
    await expect(readBudgetActionJson(Response.json({}, { headers: { "content-length": "16385" } }), 16384)).rejects.toThrow();
    await expect(readBudgetActionJson(Response.json("a".repeat(16384)), 16384)).rejects.toThrow();
    await expect(readBudgetActionJson(new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }), 16384)).rejects.toThrow();
  });
  it("requires coherent scoped entity identity and decision fields", () => {
    for (const state of [{ ...alert, id: other }, { ...alert, acknowledgedAt: undefined }, { ...alert, status: "open" }]) expect(() => verifyBudgetActionState(ack, state)).toThrow();
    for (const state of [{ ...exception, resolvedBy: undefined }, { ...exception, status: "pending" }, { ...exception, id: other }]) expect(() => verifyBudgetActionState(decision, state)).toThrow();
    expect(() => verifyBudgetActionState(request, { ...exception, deniedReservationId: other })).toThrow();
  });
  it("never mislabels expiry or another actor's existing result as this action", () => {
    const attempt = makeBudgetActionAttempt(scope, decision);
    expect(budgetActionResultText(attempt, { ...exception, status: "expired" })).toContain("does not confirm");
    expect(budgetActionResultText(attempt, { ...exception, resolvedBy: other })).toContain("differs");
    expect(budgetActionResultText(attempt, { ...exception, decisionNote: "Earlier note" })).toContain("differs");
    expect(budgetActionResultText(makeBudgetActionAttempt(scope, request), { ...exception, justification: "Other explanation" })).toContain("was not saved");
    expect(budgetActionResultText(makeBudgetActionAttempt(scope, ack), { ...alert, acknowledgedBy: other })).toContain("another account");
  });
});
