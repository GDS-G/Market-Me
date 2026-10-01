import { describe, expect, it, vi } from "vitest";
import { isWorkspaceManagementError, normalizeWorkspaceManagementRequest, WorkspaceManagementError } from "./workspace-management-models";

const organizationId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const requestId = "abcdefab-cdef-4abc-8abc-abcdefabcdef";
const create = { operation: "create", organizationId, requestId, name: "Client space" };
const rename = { operation: "rename", workspaceId, requestId, expectedRevision: 2, name: "New name" };

describe("strict workspace management request", () => {
  it("canonicalizes normalized labels and identifiers in a deterministic field order", () => {
    const normalized = normalizeWorkspaceManagementRequest({ name: "  Cafe\u0301   team  ", requestId: requestId.toUpperCase(), organizationId, operation: "create" });
    expect(normalized).toEqual({ ...create, name: "Café team" });
    expect(JSON.stringify(normalized)).toBe(JSON.stringify({ ...create, name: "Café team" }));
    expect(Object.isFrozen(normalized)).toBe(true);
  });
  it("normalizes a rename without accepting organization reassignment", () => {
    expect(normalizeWorkspaceManagementRequest(rename)).toEqual(rename);
    expect(() => normalizeWorkspaceManagementRequest({ ...rename, organizationId })).toThrow(WorkspaceManagementError);
    expect(() => normalizeWorkspaceManagementRequest({ ...create, workspaceId })).toThrow(WorkspaceManagementError);
  });
  it.each(["", " ", "x".repeat(121), "line\nfeed", "tab\tname", "null\0name", "delete\u007f", 42, null])("rejects invalid name %j", name => {
    expect(() => normalizeWorkspaceManagementRequest({ ...create, name })).toThrow(WorkspaceManagementError);
  });
  it.each([0, -1, 1.2, "2", 2_147_483_648, Number.NaN, undefined])("rejects invalid revision %j", expectedRevision => {
    expect(() => normalizeWorkspaceManagementRequest({ ...rename, expectedRevision })).toThrow(WorkspaceManagementError);
  });
  it.each([{ role: "owner" }, { creator: workspaceId }, { slug: "selected" }, { timezone: "UTC" }, { inheritMembers: true }, { credentials: [] }])("rejects injected authority %j", extra => {
    expect(() => normalizeWorkspaceManagementRequest({ ...create, ...extra })).toThrow(WorkspaceManagementError);
  });
  it("rejects arrays, inherited objects, symbols, accessors and hidden fields without invoking getters", () => {
    const getter = vi.fn(() => "create");
    const accessor = Object.defineProperty({ ...create }, "operation", { get: getter, enumerable: true });
    const hidden = Object.defineProperty({ ...create }, "role", { value: "owner", enumerable: false });
    for (const value of [null, [], Object.create(create), { ...create, [Symbol("role")]: "owner" }, accessor, hidden]) {
      expect(() => normalizeWorkspaceManagementRequest(value)).toThrow(WorkspaceManagementError);
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it("rejects missing or malformed identities and unsupported operations", () => {
    for (const patch of [{ organizationId: "bad" }, { requestId: "bad" }, { operation: "delete" }, { operation: undefined }]) {
      expect(() => normalizeWorkspaceManagementRequest({ ...create, ...patch })).toThrow(WorkspaceManagementError);
    }
  });
  it("does not confuse an arbitrary named error with a safe branded domain error", () => {
    expect(isWorkspaceManagementError(new WorkspaceManagementError("access_denied", "Denied."))).toBe(true);
    expect(isWorkspaceManagementError(Object.assign(new Error("private"), { name: "WorkspaceManagementError" }))).toBe(false);
  });
});
