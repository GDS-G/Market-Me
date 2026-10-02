import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignVersion } from "@market-me/domain";
import type { StoredCampaign } from "@market-me/database";

const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), campaign: vi.fn(), finalization: vi.fn(), packages: vi.fn(),
  destinations: vi.fn(), connections: vi.fn(), brands: vi.fn(), audiences: vi.fn(), previews: vi.fn(), campaigns: vi.fn(), runs: vi.fn(), preparations: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/database", () => ({
  getRepository: () => ({ listContentPackages: mocks.packages }),
  getCampaignRepository: () => ({ getCampaign: mocks.campaign, listDestinations: mocks.destinations, listCampaigns: mocks.campaigns, listCampaignInstances: mocks.runs }),
  getCampaignFinalizationRepository: () => ({ getForCampaign: mocks.finalization }),
  getCampaignPreparationRepository: () => ({ listForWorkspace: mocks.preparations }),
  getDraftRepository: () => ({ listCampaignPreviewOptions: mocks.previews }),
  getProfileRepository: () => ({ listBrandProfiles: mocks.brands, listAudienceProfiles: mocks.audiences }),
  getPublishingRepository: () => ({ listChannelConnections: mocks.connections }),
}));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => createElement("main", {}, children) }));
vi.mock("@/components/campaign-form", () => ({ CampaignForm: () => createElement("form", { "data-advanced": true }, "Advanced writer editor") }));
vi.mock("@/components/campaign-finalization-result", () => ({ CampaignFinalizationResult: () => createElement("section", {}, "Protected finalization controls") }));
vi.mock("../components/campaign-inspection.module.css", () => ({ default: {} }));
vi.mock("@/components/campaign-inspection", () => import("../components/campaign-inspection"));
vi.mock("@/components/campaign-inspection-path", () => import("../components/campaign-inspection-path"));
vi.mock("@/components/campaign-preparation-request", () => import("../components/campaign-preparation-request"));
vi.mock("@/components/campaign-finalization-request", () => import("../components/campaign-finalization-request"));
vi.mock("@/server/workspace-analytics-view", () => import("./workspace-analytics-view"));
import DetailPage from "../app/campaigns/[id]/page";
import EditPage from "../app/campaigns/[id]/edit/page";
import NewPage from "../app/campaigns/new/page";
import ListPage from "../app/campaigns/page";
import { campaignInspectionPath } from "../components/campaign-inspection-path";

const uuid = (n: string) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const workspaceId = uuid("a"), campaignId = uuid("b"), userId = uuid("c");
const version: CampaignVersion = { id: uuid("d"), campaignId, versionNumber: 1, status: "published", objective: "awareness", contentPackageIds: [],
  audienceProfileVersionIds: [], informationDepth: "contextual", promotionalStrength: "light", autonomyMode: "approval_required", timezone: "UTC",
  context: {}, successCriteria: [], successAction: "notify_only", steps: [], createdAt: "2026-10-02T00:00:00Z" };
const campaign: StoredCampaign = { id: campaignId, workspaceId, name: "Scoped café <script>name</script>", description: "Read-only summary", status: "scheduled",
  currentVersion: version, createdBy: userId, createdAt: version.createdAt, updatedAt: version.createdAt };
const input = (id = campaignId, query: Record<string, unknown> = { workspaceId }) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query as Record<string, string | string[] | undefined>) });
const candidateReads = () => [mocks.packages, mocks.destinations, mocks.connections, mocks.brands, mocks.audiences, mocks.previews];
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: userId, displayName: "QA" });
  mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA", role: "editor" });
  mocks.campaign.mockResolvedValue(campaign); mocks.finalization.mockResolvedValue(undefined); mocks.campaigns.mockResolvedValue([campaign]);
  for (const read of [...candidateReads(), mocks.runs, mocks.preparations]) read.mockResolvedValue([]);
});

