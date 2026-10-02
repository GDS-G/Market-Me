import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSessionError } from "@market-me/database";
import { AuthenticationError } from "./auth";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), revoke: vi.fn(), list: vi.fn(), getReceipt: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/account-session-auth", () => ({ requireAccountSessionActor: mocks.actor }));
vi.mock("@/server/database", () => ({ getAccountSessionRepository: () => mocks }));
vi.mock("@/server/account-session-api", () => import("./account-session-api"));
import { GET, POST } from "../app/api/v1/account-sessions/route";
const accountId = "11111111-1111-4111-8111-111111111111", requestId = "22222222-2222-4222-8222-222222222222", targetSessionId = "33333333-3333-4333-8333-333333333333";
const foreign = "44444444-4444-4444-8444-444444444444", base = "http://127.0.0.1:3119", endpoint = `${base}/api/v1/account-sessions`;
const input = { accountId, requestId, targetSessionId }, actor = { accountId, tokenHash: "synthetic-server-only-hash" };
const receipt = { ...input, revokedAt: "2026-10-02T00:00:00.000Z" };
const request = (body: unknown = input, headers: Record<string, string> = {}) => new Request(endpoint, {
  method: "POST", headers: { origin: base, "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});
function privateResponse(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toBe("Cookie");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff"); expect(response.headers.has("set-cookie")).toBe(false);
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("APP_BASE_URL", base); mocks.actor.mockResolvedValue(actor);
  mocks.revoke.mockResolvedValue({ receipt, replayed: false }); mocks.getReceipt.mockResolvedValue(receipt); mocks.list.mockResolvedValue({ accountId, others: [] }); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("own-account session transport", () => {
  it("passes only canonical selected intent plus independent server context and returns minimized private outcome", async () => {
    const response = await POST(request({ ...input, targetSessionId: targetSessionId.toUpperCase() })); privateResponse(response);
    expect(response.status).toBe(201); expect(mocks.revoke).toHaveBeenCalledWith(input, actor);
    expect(await response.json()).toEqual({ data: receipt, meta: { replayed: false } });
    mocks.revoke.mockResolvedValue({ receipt, replayed: true }); expect((await POST(request())).status).toBe(200);
  });
  it.each([undefined, "null", "https://outside.invalid", `${base}/`, `${base}/path`])("rejects foreign/missing Origin %s before session lookup", async origin => {
    const req = request(); if (origin === undefined) req.headers.delete("origin"); else req.headers.set("origin", origin);
    const response = await POST(req); expect(response.status).toBe(403); privateResponse(response); expect(mocks.actor).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("fails closed without configured application origin", async () => { vi.stubEnv("APP_BASE_URL", ""); expect((await POST(request())).status).toBe(403); });
  it.each([{ token: "secret" }, { tokenHash: "secret" }, { actorUserId: accountId }, { role: "owner" }, { currentSessionId: targetSessionId },
    { workspaceId: foreign }, { targetSessionId: "bad" }, { targetSessionId: undefined }, { requestId: "bad" }])("rejects injected or invalid input %j", async patch => {
    expect((await POST(request({ ...input, ...patch }))).status).toBe(422); expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("rejects foreign account hints before any repository operation", async () => {
    expect((await POST(request({ ...input, accountId: foreign }))).status).toBe(403);
    expect((await GET(new Request(`${endpoint}?accountId=${foreign}`))).status).toBe(403);
    expect((await GET(new Request(`${endpoint}?accountId=${foreign}&requestId=${requestId}`))).status).toBe(403);
    expect(mocks.revoke).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.getReceipt).not.toHaveBeenCalled();
  });
  it("enforces advertised/streamed bytes, media and valid UTF-8 before persistence", async () => {
    const headers = { origin: base, "content-type": "application/json" };
    const cases = [[request(input, { "content-length": "2049" }), 413], [request("x".repeat(2049)), 413], [request("{"), 422],
      [request(input, { "content-type": "text/plain" }), 415], [new Request(endpoint, { method: "POST", headers, body: new Uint8Array([0xc3, 0x28]) }), 422],
      [new Request(endpoint, { method: "POST", headers }), 422], [new Request(`${endpoint}?accountId=${accountId}`, { method: "POST", headers, body: JSON.stringify(input) }), 422]] as const;
    for (const [req, status] of cases) { const response = await POST(req); expect(response.status).toBe(status); privateResponse(response); }
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it.each([`"accountId":"${accountId}"`, `"account\\u0049d":"${accountId}"`, `"targetSessionId":"${foreign}"`, `"requestId":"${requestId}"`])("rejects duplicate member %s", async duplicate => {
    expect((await POST(request(JSON.stringify(input).slice(0, -1) + `,${duplicate}}`))).status).toBe(422); expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("separates bounded list paging and exact receipt lookup, without secret output or writes", async () => {
    const response = await GET(new Request(`${endpoint}?accountId=${accountId}&cursor=opaque`)); privateResponse(response);
    expect(mocks.list).toHaveBeenCalledWith(accountId, actor, "opaque"); expect(await response.text()).not.toContain(actor.tokenHash);
    const outcome = await GET(new Request(`${endpoint}?accountId=${accountId}&requestId=${requestId}`)); privateResponse(outcome);
    expect(mocks.getReceipt).toHaveBeenCalledWith(accountId, requestId, actor); expect(await outcome.json()).toEqual({ data: receipt }); expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it.each(["", "?accountId=bad", `?accountId=${accountId}&accountId=${accountId}`, `?accountId=${accountId}&requestId=`,
    `?accountId=${accountId}&requestId=${requestId}&cursor=opaque`, `?accountId=${accountId}&cursor=a&cursor=b`, `?accountId=${accountId}&tokenHash=x`,
    `?accountId=${accountId}&requestId=${requestId}&requestId=${requestId}`])("rejects ambiguous/private GET fields %s", async query => {
    expect((await GET(new Request(endpoint + query))).status).toBe(422); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.getReceipt).not.toHaveBeenCalled();
  });
  it("does not report a missing historical result as proven failure", async () => {
    mocks.getReceipt.mockResolvedValue(undefined); const response = await GET(new Request(`${endpoint}?accountId=${accountId}&requestId=${requestId}`));
    expect(response.status).toBe(404); expect(await response.text()).toContain("may still finish"); privateResponse(response);
  });
  it.each([["authentication_required", 401], ["access_denied", 403], ["not_found", 404], ["invalid_input", 422], ["request_conflict", 409], ["current_session", 409]] as const)
    ("maps %s to fixed private %s without leaking messages", async (code, status) => {
      const error = new AccountSessionError(code, "PRIVATE AUTHENTICATION DETAIL"); Object.setPrototypeOf(error, Error.prototype); mocks.revoke.mockRejectedValue(error);
      const response = await POST(request()); expect(response.status).toBe(status); privateResponse(response); expect(await response.text()).not.toContain("PRIVATE");
    });
  it("handles anonymous access and unknown storage failure without secret logs", async () => {
    mocks.actor.mockRejectedValue(new AuthenticationError()); expect((await POST(request())).status).toBe(401);
    expect((await GET(new Request(`${endpoint}?accountId=${accountId}`))).status).toBe(401); expect(mocks.revoke).not.toHaveBeenCalled();
    mocks.actor.mockResolvedValue(actor); mocks.revoke.mockRejectedValue(new Error(actor.tokenHash)); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(request()); expect(response.status).toBe(503); privateResponse(response); expect(await response.text()).not.toContain(actor.tokenHash);
    expect(JSON.stringify(log.mock.calls)).not.toContain(actor.tokenHash);
  });
});
