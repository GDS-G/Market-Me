import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_MODE_INDICATORS } from "@market-me/generation";

// Handler-only harness: in-memory storage and React slots, no DOM, real transport or provider.
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), states: [] as unknown[], refs: [] as {current: unknown}[], cursor: 0, refCursor: 0 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState(initial: unknown) { const index = mocks.cursor++; if (!(index in mocks.states)) mocks.states[index] = typeof initial === "function" ? initial() : initial;
    return [mocks.states[index], (value: unknown) => { mocks.states[index] = typeof value === "function" ? value(mocks.states[index]) : value; }]; },
  useRef(initial: unknown) { const index = mocks.refCursor++; return mocks.refs[index] ?? (mocks.refs[index] = { current: initial }); },
  useEffect: () => undefined,
}));
import { AiPolicyPanel } from "./ai-policy-form";
import { AiPolicySaveRecovery } from "./ai-policy-save-recovery";

function panel() {
  mocks.cursor = 0; mocks.refCursor = 0;
  return AiPolicyPanel({ userId: "11111111-1111-4111-8111-111111111111", policyRevision: 0, recoveryReady: true,
    workspaceId: "22222222-2222-4222-8222-222222222222", policy: {
    workspaceId: "22222222-2222-4222-8222-222222222222", mode: "recommended", maximumPrivacyClass: "cloud",
    failoverMode: "ask_before_switching", capBehavior: "require_approval", currency: "USD", alertThresholdPercentages: [50,80,100],
  }, usage: { unitIntegrity: { status: "compatible", ledgerExponent: 2, incompatibleReservationCount: 0 }, currency: "USD", currentMonthCostMinor: 0, requestCount: 0, inputUnits: 0, outputUnits: 0, cachedInputUnits: 0, byFeature: [] },
  budgetStatus: { unitIntegrity: { status: "compatible", ledgerExponent: 2, incompatibleReservationCount: 0 }, asOf: "2026-10-01T00:00:00Z", currency: "USD", daily: { scope: "daily", spentMinor: 0, reservedMinor: 0 },
    monthly: { scope: "monthly", spentMinor: 0, reservedMinor: 0 }, activeReservationCount: 0, recentReservations: [] },
  budgetAlerts: [], spendExceptions: [], capResponses: [], canRequestSpendException: false, canApproveSpendException: false,
  canEditPolicy: true, hasSavedPolicy: false, modeIndicators: AI_MODE_INDICATORS });
}
function recovery() {
  const find = (node: ReactNode): Parameters<typeof AiPolicySaveRecovery>[0]["recovery"] | undefined => {
    if (Array.isArray(node)) return node.map(find).find(Boolean);
    if (!isValidElement<{ children?: ReactNode; recovery: Parameters<typeof AiPolicySaveRecovery>[0]["recovery"] }>(node)) return;
    return node.type === AiPolicySaveRecovery ? node.props.recovery : find(node.props.children);
  };
  return find(panel())!;
}
function submitHandler() {
  const find = (node: ReactNode): ((event: { preventDefault(): void }) => Promise<void>) | undefined => {
    if (Array.isArray(node)) return node.map(find).find(Boolean);
    if (!isValidElement<{ children?: ReactNode; onSubmit?: (event: { preventDefault(): void }) => Promise<void> }>(node)) return;
    return node.type === "form" ? node.props.onSubmit : find(node.props.children);
  };
  const submit = find(panel()); expect(submit).toBeDefined(); return submit!;
}
const event = { preventDefault: vi.fn() };
let storage: Map<string, string>;
beforeEach(() => {
  vi.clearAllMocks(); mocks.states = []; mocks.refs = []; storage = new Map();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());
describe("AI policy save response safety", () => {
  it("handles a lost response without leaving pending stuck", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Synthetic connection loss")));
    const submit = submitHandler();
    await expect(submit(event)).resolves.toBeUndefined();
    expect(recovery().pending).toBe(false); expect(recovery().error).toContain("retained");
    expect(recovery().attempt).toBeDefined(); expect(storage.size).toBe(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("does not turn malformed successful output into confirmed save", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", {status:200})));
    await submitHandler()(event);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(recovery().result).toBeUndefined(); expect(recovery().pending).toBe(false); expect(recovery().error).toContain("retained");
  });
  it("prevents two same-tick submits from sending duplicate mutations", async () => {
    let finish!: (value: Response) => void;
    const response = new Promise<Response>(resolve => { finish=resolve; });
    const send = vi.fn().mockReturnValue(response); vi.stubGlobal("fetch",send);
    const submit=submitHandler(), first=submit(event), second=submit(event);
    finish(Response.json({error:{code:"validation_failed",message:"Synthetic rejected input"}}, {status:422}));
    await Promise.all([first,second]); expect(send).toHaveBeenCalledTimes(1);
  });
  it("retains and reuses the same request even before a rerender", async () => {
    const send = vi.fn().mockRejectedValue(new Error("Synthetic loss")); vi.stubGlobal("fetch", send);
    const submit = submitHandler(); await submit(event); await submit(event);
    expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[0]![1].body).toBe(send.mock.calls[1]![1].body);
    expect(recovery().frozen).toBe(true);
  });
  it("refuses network I/O when storage cannot retain the request", async () => {
    const send = vi.fn(); vi.stubGlobal("fetch", send);
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => { throw new Error("Synthetic storage denial"); } });
    await submitHandler()(event); expect(send).not.toHaveBeenCalled(); expect(recovery().pending).toBe(false);
    expect(recovery().storageError).toContain("Nothing was sent"); expect(recovery().frozen).toBe(true);
  });
  it("restores the request without automatically sending or claiming success", async () => {
    const send = vi.fn().mockRejectedValue(new Error("Synthetic loss")); vi.stubGlobal("fetch", send);
    await submitHandler()(event); const saved = recovery().attempt;
    mocks.states = []; mocks.refs = []; send.mockClear();
    expect(recovery().attempt).toEqual(saved); expect(recovery().result).toBeUndefined(); expect(recovery().frozen).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
  it("requires explicit acknowledgement and byte-identical storage before clearing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Synthetic loss")));
    const reload = vi.fn(); vi.stubGlobal("window", { location: { reload } });
    await submitHandler()(event); recovery().reset(); expect(storage.size).toBe(1); expect(reload).not.toHaveBeenCalled();
    recovery().setConfirmed(true); const key = [...storage.keys()][0]!; storage.set(key, "changed elsewhere");
    recovery().reset(); expect(storage.get(key)).toBe("changed elsewhere"); expect(reload).not.toHaveBeenCalled();
  });
  it("clears only the exact local copy and reloads instead of reusing old revision props", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Synthetic loss")));
    const reload = vi.fn(); vi.stubGlobal("window", { location: { reload } });
    await submitHandler()(event); recovery().setConfirmed(true); recovery().reset();
    expect(storage.size).toBe(0); expect(reload).toHaveBeenCalledOnce(); expect(recovery().pending).toBe(true);
  });
});
