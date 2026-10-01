import { describe, expect, it } from "vitest";
import { WORKSPACE_START_COUNT_KEYS, workspaceStartCount, workspaceStartSnapshot, workspaceStartUuid } from "./workspace-start-models";

const workspaceId = "ABCDEF12-1234-4234-9234-123456789012";
const row = () => ({ workspaceId, role: "owner", observedAt: new Date("2026-10-01T12:00:00Z"),
  ...Object.fromEntries(WORKSPACE_START_COUNT_KEYS.map(key => [key, "0"])) });

describe("workspace start snapshot projection", () => {
  it.each(["owner", "admin", "editor", "approver", "analyst", "viewer"])("preserves current %s authority without inventing capabilities", role => {
    const projected = workspaceStartSnapshot({ ...row(), role, privateContent: "not projected" });
    expect(projected).toEqual({ ...row(), role, workspaceId: workspaceId.toLowerCase(), observedAt: "2026-10-01T12:00:00.000Z",
      ...Object.fromEntries(WORKSPACE_START_COUNT_KEYS.map(key => [key, 0])) });
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(WORKSPACE_START_COUNT_KEYS)).toBe(true);
  });
  it.each(WORKSPACE_START_COUNT_KEYS)("never substitutes zero for missing %s", key => {
    expect(() => workspaceStartSnapshot({ ...row(), [key]: undefined })).toThrow("count is unavailable");
  });
  it.each(["0", 0, "42", 42, "9007199254740991", Number.MAX_SAFE_INTEGER])("accepts exact nonnegative safe count %s", value => {
    expect(workspaceStartCount(value)).toBe(Number(value));
  });
  it.each([null, undefined, true, {}, [], "", "01", "-1", -1, 1.5, "1.5", "1e3", " 1", NaN, Infinity, "9007199254740992", Number.MAX_SAFE_INTEGER + 1, 1n])
    ("rejects malformed or lossy count %s", value => { expect(() => workspaceStartCount(value)).toThrow("count is unavailable"); });
  it.each(["organization_owner", "future_role", undefined])("rejects unrecognized role %s", role => {
    expect(() => workspaceStartSnapshot({ ...row(), role })).toThrow("role is unavailable");
  });
  it.each([undefined, null, 0, "not-a-date", new Date(NaN)])("rejects unavailable snapshot time %s", observedAt => {
    expect(() => workspaceStartSnapshot({ ...row(), observedAt })).toThrow("time is unavailable");
  });
  it("normalizes valid internal identity without allowing a malformed query identity", () => {
    expect(workspaceStartUuid(` ${workspaceId} `)).toBe(workspaceId.toLowerCase());
    for (const value of ["", "not-a-uuid", "00000000-0000-0000-0000-000000000000", workspaceId + "';--", undefined]) {
      expect(() => workspaceStartUuid(value as string)).toThrow("valid workspace");
    }
  });
});
