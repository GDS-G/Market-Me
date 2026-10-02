import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExecutionControlGate, EXECUTION_CONTROL_BROWSER_LIMITS, loadExecutionSnapshot, makeExecutionAttempt, normalizeExecutionReason,
  parseExecutionReceipt, parseExecutionSnapshot, readExecutionResponse, runExecutionAttempt, type ExecutionControlSnapshot } from "./workspace-execution-control-contract";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./workspace-execution-control-panel.module.css", () => ({ default: {} }));
import { WorkspaceExecutionControlPanel } from "./workspace-execution-control-panel";
const userId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222";
const requestId = "44444444-4444-4444-8444-444444444444", grant = "55555555-5555-4555-8555-555555555555", scope = { userId, workspaceId };
const snapshot: ExecutionControlSnapshot = { workspaceId, state: "paused", revision: 3, changedAt: "2026-10-02T00:00:00.000Z", canManage: true, actorIncarnationId: grant, reason: "Original pause" };
const attempt = makeExecutionAttempt(scope, snapshot, requestId, "Reviewed reopening");
const receipt = { ...attempt.request, previousState: "paused", revision: 4, changedAt: snapshot.changedAt };
const response = (value: unknown = { data: receipt }, status = 200) => Response.json(value, { status });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("independent execution-control browser contracts", () => {
  it("pins one exact immutable intended state, actor grant and revision", () => {
    expect(attempt.request).toEqual({ workspaceId, requestId, expectedActorIncarnationId: grant, expectedRevision: 3, state: "open", reason: "Reviewed reopening" });
    for (const value of [attempt, attempt.request, attempt.preview, EXECUTION_CONTROL_BROWSER_LIMITS]) expect(Object.isFrozen(value)).toBe(true);
    expect(parseExecutionReceipt(receipt, attempt)).toEqual(receipt);
    expect(makeExecutionAttempt(scope, { ...snapshot, state: "open" }, requestId, "Pause now").request.state).toBe("paused");
  });
  it.each([{ workspaceId: userId }, { canManage: false }, { actorIncarnationId: "bad" }, { revision: 0 }, { revision: 2147483648 },
    { revision: 1, state: "paused", reason: "" }, { reason: "" }, { actorUserId: userId }, { state: "enabled" }])("rejects inconsistent/private current state %j", patch => {
    expect(() => parseExecutionSnapshot({ ...snapshot, ...patch }, scope)).toThrow();
  });
  it("accepts only minimized readonly state and never constructs its mutation", () => {
    const view = { workspaceId, state: "paused" as const, revision: 3, changedAt: snapshot.changedAt, canManage: false as const };
    expect(parseExecutionSnapshot(view, scope)).toEqual(view);
    expect(() => makeExecutionAttempt(scope, view, requestId, "Forbidden")).toThrow();
    expect(() => makeExecutionAttempt(scope, { ...snapshot, revision: 2147483647 }, requestId, "Exhausted")).toThrow();
    const html = renderToStaticMarkup(createElement(WorkspaceExecutionControlPanel, { ...scope, initial: view }));
    expect(html).toContain("Only a current workspace owner or administrator"); expect(html).not.toContain("Review workspace reopening"); expect(html).not.toContain(grant);
  });
  it.each(["", " ", "x\n", "x\u202e", "x\u200b", "x\ud800", "a".repeat(501)])("rejects unsafe reason %j", note => { expect(() => normalizeExecutionReason(note)).toThrow(); });
  it("normalizes NFC and whitespace consistently", () => { expect(normalizeExecutionReason("  cafe\u0301   release  ")).toBe("café release"); });
  it.each([{ workspaceId: userId }, { requestId: grant }, { expectedActorIncarnationId: requestId }, { expectedRevision: 2 }, { state: "paused" },
    { reason: "Changed" }, { previousState: "open" }, { revision: 3 }, { canonicalRequest: "private" }, { changedAt: "not a time" }])("rejects mismatched receipt %j", patch => {
    expect(() => parseExecutionReceipt({ ...receipt, ...patch }, attempt)).toThrow();
  });
  it("uses one exact POST and only a read-only GET for original recovery", async () => {
    const send = vi.fn().mockResolvedValueOnce(response({ data: receipt, meta: { replayed: false } }, 201)).mockResolvedValueOnce(response());
    const signal = new AbortController().signal;
    expect(await runExecutionAttempt(attempt, scope, false, signal, send)).toEqual(receipt);
    expect(await runExecutionAttempt(attempt, scope, true, signal, send)).toEqual(receipt);
    expect(send.mock.calls[0]).toEqual(["/api/v1/workspace-execution-control", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
      headers: { "content-type": "application/json" }, body: JSON.stringify(attempt.request) }]);
    expect(send.mock.calls[1]).toEqual([`/api/v1/workspace-execution-control?workspaceId=${workspaceId}&requestId=${requestId}`,
      { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal }]);
  });
  it("rejects altered scope, grant and request before any network request", async () => {
    const send = vi.fn(), signal = new AbortController().signal;
    for (const changed of [{ ...attempt, userId: grant }, { ...attempt, request: { ...attempt.request, expectedRevision: 4 } },
      { ...attempt, request: { ...attempt.request, state: "paused" as const } }, { ...attempt, request: { ...attempt.request, role: "owner" } }]) {
      await expect(runExecutionAttempt(changed, scope, false, signal, send)).rejects.toThrow();
    }
    await expect(runExecutionAttempt(attempt, { ...scope, workspaceId: grant }, true, signal, send)).rejects.toThrow(); expect(send).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 409, 422, 500, 503])("keeps status %s advice fixed and never auto-resends", async status => {
    const send = vi.fn().mockResolvedValue(response({ error: { message: "PRIVATE DETAIL" } }, status));
    let error: unknown; try { await runExecutionAttempt(attempt, scope, true, new AbortController().signal, send); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain("PRIVATE"); expect(send).toHaveBeenCalledTimes(1);
    if (status === 404) expect(String(error)).toContain("may still finish");
  });
  it("rejects unknown status/envelope/replay semantics and never retries response loss", async () => {
    for (const result of [response({ data: receipt }, 201), response({ data: receipt, meta: { replayed: true } }, 201),
      response({ data: receipt, meta: { replayed: false } }, 200), response({ data: receipt, meta: { replayed: false }, private: true }, 201), response({}, 202)]) {
      const send = vi.fn().mockResolvedValue(result); await expect(runExecutionAttempt(attempt, scope, false, new AbortController().signal, send)).rejects.toThrow(); expect(send).toHaveBeenCalledTimes(1);
    }
    const lost = vi.fn().mockRejectedValue(new Error("Network loss")); await expect(runExecutionAttempt(attempt, scope, false, new AbortController().signal, lost)).rejects.toThrow(); expect(lost).toHaveBeenCalledTimes(1);
  });
  it("loads fresh minimized state without any mutation", async () => {
    const send = vi.fn().mockResolvedValue(response({ data: snapshot })), signal = new AbortController().signal;
    expect(await loadExecutionSnapshot(scope, signal, send)).toEqual(snapshot);
    expect(send).toHaveBeenCalledExactlyOnceWith(`/api/v1/workspace-execution-control?workspaceId=${workspaceId}`, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal });
  });
  it("bounds response media, byte counts and UTF-8", async () => {
    for (const result of [new Response("{}"), new Response(null, { headers: { "content-type": "application/json" } }),
      response({}, 200), Response.json({}, { headers: { "content-length": "16385" } }), new Response("x".repeat(16385), { headers: { "content-type": "application/json" } }),
      new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } })]) {
      if (result.headers.get("content-type") === "application/json" && result.headers.get("content-length") === null && await result.clone().text() === "{}") expect(await readExecutionResponse(result)).toEqual({});
      else await expect(readExecutionResponse(result)).rejects.toThrow();
    }
  });
  it("serializes panel operations, times out and discards late/cancelled scope results", () => {
    vi.useFakeTimers(); const gate = createExecutionControlGate(), first = gate.begin()!;
    expect(gate.begin()).toBeUndefined(); expect(first.current()).toBe(true);
    vi.advanceTimersByTime(15_000); expect(first.signal.aborted).toBe(true); expect(first.current()).toBe(false);
    first.finish(); const second = gate.begin()!; first.finish(); expect(second.current()).toBe(true);
    gate.cancel(); expect(second.current()).toBe(false); expect(second.signal.aborted).toBe(true);
    const next = gate.begin()!; next.finish(); expect(vi.getTimerCount()).toBe(0);
  });
  it("states scope, irreversible delivery limits and explicit campaign resume in the initial screen", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceExecutionControlPanel, { ...scope, initial: snapshot }));
    expect(html).toContain("Workspace execution is paused"); expect(html).toContain("Review workspace reopening");
    expect(html).toContain("Already-admitted work may finish"); expect(html).toContain("explicit campaign Resume");
    expect(html).toContain("not a deployment-wide shutdown"); expect(html).not.toContain("Confirm workspace execution change");
  });
});
