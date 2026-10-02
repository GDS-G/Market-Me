import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceExecutionControlError } from "@market-me/database";
import { AuthenticationError } from "./auth";
const mocks = vi.hoisted(() => ({ user: vi.fn(), mutate: vi.fn(), getSnapshot: vi.fn(), getReceipt: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", async () => ({ ...await import("./auth"), requireAuthenticatedUser: mocks.user }));
vi.mock("@/server/database", () => ({ getWorkspaceExecutionControlRepository: () => mocks }));
vi.mock("@/server/workspace-execution-control-api", () => import("./workspace-execution-control-api"));
import { GET, POST } from "../app/api/v1/workspace-execution-control/route";
const workspaceId = "11111111-1111-4111-8111-111111111111", requestId = "22222222-2222-4222-8222-222222222222";
const actorId = "44444444-4444-4444-8444-444444444444", expectedActorIncarnationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const base = "http://127.0.0.1:3120", endpoint = `${base}/api/v1/workspace-execution-control`;
const input = { workspaceId, requestId, expectedActorIncarnationId, expectedRevision: 2, state: "open", reason: "Reviewed reopening" };
const receipt = { ...input, previousState: "paused", revision: 3, changedAt: "2026-10-02T00:00:00.000Z" };
const request = (body: unknown = input, headers: Record<string, string> = {}) => new Request(endpoint, {
  method: "POST", headers: { origin: base, "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
});
function privateResponse(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toBe("Cookie");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff"); expect(response.headers.has("set-cookie")).toBe(false);
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("APP_BASE_URL", base); mocks.user.mockResolvedValue({ id: actorId });
  mocks.mutate.mockResolvedValue({ receipt, replayed: false }); mocks.getReceipt.mockResolvedValue(receipt);
  mocks.getSnapshot.mockResolvedValue({ workspaceId, state: "paused", revision: 2, changedAt: receipt.changedAt, canManage: false }); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("workspace execution-control transport", () => {
  it("uses only canonical reviewed intent and independent authenticated actor", async () => {
    const response = await POST(request({ ...input, expectedActorIncarnationId: expectedActorIncarnationId.toUpperCase(), reason: "  Reviewed   reopening  " }));
    expect(response.status).toBe(201); privateResponse(response); expect(mocks.mutate).toHaveBeenCalledWith(input, actorId);
    expect(await response.json()).toEqual({ data: receipt, meta: { replayed: false } });
    mocks.mutate.mockResolvedValue({ receipt, replayed: true }); expect((await POST(request())).status).toBe(200);
  });
  it.each([undefined, "null", "https://outside.invalid", `${base}/`, `${base}/path`])("rejects invalid origin %s before authentication", async origin => {
    const req = request(); if (origin === undefined) req.headers.delete("origin"); else req.headers.set("origin", origin);
    const response = await POST(req); expect(response.status).toBe(403); privateResponse(response); expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("fails closed without a configured application origin", async () => { vi.stubEnv("APP_BASE_URL", ""); expect((await POST(request())).status).toBe(403); });
  it.each([{ actorUserId: actorId }, { role: "owner" }, { allWorkspaces: true }, { canManage: true }, { restartCampaigns: true }, { state: "enabled" },
    { expectedActorIncarnationId: undefined }, { expectedRevision: 2147483647 }, { expectedRevision: "2" }, { reason: "x\u202e" }, { reason: "" }, { workspaceId: "bad" }])("rejects unsafe intent %j", async patch => {
    expect((await POST(request({ ...input, ...patch }))).status).toBe(422); expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("bounds media/streamed bytes/UTF-8 and rejects query mutation authority", async () => {
    const headers = { origin: base, "content-type": "application/json" };
    for (const [req, status] of [[request(input, { "content-length": "4097" }), 413], [request("x".repeat(4097)), 413], [request("{"), 422],
      [request(input, { "content-type": "text/plain" }), 415], [new Request(endpoint, { method: "POST", headers, body: new Uint8Array([0xc3, 0x28]) }), 422],
      [new Request(endpoint, { method: "POST", headers }), 422], [new Request(`${endpoint}?workspaceId=${workspaceId}`, { method: "POST", headers, body: JSON.stringify(input) }), 422]] as const) {
      const response = await POST(req); expect(response.status).toBe(status); privateResponse(response);
    }
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it.each([`"workspaceId":"${workspaceId}"`, `"workspa\\u0063eId":"${workspaceId}"`, `"reason":"another"`, `"expectedRevision":2`])("rejects duplicate JSON member %s", async duplicate => {
    expect((await POST(request(JSON.stringify(input).slice(0, -1) + `,${duplicate}}`))).status).toBe(422); expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("separates minimized current state from creator-private historical lookup", async () => {
    const current = await GET(new Request(`${endpoint}?workspaceId=${workspaceId}`)); privateResponse(current);
    expect(await current.json()).toEqual({ data: { workspaceId, state: "paused", revision: 2, changedAt: receipt.changedAt, canManage: false } });
    expect(mocks.getSnapshot).toHaveBeenCalledWith(workspaceId, actorId);
    const original = await GET(new Request(`${endpoint}?workspaceId=${workspaceId}&requestId=${requestId}`)); privateResponse(original);
    expect(await original.json()).toEqual({ data: receipt }); expect(mocks.getReceipt).toHaveBeenCalledWith(workspaceId, requestId, actorId);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it.each(["", "?workspaceId=bad", `?workspaceId=${workspaceId}&workspaceId=${workspaceId}`, `?workspaceId=${workspaceId}&requestId=`,
    `?workspaceId=${workspaceId}&requestId=${requestId}&actorUserId=${actorId}`, `?workspaceId=${workspaceId}&requestId=${requestId}&requestId=${requestId}`,
    `?workspaceId=${workspaceId}&state=open`])("rejects ambiguous GET %s", async query => {
    expect((await GET(new Request(endpoint + query))).status).toBe(422); expect(mocks.getSnapshot).not.toHaveBeenCalled(); expect(mocks.getReceipt).not.toHaveBeenCalled();
  });
  it("does not treat an absent receipt as proof of failure", async () => {
    mocks.getReceipt.mockResolvedValue(undefined); const response = await GET(new Request(`${endpoint}?workspaceId=${workspaceId}&requestId=${requestId}`));
    expect(response.status).toBe(404); privateResponse(response); expect(await response.text()).toContain("may still finish");
  });
  it.each([["access_denied", 403], ["not_found", 404], ["invalid_input", 422], ["request_conflict", 409], ["revision_conflict", 409],
    ["state_conflict", 409], ["execution_paused", 409], ["control_unavailable", 503]] as const)("maps branded %s to fixed private %s", async (code, status) => {
    const error = new WorkspaceExecutionControlError(code, "PRIVATE DETAIL"); Object.setPrototypeOf(error, Error.prototype); mocks.mutate.mockRejectedValue(error);
    const response = await POST(request()); expect(response.status).toBe(status); privateResponse(response); expect(await response.text()).not.toContain("PRIVATE");
  });
  it("keeps anonymous and unknown failures private, including logs", async () => {
    mocks.user.mockRejectedValue(new AuthenticationError()); expect((await POST(request())).status).toBe(401);
    expect((await GET(new Request(`${endpoint}?workspaceId=${workspaceId}`))).status).toBe(401); expect(mocks.mutate).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ id: actorId }); mocks.mutate.mockRejectedValue(new Error("PRIVATE SQL DETAIL")); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(request()); expect(response.status).toBe(503); privateResponse(response); expect(await response.text()).not.toContain("PRIVATE SQL");
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE SQL");
  });
});
