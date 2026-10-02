import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountProfileError } from "@market-me/database";
import { AuthenticationError } from "./auth";
const mocks = vi.hoisted(() => ({ user: vi.fn(), save: vi.fn(), getProfile: vi.fn(), getReceipt: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./auth", async original => ({ ...await original<typeof import("./auth")>(), requireAuthenticatedUser: mocks.user }));
vi.mock("./database", () => ({ getAccountProfileRepository: () => mocks }));
vi.mock("@/server/auth", () => import("./auth"));
vi.mock("@/server/database", () => import("./database"));
vi.mock("@/server/account-profile-api", () => import("./account-profile-api"));
import { GET, POST } from "../app/api/v1/account-profile/route";
const accountId = "11111111-1111-4111-8111-111111111111", requestId = "22222222-2222-4222-8222-222222222222";
const foreign = "33333333-3333-4333-8333-333333333333", base = "http://127.0.0.1:3119", endpoint = `${base}/api/v1/account-profile`;
const input = { accountId, requestId, expectedRevision: 1, displayName: "Café Reader" };
const profile = { accountId, displayName: input.displayName, revision: 2 };
const receipt = { ...profile, requestId, changed: true, createdAt: "2026-10-02T00:00:00.000Z" };
const request = (body: unknown = input, headers: Record<string, string> = {}) => new Request(endpoint, {
  method: "POST", headers: { origin: base, "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});
function privateResponse(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toBe("Cookie");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff"); expect(response.headers.has("set-cookie")).toBe(false);
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("APP_BASE_URL", base); mocks.user.mockResolvedValue({ id: accountId });
  mocks.save.mockResolvedValue({ receipt, replayed: false }); mocks.getProfile.mockResolvedValue(profile); mocks.getReceipt.mockResolvedValue(receipt);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("self-scoped profile transport", () => {
  it("normalizes one bounded name, uses authenticated identity and privately returns new or replayed results", async () => {
    const response = await POST(request({ ...input, displayName: " Cafe\u0301   Reader " }));
    expect(response.status).toBe(201); privateResponse(response); expect(mocks.save).toHaveBeenCalledWith(input, accountId);
    expect(await response.json()).toEqual({ data: receipt, meta: { replayed: false } });
    mocks.save.mockResolvedValue({ receipt, replayed: true }); expect((await POST(request())).status).toBe(200);
  });
  it.each([undefined, "null", "https://outside.invalid", `${base}/`, `${base}/path`])("rejects Origin %s before identity or persistence", async origin => {
    const req = request(); if (origin === undefined) req.headers.delete("origin"); else req.headers.set("origin", origin);
    const response = await POST(req); expect(response.status).toBe(403); privateResponse(response);
    expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("fails closed when the application origin is not configured", async () => {
    vi.stubEnv("APP_BASE_URL", ""); expect((await POST(request())).status).toBe(403); expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([{ email: "other@example.test" }, { actorUserId: accountId }, { workspaceId: foreign }, { role: "owner" },
    { displayName: "" }, { displayName: "x".repeat(121) }, { displayName: "x\u202e" }, { expectedRevision: "1" }, { expectedRevision: 0 }])("rejects invalid or authority-injected fields %j", async patch => {
    expect((await POST(request({ ...input, ...patch }))).status).toBe(422); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects stale/foreign account hints before repository access for both actions", async () => {
    expect((await POST(request({ ...input, accountId: foreign }))).status).toBe(403);
    expect((await GET(new Request(`${endpoint}?accountId=${foreign}`))).status).toBe(403);
    expect((await GET(new Request(`${endpoint}?accountId=${foreign}&requestId=${requestId}`))).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.getProfile).not.toHaveBeenCalled(); expect(mocks.getReceipt).not.toHaveBeenCalled();
  });
  it("bounds both advertised and actual UTF-8 bytes and rejects malformed data", async () => {
    const cases = [[request(input, { "content-length": "4097" }), 413], [request("x".repeat(4097)), 413],
      [request({ ...input, displayName: "😀".repeat(1100) }), 413], [request("{"), 422], [request(input, { "content-type": "text/plain" }), 415]] as const;
    for (const [req, status] of cases) { const response = await POST(req); expect(response.status).toBe(status); privateResponse(response); }
    const headers = { origin: base, "content-type": "application/json" };
    expect((await POST(new Request(endpoint, { method: "POST", headers, body: new Uint8Array([0xc3, 0x28]) }))).status).toBe(422);
    expect((await POST(new Request(endpoint, { method: "POST", headers }))).status).toBe(422);
    expect((await POST(new Request(`${endpoint}?accountId=${accountId}`, { method: "POST", headers, body: JSON.stringify(input) }))).status).toBe(422);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([`"accountId":"${foreign}"`, `"account\\u0049d":"${accountId}"`, '"displayName":"Other"', '"expectedRevision":2'])
    ("rejects duplicate JSON members, including escaped aliases %s", async duplicate => {
      expect((await POST(request(JSON.stringify(input).slice(0, -1) + `,${duplicate}}`))).status).toBe(422);
      expect(mocks.save).not.toHaveBeenCalled();
    });
  it("accepts escaped quotes and key-like text as ordinary label data", async () => {
    const displayName = 'A "accountId": label'; expect((await POST(request({ ...input, displayName }))).status).toBe(201);
    expect(mocks.save).toHaveBeenCalledWith({ ...input, displayName }, accountId);
  });
  it("separates current state from exact historical receipt and does no writes during lookup", async () => {
    const current = await GET(new Request(`${endpoint}?accountId=${accountId}`)); expect(current.status).toBe(200); privateResponse(current);
    expect(await current.json()).toEqual({ data: profile }); expect(mocks.getProfile).toHaveBeenCalledWith(accountId, accountId);
    const prior = await GET(new Request(`${endpoint}?accountId=${accountId}&requestId=${requestId}`)); privateResponse(prior);
    expect(await prior.json()).toEqual({ data: receipt }); expect(mocks.getReceipt).toHaveBeenCalledWith(accountId, requestId, accountId);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(["", "?accountId=bad", `?accountId=${accountId}&accountId=${accountId}`, `?accountId=${accountId}&requestId=`,
    `?accountId=${accountId}&requestId=${requestId}&requestId=${requestId}`, `?accountId=${accountId}&actorUserId=${accountId}`])("rejects ambiguous or unknown GET scope %s", async query => {
    expect((await GET(new Request(endpoint + query))).status).toBe(422); expect(mocks.getReceipt).not.toHaveBeenCalled(); expect(mocks.getProfile).not.toHaveBeenCalled();
  });
  it("does not claim absence proves failure", async () => {
    mocks.getReceipt.mockResolvedValue(undefined); const response = await GET(new Request(`${endpoint}?accountId=${accountId}&requestId=${requestId}`));
    expect(response.status).toBe(404); expect(await response.text()).toContain("may still finish"); privateResponse(response);
  });
  it.each([["invalid_input", 422], ["access_denied", 403], ["not_found", 404], ["request_conflict", 409], ["revision_conflict", 409]] as const)
    ("returns fixed private %s errors without arbitrary exception messages", async (code, status) => {
      const error = new AccountProfileError(code, "PRIVATE DETAIL"); Object.setPrototypeOf(error, Error.prototype); mocks.save.mockRejectedValue(error);
      const response = await POST(request()); expect(response.status).toBe(status); privateResponse(response); expect(await response.text()).not.toContain("PRIVATE DETAIL");
    });
  it("requires authentication and keeps unknown SQL details out of both response and logs", async () => {
    mocks.user.mockRejectedValue(new AuthenticationError()); expect((await POST(request())).status).toBe(401);
    expect((await GET(new Request(`${endpoint}?accountId=${accountId}`))).status).toBe(401); expect(mocks.save).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ id: accountId }); const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.save.mockRejectedValue(Object.assign(new Error("PRIVATE SQL"), { name: "AccountProfileError", code: "revision_conflict" }));
    const response = await POST(request()); expect(response.status).toBe(503); privateResponse(response);
    expect(await response.text()).not.toContain("PRIVATE SQL"); expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE SQL");
  });
});
