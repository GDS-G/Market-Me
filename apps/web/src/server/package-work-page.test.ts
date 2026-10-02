import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackageWorkSnapshot, WorkspaceRole } from "@market-me/database";
import { packageWorkPath, packageWorkQuery } from "./package-work-view";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), getSnapshot: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/database", () => ({ getPackageWorkRepository: () => mocks }));
vi.mock("@/server/dashboard-data", async () => await import("./dashboard-data"));
vi.mock("@/server/package-work-view", async () => await import("./package-work-view"));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => createElement("main", {}, children) }));
vi.mock("@/components/campaign-preparation-request", async () => await import("../components/campaign-preparation-request"));
vi.mock("@/components/campaign-finalization-request", async () => await import("../components/campaign-finalization-request"));
vi.mock("../app/content-packages/[id]/work/work.module.css", () => ({ default: {} }));
import PackageWorkPage from "../app/content-packages/[id]/work/page";
const uuid = (n: number) => `11111111-1111-4111-8111-${n.toString().padStart(12, "0")}`;
const userId = uuid(1), workspaceId = uuid(2), packageId = uuid(3), at = "2026-10-01T12:00:00.000Z";
const snapshot = (): PackageWorkSnapshot => ({ workspaceId, packageId, title: "Synthetic package", packageVersion: 2, packageStatus: "approved", role: "owner", observedAt: at, page: 1, hasMore: false,
  preparations: [{ id: uuid(4), campaignId: uuid(5), campaignName: "Synthetic campaign", packageVersion: 1, createdAt: at,
    drafts: [{ draftId: uuid(6), initialVersionId: uuid(7), audienceLabel: "First audience", current: { versionId: uuid(8), versionNumber: 2, status: "approved" } }], finalization: null }] });
const page = (query: Record<string, string | string[] | undefined> = {}, id = packageId) => PackageWorkPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) });
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: userId, displayName: "Synthetic user" });
  mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "Synthetic workspace", role: "owner" }); mocks.getSnapshot.mockResolvedValue(snapshot()); });
