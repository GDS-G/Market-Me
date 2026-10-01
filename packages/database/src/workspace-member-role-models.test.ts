import { describe, expect, it } from "vitest";
import { isWorkspaceMemberRoleError, MANAGED_MEMBER_ROLES, normalizeWorkspaceMemberRoleRequest, WorkspaceMemberRoleError,
  WORKSPACE_MEMBER_ROLE_LIMITS } from "./workspace-member-role-models";
const workspaceId = "ABCDEF12-ABCD-4ABC-8ABC-ABCDEF123456", targetUserId = "22222222-2222-4222-8222-222222222222", requestId = "33333333-3333-4333-8333-333333333333";
const input = { workspaceId, targetUserId, requestId, expectedRevision: 1, newRole: "editor", reason: "Support the content team" };
describe("bounded existing-member role intent", () => {
  it("produces frozen canonical fields and NFC whitespace normalization", () => {
    const parsed = normalizeWorkspaceMemberRoleRequest({ reason: "  Cafe\u0301\u00a0 team  ", newRole: "editor", expectedRevision: 1, requestId, targetUserId, workspaceId: ` ${workspaceId} ` });
    expect(parsed).toEqual({ workspaceId: workspaceId.toLowerCase(), targetUserId, requestId, expectedRevision: 1, newRole: "editor", reason: "Café team" });
    expect(Object.keys(parsed)).toEqual(["workspaceId", "targetUserId", "requestId", "expectedRevision", "newRole", "reason"]); expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(WORKSPACE_MEMBER_ROLE_LIMITS)).toBe(true); expect(Object.isFrozen(MANAGED_MEMBER_ROLES)).toBe(true);
  });
  it.each(MANAGED_MEMBER_ROLES)("accepts only the existing non-owner %s role", newRole => {
    expect(normalizeWorkspaceMemberRoleRequest({ ...input, newRole }).newRole).toBe(newRole);
  });
  it.each(["owner", "publisher", "campaign_manager", "Admin", "", null, {}, true])("rejects unsupported or owner role %j", newRole => {
    expect(() => normalizeWorkspaceMemberRoleRequest({ ...input, newRole })).toThrow(WorkspaceMemberRoleError);
  });
  it.each([0, -1, 1.5, 2_147_483_648, "1", null, NaN, Infinity])("rejects invalid revision %j", expectedRevision => {
    expect(() => normalizeWorkspaceMemberRoleRequest({ ...input, expectedRevision })).toThrow(WorkspaceMemberRoleError);
  });
  it.each(["", " ", "x\n", "x\t", "x\0", "x\u007f", "x".repeat(501), null])("rejects invalid reasons %j", reason => {
    expect(() => normalizeWorkspaceMemberRoleRequest({ ...input, reason })).toThrow(WorkspaceMemberRoleError);
  });
  it.each(["actorUserId", "organizationId", "members", "owner", "enabled", "previousRole", "role", "operation"])("refuses injected %s authority", key => {
    expect(() => normalizeWorkspaceMemberRoleRequest({ ...input, [key]: targetUserId })).toThrow(WorkspaceMemberRoleError);
  });
  it.each(["workspaceId", "targetUserId", "requestId"])("requires a valid %s", key => {
    expect(() => normalizeWorkspaceMemberRoleRequest({ ...input, [key]: "not-a-uuid" })).toThrow(WorkspaceMemberRoleError);
  });
  it("rejects nonordinary objects and hidden/accessor authority before reading getters", () => {
    let read = false;
    const getter = Object.defineProperty({ ...input }, "newRole", { get() { read = true; return "admin"; }, enumerable: true });
    const hidden = Object.defineProperty({ ...input }, "actorUserId", { value: targetUserId });
    const symbolic = { ...input, [Symbol("actor")]: targetUserId };
    for (const value of [getter, hidden, symbolic, Object.create(input), Object.assign(Object.create(null), input), [], null, "settings"]) {
      expect(() => normalizeWorkspaceMemberRoleRequest(value)).toThrow(WorkspaceMemberRoleError);
    }
    expect(read).toBe(false);
  });
  it("preserves safe domain error branding without trusting a name or code alone", () => {
    const error = new WorkspaceMemberRoleError("protected_member", "Owner changes require a separate workflow.");
    Object.setPrototypeOf(error, Error.prototype); expect(isWorkspaceMemberRoleError(error)).toBe(true);
    expect(isWorkspaceMemberRoleError(Object.assign(new Error("Unknown"), { name: "WorkspaceMemberRoleError", code: "invalid_input" }))).toBe(false);
    expect(isWorkspaceMemberRoleError({ code: "invalid_input" })).toBe(false);
  });
});
