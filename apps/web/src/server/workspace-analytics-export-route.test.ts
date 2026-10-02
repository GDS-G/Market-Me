import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceAnalyticsSnapshot } from "@market-me/database";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), getSnapshot: vi.fn() }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/database", () => ({ getWorkspaceAnalyticsRepository: () => mocks }));
vi.mock("@/server/workspace-analytics-export", () => import("./workspace-analytics-export"));
import { GET } from "../app/api/v1/analytics/export/route";
const userId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222", campaignId = "33333333-3333-4333-8333-333333333333";
function snapshot(): WorkspaceAnalyticsSnapshot { return { schemaVersion: 1, workspaceId, campaign: null, observedAt: "2026-10-01T12:00:00Z", totals: { campaignRuns: "0", publicationActions: "0", measurementEvents: "0", providerMetricRows: "0" }, runStatuses: [], publicationStatuses: [], measurements: { groupCount: "0", hasMore: false, items: [] }, providerMetrics: [], recentRuns: { hasMore: false, items: [] } }; }
const request = (query = `workspaceId=${workspaceId}&format=json`, site?: string) => new Request(`https://example.invalid/api/v1/analytics/export?${query}`, { headers: site ? { "sec-fetch-site": site } : {} });
function privateResponse(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin"); expect(response.headers.get("vary")).toBe("Cookie");
  expect(response.headers.has("access-control-allow-origin")).toBe(false); expect(response.headers.has("set-cookie")).toBe(false);
}
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: userId }); mocks.workspace.mockResolvedValue({ workspaceId, role: "viewer" }); mocks.getSnapshot.mockResolvedValue(snapshot()); });
describe("private current-member Analytics download", () => {
  it.each(["owner", "admin", "editor", "approver", "analyst", "viewer"])("downloads for current %s membership with the authenticated actor only", async role => {
    mocks.workspace.mockResolvedValue({ workspaceId, role }); const result = await GET(request()); expect(result.status).toBe(200); privateResponse(result);
    expect(mocks.workspace).toHaveBeenCalledExactlyOnceWith(userId); expect(mocks.getSnapshot).toHaveBeenCalledExactlyOnceWith(workspaceId, userId, undefined);
    expect(result.headers.get("content-disposition")).toBe(`attachment; filename="market-me-analytics-${workspaceId}-workspace.json"`);
    expect((await result.json()).snapshot).toEqual(snapshot());
  });
  it.each(["json", "csv"])("retains exact Campaign selection in %s attachment and never uses the label as a filename", async format => {
    mocks.getSnapshot.mockResolvedValue({ ...snapshot(), campaign: { id: campaignId, name: 'Bad"\r\nX-Header: value' } });
    const response = await GET(request(`workspaceId=${workspaceId}&format=${format}&campaignId=${campaignId}`, "same-origin")); expect(response.status).toBe(200); privateResponse(response);
    expect(mocks.getSnapshot).toHaveBeenCalledWith(workspaceId, userId, campaignId); expect(response.headers.get("content-disposition")).toBe(`attachment; filename="market-me-analytics-${workspaceId}-campaign-${campaignId}.${format}"`);
    expect(response.headers.get("content-type")).toBe(format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8");
  });
  it("authenticates before resolving selection or querying", async () => {
    mocks.user.mockResolvedValue(undefined); const response = await GET(request()); expect(response.status).toBe(401); privateResponse(response);
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.getSnapshot).not.toHaveBeenCalled(); expect(response.headers.has("content-disposition")).toBe(false);
  });
  it("rejects unavailable active selection", async () => { mocks.workspace.mockResolvedValue(undefined); const response = await GET(request()); expect(response.status).toBe(404); privateResponse(response); expect(mocks.getSnapshot).not.toHaveBeenCalled(); });
  it.each(["cross-site", "same-site", "unexpected"])("rejects %s fetch metadata before authentication", async site => { const response = await GET(request(undefined, site)); expect(response.status).toBe(403); privateResponse(response); expect(mocks.user).not.toHaveBeenCalled(); });
  it("permits deliberate direct navigation without treating fetch metadata as authentication", async () => { expect((await GET(request(undefined, "none"))).status).toBe(200); mocks.user.mockResolvedValue(undefined); expect((await GET(request(undefined, "none"))).status).toBe(401); });
  it.each(["format=json", `workspaceId=${campaignId}&format=json`, `workspaceId=${workspaceId}&format=csv&format=json`, `workspaceId=${workspaceId}&format=json&campaignId=bad`, `workspaceId=${workspaceId}&format=json&role=owner`])("rejects invalid scope %s without querying", async query => {
    const response = await GET(request(query)); expect(response.status).toBe(400); privateResponse(response); expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });
  it("rejects revoked membership, foreign workspace and mismatched Campaign output", async () => {
    for (const data of [undefined, { ...snapshot(), workspaceId: campaignId }, { ...snapshot(), campaign: { id: campaignId, name: "wrong" } }]) {
      mocks.getSnapshot.mockResolvedValue(data); const response = await GET(request()); expect(response.status).toBe(404); privateResponse(response); expect(response.headers.has("content-disposition")).toBe(false);
    }
    mocks.getSnapshot.mockResolvedValue(snapshot()); expect((await GET(request(`workspaceId=${workspaceId}&format=json&campaignId=${campaignId}`))).status).toBe(404);
  });
  it("obtains a new authorized snapshot on every download rather than caching the prior grant", async () => {
    expect((await GET(request())).status).toBe(200); mocks.getSnapshot.mockResolvedValue(undefined); expect((await GET(request())).status).toBe(404); expect(mocks.getSnapshot).toHaveBeenCalledTimes(2);
  });
  it.each(["user", "workspace", "getSnapshot"] as const)("does not disclose %s private errors in responses or logs", async key => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined); mocks[key].mockRejectedValue(new Error("private SQL credentials source labels"));
    const response = await GET(request()); expect(response.status).toBe(503); privateResponse(response); expect(await response.text()).not.toContain("private SQL"); expect(log).not.toHaveBeenCalled(); log.mockRestore();
  });
  it("fails closed on oversized output and malformed exact numbers, never returning partial downloads", async () => {
    for (const data of [{ ...snapshot(), campaign: { id: campaignId, name: "é".repeat(1_048_576) } }, { ...snapshot(), totals: { ...snapshot().totals, campaignRuns: "=SUM(1,2)" } }]) {
      mocks.getSnapshot.mockResolvedValue(data); const response = await GET(request(`workspaceId=${workspaceId}&format=json${data.campaign ? `&campaignId=${campaignId}` : ""}`));
      expect(response.status).toBe(503); privateResponse(response); expect(response.headers.has("content-disposition")).toBe(false); expect((await response.text()).length).toBeLessThan(250);
    }
  });
});
