import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError } from "./auth";
import { WorkspaceMemberRoleError } from "@market-me/database";
const mocks = vi.hoisted(() => ({ user: vi.fn(), mutate: vi.fn(), getReceipt: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./auth", async original => ({ ...await original<typeof import("./auth")>(), requireAuthenticatedUser: mocks.user }));
vi.mock("./database", () => ({ getWorkspaceMemberRoleRepository: () => mocks }));
vi.mock("@/server/auth", () => import("./auth"));
vi.mock("@/server/database", () => import("./database"));
vi.mock("@/server/workspace-member-role-api", () => import("./workspace-member-role-api"));
import { GET, POST } from "../app/api/v1/workspace-member-roles/route";
const workspaceId = "11111111-1111-4111-8111-111111111111", targetUserId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333", actor = "44444444-4444-4444-8444-444444444444";
const base = "http://127.0.0.1:3119", endpoint = `${base}/api/v1/workspace-member-roles`;
const input = { workspaceId, targetUserId, requestId, expectedRevision: 1, newRole: "viewer", reason: "Reviewed access" };
const receipt = { workspaceId, targetUserId, requestId, previousRole: "editor", newRole: input.newRole, reason: input.reason, revision: 2, createdAt: "2026-10-01T00:00:00.000Z" };
const request = (body: unknown = input, headers: Record<string, string> = {}) => new Request(endpoint, {
  method: "POST", headers: { origin: base, "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});
describe("member-role mutation and private recovery transport", () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv("APP_BASE_URL", base); mocks.user.mockResolvedValue({ id: actor });
    mocks.mutate.mockResolvedValue({ receipt, replayed: false }); mocks.getReceipt.mockResolvedValue(receipt);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it("normalizes the reason and derives actor identity only from authentication", async () => {
    const response = await POST(request({ ...input, reason: "  Reviewed   access  " }));
    expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("set-cookie")).toBe(false); expect(mocks.mutate).toHaveBeenCalledWith(input, actor);
    expect(await response.json()).toEqual({ data: receipt, meta: { replayed: false } });
    mocks.mutate.mockResolvedValue({ receipt, replayed: true }); expect((await POST(request())).status).toBe(200);
  });
  it.each([undefined, "https://outside.invalid", `${base}/path`, `${base}/`, "null"])("rejects Origin %s before any auth or write", async origin => {
    const req = request(); if (origin === undefined) req.headers.delete("origin"); else req.headers.set("origin", origin);
    expect((await POST(req)).status).toBe(403); expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it.each([{ actorUserId: actor }, { role: "owner" }, { newRole: "owner" }, { members: [] }, { organizationId: workspaceId }, { expectedRevision: 0 },
    { expectedRevision: "1" }, { reason: "x\n" }, { reason: "x".repeat(501) }, { reason: "" }, { targetUserId: "bad" }])("rejects invalid/injected changes %j", async patch => {
    expect((await POST(request({ ...input, ...patch }))).status).toBe(422); expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("bounds both advertised and streamed bytes and requires valid UTF-8 JSON without query authority", async () => {
    expect((await POST(request(input, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(request(input, { "content-length": "4097" }))).status).toBe(413);
    expect((await POST(request("x".repeat(4097)))).status).toBe(413);
    expect((await POST(request("{"))).status).toBe(422);
    const headers = { origin: base, "content-type": "application/json" };
    expect((await POST(new Request(endpoint, { method: "POST", headers, body: new Uint8Array([0xc3, 0x28]) }))).status).toBe(422);
    expect((await POST(new Request(endpoint, { method: "POST", headers }))).status).toBe(422);
    expect((await POST(new Request(`${endpoint}?workspaceId=${workspaceId}`, { method: "POST", headers, body: JSON.stringify(input) }))).status).toBe(422);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("looks up only one exact workspace/request with authenticated original-actor scope", async () => {
    const url = `${endpoint}?workspaceId=${workspaceId}&requestId=${requestId}`;
    const response = await GET(new Request(url)); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getReceipt).toHaveBeenCalledWith(workspaceId, requestId, actor);
    for (const extra of [`&workspaceId=${workspaceId}`, "&actorUserId=x", `&requestId=${requestId}`, `&targetUserId=${targetUserId}`, "&page=1"]) {
      expect((await GET(new Request(url + extra))).status).toBe(422);
    }
    mocks.getReceipt.mockResolvedValue(undefined); const missing = await GET(new Request(url));
    expect(missing.status).toBe(404); expect(await missing.text()).toContain("may still finish"); expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it.each(["", "?workspaceId=bad", `?workspaceId=${workspaceId}`, `?workspaceId=bad&requestId=${requestId}`])("refuses missing or invalid recovery %s", async query => {
    expect((await GET(new Request(endpoint + query))).status).toBe(422); expect(mocks.getReceipt).not.toHaveBeenCalled();
  });
  it.each([["invalid_input", 422], ["access_denied", 403], ["protected_member", 403], ["not_found", 404], ["request_conflict", 409], ["revision_conflict", 409]] as const)
    ("maps branded %s across development prototype replacement", async (code, status) => {
      const error = new WorkspaceMemberRoleError(code, "Safe explanation"); Object.setPrototypeOf(error, Error.prototype); mocks.mutate.mockRejectedValue(error);
      const response = await POST(request()); expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: { code, message: "Safe explanation" } });
    });
  it("requires authentication for both operations", async () => {
    mocks.user.mockRejectedValue(new AuthenticationError()); expect((await POST(request())).status).toBe(401);
    expect((await GET(new Request(`${endpoint}?workspaceId=${workspaceId}&requestId=${requestId}`))).status).toBe(401);
    expect(mocks.mutate).not.toHaveBeenCalled(); expect(mocks.getReceipt).not.toHaveBeenCalled();
  });
  it("sanitizes unknown SQL details and keeps an honest uncertain outcome", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.mutate.mockRejectedValue(Object.assign(new Error("private SQL and reason"), { name: "WorkspaceMemberRoleError", code: "revision_conflict" }));
    const response = await POST(request()); expect(response.status).toBe(503);
    const text = await response.text(); expect(text).not.toContain("private SQL"); expect(text).toContain("do not assume it failed");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private SQL");
  });
});
