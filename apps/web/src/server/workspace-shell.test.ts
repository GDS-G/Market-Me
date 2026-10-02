import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), selection: vi.fn(), switchAction: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/link", () => ({ default: ({ href, prefetch, children, ...props }: { href: string; prefetch?: boolean; children: ReactNode }) =>
  createElement("a", { ...props, href, "data-prefetch": prefetch === false ? "false" : undefined }, children) }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspaceSelection: mocks.selection }));
vi.mock("@/server/workspace-actions", () => ({ switchActiveWorkspace: mocks.switchAction }));
vi.mock("../components/workspace-shell.module.css", () => ({ default: { shell: "shell", desktopSidebar: "desktopSidebar", mobileHeader: "mobileHeader", menu: "menu" } }));
vi.mock("../components/workspace-switcher.module.css", () => ({ default: {} }));
import { WorkspaceShell } from "../components/workspace-shell";
import { WorkspaceNavigation } from "../components/workspace-navigation";
import { WorkspaceSwitcher } from "../components/workspace-switcher";
const userId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222";
const paths = ["/", "/getting-started", "/smart-sources", "/context-packs", "/content-packages", "/drafts", "/campaigns", "/approvals", "/calendar",
  "/conversations", "/analytics", "/ai-settings", "/audience", "/destinations", "/integrations", "/companion", "/team", "/settings"];
const selection = () => ({ workspace: { workspaceId, workspaceName: "Current synthetic workspace", role: "viewer" }, workspaces: [
  { workspaceId, workspaceName: "Current synthetic workspace", role: "viewer", organizationId: "private-organization" },
  { workspaceId: "33333333-3333-4333-8333-333333333333", workspaceName: "Another synthetic workspace", role: "owner", organizationId: "other-organization" },
] });
const props = { activePath: "/ai-settings", workspaceName: "Stale passed label", userName: "Synthetic reader", children: createElement("h1", {}, "Synthetic content") };
const shell = async (activePath = props.activePath) => WorkspaceShell({ ...props, activePath });
function elements(node: ReactNode): Array<React.ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: userId }); mocks.selection.mockResolvedValue(selection()); });

describe("shared responsive workspace navigation", () => {
  it.each(paths)("marks only the exact %s section current without speculative prefetch", path => {
    const html = renderToStaticMarkup(createElement(WorkspaceNavigation, { activePath: path }));
    expect(html.match(/<a /g)).toHaveLength(18); expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain(`href="${path}"`);
    const current = html.match(/<a [^>]*aria-current="page"[^>]*>/)?.[0]; expect(current).toContain(`href="${path}"`);
    expect(html.match(/data-prefetch="false"/g)).toHaveLength(18);
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(18);
    for (const expected of paths) expect(html.match(new RegExp(`href="${expected}"`, "g"))).toHaveLength(1);
    expect(mocks.selection).not.toHaveBeenCalled(); expect(mocks.switchAction).not.toHaveBeenCalled();
  });
  it.each(["/campaigns/not-a-section", "/?workspace=other", "https://example.invalid"])("does not infer active authority from %s", activePath => {
    const html = renderToStaticMarkup(createElement(WorkspaceNavigation, { activePath }));
    expect(html).not.toContain("aria-current"); expect(html).not.toContain('href="https:');
  });
  it("requires authentication and a current selection before rendering either surface", async () => {
    mocks.user.mockResolvedValue(undefined); await expect(shell()).rejects.toThrow("redirect:/login"); expect(mocks.selection).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ id: userId }); mocks.selection.mockResolvedValue({ workspace: undefined, workspaces: [] });
    await expect(shell()).rejects.toThrow("redirect:/login");
  });
  it("loads selection once and displays the current workspace, not a stale caller label", async () => {
    const html = renderToStaticMarkup(await shell());
    expect(mocks.user).toHaveBeenCalledTimes(1); expect(mocks.selection).toHaveBeenCalledExactlyOnceWith(userId);
    expect(html).toContain("Current synthetic workspace"); expect(html).not.toContain("Stale passed label");
    expect(html).toContain("Synthetic reader"); expect(html).toContain('href="#workspace-main"');
    expect(html).toContain('id="workspace-main" tabindex="-1"'); expect(html).toContain("Synthetic content");
    expect(html.match(/aria-label="Primary navigation"/g)).toHaveLength(2); expect(html.match(/<summary>Workspace menu<\/summary>/g)).toHaveLength(1);
    expect(html).not.toMatch(/<details[^>]*open/); expect(html).not.toContain('role="dialog"');
    expect(html.match(/action="\/api\/auth\/logout" method="post"/g)).toHaveLength(2);
  });
  it("passes only existing selection labels and safe section input to both switchers", async () => {
    const tree = elements(await shell("/content-packages"));
    const switchers = tree.filter(element => element.type === WorkspaceSwitcher); expect(switchers).toHaveLength(2);
    for (const element of switchers) expect(element.props).toEqual({ workspaceId, returnPath: "/content-packages", workspaces: [
      { workspaceId, workspaceName: "Current synthetic workspace" },
      { workspaceId: "33333333-3333-4333-8333-333333333333", workspaceName: "Another synthetic workspace" },
    ] });
    expect(mocks.switchAction).not.toHaveBeenCalled();
  });
  it("gives both rendered switchers unique actual React-generated labels and IDs", async () => {
    const html = renderToStaticMarkup(await shell()); const ids = [...html.matchAll(/<select id="([^"]+)"/g)].map(match => match[1]);
    expect(ids).toHaveLength(2); expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(html).toContain(`for="${id}"`);
    expect(html.match(/name="returnPath" value="\/ai-settings"/g)).toHaveLength(2);
    expect(mocks.switchAction).not.toHaveBeenCalled();
  });
  it("resets native menu identity on section or workspace change only", async () => {
    const key = async (path = "/ai-settings") => elements(await shell(path)).find(element => element.type === "details")?.key;
    const original = await key(); expect(original).toBeTruthy(); expect(await key()).toBe(original); expect(await key("/drafts")).not.toBe(original);
    const renamed = selection(); renamed.workspace.workspaceName = "Current renamed workspace"; mocks.selection.mockResolvedValue(renamed);
    expect(await key()).toBe(original); renamed.workspace.workspaceId = "other-workspace"; expect(await key()).not.toBe(original);
  });
  it("shows a single workspace as information without a switch action", async () => {
    const only = selection(); only.workspaces = only.workspaces.slice(0, 1); mocks.selection.mockResolvedValue(only);
    const html = renderToStaticMarkup(await shell()); expect(html).not.toContain('aria-label="Switch workspace"');
    expect(html).toContain("Current synthetic workspace"); expect(mocks.switchAction).not.toHaveBeenCalled();
  });
  it("preserves and escapes long current labels instead of inventing shortened workspace identities", async () => {
    const current = selection(); current.workspace.workspaceName = "NavigationQA".repeat(10);
    current.workspaces[0].workspaceName = current.workspace.workspaceName;
    current.workspaces[1].workspaceName = "Synthetic <script>name</script> & reader";
    mocks.selection.mockResolvedValue(current);
    const html = renderToStaticMarkup(await shell());
    expect(html).toContain(current.workspace.workspaceName);
    expect(html).toContain("Synthetic &lt;script&gt;name&lt;/script&gt; &amp; reader");
    expect(html).not.toContain("<script>name</script>");
  });
  it("propagates failed membership reads instead of serving a guessed menu", async () => {
    mocks.selection.mockRejectedValue(new Error("synthetic unavailable")); await expect(shell()).rejects.toThrow("synthetic unavailable");
  });
});
