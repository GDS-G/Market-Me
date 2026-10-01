import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sourcePreparationPlanPreviewView } from "../server/source-preparation-view";
import { SourcePreparationPlanPreview } from "./source-preparation-plan-preview";
import { initialSourcePreparationBindingValues, isScopedSourcePreparationPlanPreview,
  sourcePreparationPlanPreviewRequest, sourcePreparationPlanPreviewRequestPath } from "./source-preparation-binding-request";
import { preparationPreviewFixture, previewReferenceId, previewSourceId, previewWorkspaceId } from "./source-preparation-preview.test-fixture";

const scope = { workspaceId: previewWorkspaceId, smartSourceId: previewSourceId };
const view = () => sourcePreparationPlanPreviewView(preparationPreviewFixture);

describe("preparation plan preview browser boundary", () => {
  it("requests one scoped preview with the current source version and only binding settings", () => {
    expect(sourcePreparationPlanPreviewRequestPath(scope))
      .toBe(`/api/v1/smart-sources/${previewSourceId}/preparation-binding/preview?workspaceId=${previewWorkspaceId}`);
    const values = { ...initialSourcePreparationBindingValues(previewWorkspaceId), expectedRevision: 3 };
    expect(JSON.parse(sourcePreparationPlanPreviewRequest(values, 2))).toEqual({ ...values, expectedSourceVersion: 2 });
    for (const version of [0, 1.5, Infinity, 2_147_483_648]) {
      expect(() => sourcePreparationPlanPreviewRequest(values, version)).toThrow("Invalid Smart Source version");
    }
  });

  it("projects labels in authored order while withholding resource and authority identities", () => {
    const projected = view();
    expect(isScopedSourcePreparationPlanPreview(projected, scope)).toBe(true);
    expect(projected.draftVariants.map((variant) => variant.label)).toEqual(["Community", "Customers"]);
    expect(JSON.stringify(projected)).not.toContain(previewReferenceId);
    expect(projected).not.toHaveProperty("currentBindingRevision");
    expect(projected.source).not.toHaveProperty("id");
    expect(projected.brandProfile).not.toHaveProperty("versionId");
    expect(projected.destination).not.toHaveProperty("id");
    expect(projected.draftVariants[0]).not.toHaveProperty("audienceProfileVersionId");
  });

  it("rejects foreign scope, hidden fields, executable steps, and contradictory reference states", () => {
    const base = view();
    const malformed = [
      { ...base, workspaceId: previewReferenceId },
      { ...base, smartSourceId: previewReferenceId },
      { ...base, writerUserId: previewReferenceId },
      { ...base, brandProfile: { ...base.brandProfile, versionId: previewReferenceId } },
      { ...base, campaign: { ...base.campaign, autonomyMode: "autonomous" } },
      { ...base, campaign: { ...base.campaign, steps: [{ ...base.campaign.steps[0], approvalRequired: false }] } },
      { ...base, draftVariants: [{ kind: "general", label: "General" }, ...base.draftVariants] },
      { ...base, referenceValidation: "retained_for_disabled_safe_stop" },
      { ...base, destination: { title: "Archived", current: false } },
      { ...base, draftVariants: [] },
    ];
    for (const candidate of malformed) expect(isScopedSourcePreparationPlanPreview(candidate, scope)).toBe(false);
  });

  it("describes proposed settings and ordered variants without implying preparation or live sync happened", () => {
    const html = renderToStaticMarkup(createElement(SourcePreparationPlanPreview, { preview: view() }));
    expect(html).toContain("Your saved settings stay in effect until then");
    expect(html).toContain("Previewing creates no Campaign or drafts");
    expect(html).toContain("synchronization paused");
    expect(html).toContain("Launch page");
    expect(html.indexOf("Community · v3")).toBeLessThan(html.indexOf("Customers · v1"));
    expect(html).not.toContain(previewReferenceId);
  });

  it("renders one General slot and keeps an unsaved disabled proposal distinct from saved settings", () => {
    const preview = { ...view(), enabled: false, draftVariants: [{ kind: "general" as const, label: "General" }] };
    const html = renderToStaticMarkup(createElement(SourcePreparationPlanPreview, { preview }));
    expect(isScopedSourcePreparationPlanPreview(preview, scope)).toBe(true);
    expect(html).toContain("one General draft");
    expect(html).toContain("If you save these disabled settings");
    expect(html).toContain("Work already queued is unaffected");
    expect(html).not.toContain("Some saved selections are out of date");
  });

  it("labels stale saved selections only in a valid disabled proposal", () => {
    const preview = { ...view(), enabled: false, referenceValidation: "retained_for_disabled_safe_stop" as const,
      destination: { title: "Prior destination", current: false } };
    expect(isScopedSourcePreparationPlanPreview(preview, scope)).toBe(true);
    expect(isScopedSourcePreparationPlanPreview({ ...preview, enabled: true }, scope)).toBe(false);
    const html = renderToStaticMarkup(createElement(SourcePreparationPlanPreview, { preview }));
    expect(html).toContain("Prior destination · no longer published");
    expect(html).toContain("Some saved selections are out of date");
  });
});
