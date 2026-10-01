import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError } from "./auth";
import { WorkspaceManagementError } from "@market-me/database";
const mocks = vi.hoisted(() => ({ user: vi.fn(), mutate: vi.fn(), getReceipt: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./auth", async original => ({ ...await original<typeof import("./auth")>(), requireAuthenticatedUser: mocks.user }));
vi.mock("./database", () => ({ getWorkspaceManagementRepository: () => mocks }));
vi.mock("@/server/auth", () => import("./auth"));
vi.mock("@/server/database", () => import("./database"));
vi.mock("@/server/workspace-management-api", () => import("./workspace-management-api"));
import { GET, POST } from "../app/api/v1/workspace-management/route";
const organizationId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333", actor = "44444444-4444-4444-8444-444444444444";
const base = "http://127.0.0.1:3119", endpoint = `${base}/api/v1/workspace-management`;
const input = { operation: "create", organizationId, requestId, name: "Client workspace" };
const receipt = { organizationId, workspaceId, requestId, operation: "create", name: input.name, revision: 1, createdAt: "2026-10-01T00:00:00.000Z" };
const request = (body: unknown = input, headers: Record<string, string> = {}) => new Request(endpoint, {
  method: "POST", headers: { origin: base, "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});
describe("workspace management mutation and actor-private recovery transport", () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv("APP_BASE_URL", base); mocks.user.mockResolvedValue({ id: actor });
    mocks.mutate.mockResolvedValue({ receipt, replayed: false }); mocks.getReceipt.mockResolvedValue(receipt);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it("normalizes settings, uses the authenticated actor and never changes active-workspace cookies", async () => {
    const response = await POST(request({ ...input, name: "  Client   workspace  " }));
    expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("set-cookie")).toBe(false); expect(mocks.mutate).toHaveBeenCalledWith(input, actor);
    expect(await response.json()).toEqual({ data: receipt, meta: { replayed: false } });
    mocks.mutate.mockResolvedValue({ receipt, replayed: true }); expect((await POST(request())).status).toBe(200);
  });
  it.each([undefined, "https://outside.invalid", `${base}/path`, `${base}/`, "null"])("rejects Origin %s before authentication or persistence", async origin => {
    const req = request(); if (origin === undefined) req.headers.delete("origin"); else req.headers.set("origin", origin);
    expect((await POST(req)).status).toBe(403); expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it.each([{ actorUserId: actor }, { role: "owner" }, { members: [] }, { operation: "delete" }, { name: "x\n" }, { name: "x".repeat(121) }])("rejects invalid settings %j", async patch => {
    expect((await POST(request({ ...input, ...patch }))).status).toBe(422); expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("accepts only the closed rename request", async () => {
    const rename = { operation: "rename", workspaceId, requestId, expectedRevision: 2, name: "Renamed" };
    expect((await POST(request(rename))).status).toBe(201); expect(mocks.mutate).toHaveBeenCalledWith(rename, actor);
    for (const patch of [{ organizationId }, { expectedRevision: 0 }, { expectedRevision: "2" }, { enabled: true }]) {
      expect((await POST(request({ ...rename, ...patch }))).status).toBe(422);
    }
  });
  it("bounds advertised/streamed bytes, requires JSON and rejects malformed UTF-8 or query authority", async () => {
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
  it.each(["create", "rename"] as const)("looks up %s using exact operation-specific scope and original actor", async operation => {
    const scope = operation === "create" ? { organizationId } : { workspaceId };
    const query = new URLSearchParams({ operation, requestId }); query.set(operation === "create" ? "organizationId" : "workspaceId", operation === "create" ? organizationId : workspaceId);
    const url = `${endpoint}?${query}`;
    const response = await GET(new Request(url)); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getReceipt).toHaveBeenCalledWith({ operation, ...scope }, requestId, actor);
    for (const extra of [`&operation=${operation}`, "&actorUserId=x", `&requestId=${requestId}`, operation === "create" ? `&workspaceId=${workspaceId}` : `&organizationId=${organizationId}`]) {
      expect((await GET(new Request(url + extra))).status).toBe(422);
    }
    mocks.getReceipt.mockResolvedValue(undefined); const missing = await GET(new Request(url));
    expect(missing.status).toBe(404); expect(await missing.text()).toContain("may still finish"); expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it.each(["", "?operation=delete", "?operation=create", `?operation=create&organizationId=x&requestId=${requestId}`])("refuses ambiguous recovery %s", async query => {
    expect((await GET(new Request(endpoint + query))).status).toBe(422); expect(mocks.getReceipt).not.toHaveBeenCalled();
  });
  it.each([["invalid_input", 422], ["access_denied", 403], ["not_found", 404], ["request_conflict", 409], ["revision_conflict", 409]] as const)("maps branded %s errors without relying on prototype identity", async (code, status) => {
    const error = new WorkspaceManagementError(code, "Safe explanation"); Object.setPrototypeOf(error, Error.prototype); mocks.mutate.mockRejectedValue(error);
    const response = await POST(request()); expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code, message: "Safe explanation" } });
  });
  it("requires authentication for both actions without trusting a request actor", async () => {
    mocks.user.mockRejectedValue(new AuthenticationError()); expect((await POST(request())).status).toBe(401);
    expect((await GET(new Request(`${endpoint}?operation=create&organizationId=${organizationId}&requestId=${requestId}`))).status).toBe(401);
    expect(mocks.mutate).not.toHaveBeenCalled(); expect(mocks.getReceipt).not.toHaveBeenCalled();
  });
  it("keeps unknown SQL and private request details out of responses and logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.mutate.mockRejectedValue(Object.assign(new Error("private SQL"), { name: "WorkspaceManagementError", code: "revision_conflict" }));
    const response = await POST(request()); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private SQL"); expect(JSON.stringify(log.mock.calls)).not.toContain("private SQL");
  });
});
