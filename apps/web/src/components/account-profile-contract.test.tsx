import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeAccountProfileRequest } from "@market-me/database";
import { ACCOUNT_PROFILE_BROWSER_LIMITS, accountProfileLookupPath, createAccountProfileGate, makeAccountProfileIntent,
  normalizeAccountDisplayName, parseAccountProfileReceipt, readAccountProfileResponse, runAccountProfileIntent } from "./account-profile-contract";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { AccountProfileForm } from "./account-profile-form";
const accountId = "11111111-1111-4111-8111-111111111111", requestId = "22222222-2222-4222-8222-222222222222";
const profile = { accountId, displayName: "Previous", revision: 1 };
const intent = makeAccountProfileIntent(profile, "Café Reader", requestId);
const receipt = { accountId, requestId, displayName: intent.displayName, revision: 2, changed: true, createdAt: "2026-10-02T00:00:00.000Z" };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("profile exact intent, bounded result and form-local lifecycle", () => {
  it("matches server normalization and freezes the memory-only canonical request", () => {
    const result = makeAccountProfileIntent(profile, " Cafe\u0301   Reader ", requestId);
    expect(result).toEqual(intent); expect(result).toEqual(normalizeAccountProfileRequest(result)); expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(ACCOUNT_PROFILE_BROWSER_LIMITS)).toBe(true); expect(normalizeAccountDisplayName("😀".repeat(60))).toHaveLength(120);
  });
  it.each(["", " ", "x".repeat(121), "😀".repeat(61), "x\n", "x\u200b", "x\u202e", "x\ud800", "x\udfff", "x".repeat(4097)])("rejects invalid name %j without a transport", value => {
    expect(() => makeAccountProfileIntent(profile, value, requestId)).toThrow();
  });
  it("correlates original changed/no-op outcomes to the exact intent and revision", () => {
    expect(parseAccountProfileReceipt(receipt, intent)).toEqual(receipt);
    expect(parseAccountProfileReceipt({ ...receipt, changed: false, revision: 1 }, intent)).toMatchObject({ changed: false, revision: 1 });
  });
  it.each([{ accountId: requestId }, { requestId: accountId }, { displayName: "Other" }, { revision: 3 }, { changed: false },
    { canonicalRequest: "private" }, { createdAt: "bad" }, { displayName: " Not normalized " }])("rejects foreign/mismatched result %j", patch => {
    expect(() => parseAccountProfileReceipt({ ...receipt, ...patch }, intent)).toThrow();
  });
  it("sends one exact POST and performs explicit lookup with GET only", async () => {
    const controller = new AbortController(); const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: receipt, meta: { replayed: false } }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ data: receipt }));
    expect(await runAccountProfileIntent(intent, false, controller.signal, send)).toEqual(receipt);
    expect(await runAccountProfileIntent(intent, true, controller.signal, send)).toEqual(receipt);
    expect(send.mock.calls[0]).toEqual(["/api/v1/account-profile", { method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error",
      signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify(intent) }]);
    expect(send.mock.calls[1]).toEqual([accountProfileLookupPath(intent), { method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal }]);
  });
  it("never automatically retries an uncertain transport and retains immutable caller intent", async () => {
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error("Connection lost"));
    await expect(runAccountProfileIntent(intent, false, new AbortController().signal, send)).rejects.toThrow("Connection lost");
    expect(send).toHaveBeenCalledTimes(1); expect(intent).toEqual(makeAccountProfileIntent(profile, "Café Reader", requestId));
  });
  it.each([401, 403, 404, 409, 422, 503])("does not display arbitrary response errors or infer failure for HTTP %s", async status => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: "private", message: "PRIVATE SQL" } }, { status }));
    await expect(runAccountProfileIntent(intent, true, new AbortController().signal, send)).rejects.not.toThrow("PRIVATE SQL");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("bounds actual/advertised bytes, media type, UTF-8 and response shape", async () => {
    for (const response of [new Response("x".repeat(8193), { headers: { "content-type": "application/json" } }),
      Response.json({ data: receipt }, { headers: { "content-length": "8193" } }), new Response("{}"),
      new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } })]) await expect(readAccountProfileResponse(response)).rejects.toThrow();
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: receipt, extra: true }));
    await expect(runAccountProfileIntent(intent, true, new AbortController().signal, send)).rejects.toThrow();
  });
  it("rejects aborts before sending and after a transport ignores cancellation", async () => {
    const controller = new AbortController(), send = vi.fn<typeof fetch>(); controller.abort();
    await expect(runAccountProfileIntent(intent, false, controller.signal, send)).rejects.toThrow(); expect(send).not.toHaveBeenCalled();
    const later = new AbortController(); send.mockImplementation(async () => { later.abort(); return Response.json({ data: receipt }); });
    await expect(runAccountProfileIntent(intent, true, later.signal, send)).rejects.toThrow();
  });
  it("fences immediate duplicate operations, late results and a finishing cancelled operation", () => {
    const gate = createAccountProfileGate(), first = gate.begin()!; expect(first.current()).toBe(true); expect(gate.begin()).toBeUndefined();
    gate.cancel(); expect(first.current()).toBe(false); expect(first.signal.aborted).toBe(true);
    const second = gate.begin()!; first.finish(); expect(second.current()).toBe(true); expect(gate.begin()).toBeUndefined();
    second.finish(); const third = gate.begin()!; expect(third.current()).toBe(true); third.finish();
  });
  it("times out without claiming the mutation was rolled back", () => {
    vi.useFakeTimers(); const operation = createAccountProfileGate().begin()!;
    vi.advanceTimersByTime(ACCOUNT_PROFILE_BROWSER_LIMITS.timeoutMs); expect(operation.signal.aborted).toBe(true); expect(operation.current()).toBe(false); operation.finish();
  });
  it("clears the timer on unmount cancellation even if the transport never settles", () => {
    vi.useFakeTimers(); const gate = createAccountProfileGate(), operation = gate.begin()!;
    expect(vi.getTimerCount()).toBe(1); gate.cancel(); expect(vi.getTimerCount()).toBe(0); expect(operation.signal.aborted).toBe(true);
    operation.finish(); expect(vi.getTimerCount()).toBe(0);
  });
  it("renders an escaped self-only label editor with explicit identity/permission boundaries", () => {
    const html = renderToStaticMarkup(createElement(AccountProfileForm, { profile: { ...profile, displayName: '<script>unsafe</script>' } }));
    expect(html).toContain("Edit your display name"); expect(html).toContain("Save display name"); expect(html).toContain("maxLength=\"120\"");
    expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;"); expect(html).not.toContain("<script>");
    expect(html).toContain("email, sign-in provider profile, password or permissions"); expect(html).toContain("not unique proof of identity");
    expect(html).not.toContain("Check original result");
  });
  it("provides scoped three-pixel keyboard focus and minimum touch targets without changing other forms", () => {
    const css = readFileSync(new URL("./account-profile-form.module.css", import.meta.url), "utf8");
    expect(css).toContain(".profile :is(input, button, a):focus-visible"); expect(css).toContain("outline: 3px solid");
    expect(css).toContain(".profile :is(input, button) { min-height: 44px; }"); expect(css).toMatch(/\.profile a \{[^}]*min-height: 44px/);
  });
});
