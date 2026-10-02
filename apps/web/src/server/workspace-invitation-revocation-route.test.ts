import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, AuthorizationError } from "./auth";
const mocks = vi.hoisted(() => ({ access: vi.fn(), revokeWorkspaceInvitation: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", async () => ({ ...await import("./auth"), requireWorkspaceAccess: mocks.access }));
vi.mock("@/server/database", () => ({ getRepository: () => mocks }));
vi.mock("@/server/workspace-member-lifecycle-api", () => import("./workspace-member-lifecycle-api"));
import { DELETE } from "../app/api/v1/workspaces/[workspaceId]/invitations/[invitationId]/route";
const workspaceId = "11111111-1111-4111-8111-111111111111", invitationId = "22222222-2222-4222-8222-222222222222", userId = "33333333-3333-4333-8333-333333333333";
const origin = "http://127.0.0.1:3120", endpoint = `${origin}/api/v1/workspaces/${workspaceId}/invitations/${invitationId}`;
const context = { params: Promise.resolve({ workspaceId, invitationId }) }, request = () => new Request(endpoint, { method: "DELETE", headers: { origin } });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("APP_BASE_URL", origin); mocks.access.mockResolvedValue({ user: { id: userId }, workspace: { role: "admin" } });
  mocks.revokeWorkspaceInvitation.mockResolvedValue({ id: invitationId, workspaceId, status: "revoked" }); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("selected invitation revocation boundary", () => {
  it("requires independent current workspace authority and returns private selected result", async () => {
    const response = await DELETE(request(), context); expect(response.status).toBe(200);
    expect(mocks.access).toHaveBeenCalledWith(workspaceId); expect(mocks.revokeWorkspaceInvitation).toHaveBeenCalledWith({ workspaceId, invitationId, revokedBy: userId });
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toBe("Cookie");
    expect(await response.json()).toEqual({ data: { id: invitationId, workspaceId, status: "revoked" } });
  });
  it.each([undefined, "null", "https://outside.invalid", `${origin}/`])("rejects invalid Origin %s before authority lookup", async value => {
    const req = request(); if (value === undefined) req.headers.delete("origin"); else req.headers.set("origin", value);
    expect((await DELETE(req, context)).status).toBe(403); expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.revokeWorkspaceInvitation).not.toHaveBeenCalled();
  });
  it.each(["editor", "approver", "analyst", "viewer"])("rejects non-administrator %s", async role => {
    mocks.access.mockResolvedValue({ user: { id: userId }, workspace: { role } }); expect((await DELETE(request(), context)).status).toBe(403); expect(mocks.revokeWorkspaceInvitation).not.toHaveBeenCalled();
  });
  it("rejects malformed identifiers and query ambiguity before repository work", async () => {
    expect((await DELETE(request(), { params: Promise.resolve({ workspaceId: "bad", invitationId }) })).status).toBe(422);
    expect((await DELETE(request(), { params: Promise.resolve({ workspaceId, invitationId: "bad" }) })).status).toBe(422);
    expect((await DELETE(new Request(endpoint + "?role=owner", { method: "DELETE", headers: { origin } }), context)).status).toBe(422);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.revokeWorkspaceInvitation).not.toHaveBeenCalled();
  });
  it("distinguishes anonymous, forbidden, nonpending and unknown failures without leaking details", async () => {
    mocks.access.mockRejectedValueOnce(new AuthenticationError()); expect((await DELETE(request(), context)).status).toBe(401);
    mocks.access.mockRejectedValueOnce(new AuthorizationError()); expect((await DELETE(request(), context)).status).toBe(403);
    mocks.revokeWorkspaceInvitation.mockResolvedValueOnce(undefined); expect((await DELETE(request(), context)).status).toBe(409);
    mocks.revokeWorkspaceInvitation.mockRejectedValueOnce(new Error("PRIVATE SQL")); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await DELETE(request(), context); expect(response.status).toBe(503); expect(await response.text()).not.toContain("PRIVATE"); expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE");
  });
});
