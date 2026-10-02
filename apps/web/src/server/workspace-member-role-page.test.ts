import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), listMembers: vi.fn(), listWorkspaceInvitations: vi.fn(), listPendingInvitations: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/database", () => ({ getWorkspaceMemberRoleRepository: () => mocks, getRepository: () => mocks, getWorkspaceMemberLifecycleRepository: () => mocks }));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => createElement("main", {}, children) }));
vi.mock("@/components/workspace-member-role-form", () => ({ WorkspaceMemberRoleForm: (props: unknown) => createElement("form", { "data-role-scope": JSON.stringify(props) }, "Role editor") }));
vi.mock("@/components/workspace-member-removal-panel", () => ({ WorkspaceMemberRemovalPanel: (props: unknown) => createElement("div", { "data-removal-scope": JSON.stringify(props) }, "Access removal review") }));
vi.mock("@/components/team-invitations", () => ({ TeamInvitations: () => createElement("div", {}, "Invitation controls") }));
vi.mock("@/components/workspace-management.module.css", () => ({ default: {} }));
import Team from "../app/team/page";
const userId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222";
const member = { userId: "33333333-3333-4333-8333-333333333333", displayName: "Synthetic collaborator", role: "editor", revision: 4, canChangeRole: true };
const team = { workspaceId, page: 1, more: false, canManage: true, members: [member] };
const page = (query: Record<string, string | string[] | undefined> = {}) => Team({ searchParams: Promise.resolve(query) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: userId, displayName: "Synthetic owner" });
  mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA", role: "owner" }); mocks.listMembers.mockResolvedValue(team); mocks.listWorkspaceInvitations.mockResolvedValue([]);
});
describe("bounded member-role team page", () => {
  it("requires a signed-in workspace before reading membership", async () => {
    mocks.user.mockResolvedValue(undefined); await expect(page()).rejects.toThrow("redirect:/login"); expect(mocks.listMembers).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ id: userId }); mocks.workspace.mockResolvedValue(undefined); await expect(page()).rejects.toThrow("redirect:/login");
  });
  it("passes exact current workspace/user, loaded revisions and truthful snapshot text", async () => {
    const html = renderToStaticMarkup(await page()); expect(mocks.listMembers).toHaveBeenCalledWith(workspaceId, userId, 1);
    expect(html).toContain("Role editor"); expect(html).toContain("&quot;revision&quot;:4"); expect(html).toContain("Loaded team snapshot");
    expect(html).toContain("Invitation controls"); expect(html).not.toContain("Next members");
    expect(html).toContain("Access removal review"); expect(html).toContain("data-removal-scope");
  });
  it("uses fresh repository authority, not an older active-workspace role", async () => {
    mocks.listMembers.mockResolvedValue({ ...team, canManage: false, members: [{ ...member, canChangeRole: false }] });
    const html = renderToStaticMarkup(await page()); expect(html).not.toContain("Role editor"); expect(html).not.toContain("Invitation controls");
    expect(html).not.toContain("Access removal review");
    expect(mocks.listWorkspaceInvitations).not.toHaveBeenCalled(); expect(html).toContain(member.displayName);
  });
  it("navigates bounded pages without accepting query-supplied workspace authority", async () => {
    mocks.listMembers.mockResolvedValue({ ...team, page: 2, more: true });
    const html = renderToStaticMarkup(await page({ page: "2" })); expect(mocks.listMembers).toHaveBeenCalledWith(workspaceId, userId, 2);
    expect(html).toContain('/team?page=1'); expect(html).toContain('/team?page=3');
  });
  it("uses independently authorized member-specific pending invitations rather than a capped mixed history", async () => {
    mocks.listPendingInvitations.mockResolvedValue([]);
    const html = renderToStaticMarkup(await page({ invitationMember: member.userId }));
    expect(mocks.listPendingInvitations).toHaveBeenCalledWith(workspaceId, member.userId, userId); expect(mocks.listWorkspaceInvitations).not.toHaveBeenCalled();
    expect(html).toContain("unrelated invitations are excluded");
    mocks.listMembers.mockResolvedValue({ ...team, canManage: false });
    await expect(page({ invitationMember: member.userId })).rejects.toThrow("not-found");
  });
  it.each([{ invitationMember: [member.userId, member.userId] }, { invitationMember: "bad" }, { invitationMember: "" }])("rejects invalid invitation member filter %j", async query => {
    await expect(page(query)).rejects.toThrow("not-found"); expect(mocks.listPendingInvitations).not.toHaveBeenCalled();
  });
  it.each([{ page: "0" }, { page: "2001" }, { page: "1.5" }, { page: "01" }, { page: ["1", "2"] }, { workspaceId }, { role: "admin" }])("rejects ambiguous/unsupported scope %j", async query => {
    await expect(page(query)).rejects.toThrow("not-found"); expect(mocks.listMembers).not.toHaveBeenCalled();
  });
});
