import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), packages: vi.fn(), brands: vi.fn(), audiences: vi.fn(), destinations: vi.fn(), get: vi.fn(), draft: vi.fn(), campaigns: vi.fn(), runs: vi.fn(), receipts: vi.fn(), drafts: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error("redirect:" + path); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/database", () => ({
  getRepository: () => ({ listContentPackages: mocks.packages }),
  getProfileRepository: () => ({ listBrandProfiles: mocks.brands, listAudienceProfiles: mocks.audiences }),
  getCampaignRepository: () => ({ listDestinations: mocks.destinations, listCampaigns: mocks.campaigns, listCampaignInstances: mocks.runs }),
  getCampaignPreparationRepository: () => ({ get: mocks.get, listForWorkspace: mocks.receipts }),
  getDraftRepository: () => ({ get: mocks.draft, list: mocks.drafts }),
}));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => createElement("main", {}, children) }));
vi.mock("@/components/campaign-preparation-request", () => import("../components/campaign-preparation-request"));
vi.mock("@/components/campaign-preparation-form", () => ({ CampaignPreparationForm: (props: { userId: string; workspaceId: string; packages: { id: string }[]; brands: { id: string }[]; audiences: { id: string }[]; destinations: { id: string }[] }) => createElement("form", { "data-user": props.userId, "data-workspace": props.workspaceId }, JSON.stringify(props)) }));
vi.mock("@/components/campaign-preparation-result", () => ({ CampaignPreparationResult: (props: { canWrite: boolean; availableDraftIds: string[] }) => createElement("section", { "data-can-write": props.canWrite }, props.availableDraftIds.join(",")) }));
vi.mock("@/components/draft-generation-form", () => ({ DraftGenerationForm: () => createElement("form", {}, "Existing plan generator") }));

import PreparePage from "../app/campaigns/prepare/page";
import ResultPage from "../app/campaigns/preparations/[id]/page";
import CampaignsPage from "../app/campaigns/page";
import DraftsPage from "../app/drafts/page";

const workspaceId = "11111111-1111-4111-8111-111111111111", userId = "22222222-2222-4222-8222-222222222222";
const packageId = "33333333-3333-4333-8333-333333333333", receiptId = "44444444-4444-4444-8444-444444444444";
const campaignId = "55555555-5555-4555-8555-555555555555";
const receipt = { id: receiptId, workspaceId, configurationSnapshot: { name: "Saved campaign", description: "" }, preparedDrafts: [{ draftId: "draft-1" }, { draftId: "missing" }] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: userId, displayName: "QA user" });
  mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA workspace", role: "editor" });
  mocks.packages.mockResolvedValue([{ id: packageId, title: "Approved source", version: 1, status: "approved" }, { id: campaignId, title: "Unapproved", version: 2, status: "needs_review" }]);
  mocks.brands.mockResolvedValue([]); mocks.audiences.mockResolvedValue([]); mocks.destinations.mockResolvedValue([]);
  mocks.get.mockResolvedValue(receipt); mocks.draft.mockImplementation(async (_workspace: string, id: string) => id === "draft-1" ? { id } : undefined);
  mocks.campaigns.mockResolvedValue([]); mocks.runs.mockResolvedValue([]); mocks.receipts.mockResolvedValue([]); mocks.drafts.mockResolvedValue([]);
});

