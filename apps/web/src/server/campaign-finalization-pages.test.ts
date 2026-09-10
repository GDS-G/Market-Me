import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), preparation: vi.fn(), receipt: vi.fn(), forCampaign: vi.fn(), campaign: vi.fn(), runs: vi.fn(), options: vi.fn(), packages: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error("redirect:" + path); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/database", () => ({
  getRepository: () => ({ listContentPackages: mocks.packages }),
  getCampaignPreparationRepository: () => ({ get: mocks.preparation }),
  getCampaignFinalizationRepository: () => ({ get: mocks.receipt, getForCampaign: mocks.forCampaign }),
  getCampaignRepository: () => ({ getCampaign: mocks.campaign, listCampaignInstances: mocks.runs, listDestinations: vi.fn().mockResolvedValue([]) }),
  getDraftRepository: () => ({ listCampaignPreviewOptions: mocks.options }),
  getProfileRepository: () => ({ listBrandProfiles: vi.fn().mockResolvedValue([]), listAudienceProfiles: vi.fn().mockResolvedValue([]) }),
  getPublishingRepository: () => ({ listChannelConnections: vi.fn().mockResolvedValue([]) }),
}));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => createElement("main", {}, children) }));
vi.mock("@/components/campaign-preparation-request", () => import("../components/campaign-preparation-request"));
vi.mock("@/components/campaign-finalization-request", () => import("../components/campaign-finalization-request"));
vi.mock("@/components/campaign-finalization-form", () => ({ CampaignFinalizationForm: (props: Record<string, unknown>) => createElement("form", { "data-finalizer": true }, JSON.stringify(props)) }));
vi.mock("@/components/campaign-finalization-result", () => ({ CampaignFinalizationResult: (props: { canWrite: boolean }) => createElement("section", { "data-protected": true, "data-can-write": props.canWrite }, "Protected receipt") }));
vi.mock("@/components/campaign-form", () => ({ CampaignForm: () => createElement("form", { "data-advanced": true }, "Advanced editor") }));

import FinalizePage from "../app/campaigns/preparations/[id]/finalize/page";
import ResultPage from "../app/campaigns/finalizations/[id]/page";
import EditPage from "../app/campaigns/[id]/edit/page";

const uuid = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const workspaceId = uuid(1), userId = uuid(2), preparationId = uuid(3), campaignId = uuid(4), versionId = uuid(5), draftId = uuid(6), finalizationId = uuid(7);
const preparation = { id: preparationId, workspaceId, campaignId, planningVersionId: versionId, generationId: uuid(9),
  configurationSnapshot: { name: "Prepared café 🚀" }, referenceSnapshot: { audiences: [{ name: "Original audience" }] }, preparedDrafts: [{ draftId, versionId: uuid(8) }] };
const receipt = { id: finalizationId, workspaceId, campaignId, compiledDefinition: { name: "Protected café 🚀" } };
const pageInput = (id = preparationId, selectedWorkspace: string | string[] | undefined = workspaceId) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ workspaceId: selectedWorkspace }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: userId, displayName: "QA user" }); mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA workspace", role: "editor" });
  mocks.preparation.mockResolvedValue(preparation); mocks.receipt.mockResolvedValue(receipt); mocks.forCampaign.mockResolvedValue(undefined);
  mocks.campaign.mockResolvedValue({ id: campaignId, workspaceId, name: "Current campaign", currentVersion: { id: versionId, versionNumber: 1 } });
  mocks.runs.mockResolvedValue([]); mocks.options.mockResolvedValue([]); mocks.packages.mockResolvedValue([]);
});

