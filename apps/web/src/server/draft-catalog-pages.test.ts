import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeDraftCatalogCursor, type DraftCatalogSnapshot } from "@market-me/database";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), getPage: vi.fn(), campaigns: vi.fn(), packages: vi.fn() }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/database", () => ({ getDraftCatalogRepository: () => mocks, getCampaignRepository: () => ({ listCampaigns: mocks.campaigns }), getRepository: () => ({ listContentPackages: mocks.packages }) }));
vi.mock("@/server/draft-catalog-view", () => import("./draft-catalog-view"));
vi.mock("@/server/content-catalog-view", () => import("./content-catalog-view"));
vi.mock("@/server/dashboard-data", () => import("./dashboard-data"));
vi.mock("@/components/campaign-preparation-request", () => import("../components/campaign-preparation-request"));
vi.mock("@/components/draft-generation-form", () => ({ DraftGenerationForm: (props: unknown) => createElement("form", { "data-generator": "true" }, JSON.stringify(props)) }));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => createElement("main", {}, children) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("redirect:" + url); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("next/link", () => ({ default: ({ href, prefetch, children, ...props }: { href: string; prefetch?: boolean; children: ReactNode }) => createElement("a", { ...props, href, "data-prefetch": prefetch === false ? "false" : undefined }, children) }));
vi.mock("../app/drafts/catalog.module.css", () => ({ default: {} }));
import DraftsPage from "../app/drafts/page";
import GenerateDraftsPage from "../app/drafts/generate/page";
const userId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222", draftId = "33333333-3333-4333-8333-333333333333", time = "2026-10-02T05:00:00.123456Z";
function snapshot(): DraftCatalogSnapshot { return { schemaVersion: 1, workspaceId, observedAt: time, filters: { query: "", status: null }, totalDrafts: "1", totalMatches: "1", nextCursor: null, items: [{ id: draftId, currentVersionId: userId, versionNumber: 3, headline: "Synthetic draft", bodyPreview: "Safe copy", bodyCharacters: "9", bodyTruncated: false, status: "working", updatedAt: time, campaignId: userId, campaignName: "Synthetic plan", packageId: userId, packageTitle: "Synthetic package", audienceName: null }] }; }
const page = (query: Record<string, string | string[] | undefined> = {}) => DraftsPage({ searchParams: Promise.resolve(query) });
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: userId, displayName: "Synthetic" }); mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "Synthetic workspace", role: "viewer" }); mocks.getPage.mockResolvedValue(snapshot()); mocks.campaigns.mockResolvedValue([]); mocks.packages.mockResolvedValue([]); });
describe("scoped searchable draft variants", () => {
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
    mocks.workspace.mockResolvedValue({ workspaceId: draftId, workspaceName: "Other", role: "viewer" });
    mocks.getPage.mockResolvedValue({ ...snapshot(), workspaceId: draftId });
    expect(formKey(await page())).toBe(JSON.stringify([draftId, "", null]));
  });
  it("uses only the current-member catalog, never full draft/campaign/package hydration", async () => {
    const html = renderToStaticMarkup(await page()); expect(mocks.getPage).toHaveBeenCalledExactlyOnceWith(workspaceId, userId, { query: "" }); expect(mocks.campaigns).not.toHaveBeenCalled(); expect(mocks.packages).not.toHaveBeenCalled();
    expect(html).toContain('method="get"'); expect(html).toContain('action="/drafts"'); expect(html).toContain('name="workspaceId" value="' + workspaceId + '"'); expect(html).toContain('maxLength="120"'); expect(html).not.toContain('data-generator'); expect(html).not.toContain('/api/');
    expect(html).toContain("General"); expect(html).toContain("Current copy version"); expect(html).toContain("does not prove current approval");
  });
  it.each(["owner", "admin", "editor", "approver", "analyst", "viewer"])("offers read-only search to %s with generation links only for writers", async role => {
    mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA", role }); const html = renderToStaticMarkup(await page());
    expect(html).toContain("Search drafts"); expect(html.includes('href="/drafts/generate"')).toBe(["owner", "admin", "editor"].includes(role)); expect(html).not.toContain('data-generator');
    expect(mocks.packages).not.toHaveBeenCalled(); expect(mocks.campaigns).not.toHaveBeenCalled();
  });
  it.each(["session", "workspace"])("requires current %s", async missing => {
    if (missing === "session") mocks.user.mockResolvedValue(undefined); else mocks.workspace.mockResolvedValue(undefined);
    await expect(page()).rejects.toThrow("redirect:/login"); expect(mocks.getPage).not.toHaveBeenCalled();
  });
  it.each([{ workspaceId: draftId }, { q: ["a", "b"] }, { status: ["working"] }, { cursor: "bad" }, { q: "x".repeat(121) }, { extra: "yes" }])("rejects invalid browser input %j before SQL", async query => { await expect(page(query)).rejects.toThrow("not-found"); expect(mocks.getPage).not.toHaveBeenCalled(); });
  it.each([undefined, { ...snapshot(), workspaceId: draftId }, { ...snapshot(), filters: { query: "foreign", status: null } }, { ...snapshot(), filters: { query: "", status: "approved" } }])("rejects inaccessible or inconsistent returned scope", async data => { mocks.getPage.mockResolvedValue(data); await expect(page()).rejects.toThrow("not-found"); });
  it("escapes copy/labels and makes shortened copy explicit without claiming full evidence", async () => {
    const data = snapshot(); Object.assign(data.items[0], { headline: '<script>alert("x")</script>', bodyPreview: "<private>&copy", audienceName: "Members <reader>", bodyTruncated: true, bodyCharacters: "9007199254740995" }); mocks.getPage.mockResolvedValue(data);
    const html = renderToStaticMarkup(await page()); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>"); expect(html).toContain("&lt;private&gt;&amp;copy"); expect(html).toContain("Members &lt;reader&gt;"); expect(html).toContain("first 320 characters of 9,007,199,254,740,995"); expect(html).toContain("Open the draft for complete copy");
  });
  it("distinguishes empty copy/headline from missing records", async () => { const data = snapshot(); Object.assign(data.items[0], { headline: "", bodyPreview: "", bodyCharacters: "0" }); mocks.getPage.mockResolvedValue(data); const html = renderToStaticMarkup(await page()); expect(html).toContain("Untitled draft"); expect(html).toContain("No body copy recorded."); expect(html).not.toContain("Shortened preview"); });
  it.each([{ totalDrafts: "0", totalMatches: "0", expected: "No drafts available" }, { totalDrafts: "3", totalMatches: "0", expected: "No matching drafts" }, { totalDrafts: "3", totalMatches: "2", expected: "No more drafts at this position" }])("distinguishes $expected", async example => { mocks.getPage.mockResolvedValue({ ...snapshot(), ...example, items: [] }); const html = renderToStaticMarkup(await page()); expect(html).toContain(example.expected); expect(html).not.toContain('href="/campaigns/prepare"'); });
  it("preserves selection in next/newest URLs while the GET form drops the old cursor", async () => {
    const selection = { query: "café &", status: "working" as const }, cursor = encodeDraftCatalogCursor(workspaceId, selection, { at: time, id: draftId });
    mocks.getPage.mockResolvedValue({ ...snapshot(), filters: selection, totalMatches: "9007199254740995", nextCursor: cursor });
    const html = renderToStaticMarkup(await page({ q: selection.query, status: selection.status, cursor }));
    expect(html).toContain("1 of 9,007,199,254,740,995"); expect(html).toContain("q=caf%C3%A9+%26&amp;status=working&amp;cursor="); expect(html).toContain("Newest results"); expect(html).toContain('data-prefetch="false"');
    expect(html.match(/<form[^>]*>[\s\S]*?<\/form>/)?.[0]).not.toContain('name="cursor"');
  });
});
describe("explicit existing-plan generation page", () => {
  it.each(["viewer", "analyst", "approver"])("does not hydrate candidates or show writer controls for %s", async role => {
    mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA", role }); const html = renderToStaticMarkup(await GenerateDraftsPage()); expect(html).toContain("Writer access required"); expect(html).not.toContain('data-generator'); expect(html).not.toContain('/campaigns/prepare'); expect(mocks.campaigns).not.toHaveBeenCalled(); expect(mocks.packages).not.toHaveBeenCalled();
  });
  it.each(["owner", "admin", "editor"])("preserves the existing bound-package generator for %s", async role => {
    mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA", role }); mocks.packages.mockResolvedValue([{ id: draftId, title: "Marked approved", status: "approved" }, { id: userId, title: "Unapproved", status: "ready" }]); mocks.campaigns.mockResolvedValue([{ id: userId, name: "Published plan", currentVersion: { contentPackageIds: [draftId, userId] } }]);
    const html = renderToStaticMarkup(await GenerateDraftsPage()); expect(html).toContain('data-generator="true"'); expect(html).toContain("Marked approved"); expect(html).not.toContain("Unapproved"); expect(html).toContain("does not generate, approve or send anything"); expect(mocks.getPage).not.toHaveBeenCalled(); expect(mocks.packages).toHaveBeenCalledExactlyOnceWith(workspaceId);
  });
  it("shows one preparation entry for a writer with no candidates", async () => { mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA", role: "editor" }); const html = renderToStaticMarkup(await GenerateDraftsPage()); expect(html.match(/href="\/campaigns\/prepare"/g)).toHaveLength(1); expect(html).not.toContain('data-generator'); });
  it.each(["session", "workspace"])("requires current %s before loading candidates", async missing => { if (missing === "session") mocks.user.mockResolvedValue(undefined); else mocks.workspace.mockResolvedValue(undefined); await expect(GenerateDraftsPage()).rejects.toThrow("redirect:/login"); expect(mocks.packages).not.toHaveBeenCalled(); });
});
