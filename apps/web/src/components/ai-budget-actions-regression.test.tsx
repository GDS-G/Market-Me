import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_MODE_INDICATORS } from "@market-me/generation";
import type { AiPolicyFormProps } from "./ai-policy-form";

// Handler-only regression harness; all transport and storage are in memory.
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), states: [] as unknown[], refs: [] as {current: unknown}[], cursor: 0, refCursor: 0 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState(initial: unknown) { const index = mocks.cursor++; if (!(index in mocks.states)) mocks.states[index] = typeof initial === "function" ? initial() : initial;
    return [mocks.states[index], (value: unknown) => { mocks.states[index] = typeof value === "function" ? value(mocks.states[index]) : value; }]; },
  useRef(initial: unknown) { const index = mocks.refCursor++; return mocks.refs[index] ?? (mocks.refs[index] = { current: initial }); },
  useEffect: () => undefined,
}));
import { AiPolicyPanel } from "./ai-policy-form";
import { BudgetActionRecovery } from "./ai-budget-action-recovery";

const userId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222";
const alertId = "33333333-3333-4333-8333-333333333333", requestId = "44444444-4444-4444-8444-444444444444";
const deniedReservationId = "55555555-5555-4555-8555-555555555555", stamp = "2026-10-01T00:00:00.000Z";
const props: AiPolicyFormProps = {
  userId, workspaceId, policyRevision: 0,
  policy: { workspaceId, mode: "recommended", maximumPrivacyClass: "cloud", failoverMode: "ask_before_switching", capBehavior: "require_approval", currency: "USD", alertThresholdPercentages: [50, 80, 100] },
  usage: { currency: "USD", currentMonthCostMinor: 0, requestCount: 0, inputUnits: 0, outputUnits: 0, cachedInputUnits: 0, byFeature: [] },
  budgetStatus: { asOf: stamp, currency: "USD", daily: { scope: "daily", spentMinor: 0, reservedMinor: 0 }, monthly: { scope: "monthly", spentMinor: 0, reservedMinor: 0 }, activeReservationCount: 0, recentReservations: [] },
  budgetAlerts: [{ id: alertId, workspaceId, scope: "monthly", windowKey: "2026-10", thresholdPercentage: 50, committedCostMinor: 50, capMinor: 100, currency: "USD", status: "open", createdAt: stamp, updatedAt: stamp }],
  spendExceptions: [{ id: requestId, workspaceId, deniedReservationId, capability: "generate_text", feature: "synthetic", currency: "USD", estimatedCostMinor: 100, exceededScopes: ["monthly"], capBehavior: "require_approval", status: "pending", justification: "Synthetic approved test input", requestedBy: userId, expiresAt: "2099-01-01T00:00:00.000Z", createdAt: stamp, updatedAt: stamp }],
  capResponses: [], canRequestSpendException: true, canApproveSpendException: true, canEditPolicy: true, hasSavedPolicy: false, modeIndicators: AI_MODE_INDICATORS,
};
let currentProps: AiPolicyFormProps;
let memory: Map<string, string>;
function panel() { mocks.cursor = 0; mocks.refCursor = 0; return AiPolicyPanel({ ...currentProps, recoveryReady: true }); }
function findNode<T>(node: ReactNode, predicate: (type: unknown, props: T) => boolean): T | undefined {
  if (Array.isArray(node)) return node.map(child => findNode<T>(child, predicate)).find(Boolean);
  if (!isValidElement<T & { children?: ReactNode }>(node)) return;
  return predicate(node.type, node.props) ? node.props : findNode<T>(node.props.children, predicate);
}
function recovery() { return findNode<Parameters<typeof BudgetActionRecovery>[0]>(panel(), type => type === BudgetActionRecovery)!.recovery; }
function action(label: string) {
  if (label !== "Request approval") return button(label).onClick;
  const textarea = findNode<{ onChange(event: { target: { value: string } }): void }>(panel(), type => type === "textarea")!;
  textarea.onChange({ target: { value: "Synthetic explanation retained across uncertainty" } });
  const form = findNode<{ className?: string; onSubmit(event: { preventDefault(): void }): Promise<void> }>(panel(), (type, value) => type === "form" && value.className === "ai-spend-exception-form")!;
  return () => form.onSubmit({ preventDefault() {} });
}
function button(label: string) {
  const find = (node: ReactNode): { onClick(): Promise<void>; disabled?: boolean } | undefined => {
    if (Array.isArray(node)) return node.map(find).find(Boolean);
    if (!isValidElement<{ children?: ReactNode; onClick(): Promise<void>; disabled?: boolean }>(node)) return;
    return node.type === "button" && node.props.children === label ? node.props : find(node.props.children);
  };
  const result = find(panel()); expect(result).toBeDefined(); return result!;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.states = []; mocks.refs = [];
  currentProps = { ...props, budgetStatus: { ...props.budgetStatus, recentReservations: [{ id: "66666666-6666-4666-8666-666666666666", workspaceId,
    capability: "generate_text", feature: "synthetic", currency: "USD", estimatedCostMinor: 100, status: "denied", exceededScopes: ["daily"], capBehavior: "require_approval", requestedBy: userId, createdAt: stamp, updatedAt: stamp }] } };
  memory = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());
