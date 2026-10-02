import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), getSnapshot: vi.fn(), panel: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/database", () => ({ getWorkspaceExecutionControlRepository: () => mocks }));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => createElement("main", {}, children) }));
vi.mock("@/components/workspace-execution-control-panel", () => ({ WorkspaceExecutionControlPanel: (props: unknown) => {
  mocks.panel(props); return createElement("section", {}, "Execution control");
} }));
import Page from "../app/settings/execution/page";
const userId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222";
const snapshot = { workspaceId, state: "open", revision: 1, changedAt: "2026-10-02T12:00:00.000Z", canManage: false };
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: userId, displayName: "Synthetic viewer" });
  mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "Synthetic workspace", role: "viewer" });
  mocks.getSnapshot.mockResolvedValue(snapshot);
});
describe("workspace execution settings page", () => {
  it("uses the authenticated account and server-selected workspace, with minimized member state", async () => {
    const html = renderToStaticMarkup(await Page());
    expect(mocks.workspace).toHaveBeenCalledExactlyOnceWith(userId);
    expect(mocks.getSnapshot).toHaveBeenCalledExactlyOnceWith(workspaceId, userId);
    expect(mocks.panel).toHaveBeenCalledExactlyOnceWith({ userId, workspaceId, initial: snapshot });
    expect(html).toContain("Synthetic workspace"); expect(html).toContain('href="/settings"');
  });
  it.each(["owner", "admin"])("uses repository authority, not a %s shell role, for management review", async role => {
    mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "Workspace", role });
    renderToStaticMarkup(await Page());
    expect(mocks.panel.mock.calls[0]?.[0].initial).toEqual(snapshot);
    expect(mocks.panel.mock.calls[0]?.[0].initial).not.toHaveProperty("actorIncarnationId");
  });
  it("redirects before repository access when not authenticated", async () => {
    mocks.user.mockResolvedValue(undefined); await expect(Page()).rejects.toThrow("redirect:/login");
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });
  it("redirects when no active membership exists", async () => {
    mocks.workspace.mockResolvedValue(undefined); await expect(Page()).rejects.toThrow("redirect:/login");
    expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });
  it("never renders a default-open control on a persistence failure", async () => {
    mocks.getSnapshot.mockRejectedValue(new Error("state unavailable"));
    await expect(Page()).rejects.toThrow("state unavailable"); expect(mocks.panel).not.toHaveBeenCalled();
  });
});
