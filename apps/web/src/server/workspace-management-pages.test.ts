import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), getSettings: vi.fn(), getCreationOrganization: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/database", () => ({ getWorkspaceManagementRepository: () => mocks }));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => createElement("main", {}, children) }));
vi.mock("@/components/workspace-management-form", () => ({ WorkspaceManagementForm: (props: unknown) => createElement("form", { "data-workspace": JSON.stringify(props) }, "Workspace editor") }));
vi.mock("@/components/workspace-management.module.css", () => ({ default: {} }));
import Settings from "../app/settings/page";
import New from "../app/settings/workspaces/new/page";
const userId = "11111111-1111-4111-8111-111111111111", organizationId = "22222222-2222-4222-8222-222222222222", workspaceId = "33333333-3333-4333-8333-333333333333";
const settings = { workspaceId, organizationId, organizationName: "QA organization", name: "QA workspace", revision: 3, canRename: true, canCreateWorkspace: true };
const page = (query: Record<string, string | string[] | undefined> = { organizationId }) => New({ searchParams: Promise.resolve(query) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: userId, displayName: "Synthetic QA", email: "qa@market-me.local" });
  mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA workspace", role: "owner" });
  mocks.getSettings.mockResolvedValue(settings); mocks.getCreationOrganization.mockResolvedValue({ id: organizationId, name: "QA organization" });
});
describe("workspace settings and explicit organization creation pages", () => {
  it("requires signed-in membership before rendering settings", async () => {
    mocks.user.mockResolvedValue(undefined); await expect(Settings()).rejects.toThrow("redirect:/login"); await expect(page()).rejects.toThrow("redirect:/login");
    expect(mocks.getSettings).not.toHaveBeenCalled(); expect(mocks.getCreationOrganization).not.toHaveBeenCalled();
  });
  it("rechecks membership and passes current revision/organization to rename", async () => {
    const html = renderToStaticMarkup(await Settings()); expect(mocks.getSettings).toHaveBeenCalledWith(workspaceId, userId);
    expect(html).toContain("Workspace editor"); expect(html).toContain("&quot;revision&quot;:3"); expect(html).toContain(`organizationId=${organizationId}`);
    expect(html).not.toContain("Workspace name changes and");
    mocks.getSettings.mockResolvedValue(undefined); await expect(Settings()).rejects.toThrow("not-found");
  });
  it.each([[false, false], [true, false], [false, true], [true, true]])("separates rename %s and organization-create %s authority", async (canRename, canCreateWorkspace) => {
    mocks.getSettings.mockResolvedValue({ ...settings, canRename, canCreateWorkspace });
    const html = renderToStaticMarkup(await Settings()); expect(html.includes("Workspace editor")).toBe(canRename); expect(html.includes("Create another workspace")).toBe(canCreateWorkspace);
    if (!canRename) expect(html).toContain("Organization ownership alone does not grant that permission");
    if (!canCreateWorkspace) expect(html).toContain("Workspace administration alone does not grant that permission");
  });
  it("uses explicit organization-owner lookup instead of deriving authority from active workspace", async () => {
    const html = renderToStaticMarkup(await page()); expect(mocks.getCreationOrganization).toHaveBeenCalledWith(organizationId, userId);
    expect(html).toContain("New workspace"); expect(html).toContain("&quot;operation&quot;:&quot;create&quot;");
    mocks.getCreationOrganization.mockResolvedValue(undefined); await expect(page()).rejects.toThrow("not-found");
  });
  it.each([{}, { organizationId: [organizationId, organizationId] }, { organizationId: "bad" }, { organizationId, role: "owner" }, { organizationId, workspaceId }])("rejects missing/ambiguous or injected scope %j", async query => {
    await expect(page(query)).rejects.toThrow("not-found"); expect(mocks.getCreationOrganization).not.toHaveBeenCalled();
  });
});
