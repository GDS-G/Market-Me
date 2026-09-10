import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceAccess } from "@market-me/database";

const mocks = vi.hoisted(() => ({ list: vi.fn(), getCookie: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.getCookie }) }));
vi.mock("./database", () => ({ getRepository: () => ({ listWorkspaceAccess: mocks.list }) }));

import { getActiveWorkspace, getActiveWorkspaceSelection } from "./active-workspace";
import { ACTIVE_WORKSPACE_COOKIE, selectActiveWorkspace, workspaceSwitchReturnPath } from "./workspace-selection";

const first: WorkspaceAccess = { workspaceId: "11111111-1111-4111-8111-111111111111", workspaceName: "First", organizationId: "organization", role: "owner" };
const second: WorkspaceAccess = { workspaceId: "22222222-2222-4222-8222-222222222222", workspaceName: "Second", organizationId: "organization", role: "viewer" };

beforeEach(() => vi.resetAllMocks());

describe("active workspace selection", () => {
  it("uses a current membership selected by the cookie, including read-only roles", async () => {
    mocks.list.mockResolvedValue([first, second]);
    mocks.getCookie.mockReturnValue({ value: second.workspaceId });
    await expect(getActiveWorkspaceSelection("session-user")).resolves.toEqual({ workspace: second, workspaces: [first, second] });
    expect(mocks.list).toHaveBeenCalledWith("session-user");
    expect(mocks.getCookie).toHaveBeenCalledWith(ACTIVE_WORKSPACE_COOKIE);
  });

  it("falls back to a permitted membership when the hint is absent, forged, or revoked", () => {
    expect(selectActiveWorkspace([first, second])).toBe(first);
    expect(selectActiveWorkspace([first, second], "foreign-workspace")).toBe(first);
    expect(selectActiveWorkspace([first], second.workspaceId)).toBe(first);
  });

  it("does not reuse membership from an earlier request or another user", async () => {
    mocks.getCookie.mockReturnValue({ value: second.workspaceId });
    mocks.list.mockResolvedValueOnce([first, second]).mockResolvedValueOnce([first]).mockResolvedValueOnce([]);
    await expect(getActiveWorkspace("session-user")).resolves.toBe(second);
    await expect(getActiveWorkspace("session-user")).resolves.toBe(first);
    await expect(getActiveWorkspace("other-user")).resolves.toBeUndefined();
    expect(mocks.list).toHaveBeenLastCalledWith("other-user");
  });

  it("returns no workspace for an empty membership list, even with a valid-looking hint", () => {
    expect(selectActiveWorkspace([], first.workspaceId)).toBeUndefined();
  });

  it.each(["https://outside.example/path", "//outside.example", "/campaigns/old-id/edit", "/drafts?workspaceId=old", "/%2f%2foutside.example", "/\\outside.example", null])(
    "discards unsafe or prior-workspace return paths: %s", (value) => {
      expect(workspaceSwitchReturnPath(value)).toBe("/");
    },
  );

  it("allows section roots without retaining a previous record or filter", () => {
    expect(workspaceSwitchReturnPath("/campaigns")).toBe("/campaigns");
    expect(workspaceSwitchReturnPath("/settings")).toBe("/settings");
  });
});
