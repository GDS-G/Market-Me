import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceAnalyticsSnapshot } from "@market-me/database";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), getSnapshot: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("next/link", () => ({ default: ({ href, prefetch, children, ...props }: { href: string; prefetch?: boolean; children: ReactNode }) =>
  createElement("a", { ...props, href, "data-prefetch": prefetch === false ? "false" : undefined }, children) }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/database", () => ({ getWorkspaceAnalyticsRepository: () => mocks }));
vi.mock("@/server/dashboard-data", async () => await import("./dashboard-data"));
vi.mock("@/server/workspace-analytics-view", async () => await import("./workspace-analytics-view"));
vi.mock("@/server/workspace-analytics-export", async () => await import("./workspace-analytics-export"));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children, activePath }: { children: ReactNode; activePath: string }) => createElement("main", { "data-active-path": activePath }, children) }));
vi.mock("../app/analytics/analytics.module.css", () => ({ default: {} }));
import Analytics from "../app/analytics/page";
const userId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222", campaignId = "33333333-3333-4333-8333-333333333333", runId = "44444444-4444-4444-8444-444444444444";
const time = "2026-10-01T12:00:00.123456Z";
function snapshot(): WorkspaceAnalyticsSnapshot {
  return { schemaVersion: 1, workspaceId, campaign: null, observedAt: time, totals: { campaignRuns: "0", publicationActions: "0", measurementEvents: "0", providerMetricRows: "0" },
    runStatuses: [], publicationStatuses: [], measurements: { groupCount: "0", hasMore: false, items: [] }, providerMetrics: [], recentRuns: { hasMore: false, items: [] } };
}
const page = (query: Record<string, string | string[] | undefined> = {}) => Analytics({ searchParams: Promise.resolve(query) });
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: userId, displayName: "Synthetic analyst" }); mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "Synthetic workspace", role: "viewer" }); mocks.getSnapshot.mockResolvedValue(snapshot()); });
describe("authenticated read-only Analytics page", () => {
  it("requires authentication and current selection before reporting", async () => {
    mocks.user.mockResolvedValue(undefined); await expect(page()).rejects.toThrow("redirect:/login"); expect(mocks.getSnapshot).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ id: userId }); mocks.workspace.mockResolvedValue(undefined); await expect(page()).rejects.toThrow("redirect:/login"); expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });
  it("reads one current-member snapshot and describes missing observations honestly", async () => {
    const html = renderToStaticMarkup(await page()); expect(mocks.getSnapshot).toHaveBeenCalledExactlyOnceWith(workspaceId, userId, undefined);
    expect(html).toContain('data-active-path="/analytics"'); expect(html).toContain("No event observations yet"); expect(html).toContain("No provider totals observed"); expect(html).toContain("not zero engagement");
    expect(html).toContain("All-time recorded data"); expect(html).toContain("No inferred attribution"); expect(html).toContain("does not contact providers");
    expect(html).toContain(`href="/analytics?workspaceId=${workspaceId}"`); expect(html).toContain("Refresh recorded data");
    expect(html).not.toMatch(/<form|<input|<button/); expect(html).not.toContain("ROI:");
    for (const format of ["json", "csv"]) expect(html).toContain(`href="/api/v1/analytics/export?workspaceId=${workspaceId}&amp;format=${format}" download=""`);
    expect(html).toContain("not a full-history export"); expect(html).toContain("fresh snapshot"); expect(html).toContain("set all columns to text");
  });
  it.each(["owner", "admin", "editor", "approver", "analyst", "viewer"])("offers only read/navigation for %s", async role => {
    mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "Synthetic workspace", role });
    const html = renderToStaticMarkup(await page()); expect(html).toContain("Analytics"); expect(html).not.toMatch(/<form|<input|<button/);
  });
  it.each([{ role: "owner" }, { campaignId: [campaignId, campaignId] }, { workspaceId: campaignId }, { campaignId: "bad" }, { refresh: "provider" }, { page: "2" }])("rejects unsupported/ambiguous filters %j before reporting", async query => {
    await expect(page(query)).rejects.toThrow("not-found"); expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });
  it("requires the exact requested Campaign in the active workspace and retains it on refresh", async () => {
    mocks.getSnapshot.mockResolvedValue({ ...snapshot(), campaign: { id: campaignId, name: "Synthetic café" } });
    const html = renderToStaticMarkup(await page({ campaignId, workspaceId })); expect(mocks.getSnapshot).toHaveBeenCalledExactlyOnceWith(workspaceId, userId, campaignId);
    expect(html).toContain("Campaign: Synthetic café"); expect(html).toContain("contradictory links are excluded"); expect(html).toContain("All workspace data");
    expect(html).toContain(`href="/analytics?workspaceId=${workspaceId}&amp;campaignId=${campaignId}"`);
    for (const format of ["json", "csv"]) expect(html).toContain(`href="/api/v1/analytics/export?workspaceId=${workspaceId}&amp;format=${format}&amp;campaignId=${campaignId}" download=""`);
  });
  it("rejects revoked, foreign and wrong-filter snapshots", async () => {
    for (const data of [undefined, { ...snapshot(), workspaceId: campaignId }, { ...snapshot(), campaign: { id: campaignId, name: "Foreign selection" } }]) {
      mocks.getSnapshot.mockResolvedValue(data); await expect(page()).rejects.toThrow("not-found");
    }
    mocks.getSnapshot.mockResolvedValue(snapshot()); await expect(page({ campaignId })).rejects.toThrow("not-found");
  });
  it("does not turn persistence failure into an empty report", async () => {
    mocks.getSnapshot.mockRejectedValue(new Error("synthetic unavailable")); await expect(page()).rejects.toThrow("synthetic unavailable");
  });
  it("renders exact amounts by currency/source and provider totals separately without inferred rates", async () => {
    const data = snapshot(); data.totals = { campaignRuns: "23", publicationActions: "3", measurementEvents: "205", providerMetricRows: "2" };
    data.runStatuses = [{ status: "completed", count: "23" }]; data.publicationStatuses = [{ provider: "mastodon_account", status: "ambiguous", count: "3" }];
    data.measurements = { groupCount: "205", hasMore: true, items: [
      { eventType: "purchase", source: "synthetic_checkout", currency: "USD", eventCount: "4", valueCount: "3", valueTotal: "199999999999999.999997", firstOccurredAt: time, lastOccurredAt: time },
      { eventType: "purchase", source: "synthetic_checkout", currency: "EUR", eventCount: "1", valueCount: "1", valueTotal: "-0.000001", firstOccurredAt: time, lastOccurredAt: time },
      { eventType: "destination_visit", source: "<script>bad</script>", currency: null, eventCount: "2", valueCount: "0", valueTotal: null, firstOccurredAt: time, lastOccurredAt: time },
      { eventType: "complaint", source: "import", currency: null, eventCount: "1", valueCount: "1", valueTotal: "0.000000", firstOccurredAt: time, lastOccurredAt: time },
    ] };
    data.providerMetrics = [{ provider: "mastodon_account", metricType: "mastodon_favourite", metricTotal: "18014398509481982", publicationCount: "2", firstObservedAt: time, lastObservedAt: time }];
    data.recentRuns = { hasMore: true, items: [{ id: runId, campaignId, campaignVersionId: userId, campaignName: "Synthetic café <img>", status: "completed", createdAt: time }] };
    mocks.getSnapshot.mockResolvedValue(data); const html = renderToStaticMarkup(await page());
    for (const text of ["199,999,999,999,999.999997", "-0.000001", "18,014,398,509,481,982", "Recorded value (USD)", "Recorded value (EUR)", "No value recorded", "0.000000", "Recorded negative feedback", "Recorded engagement", "Recorded business outcomes", "Outcome uncertain", "more groups are not shown", "older runs are not listed", "not unique people across this workspace"]) expect(html).toContain(text);
    expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;"); expect(html).not.toContain("<script>bad"); expect(html).toContain("Synthetic café &lt;img&gt;");
    expect(html).toContain(`href="/campaign-instances/${runId}"`); expect(html).toContain(`href="/analytics?workspaceId=${workspaceId}&amp;campaignId=${campaignId}"`);
    expect(html).toContain('data-prefetch="false"'); expect(html).toContain("<details>"); expect(html).toContain(`dateTime="${time}"`);
    expect(html).not.toContain("Conversion rate"); expect(html).not.toContain("100%");
  });
});