describe("package work navigation input", () => {
  it("uses canonical bounded local paging links", () => {
    expect(packageWorkQuery({})).toBe(1); expect(packageWorkQuery({ page: "1000" })).toBe(1000);
    expect(packageWorkPath(packageId)).toBe(`/content-packages/${packageId}/work`);
    expect(packageWorkPath(packageId, 2)).toBe(`/content-packages/${packageId}/work?page=2`);
    expect(() => packageWorkPath("//external.test")).toThrow();
  });
  it.each(["", "0", "01", "-1", "1.5", "1e2", " 1", "1 ", "1001", "99999", ["1", "2"]])("rejects ambiguous page %j", value => {
    expect(() => packageWorkQuery({ page: value })).toThrow();
  });
  it.each(["workspaceId", "role", "packageId", "action", "done"])("rejects query authority %s", key => {
    expect(() => packageWorkQuery({ [key]: "synthetic" })).toThrow();
  });
});
describe("authenticated read-only package journey", () => {
  it("requires authentication and selected workspace before a repository read", async () => {
    mocks.user.mockResolvedValue(undefined); await expect(page()).rejects.toThrow("redirect:/login"); expect(mocks.getSnapshot).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ id: userId }); mocks.workspace.mockResolvedValue(undefined); await expect(page()).rejects.toThrow("redirect:/login"); expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });
  it("passes exact server-owned scope and preserves captured versus current versions", async () => {
    const html = renderToStaticMarkup(await page()); expect(mocks.getSnapshot).toHaveBeenCalledExactlyOnceWith(workspaceId, packageId, userId, 1);
    expect(html).toContain("current package revision 2"); expect(html).toContain("Captured package revision 1");
    expect(html).toContain("different revision"); expect(html).toContain("current version differs from the initial");
    expect(html).toContain(`/campaigns/preparations/${uuid(4)}?workspaceId=${workspaceId}`);
    expect(html).toContain(`/drafts/${uuid(6)}`); expect(html).toContain("No finalization receipt is recorded");
    expect(html).not.toMatch(/<form|<button|<input|href="\/api\//); expect(html).not.toMatch(/ready to launch|100%|send now/i);
    expect(html).toContain("<details>"); expect(html).toContain("What is included and what statuses mean");
  });
  it.each(["owner", "admin", "editor", "approver", "analyst", "viewer"])("renders fresh %s scope without launch or approval controls", async role => {
    mocks.getSnapshot.mockResolvedValue({ ...snapshot(), role: role as WorkspaceRole });
    const html = renderToStaticMarkup(await page()); expect(html).toContain(`Current role: ${role}`);
    expect(html).not.toContain('href="/approvals"'); expect(html).not.toContain('href="/campaigns/prepare"'); expect(html).not.toMatch(/<form|<button/);
  });
  it("rejects malformed path or query before reading related work", async () => {
    await expect(page({}, "bad")).rejects.toThrow("not-found"); await expect(page({ workspaceId })).rejects.toThrow("not-found");
    await expect(page({ page: ["1", "2"] })).rejects.toThrow("not-found"); expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });
  it.each([undefined, { ...snapshot(), workspaceId: uuid(99) }, { ...snapshot(), packageId: uuid(99) }, { ...snapshot(), page: 2 }])("rejects missing or mismatched scope", async value => {
    mocks.getSnapshot.mockResolvedValue(value); await expect(page()).rejects.toThrow("not-found");
  });
  it("propagates persistence failure without an empty-success fallback", async () => {
    mocks.getSnapshot.mockRejectedValue(new Error("synthetic storage unavailable")); await expect(page()).rejects.toThrow("synthetic storage unavailable");
  });
  it("explains empty scope without offering automatic preparation", async () => {
    mocks.getSnapshot.mockResolvedValue({ ...snapshot(), preparations: [] }); const html = renderToStaticMarkup(await page());
    expect(html).toContain("No completed preparations recorded"); expect(html).toContain("does not mean that the package is ready"); expect(html).toContain("pending source-preparation commands are not included");
  });
  it("preserves current-page refresh and truthful bounded pagination", async () => {
    mocks.getSnapshot.mockResolvedValue({ ...snapshot(), page: 2, hasMore: true }); const html = renderToStaticMarkup(await page({ page: "2" }));
    expect(mocks.getSnapshot).toHaveBeenCalledExactlyOnceWith(workspaceId, packageId, userId, 2);
    expect(html).toContain(`href="${packageWorkPath(packageId, 2)}"`); expect(html).toContain(`href="${packageWorkPath(packageId, 3)}"`); expect(html).toContain("not a stable history export");
    mocks.getSnapshot.mockResolvedValue({ ...snapshot(), page: 1000, hasMore: true }); const limited = renderToStaticMarkup(await page({ page: "1000" }));
    expect(limited).toContain("supported history page limit"); expect(limited).not.toContain("page=1001");
  });
  it("explains an empty later page and offers a latest-page reset", async () => {
    mocks.getSnapshot.mockResolvedValue({ ...snapshot(), page: 2, preparations: [] }); const html = renderToStaticMarkup(await page({ page: "2" }));
    expect(html).toContain("No preparations on this page"); expect(html).toContain("View latest preparations");
  });
  it("omits broken draft links while preserving historical context", async () => {
    const source = snapshot(), p = source.preparations[0]!;
    mocks.getSnapshot.mockResolvedValue({ ...source, preparations: [{ ...p, drafts: [{ ...p.drafts[0], current: null }] }] });
    const html = renderToStaticMarkup(await page()); expect(html).toContain("Current draft unavailable"); expect(html).not.toContain(`/drafts/${uuid(6)}`);
  });
  it("links exact finalization and runs, not inferred execution or external delivery", async () => {
    const source = snapshot(), p = source.preparations[0]!;
    mocks.getSnapshot.mockResolvedValue({ ...source, preparations: [{ ...p, finalization: { id: uuid(9), finalizedVersionId: uuid(10), selectedDraftId: uuid(6), selectedDraftVersionId: uuid(8), createdAt: at,
      runs: [{ id: uuid(11), status: "completed", createdAt: at }], hasMoreRuns: true } }] });
    const html = renderToStaticMarkup(await page()); expect(html).toContain(`/campaigns/finalizations/${uuid(9)}?workspaceId=${workspaceId}`);
    expect(html).toContain(`/campaign-instances/${uuid(11)}`); expect(html).toContain("not a delivery or engagement receipt"); expect(html).toContain("Only the five most recent");
    expect(html).not.toContain("/finalize?");
  });
  it("escapes user labels as inert text", async () => {
    mocks.getSnapshot.mockResolvedValue({ ...snapshot(), title: "<script>synthetic</script>" }); const html = renderToStaticMarkup(await page());
    expect(html).toContain("&lt;script&gt;synthetic&lt;/script&gt;"); expect(html).not.toContain("<script>synthetic");
  });
});