describe("budget action response safety", () => {
  for (const label of ["Acknowledge", "Approve", "Request approval"]) {
    it(`${label} handles response loss without an unhandled rejection`, async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Synthetic connection loss")));
      await expect(action(label)()).resolves.toBeUndefined();
      expect(recovery().pending).toBe(false); expect(recovery().frozen).toBe(true); expect(recovery().attempt).toBeDefined();
      expect(mocks.refresh).not.toHaveBeenCalled();
    });
    it(`${label} does not treat malformed successful JSON as a confirmed action`, async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
      await action(label)(); expect(mocks.refresh).not.toHaveBeenCalled(); expect(recovery().result).toBeUndefined(); expect(recovery().pending).toBe(false);
    });
    it(`${label} admits at most one same-tick action`, async () => {
      let finish!: (response: Response) => void;
      const response = new Promise<Response>(resolve => { finish = resolve; });
      const send = vi.fn().mockReturnValue(response); vi.stubGlobal("fetch", send);
      const submit = action(label), first = submit(), second = submit();
      finish(Response.json({ error: { code: "synthetic_failure" } }, { status: 503 }));
      await Promise.all([first, second]); expect(send).toHaveBeenCalledTimes(1);
    });
  }
  it("retains the exact action, blocks a different action and restores without automatically sending", async () => {
    const send = vi.fn().mockRejectedValue(new Error("Synthetic loss")); vi.stubGlobal("fetch", send);
    const submit = action("Request approval"); await submit(); const saved = recovery().attempt;
    await submit(); await action("Approve")(); expect(send).toHaveBeenCalledOnce();
    expect(saved?.action).toMatchObject({ kind: "request_exception", justification: "Synthetic explanation retained across uncertainty" });
    mocks.states = []; mocks.refs = []; send.mockClear();
    expect(recovery().attempt).toEqual(saved); expect(recovery().result).toBeUndefined(); expect(send).not.toHaveBeenCalled();
  });
  it("performs only an explicit GET after response loss", async () => {
    const send = vi.fn().mockRejectedValue(new Error("Synthetic loss")); vi.stubGlobal("fetch", send);
    await action("Acknowledge")(); send.mockResolvedValue(Response.json({ data: { kind: "alert", id: alertId, workspaceId, status: "acknowledged", acknowledgedBy: userId, acknowledgedAt: stamp } }));
    await recovery().run(); expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1]![1].method).toBe("GET");
    expect(recovery().result).toMatchObject({ status: "acknowledged" }); expect(recovery().frozen).toBe(true);
  });
  it("does not send if durable tab-local retention fails", async () => {
    const send = vi.fn(); vi.stubGlobal("fetch", send); vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => { throw new Error("Synthetic denied storage"); } });
    await action("Approve")(); expect(send).not.toHaveBeenCalled(); expect(recovery().storageError).toContain("not sent"); expect(recovery().pending).toBe(false);
  });
  it("checks independent client permissions before new actions and recovery", async () => {
    const send = vi.fn(); vi.stubGlobal("fetch", send); currentProps = { ...currentProps, canEditPolicy: false, canRequestSpendException: false, canApproveSpendException: false };
    await recovery().run({ kind: "decide_exception", workspaceId, targetId: requestId, decision: "approved" }); expect(send).not.toHaveBeenCalled();
  });
  it("requires explicit acknowledgement and byte-identical storage before clearing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Synthetic loss"))); const reload = vi.fn(); vi.stubGlobal("window", { location: { reload } });
    await action("Approve")(); recovery().reset(); expect(memory.size).toBe(1); expect(reload).not.toHaveBeenCalled();
    recovery().setConfirmed(true); const key = [...memory.keys()][0]!; memory.set(key, "changed elsewhere"); recovery().reset();
    expect(memory.get(key)).toBe("changed elsewhere"); expect(reload).not.toHaveBeenCalled();
  });
  it("clears only the acknowledged local copy and reloads for current saved records", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Synthetic loss"))); const reload = vi.fn(); vi.stubGlobal("window", { location: { reload } });
    await action("Approve")(); recovery().setConfirmed(true); recovery().reset(); expect(memory.size).toBe(0); expect(reload).toHaveBeenCalledOnce(); expect(recovery().pending).toBe(true);
  });
});
