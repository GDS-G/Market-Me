import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_START_COUNT_KEYS } from "@market-me/database";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), getSnapshot: vi.fn(), listSmartSources: vi.fn(), listContentPackages: vi.fn(),
  listCampaigns: vi.fn(), listCampaignInstances: vi.fn(), listApprovals: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/database", () => ({ getWorkspaceStartRepository: () => mocks, getRepository: () => mocks, getCampaignRepository: () => mocks, getDraftRepository: () => mocks }));
vi.mock("@/server/dashboard-data", async () => await import("./dashboard-data"));
vi.mock("@/server/workspace-start-guide", async () => await import("./workspace-start-guide"));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children, activePath }: { children: ReactNode; activePath: string }) => createElement("main", { "data-active-path": activePath }, children) }));
vi.mock("../app/getting-started/start-guide.module.css", () => ({ default: {} }));
import GettingStarted from "../app/getting-started/page";
import Home from "../app/page";
const userId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222";
const snapshot = () => ({ workspaceId, role: "owner", observedAt: "2026-10-01T12:00:00.000Z", ...Object.fromEntries(WORKSPACE_START_COUNT_KEYS.map(key => [key, 0])) });
const page = (query: Record<string, string | string[] | undefined> = {}) => GettingStarted({ searchParams: Promise.resolve(query) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: userId, displayName: "Synthetic user" });
  mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "Synthetic workspace", role: "owner" }); mocks.getSnapshot.mockResolvedValue(snapshot());
  for (const key of ["listSmartSources", "listContentPackages", "listCampaigns", "listCampaignInstances", "listApprovals"] as const) mocks[key].mockResolvedValue([]);
});

describe("authenticated workspace start page", () => {
  it("requires a signed-in selected workspace before any guide query", async () => {
    mocks.user.mockResolvedValue(undefined); await expect(page()).rejects.toThrow("redirect:/login"); expect(mocks.getSnapshot).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ id: userId }); mocks.workspace.mockResolvedValue(undefined); await expect(page()).rejects.toThrow("redirect:/login"); expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });
  it("reads one scoped projection and renders six ordered stages, snapshot time and a real reload link", async () => {
    const html = renderToStaticMarkup(await page());
    expect(mocks.getSnapshot).toHaveBeenCalledExactlyOnceWith(workspaceId, userId);
    expect(mocks.listContentPackages).not.toHaveBeenCalled(); expect(mocks.listCampaigns).not.toHaveBeenCalled();
    expect(html).toContain('data-active-path="/getting-started"'); expect(html).toContain("Start with a folder");
    expect(html.match(/id="guide-/g)).toHaveLength(6); expect(html).toContain("<ol"); expect(html).toContain("<details");
    expect(html.match(/role="listitem"/g)).toHaveLength(6);
    expect(html).toContain('dateTime="2026-10-01T12:00:00.000Z"'); expect(html).toContain('href="/getting-started"');
    expect(html).toContain("Refresh saved state"); expect(html).toContain("not one completed journey");
    expect(html).not.toMatch(/<form|<input|<button|href="\/api\//); expect(html).not.toContain("100%");
  });
  it.each(["editor", "approver", "analyst", "viewer"])("uses fresh %s role instead of earlier active-workspace ownership", async role => {
    mocks.getSnapshot.mockResolvedValue({ ...snapshot(), role, pendingDraftApprovals: 2 });
    const html = renderToStaticMarkup(await page()); expect(html).toContain(`workspace role: ${role}`);
    expect(html.includes('href="/campaigns/prepare"')).toBe(role === "editor");
    expect(html.includes("Open the advanced campaign editor")).toBe(role === "editor");
    expect(html.includes('href="/approvals"')).toBe(role === "approver");
  });
  it.each([{ workspaceId: "foreign" }, { role: "admin" }, { done: "true" }, { page: "1" }, { role: ["viewer", "owner"] }])("rejects unsupported query authority %j", async query => {
    await expect(page(query)).rejects.toThrow("not-found"); expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });
  it("renders no guide after revoked membership or mismatched returned scope", async () => {
    mocks.getSnapshot.mockResolvedValue(undefined); await expect(page()).rejects.toThrow("not-found");
    mocks.getSnapshot.mockResolvedValue({ ...snapshot(), workspaceId: "foreign" }); await expect(page()).rejects.toThrow("not-found");
  });
  it("propagates unavailable persistence rather than treating failure as an empty workspace", async () => {
    mocks.getSnapshot.mockRejectedValue(new Error("synthetic unavailable")); await expect(page()).rejects.toThrow("synthetic unavailable");
  });
  it("offers optional supports without completion checkboxes or external destinations", async () => {
    const html = renderToStaticMarkup(await page());
    for (const path of ["/context-packs", "/audience", "/destinations", "/campaigns/presets"]) expect(html).toContain(`href="${path}"`);
    expect(html).toContain("not mandatory completion boxes"); expect(html).not.toMatch(/href="https?:/);
  });
  it("lets a writer discover the guide and review-first preparation directly from Overview", async () => {
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain('href="/getting-started"'); expect(html).toContain('href="/campaigns/prepare"'); expect(html).not.toContain('href="/campaigns/new"');
  });
  it("keeps the guide discoverable from a reader Overview without a creation shortcut", async () => {
    mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "Synthetic workspace", role: "viewer" });
    const html = renderToStaticMarkup(await Home()); expect(html).toContain('href="/getting-started"'); expect(html).not.toContain('href="/campaigns/prepare"');
  });
});
