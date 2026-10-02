import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeContentCatalogCursor, type ContentCatalogSnapshot } from "@market-me/database";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), getPage: vi.fn() }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/database", () => ({ getContentCatalogRepository: () => mocks }));
vi.mock("@/server/content-catalog-view", () => import("./content-catalog-view"));
vi.mock("@/server/dashboard-data", () => import("./dashboard-data"));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => createElement("main", {}, children) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("Redirect: " + url); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("next/link", () => ({ default: ({ href, prefetch, children, ...props }: { href: string; prefetch?: boolean; children: ReactNode }) => createElement("a", { ...props, href, "data-prefetch": prefetch === false ? "false" : undefined }, children) }));
vi.mock("../app/content-packages/catalog.module.css", () => ({ default: {} }));
import ContentPackagesPage from "../app/content-packages/page";
const userId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222", packageId = "33333333-3333-4333-8333-333333333333", time = "2026-10-02T05:00:00.123456Z";
function snapshot(): ContentCatalogSnapshot { return { schemaVersion: 1, workspaceId, observedAt: time, filters: { query: "", status: null }, totalPackages: "1", totalMatches: "1", nextCursor: null, items: [{ id: packageId, title: "Synthetic", status: "needs_review", confidence: null, updatedAt: time, assetCount: "0", evidenceCount: "0", fileNames: [] }] }; }
const page = (query: Record<string, string | string[] | undefined> = {}) => ContentPackagesPage({ searchParams: Promise.resolve(query) });
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: userId, displayName: "Synthetic" }); mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "Synthetic workspace", role: "viewer" }); mocks.getPage.mockResolvedValue(snapshot()); });
describe("current-member searchable Content Package catalog", () => {
  it("remounts native filter controls when applied query, status or workspace changes", async () => {
    function formKey(node: ReactNode): string | null {
      if (Array.isArray(node)) return node.map(formKey).find(key => key !== null) ?? null;
      if (!isValidElement<{ children?: ReactNode }>(node)) return null;
      return node.type === "form" ? node.key : formKey(node.props.children);
    }
    expect(formKey(await page())).toBe(JSON.stringify([workspaceId, "", null]));
    mocks.getPage.mockResolvedValue({ ...snapshot(), filters: { query: "café", status: null } });
    expect(formKey(await page({ q: "café" }))).toBe(JSON.stringify([workspaceId, "café", null]));
    mocks.getPage.mockResolvedValue({ ...snapshot(), filters: { query: "", status: "approved" } });
    expect(formKey(await page({ status: "approved" }))).toBe(JSON.stringify([workspaceId, "", "approved"]));
    mocks.workspace.mockResolvedValue({ workspaceId: packageId, workspaceName: "Other", role: "viewer" });
    mocks.getPage.mockResolvedValue({ ...snapshot(), workspaceId: packageId });
    expect(formKey(await page())).toBe(JSON.stringify([packageId, "", null]));
  });
  it.each([{ value: null, expected: "Unavailable" }, { value: undefined, expected: "Unavailable" }, { value: 0, expected: "0%" }, { value: 0.54, expected: "54%" }, { value: 1, expected: "100%" }])("distinguishes recorded confidence $value from missing confidence", async ({ value, expected }) => {
    const data = snapshot(); Object.assign(data.items[0], { confidence: value }); mocks.getPage.mockResolvedValue(data);
    const html = renderToStaticMarkup(await page()); expect(html).toContain("<strong>" + expected + "</strong>"); if (value == null) expect(html).not.toContain("0%");
    expect(html).toContain("Needs review"); expect(html).toContain("do not prove current approval");
  });
  it("uses one current-workspace/actor page instead of unrestricted full package loading", async () => {
    const html = renderToStaticMarkup(await page()); expect(mocks.workspace).toHaveBeenCalledExactlyOnceWith(userId); expect(mocks.getPage).toHaveBeenCalledExactlyOnceWith(workspaceId, userId, { query: "" });
    expect(html).toContain('method="get"'); expect(html).toContain('action="/content-packages"'); expect(html).toContain('name="workspaceId" value="' + workspaceId + '"'); expect(html).toContain('maxLength="120"'); expect(html).toContain('name="q"');
    expect(html).toContain('data-prefetch="false"'); expect(html).not.toContain("/api/"); expect(html).not.toContain('method="post"');
  });
  it.each(["owner", "admin", "editor", "approver", "analyst", "viewer"])("offers the same read-only search controls for %s", async role => {
    mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "Synthetic", role }); const html = renderToStaticMarkup(await page()); expect(html).toContain("Search packages"); expect(html).not.toMatch(/Approve package|Activate|Publish now/);
  });
  it("requires authentication before current membership and catalog access", async () => {
    mocks.user.mockResolvedValue(undefined); await expect(page()).rejects.toThrow("Redirect: /login"); expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.getPage).not.toHaveBeenCalled();
  });
  it("does not query without current workspace access", async () => { mocks.workspace.mockResolvedValue(undefined); await expect(page()).rejects.toThrow("Redirect: /login"); expect(mocks.getPage).not.toHaveBeenCalled(); });
  it.each([{ q: ["x", "y"] }, { workspaceId: [workspaceId] }, { status: ["ready"] }, { actorUserId: userId }, { workspaceId: packageId }, { cursor: "bad" }, { q: "x".repeat(121) }])("rejects invalid/ambiguous query %j before SQL", async query => {
    await expect(page(query)).rejects.toThrow("not-found"); expect(mocks.getPage).not.toHaveBeenCalled();
  });
  it("rejects revoked or mismatched returned workspace/filter state", async () => {
    for (const data of [undefined, { ...snapshot(), workspaceId: packageId }, { ...snapshot(), filters: { query: "other", status: null } }, { ...snapshot(), filters: { query: "", status: "approved" } }]) { mocks.getPage.mockResolvedValue(data); await expect(page()).rejects.toThrow("not-found"); }
  });
  it("propagates persistence failures instead of displaying an empty catalog", async () => { mocks.getPage.mockRejectedValue(new Error("synthetic unavailable")); await expect(page()).rejects.toThrow("synthetic unavailable"); });
  it("retains normalized search/status on paging but not the old cursor on the GET form or newest link", async () => {
    const filters = { query: "café", status: "ready" as const }, cursor = encodeContentCatalogCursor(workspaceId, filters, { at: time, id: packageId }), data = { ...snapshot(), filters, nextCursor: cursor, totalPackages: "99", totalMatches: "42" };
    mocks.getPage.mockResolvedValue(data); const html = renderToStaticMarkup(await page({ q: " café ", status: "ready", cursor, workspaceId }));
    expect(mocks.getPage).toHaveBeenCalledWith(workspaceId, userId, { query: "café", status: "ready", cursor }); expect(html).toContain('value="café"'); expect(html).toContain('<option value="ready" selected="">');
    expect(html).toContain("Showing 1 of 42 matching packages"); expect(html).toContain("99 in this workspace catalog");
    expect(html).toContain("Next 30 results"); expect(html).toContain("Newest results"); expect(html).toContain("cursor=" + cursor); expect(html).not.toContain('name="cursor"');
    expect(html).toContain('href="/content-packages?workspaceId=' + workspaceId + '&amp;q=caf%C3%A9&amp;status=ready"'); expect(html).toContain("New changes can move results");
  });
  it("escapes labels and preserves bounded filename/evidence counts and exact time attributes", async () => {
    const data = snapshot(); Object.assign(data.items[0], { title: "<script>bad</script>", assetCount: "9007199254740995", evidenceCount: "9007199254740993", fileNames: ['<img src="x">', "two.txt", ""] }); mocks.getPage.mockResolvedValue(data);
    const html = renderToStaticMarkup(await page()); expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;"); expect(html).not.toContain("<script>bad"); expect(html).toContain("&lt;img");
    expect(html).toContain("Plus 9,007,199,254,740,992 more file records"); expect(html).toContain("9,007,199,254,740,993"); expect(html).toContain("Unnamed file record"); expect(html).toContain('dateTime="' + time + '"');
  });
  it.each([{ totalPackages: "0", totalMatches: "0", title: "No Content Packages yet" }, { totalPackages: "4", totalMatches: "0", title: "No matching packages" }, { totalPackages: "4", totalMatches: "4", title: "No more packages at this position" }])("distinguishes $title without inventing a successful read", async ({ totalPackages, totalMatches, title }) => {
    mocks.getPage.mockResolvedValue({ ...snapshot(), totalPackages, totalMatches, items: [] }); const html = renderToStaticMarkup(await page()); expect(html).toContain(title); expect(html).not.toContain("Next 30 results");
  });
});