describe("scoped finalizer pages", () => {
  it.each(["owner", "admin", "editor"])("shows %s an explicit empty picker and prepared draft links without publishing", async (role) => {
    mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA", role });
    const html = renderToStaticMarkup(await FinalizePage(pageInput()));
    expect(html).toContain('data-finalizer="true"'); expect(html).toContain(`href="/drafts/${draftId}"`); expect(html).toContain("Original audience");
    expect(html).toContain("&quot;choices&quot;:[]"); expect(html).not.toContain("Activate this version");
    expect(mocks.options).toHaveBeenCalledExactlyOnceWith(workspaceId, campaignId);
  });
  it.each(["viewer", "approver"])("keeps finalization controls closed for %s", async (role) => {
    mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA", role });
    const html = renderToStaticMarkup(await FinalizePage(pageInput()));
    expect(html).toContain("Writer access required"); expect(html).not.toContain("<form"); expect(mocks.options).not.toHaveBeenCalled();
  });
  it.each([FinalizePage, ResultPage])("requires authentication and a current workspace", async (page) => {
    mocks.user.mockResolvedValue(undefined); await expect(page(pageInput())).rejects.toThrow("redirect:/login");
    mocks.user.mockResolvedValue({ id: userId }); mocks.workspace.mockResolvedValue(undefined); await expect(page(pageInput())).rejects.toThrow("redirect:/login");
    expect(mocks.preparation).not.toHaveBeenCalled(); expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it.each([undefined, "bad", [workspaceId], uuid(9)])("rejects missing, invalid or nonselected workspace %s before repository reads", async (value) => {
    for (const page of [FinalizePage, ResultPage]) await expect(page({ params: Promise.resolve({ id: preparationId }), searchParams: Promise.resolve({ workspaceId: value }) })).rejects.toThrow("not-found");
    expect(mocks.preparation).not.toHaveBeenCalled(); expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it("validates route UUIDs before database reads", async () => {
    for (const page of [FinalizePage, ResultPage]) await expect(page(pageInput("bad"))).rejects.toThrow("not-found");
    await expect(EditPage({ params: Promise.resolve({ id: "bad" }) })).rejects.toThrow("not-found");
    expect(mocks.preparation).not.toHaveBeenCalled(); expect(mocks.receipt).not.toHaveBeenCalled(); expect(mocks.campaign).not.toHaveBeenCalled();
  });
  it("finds an existing durable result even after the browser recovery copy is gone", async () => {
    mocks.forCampaign.mockResolvedValue(receipt);
    await expect(FinalizePage(pageInput())).rejects.toThrow(`redirect:/campaigns/finalizations/${finalizationId}?workspaceId=${workspaceId}`);
    expect(mocks.forCampaign).toHaveBeenCalledExactlyOnceWith(workspaceId, campaignId, userId); expect(mocks.options).not.toHaveBeenCalled();
  });
  it("rejects mismatched preparation identity before reading previews", async () => {
    mocks.preparation.mockResolvedValue({ ...preparation, workspaceId: uuid(9) });
    await expect(FinalizePage(pageInput())).rejects.toThrow("not-found"); expect(mocks.options).not.toHaveBeenCalled();
  });
  it("reads the exact result with current user membership and current campaign state separately", async () => {
    const html = renderToStaticMarkup(await ResultPage(pageInput(finalizationId)));
    expect(mocks.receipt).toHaveBeenCalledExactlyOnceWith(workspaceId, finalizationId, userId);
    expect(mocks.campaign).toHaveBeenCalledWith(workspaceId, campaignId); expect(mocks.runs).toHaveBeenCalledWith(workspaceId);
    expect(html).toContain("Protected café 🚀"); expect(html).toContain('data-can-write="true"');
  });
  it("rejects unavailable result before loading a campaign", async () => {
    mocks.receipt.mockResolvedValue(undefined); await expect(ResultPage(pageInput(finalizationId))).rejects.toThrow("not-found"); expect(mocks.campaign).not.toHaveBeenCalled();
  });
});

describe("protected campaign editor handoff", () => {
  it("renders the original receipt and direct controls instead of a save-first advanced editor", async () => {
    mocks.forCampaign.mockResolvedValue(receipt);
    const html = renderToStaticMarkup(await EditPage({ params: Promise.resolve({ id: campaignId }) }));
    expect(html).toContain("Advanced editing is unavailable"); expect(html).toContain("Original finalization receipt");
    expect(html).toContain('data-protected="true"'); expect(html).not.toContain("data-advanced");
    expect(mocks.packages).not.toHaveBeenCalled(); expect(mocks.options).not.toHaveBeenCalled();
  });
  it("does not expose protected action controls to a reader", async () => {
    mocks.forCampaign.mockResolvedValue(receipt); mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA", role: "viewer" });
    const html = renderToStaticMarkup(await EditPage({ params: Promise.resolve({ id: campaignId }) }));
    expect(html).toContain('data-can-write="false"'); expect(html).not.toContain("data-advanced");
  });
  it("retains the existing editor only for campaigns without protected provenance", async () => {
    const html = renderToStaticMarkup(await EditPage({ params: Promise.resolve({ id: campaignId }) }));
    expect(html).toContain('data-advanced="true"'); expect(html).not.toContain("data-protected");
  });
});