describe("preparation entry authorization", () => {
  it.each(["owner", "admin", "editor"])("offers %s only approved packages and current published profiles", async (role) => {
    mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA", role });
    mocks.brands.mockResolvedValue([{ name: "Published Brand", status: "published", currentVersion: { id: "brand-good", versionNumber: 2, status: "published" } }, { name: "Draft Brand", status: "draft", currentVersion: { id: "brand-bad", versionNumber: 1, status: "published" } }]);
    mocks.audiences.mockResolvedValue([{ name: "Published audience", status: "published", currentVersion: { id: "audience-good", versionNumber: 1, status: "published" } }, { name: "Archived", status: "archived" }]);
    mocks.destinations.mockResolvedValue([{ id: "dest-good", title: "Published Destination", status: "published" }, { id: "dest-bad", title: "Draft Destination", status: "draft" }]);
    const html = renderToStaticMarkup(await PreparePage({ searchParams: Promise.resolve({ contentPackageId: packageId }) }));
    expect(html).toContain("<form"); expect(html).toContain("Approved source"); expect(html).not.toContain("Unapproved");
    expect(html).toContain("brand-good"); expect(html).not.toContain("brand-bad"); expect(html).toContain("audience-good"); expect(html).toContain("dest-good"); expect(html).not.toContain("dest-bad");
    expect(mocks.packages).toHaveBeenCalledWith(workspaceId);
  });
  it.each(["viewer", "approver"])("does not render preparation controls for %s", async (role) => {
    mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA", role });
    const html = renderToStaticMarkup(await PreparePage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Writer access required"); expect(html).not.toContain("<form");
    expect(renderToStaticMarkup(await CampaignsPage())).not.toContain('href="/campaigns/prepare"');
    expect(renderToStaticMarkup(await DraftsPage())).not.toContain('href="/campaigns/prepare"');
  });
  it("requires an authenticated current workspace", async () => {
    mocks.user.mockResolvedValue(undefined);
    await expect(PreparePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/login");
    expect(mocks.packages).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ id: userId }); mocks.workspace.mockResolvedValue(undefined);
    await expect(PreparePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/login");
  });
  it("rejects malformed package IDs before repository access and foreign IDs after scoped reads", async () => {
    await expect(PreparePage({ searchParams: Promise.resolve({ contentPackageId: "bad" }) })).rejects.toThrow("not-found");
    expect(mocks.packages).not.toHaveBeenCalled();
    await expect(PreparePage({ searchParams: Promise.resolve({ contentPackageId: receiptId }) })).rejects.toThrow("not-found");
  });
  it("shows one primary prepare entry in each writer empty state", async () => {
    for (const page of [CampaignsPage, DraftsPage]) {
      const html = renderToStaticMarkup(await page());
      expect(html.match(/href="\/campaigns\/prepare"/g)).toHaveLength(1);
    }
  });
  it("makes an original receipt discoverable from Campaigns without exposing its attempt key", async () => {
    mocks.campaigns.mockResolvedValue([{ id: campaignId, name: "Saved plan", description: "", status: "active", currentVersion: { versionNumber: 1, autonomyMode: "draft_only", steps: [] } }]);
    mocks.receipts.mockResolvedValue([{ id: receiptId, campaignId }]);
    const html = renderToStaticMarkup(await CampaignsPage());
    expect(html).toContain(`href="/campaigns/preparations/${receiptId}?workspaceId=${workspaceId}"`);
    expect(html).toContain("Original preparation receipt"); expect(html).toContain("Draft-only plan"); expect(html).not.toContain("idempotencyKey");
    expect(mocks.receipts).toHaveBeenCalledWith(workspaceId, userId);
  });
});
describe("scoped immutable result page", () => {
  it.each([undefined, "bad", [workspaceId], packageId])("rejects missing, malformed or foreign workspace %s before repository access", async (id) => {
    await expect(ResultPage({ params: Promise.resolve({ id: receiptId }), searchParams: Promise.resolve({ workspaceId: id }) })).rejects.toThrow("not-found");
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("rejects malformed receipt identity before the database", async () => {
    await expect(ResultPage({ params: Promise.resolve({ id: "not-a-uuid" }), searchParams: Promise.resolve({ workspaceId }) })).rejects.toThrow("not-found");
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("uses exact current membership and separates available drafts from inaccessible history", async () => {
    const html = renderToStaticMarkup(await ResultPage({ params: Promise.resolve({ id: receiptId }), searchParams: Promise.resolve({ workspaceId }) }));
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(workspaceId, receiptId, userId);
    expect(mocks.draft).toHaveBeenCalledWith(workspaceId, "draft-1"); expect(mocks.draft).toHaveBeenCalledWith(workspaceId, "missing");
    expect(html).toContain("draft-1"); expect(html).not.toContain("missing"); expect(html).toContain('data-can-write="true"');
  });
  it.each([undefined, { ...receipt, workspaceId: packageId }, { ...receipt, id: campaignId }])("refuses missing or mismatched stored receipt before draft lookups", async (value) => {
    mocks.get.mockResolvedValue(value);
    await expect(ResultPage({ params: Promise.resolve({ id: receiptId }), searchParams: Promise.resolve({ workspaceId }) })).rejects.toThrow("not-found");
    expect(mocks.draft).not.toHaveBeenCalled();
  });
});
