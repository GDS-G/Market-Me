import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_SESSION_BROWSER_LIMITS, accountSessionLookupPath, createAccountSessionGate, makeAccountSessionIntent, parseAccountSessionReceipt,
  parseAccountSessionSnapshot, readAccountSessionResponse, runAccountSessionIntent, type AccountSessionList } from "./account-session-contract";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./account-sessions-panel.module.css", () => ({ default: {} }));
import { AccountSessionsPanel } from "./account-sessions-panel";
const accountId = "11111111-1111-4111-8111-111111111111", currentId = "22222222-2222-4222-8222-222222222222", targetId = "33333333-3333-4333-8333-333333333333", requestId = "44444444-4444-4444-8444-444444444444";
const time = "2026-10-02T00:00:00.000Z", item = { sessionId: currentId, createdAt: time, lastSeenAt: time, expiresAt: "2026-10-03T00:00:00.000Z" };
const list: AccountSessionList = { accountId, observedAt: time, current: item, others: [{ ...item, sessionId: targetId }], totalOthers: "1", nextCursor: null };
const intent = makeAccountSessionIntent(list, targetId, requestId), result = { ...intent, revokedAt: time };
const response = (value: unknown = { data: result }, status = 200) => Response.json(value, { status });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("session browser contract and request lifetime", () => {
  it("pins one exact intent and exposes no target/token in a historical lookup URL", () => {
    expect(intent).toEqual({ accountId, requestId, targetSessionId: targetId }); expect(Object.isFrozen(intent)).toBe(true);
    expect(accountSessionLookupPath(intent)).toBe(`/api/v1/account-sessions?accountId=${accountId}&requestId=${requestId}`);
    expect(Object.isFrozen(ACCOUNT_SESSION_BROWSER_LIMITS)).toBe(true);
    expect(parseAccountSessionSnapshot(list, accountId)).toEqual(list);
  });
  it.each([currentId, requestId, "bad"])("refuses current, stale or invalid target %s before transport", target => {
    expect(() => makeAccountSessionIntent(list, target, requestId)).toThrow();
  });
  it.each([{ accountId: targetId }, { tokenHash: "private" }, { totalOthers: "01" }, { totalOthers: "0" }, { observedAt: "bad" }, { nextCursor: "a" },
    { others: [{ ...item }] }, { others: Array(31).fill({ ...item, sessionId: targetId }) }, { current: { ...item, tokenHash: "private" } }])("rejects unsafe or incoherent list %j", patch => {
    expect(() => parseAccountSessionSnapshot({ ...list, ...patch }, accountId)).toThrow();
  });
  it.each([{ accountId: targetId }, { requestId: targetId }, { targetSessionId: currentId }, { revokedAt: "bad" }, { tokenHash: "secret" }, { actorSessionId: currentId }])("binds every receipt to original intent and minimizes fields %j", patch => {
    expect(() => parseAccountSessionReceipt({ ...result, ...patch }, intent)).toThrow();
  });
  it("performs one explicit POST and one GET only with strict transport options", async () => {
    const send = vi.fn().mockResolvedValueOnce(response({ data: result, meta: { replayed: false } }, 201)).mockResolvedValueOnce(response());
    const signal = new AbortController().signal;
    expect(await runAccountSessionIntent(intent, false, signal, send)).toEqual(result);
    expect(send).toHaveBeenNthCalledWith(1, "/api/v1/account-sessions", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal, headers: { "content-type": "application/json" }, body: JSON.stringify(intent) });
    expect(await runAccountSessionIntent(intent, true, signal, send)).toEqual(result);
    expect(send).toHaveBeenNthCalledWith(2, accountSessionLookupPath(intent), { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 404, 409, 500, 503])("uses bounded fixed guidance for status %s with no automatic retries", async status => {
    const send = vi.fn().mockResolvedValue(response({ error: { message: "PRIVATE SERVER DETAIL" } }, status));
    let error: unknown; try { await runAccountSessionIntent(intent, true, new AbortController().signal, send); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain("PRIVATE"); expect(send).toHaveBeenCalledTimes(1);
    if (status === 404) expect(String(error)).toContain("may still finish");
  });
  it("does not resend on network loss or accept an unexpected success/extra metadata", async () => {
    const lost = vi.fn().mockRejectedValue(new Error("Network loss"));
    await expect(runAccountSessionIntent(intent, false, new AbortController().signal, lost)).rejects.toThrow(); expect(lost).toHaveBeenCalledTimes(1);
    for (const value of [response({ data: result }, 202), response({ data: result }, 201), response({ data: result, secret: "private" }), response({ data: result, meta: { replayed: true, private: "x" } })]) {
      const send = vi.fn().mockResolvedValue(value); await expect(runAccountSessionIntent(intent, true, new AbortController().signal, send)).rejects.toThrow(); expect(send).toHaveBeenCalledTimes(1);
    }
  });
  it("fails closed on non-JSON, malformed UTF-8, absent body and advertised/streamed oversized responses", async () => {
    for (const value of [new Response("{}"), new Response(null, { headers: { "content-type": "application/json" } }),
      new Response("{}", { headers: { "content-type": "application/json", "content-length": "16385" } }),
      new Response("x".repeat(16385), { headers: { "content-type": "application/json" } }),
      new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } })]) await expect(readAccountSessionResponse(value)).rejects.toThrow();
  });
  it("checks cancellation before sending and after response body resolution", async () => {
    const first = new AbortController(); first.abort(); const notSent = vi.fn();
    await expect(runAccountSessionIntent(intent, false, first.signal, notSent)).rejects.toThrow(); expect(notSent).not.toHaveBeenCalled();
    const second = new AbortController(); const send = vi.fn().mockImplementation(async () => { second.abort(); return response(); });
    await expect(runAccountSessionIntent(intent, true, second.signal, send)).rejects.toThrow(); expect(send).toHaveBeenCalledTimes(1);
  });
  it("blocks immediate overlap, expires at15s and cleans timers even if transport never resolves", () => {
    vi.useFakeTimers(); const gate = createAccountSessionGate(), active = gate.begin()!;
    expect(gate.begin()).toBeUndefined(); expect(active.current()).toBe(true);
    vi.advanceTimersByTime(15_000); expect(active.signal.aborted).toBe(true); expect(active.current()).toBe(false);
    expect(gate.begin()).toBeUndefined(); gate.cancel(); expect(vi.getTimerCount()).toBe(0);
    const newer = gate.begin()!; active.finish(); expect(newer.current()).toBe(true); expect(gate.begin()).toBeUndefined();
    newer.finish(); expect(vi.getTimerCount()).toBe(0); expect(gate.begin()).toBeDefined(); gate.cancel();
  });
  it("renders honest current/other scope and requires review before a sign-out form exists", () => {
    const html = renderToStaticMarkup(createElement(AccountSessionsPanel, { snapshot: list }));
    expect(html).toContain("This current session"); expect(html).toContain("Last server request"); expect(html).toContain("1 other active sessions");
    expect(html).toContain(`Review sign out · ${targetId}`); expect(html).not.toContain(`Review sign out · ${currentId}`);
    expect(html).not.toContain('aria-label="Confirm selected session sign out"'); expect(html).not.toContain('type="submit"');
    expect(html).toContain("No device, browser, IP address or location is recorded"); expect(html).toContain("not a frozen history");
    expect(html).not.toMatch(/tokenHash|token_hash|mm_session|localStorage|sessionStorage/);
  });
  it("renders an empty list and scoped keyboard/touch styling without fake device labels", () => {
    const html = renderToStaticMarkup(createElement(AccountSessionsPanel, { snapshot: { ...list, others: [], totalOthers: "0" } }));
    expect(html).toContain("No other active sessions"); expect(html).not.toContain("Review sign out ·");
    const css = readFileSync(new URL("./account-sessions-panel.module.css", import.meta.url), "utf8"); expect(css).toContain("min-height: 44px"); expect(css).toContain("outline: 3px solid");
  });
});
