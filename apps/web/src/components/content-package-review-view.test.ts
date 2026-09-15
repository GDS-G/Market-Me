import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PackageReviewSnapshot, PackageReviewState } from "./content-package-review-display";
import { PackageReviewMaterialForms, initialPackageRightsInput, packageRightsRequest } from "./content-package-review-material-forms";
import { canApprovePackage, canEditPackageAssets } from "./content-package-review-request";
import { isScopedPackageReview } from "./content-package-review-actions";
import { DraftGenerationForm } from "./draft-generation-form";
import { ApprovedPackageReviewPicker } from "./approved-package-review-picker";
import { reviewTestReview, reviewTestSnapshot, reviewTestScope, reviewTestUuid } from "./content-package-review.test-fixture";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("captured package review display", () => {
  it("shows selected winners and exclusions rather than treating every active fact as usable", () => {
    const html = renderToStaticMarkup(createElement(PackageReviewSnapshot, { snapshot: reviewTestSnapshot, effectiveEvidenceIds: [reviewTestUuid(6)], excludedEvidenceIds: [reviewTestUuid(7)] }));
    expect(html).toContain("Usable fact"); expect(html).toContain("Selected conflict winner"); expect(html).toContain("Excluded from generation");
    expect(html).toContain("Admission costs $5."); expect(html).toContain("excluded candidate"); expect(html).toContain("source:loser");
  });
  it("preserves complete captured text, raw JSON keys, bigint decimal bytes and UTC microseconds", () => {
    const html = renderToStaticMarkup(createElement(PackageReviewSnapshot, { snapshot: reviewTestSnapshot, effectiveEvidenceIds: [] }));
    expect(html).toContain("END OF COMPLETE CAPTURE"); expect(html).toContain("expandable, not truncated"); expect(html).toContain("9007199254740993");
    expect(html).toContain("2026-09-15T15:30:42.654321Z"); expect(html).toContain("raw_key"); expect(html).toContain("&lt;script&gt;never execute&lt;/script&gt;"); expect(html).not.toContain("<script>");
  });
  it("shows blockers against the captured token, with no approved-status shortcut", () => {
    const html = renderToStaticMarkup(createElement(PackageReviewState, { review: { ...reviewTestReview, status: "approved", historicalApproval: true } }));
    expect(html).toContain("Historical approval is unverified"); expect(html).toContain("no verifiable original review receipt"); expect(html).toContain(reviewTestReview.reviewFingerprint);
    expect(html).toContain("Resolve the captured opening time"); expect(html).toContain(`#evidence-${reviewTestUuid(8)}`);
    expect(html).not.toContain("Current exact review approved");
  });
  it("does not invent a missing candidate's captured claim", () => {
    const snapshot = { ...reviewTestSnapshot, evidence: reviewTestSnapshot.evidence.filter((item) => item.id !== reviewTestUuid(7)) };
    const html = renderToStaticMarkup(createElement(PackageReviewSnapshot, { snapshot, effectiveEvidenceIds: [] }));
    expect(html).toContain(`Unavailable captured evidence ${reviewTestUuid(7)}`);
  });
  it.each(["owner", "admin", "approver", "editor", "viewer"])("separates %s fact and asset controls", (role) => {
    const html = renderToStaticMarkup(createElement(PackageReviewMaterialForms, { snapshot: reviewTestSnapshot, canApprove: canApprovePackage(role), canEdit: canEditPackageAssets(role), disabled: false,
      mutate: vi.fn(), channelConnections: [], campaigns: [], brandProfiles: [] }));
    expect(html.includes("Record correction")).toBe(["owner", "admin", "approver"].includes(role));
    expect(html.includes("Save rights review")).toBe(["owner", "admin", "editor"].includes(role));
    expect(html.includes("Save accessibility review")).toBe(["owner", "admin", "editor"].includes(role));
  });
  it("disabled stale or pending material forms cannot submit, retaining exact raw field values", () => {
    const html = renderToStaticMarkup(createElement(PackageReviewMaterialForms, { snapshot: reviewTestSnapshot, canApprove: true, canEdit: true, disabled: true,
      mutate: vi.fn(), channelConnections: [], campaigns: [], brandProfiles: [] }));
    expect(html).toContain("disabled=\"\""); expect(html).toContain("2027-01-01T00:00:00.987654Z"); expect(html).toContain("Unavailable captured scope"); expect(html).toContain("Retain captured notes.");
  });
  it("does not alter microseconds, unknown saved scopes, or array order when preparing a rights edit", () => {
    const values = initialPackageRightsInput(reviewTestSnapshot.assets[0]!);
    const request = packageRightsRequest(values);
    expect(request.validFrom).toBe("2026-01-01T00:00:00.123456Z"); expect(request.expiresAt).toBe("2027-01-01T00:00:00.987654Z");
    expect(request.permittedChannels).toEqual(["mastodon_account"]); expect(request.permittedChannelConnectionIds).toEqual([reviewTestUuid(9)]);
    values.permittedChannels.push("discord_webhook"); expect(reviewTestSnapshot.assets[0]!.rights.permittedChannels).toEqual(["mastodon_account"]);
  });
  it("requires coherent scope/version/token and rejects mixed or missing responses", () => {
    expect(isScopedPackageReview(reviewTestReview, reviewTestScope)).toBe(true);
    for (const value of [undefined, {}, { ...reviewTestReview, version: 3 }, { ...reviewTestReview, reviewFingerprint: "status-only" },
      { ...reviewTestReview, snapshot: { ...reviewTestSnapshot, package: { ...reviewTestSnapshot.package, workspaceId: reviewTestUuid(9) } } }]) expect(isScopedPackageReview(value, reviewTestScope)).toBe(false);
  });
  it("never implicitly picks a generation Campaign/package or presents a list option as approval proof", () => {
    const html = renderToStaticMarkup(createElement(DraftGenerationForm, { workspaceId: reviewTestScope.workspaceId, campaigns: [{ id: reviewTestUuid(8), name: "Published plan", packages: [{ id: reviewTestScope.packageId, title: "List title" }] }] }));
    expect(html).toContain("Choose a published Campaign"); expect(html).toContain("Choose a bound package"); expect(html).toContain("Load exact approved package review");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Generate governed drafts/);
    expect(html).not.toContain("Current exact review approved");
  });
  it("an unloaded review picker offers an explicit GET only, with no hidden token or mutation", () => {
    const html = renderToStaticMarkup(createElement(ApprovedPackageReviewPicker, { workspaceId: reviewTestScope.workspaceId, packageId: reviewTestScope.packageId, disabled: false, onReview: vi.fn() }));
    expect(html).toContain("Load exact approved package review"); expect(html).toContain("Package-list names and status are not proof"); expect(html).not.toContain("sha256:");
  });
});