describe("scoped read-only Campaign inspection pages", () => {
  it.each(["owner", "admin", "editor"])("offers %s explicit separate editor/review links but no mutation form", async role => {
    mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA", role });
    const html = renderToStaticMarkup(await DetailPage(input()));
    expect(html).toContain("Open advanced editor"); expect(html).toContain("Review published-version activation"); expect(html).not.toContain("<form");
    expect(html).toContain(`expectedVersionId=${version.id}`); expect(html).toContain("&lt;script&gt;name&lt;/script&gt;");
    expect(mocks.campaign).toHaveBeenCalledExactlyOnceWith(workspaceId, campaignId);
    expect(mocks.finalization).toHaveBeenCalledExactlyOnceWith(workspaceId, campaignId, userId);
    candidateReads().forEach(read => expect(read).not.toHaveBeenCalled());
  });
  it.each(["viewer", "approver", "analyst", "unknown"])("keeps %s read-only and redirects the old editor before candidate loading", async role => {
    mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA", role });
    const html = renderToStaticMarkup(await DetailPage(input()));
    expect(html).toContain("Read-only access"); expect(html).not.toContain("Open advanced editor"); expect(html).not.toContain("Review published-version activation");
    await expect(EditPage({ params: Promise.resolve({ id: campaignId }) })).rejects.toThrow(`redirect:${campaignInspectionPath(workspaceId, campaignId)}`);
    const newHtml = renderToStaticMarkup(await NewPage()); expect(newHtml).toContain("Writer access required"); expect(newHtml).not.toContain("<form");
    candidateReads().forEach(read => expect(read).not.toHaveBeenCalled());
  });
  it.each(["owner", "admin", "editor"])("preserves new-Campaign creation for current %s", async role => {
    mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA", role });
    expect(renderToStaticMarkup(await NewPage())).toContain('data-advanced="true"');
    expect(mocks.packages).toHaveBeenCalledExactlyOnceWith(workspaceId);
  });
  it.each([{}, { workspaceId: workspaceId.toUpperCase() }])("accepts direct current-workspace or normalized selection hints %#", async query => {
    expect(renderToStaticMarkup(await DetailPage(input(campaignId.toUpperCase(), query)))).toContain("Published plan");
  });
  it.each([{ workspaceId: "bad" }, { workspaceId: [workspaceId] }, { workspaceId: uuid("e") }, { workspaceId, actorId: userId }, { workspaceId, expectedVersionId: version.id }])("rejects ambiguous or foreign query %# before reads", async query => {
    await expect(DetailPage(input(campaignId, query))).rejects.toThrow("not-found");
    expect(mocks.campaign).not.toHaveBeenCalled(); expect(mocks.finalization).not.toHaveBeenCalled();
  });
  it("rejects malformed path identity before reads", async () => {
    await expect(DetailPage(input("bad"))).rejects.toThrow("not-found"); expect(mocks.campaign).not.toHaveBeenCalled();
  });
  it.each([undefined, { ...campaign, id: uuid("e") }, { ...campaign, workspaceId: uuid("e") }])("rejects unavailable or inconsistent Campaign identity %#", async value => {
    mocks.campaign.mockResolvedValue(value); await expect(DetailPage(input())).rejects.toThrow("not-found"); expect(mocks.finalization).not.toHaveBeenCalled();
  });
  it("preserves protected finalization routing without new activation/editor bypasses", async () => {
    mocks.finalization.mockResolvedValue({ id: uuid("f"), workspaceId, campaignId });
    const html = renderToStaticMarkup(await DetailPage(input())); expect(html).toContain("Protected exact-preview plan");
    expect(html).toContain(`/campaigns/finalizations/${uuid("f")}?workspaceId=${workspaceId}`);
    expect(html).not.toContain("Open advanced editor"); expect(html).not.toContain("Review published-version activation");
  });
  it("rejects an inconsistent protected receipt", async () => {
    mocks.finalization.mockResolvedValue({ id: uuid("f"), workspaceId: uuid("e"), campaignId }); await expect(DetailPage(input())).rejects.toThrow("not-found");
  });
  it("does not offer activation for draft-only, missing or inconsistent published versions", async () => {
    for (const currentVersion of [undefined, { ...version, autonomyMode: "draft_only" }, { ...version, status: "superseded" }, { ...version, campaignId: uuid("e") }]) {
      mocks.campaign.mockResolvedValue({ ...campaign, currentVersion });
      expect(renderToStaticMarkup(await DetailPage(input()))).not.toContain("Review published-version activation");
    }
  });
  it("withholds new action links for archived campaigns", async () => {
    mocks.campaign.mockResolvedValue({ ...campaign, status: "archived" }); const html = renderToStaticMarkup(await DetailPage(input()));
    expect(html).toContain("inspection only"); expect(html).not.toContain("Open advanced editor"); expect(html).not.toContain("Review published-version activation");
  });
  it("requires authenticated current membership before reading or presenting candidates", async () => {
    mocks.user.mockResolvedValue(undefined); await expect(DetailPage(input())).rejects.toThrow("redirect:/login"); await expect(NewPage()).rejects.toThrow("redirect:/login");
    mocks.user.mockResolvedValue({ id: userId }); mocks.workspace.mockResolvedValue(undefined);
    await expect(DetailPage(input())).rejects.toThrow("redirect:/login"); await expect(NewPage()).rejects.toThrow("redirect:/login");
    expect(mocks.campaign).not.toHaveBeenCalled(); candidateReads().forEach(read => expect(read).not.toHaveBeenCalled());
  });
  it("routes list inspection through current workspace and counts published rather than draft steps", async () => {
    mocks.campaigns.mockResolvedValue([{ ...campaign, draftVersion: { ...version, steps: Array.from({ length: 7 }, () => ({})) } }]);
    const html = renderToStaticMarkup(await ListPage());
    expect(html).toContain(campaignInspectionPath(workspaceId, campaignId)); expect(html).toContain("Inspect Scoped café");
    expect(html).toContain("Published steps</span><strong>0</strong>"); expect(html).not.toContain(`href="/campaigns/${campaignId}/edit"`);
  });
});
