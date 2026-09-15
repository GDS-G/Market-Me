import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentPackageReviewError } from "@market-me/database";
import { reviewTestApproval, reviewTestReview, reviewTestScope, reviewTestUuid } from "../components/content-package-review.test-fixture";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), review: vi.fn(), history: vi.fn(), approval: vi.fn(), legacyGet: vi.fn(), connections: vi.fn(), campaigns: vi.fn(), brands: vi.fn(), preview: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/media", () => ({ createAssetPreviewUrl: mocks.preview }));
vi.mock("@/server/database", () => ({ getContentPackageReviewRepository: () => ({ getReview: mocks.review, listApprovalSummaries: mocks.history, getApproval: mocks.approval }),
  getRepository: () => ({ getContentPackage: mocks.legacyGet }), getPublishingRepository: () => ({ listChannelConnections: mocks.connections }), getCampaignRepository: () => ({ listCampaigns: mocks.campaigns }), getProfileRepository: () => ({ listBrandProfiles: mocks.brands }) }));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => createElement("main", {}, children) }));
vi.mock("@/components/content-package-review-request", () => import("../components/content-package-review-request"));
vi.mock("@/components/content-package-review-actions", () => ({ ContentPackageReviewActions: (props: { role: string; initialReview: unknown }) => createElement("div", { "data-role": props.role }, JSON.stringify(props.initialReview)) }));
vi.mock("@/components/content-package-review-display", () => ({ PackageReviewSnapshot: (props: { snapshot: unknown }) => createElement("div", {}, JSON.stringify(props.snapshot)) }));
import ReviewPage from "../app/content-packages/[id]/page";
import ApprovalPage from "../app/content-packages/[id]/approvals/[approvalId]/page";
const { userId, workspaceId, packageId } = reviewTestScope;
const approvalPage = (scope: string | string[] | undefined = workspaceId) => ApprovalPage({ params: Promise.resolve({ id: packageId, approvalId: reviewTestApproval.id }), searchParams: Promise.resolve({ workspaceId: scope }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: userId, displayName: "QA" }); mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "Scoped QA", role: "owner" });
  mocks.review.mockResolvedValue(reviewTestReview); mocks.history.mockResolvedValue([reviewTestApproval]); mocks.approval.mockResolvedValue(reviewTestApproval);
  mocks.connections.mockResolvedValue([]); mocks.campaigns.mockResolvedValue([]); mocks.brands.mockResolvedValue([]);
  mocks.legacyGet.mockRejectedValue(new Error("Never hydrate a review from the legacy DTO"));
});
describe("coherent package page authority", () => {
  it.each(["owner", "admin", "approver", "editor", "viewer"])("uses one complete captured review and passes current %s role", async (role) => {
    mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "Scoped QA", role });
    const html = renderToStaticMarkup(await ReviewPage({ params: Promise.resolve({ id: packageId }) }));
    expect(html).toContain(`data-role="${role}"`); expect(html).toContain("Captured café 🚀"); expect(html).toContain(reviewTestReview.reviewFingerprint);
    expect(mocks.review).toHaveBeenCalledExactlyOnceWith(workspaceId, packageId, userId); expect(mocks.history).toHaveBeenCalledWith(workspaceId, packageId, userId); expect(mocks.legacyGet).not.toHaveBeenCalled();
  });
  it("redirects missing identity/membership and rejects malformed route identity before DB", async () => {
    mocks.user.mockResolvedValue(undefined); await expect(ReviewPage({ params: Promise.resolve({ id: packageId }) })).rejects.toThrow("redirect:/login");
    mocks.user.mockResolvedValue({ id: userId }); mocks.workspace.mockResolvedValue(undefined); await expect(ReviewPage({ params: Promise.resolve({ id: packageId }) })).rejects.toThrow("redirect:/login");
    mocks.workspace.mockResolvedValue({ workspaceId }); await expect(ReviewPage({ params: Promise.resolve({ id: "bad" }) })).rejects.toThrow("not-found"); expect(mocks.review).not.toHaveBeenCalled();
  });
  it.each([undefined, { ...reviewTestReview, snapshot: { ...reviewTestReview.snapshot, package: { ...reviewTestReview.snapshot.package, workspaceId: reviewTestUuid(9) } } }])("does not show unavailable or foreign review bytes", async (value) => {
    mocks.review.mockResolvedValue(value); await expect(ReviewPage({ params: Promise.resolve({ id: packageId }) })).rejects.toThrow("not-found"); expect(mocks.connections).not.toHaveBeenCalled();
  });
  it("fails closed with an honest complete-review error instead of a partial token", async () => {
    mocks.review.mockRejectedValue(new ContentPackageReviewError("review_snapshot_too_large", "The exact snapshot exceeds the supported review limit."));
    const html = renderToStaticMarkup(await ReviewPage({ params: Promise.resolve({ id: packageId }) }));
    expect(html).toContain("Exact review unavailable"); expect(html).toContain("No partial snapshot or approval token"); expect(html).not.toContain(reviewTestReview.reviewFingerprint); expect(mocks.history).not.toHaveBeenCalled();
  });
});
describe("immutable original package approval page", () => {
  it("loads only the retained receipt and never substitutes current live children", async () => {
    const html = renderToStaticMarkup(await approvalPage());
    expect(mocks.approval).toHaveBeenCalledExactlyOnceWith(workspaceId, reviewTestApproval.id, userId); expect(mocks.review).not.toHaveBeenCalled(); expect(mocks.legacyGet).not.toHaveBeenCalled();
    expect(html).toContain("Historical attestation, not current permission"); expect(html).toContain("2026-09-15T15:30:42.654321Z"); expect(html).toContain("Captured café 🚀"); expect(html).toContain(reviewTestApproval.reviewFingerprint); expect(html).not.toContain("idempotencyKey");
  });
  it.each([undefined, "bad", [workspaceId], reviewTestUuid(9)])("requires an explicit selected workspace %s", async (scope) => {
    await expect(ApprovalPage({ params: Promise.resolve({ id: packageId, approvalId: reviewTestApproval.id }), searchParams: Promise.resolve({ workspaceId: scope }) })).rejects.toThrow("not-found"); expect(mocks.approval).not.toHaveBeenCalled();
  });
  it.each([undefined, { ...reviewTestApproval, contentPackageId: reviewTestUuid(9) }, { ...reviewTestApproval, workspaceId: reviewTestUuid(9) }])("does not leak mismatched historical receipts", async (value) => {
    mocks.approval.mockResolvedValue(value); await expect(approvalPage()).rejects.toThrow("not-found");
  });
});
