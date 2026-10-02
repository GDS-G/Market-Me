import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceMemberLifecycleError } from "@market-me/database";
import { AuthenticationError } from "./auth";
const mocks = vi.hoisted(() => ({ user: vi.fn(), remove: vi.fn(), preview: vi.fn(), getReceipt: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", async () => ({ ...await import("./auth"), requireAuthenticatedUser: mocks.user }));
vi.mock("@/server/database", () => ({ getWorkspaceMemberLifecycleRepository: () => mocks }));
vi.mock("@/server/workspace-member-lifecycle-api", () => import("./workspace-member-lifecycle-api"));
import { GET, POST } from "../app/api/v1/workspace-member-removals/route";
const workspaceId = "11111111-1111-4111-8111-111111111111", requestId = "22222222-2222-4222-8222-222222222222", targetUserId = "33333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444", expectedIncarnationId = "55555555-5555-4555-8555-555555555555";
const base = "http://127.0.0.1:3120", endpoint = `${base}/api/v1/workspace-member-removals`;
const input = { workspaceId, targetUserId, requestId, expectedIncarnationId, expectedRevision: 2, impactFingerprint: "a".repeat(64), reason: "Reviewed synthetic offboarding" };
const receipt = { ...input, revision: 3, previousRole: "editor", revokedAt: "2026-10-02T00:00:00.000Z", impact: {} };
const request = (body: unknown = input, headers: Record<string, string> = {}) => new Request(endpoint, {
  method: "POST", headers: { origin: base, "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});
function privateResponse(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toBe("Cookie");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff"); expect(response.headers.has("set-cookie")).toBe(false);
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("APP_BASE_URL", base); mocks.user.mockResolvedValue({ id: actorId });
  mocks.remove.mockResolvedValue({ receipt, replayed: false }); mocks.getReceipt.mockResolvedValue(receipt); mocks.preview.mockResolvedValue({ workspaceId }); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("workspace member removal transport", () => {
  it("passes only canonical exact intent plus independently authenticated actor", async () => {
    const response = await POST(request({ ...input, expectedIncarnationId: expectedIncarnationId.toUpperCase(), reason: "  Reviewed   synthetic offboarding  " }));
    privateResponse(response); expect(response.status).toBe(201); expect(mocks.remove).toHaveBeenCalledWith(input, actorId);
    expect(await response.json()).toEqual({ data: receipt, meta: { replayed: false } });
    mocks.remove.mockResolvedValue({ receipt, replayed: true }); expect((await POST(request())).status).toBe(200);
  });
  it.each([undefined, "null", "https://outside.invalid", `${base}/`, `${base}/path`])("rejects invalid Origin %s before authentication", async origin => {
    const req = request(); if (origin === undefined) req.headers.delete("origin"); else req.headers.set("origin", origin);
    const response = await POST(req); expect(response.status).toBe(403); privateResponse(response); expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("fails closed without configured origin", async () => { vi.stubEnv("APP_BASE_URL", ""); expect((await POST(request())).status).toBe(403); });
  it.each([{ actorUserId: actorId }, { role: "owner" }, { revokedAt: "now" }, { restore: true }, { impact: {} }, { acknowledgedImpact: true },
    { targetUserId: "bad" }, { expectedIncarnationId: undefined }, { impactFingerprint: "BAD" }, { expectedRevision: 2147483647 }, { reason: "x\u202e" }])("rejects unsafe intent %j", async patch => {
    expect((await POST(request({ ...input, ...patch }))).status).toBe(422); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("enforces bounded UTF-8 bytes/media and rejects query authority", async () => {
    const headers = { origin: base, "content-type": "application/json" };
    for (const [req, status] of [[request(input, { "content-length": "4097" }), 413], [request("x".repeat(4097)), 413], [request("{"), 422],
      [request(input, { "content-type": "text/plain" }), 415], [new Request(endpoint, { method: "POST", headers, body: new Uint8Array([0xc3, 0x28]) }), 422],
      [new Request(endpoint, { method: "POST", headers }), 422], [new Request(`${endpoint}?workspaceId=${workspaceId}`, { method: "POST", headers, body: JSON.stringify(input) }), 422]] as const) {
      const response = await POST(req); expect(response.status).toBe(status); privateResponse(response);
    }
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each([`"workspaceId":"${workspaceId}"`, `"workspa\\u0063eId":"${workspaceId}"`, `"reason":"another"`, `"expectedRevision":2`])("rejects duplicate JSON field %s", async duplicate => {
    expect((await POST(request(JSON.stringify(input).slice(0, -1) + `,${duplicate}}`))).status).toBe(422); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("separates read-only target preview and actor-private receipt recovery", async () => {
    const preview = await GET(new Request(`${endpoint}?workspaceId=${workspaceId}&targetUserId=${targetUserId}`)); privateResponse(preview);
    expect(mocks.preview).toHaveBeenCalledWith(workspaceId, targetUserId, actorId); expect(preview.status).toBe(200);
    const result = await GET(new Request(`${endpoint}?workspaceId=${workspaceId}&requestId=${requestId}`)); privateResponse(result);
    expect(mocks.getReceipt).toHaveBeenCalledWith(workspaceId, requestId, actorId); expect(await result.json()).toEqual({ data: receipt }); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each(["", "?workspaceId=bad", `?workspaceId=${workspaceId}&workspaceId=${workspaceId}&requestId=${requestId}`, `?workspaceId=${workspaceId}&targetUserId=`,
    `?workspaceId=${workspaceId}&requestId=${requestId}&targetUserId=${targetUserId}`, `?workspaceId=${workspaceId}&requestId=${requestId}&actorUserId=${actorId}`,
    `?workspaceId=${workspaceId}&targetUserId=${targetUserId}&targetUserId=${targetUserId}`, `?workspaceId=${workspaceId}&requestId=${requestId}&requestId=${requestId}`])("rejects ambiguous GET selection %s", async query => {
    expect((await GET(new Request(endpoint + query))).status).toBe(422); expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.getReceipt).not.toHaveBeenCalled();
  });
  it("does not equate absent original receipt to a proven failed removal", async () => {
    mocks.getReceipt.mockResolvedValue(undefined); const response = await GET(new Request(`${endpoint}?workspaceId=${workspaceId}&requestId=${requestId}`));
    expect(response.status).toBe(404); expect(await response.text()).toContain("may still finish"); privateResponse(response);
  });
  it.each([["access_denied", 403], ["protected_member", 403], ["not_found", 404], ["invalid_input", 422], ["request_conflict", 409],
    ["revision_conflict", 409], ["impact_conflict", 409], ["unresolved_dependencies", 409]] as const)("maps %s to fixed private %s", async (code, status) => {
    const error = new WorkspaceMemberLifecycleError(code, "PRIVATE DETAIL"); Object.setPrototypeOf(error, Error.prototype); mocks.remove.mockRejectedValue(error);
    const response = await POST(request()); expect(response.status).toBe(status); privateResponse(response); expect(await response.text()).not.toContain("PRIVATE");
  });
  it("handles anonymous and unknown failures without disclosing private error messages/logs", async () => {
    mocks.user.mockRejectedValue(new AuthenticationError()); expect((await POST(request())).status).toBe(401);
    expect((await GET(new Request(`${endpoint}?workspaceId=${workspaceId}&targetUserId=${targetUserId}`))).status).toBe(401); expect(mocks.remove).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ id: actorId }); mocks.remove.mockRejectedValue(new Error("PRIVATE SQL DETAIL")); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(request()); expect(response.status).toBe(503); privateResponse(response); expect(await response.text()).not.toContain("PRIVATE SQL");
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE SQL");
  });
});
