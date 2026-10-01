import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupInput, setupUserId } from "../components/source-setup.test-fixture";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), connections: vi.fn(), contexts: vi.fn(), companions: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/database", () => ({ getRepository: () => ({ listStorageConnections: mocks.connections, listContextPacks: mocks.contexts }),
  getCompanionRepository: () => ({ listWorkers: mocks.companions }) }));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => createElement("main", {}, children) }));
vi.mock("@/components/source-setup-wizard", () => ({ SourceSetupWizard: (props: unknown) => createElement("section", { "data-setup": JSON.stringify(props) }) }));
import NewSmartSourcePage from "../app/smart-sources/new/page";
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: setupUserId, displayName: "QA" });
  mocks.workspace.mockResolvedValue({ workspaceId: setupInput.workspaceId, workspaceName: "QA workspace", role: "editor" });
  mocks.connections.mockResolvedValue([]); mocks.contexts.mockResolvedValue([]); mocks.companions.mockResolvedValue([]);
});
describe("guided source setup page", () => {
  it("passes only active connection labels, published context identities and usable paired desktops", async () => {
    mocks.connections.mockResolvedValue([{ id: setupInput.storageConnectionId, displayName: "Active storage", provider: "google_drive", status: "active", scopes: ["private-scope"], providerAccountId: "private-account" },
      { id: setupUserId, displayName: "Revoked storage", status: "revoked" }]);
    mocks.contexts.mockResolvedValue([{ id: setupUserId, name: "Current guide", status: "published", currentVersion: { id: setupInput.requestId, status: "published", versionNumber: 2, instructions: "Private instructions" } },
      { id: setupInput.requestId, name: "Archived guide", status: "archived", currentVersion: { id: setupUserId, status: "published", versionNumber: 1 } }]);
    mocks.companions.mockResolvedValue([{ id: setupUserId, name: "QA desktop", status: "paused", effectiveHealthState: "disconnected", tokenPrefix: "private-prefix", healthDetails: "private details" },
      { id: setupInput.requestId, name: "Revoked desktop", status: "revoked" }]);
    const html = renderToStaticMarkup(await NewSmartSourcePage());
    for (const text of ["Active storage", "Current guide", "QA desktop", "paused"]) expect(html).toContain(text);
    for (const text of ["Revoked storage", "Archived guide", "Revoked desktop", "Private instructions", "private-account", "private-prefix", "private details", "private-scope"]) expect(html).not.toContain(text);
    expect(mocks.connections).toHaveBeenCalledWith(setupInput.workspaceId); expect(mocks.contexts).toHaveBeenCalledWith(setupInput.workspaceId);
  });
  it.each(["viewer", "approver", "analyst"])("does not load setup choices for a %s", async (role) => {
    mocks.workspace.mockResolvedValue({ workspaceId: setupInput.workspaceId, workspaceName: "QA", role });
    expect(renderToStaticMarkup(await NewSmartSourcePage())).toContain("requires an owner");
    expect(mocks.connections).not.toHaveBeenCalled(); expect(mocks.contexts).not.toHaveBeenCalled(); expect(mocks.companions).not.toHaveBeenCalled();
  });
  it("requires an authenticated account and current workspace", async () => {
    mocks.user.mockResolvedValue(undefined); await expect(NewSmartSourcePage()).rejects.toThrow("redirect:/login");
    expect(mocks.workspace).not.toHaveBeenCalled(); mocks.user.mockResolvedValue({ id: setupUserId }); mocks.workspace.mockResolvedValue(undefined);
    await expect(NewSmartSourcePage()).rejects.toThrow("redirect:/login"); expect(mocks.connections).not.toHaveBeenCalled();
  });
});
