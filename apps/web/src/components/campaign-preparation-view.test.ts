import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StoredCampaignPreparation } from "@market-me/database";
import { CampaignPreparationResult } from "./campaign-preparation-result";
import { PreparationFields, initialPreparationInput, type PreparationFormProps } from "./campaign-preparation-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const uuid = (digit: number) => `${digit.toString().repeat(8)}-${digit.toString().repeat(4)}-4${digit.toString().repeat(3)}-8${digit.toString().repeat(3)}-${digit.toString().repeat(12)}`;
const props: PreparationFormProps = { userId: uuid(1), workspaceId: uuid(2), packages: [{ id: uuid(3), title: "Approved café 🚀", version: 2 }], brands: [], audiences: [], destinations: [] };
const values = initialPreparationInput(props.workspaceId, { ...props.packages[0], version: 1 });
const profile = { id: uuid(6), rootId: uuid(7), name: "Captured audience", versionNumber: 3, profile: {}, informationDepthDefault: null, informationDepthCeiling: null, promotionalStrengthDefault: null, promotionalStrengthCeiling: null };
const preparation: StoredCampaignPreparation = {
  id: uuid(4), workspaceId: props.workspaceId, idempotencyKey: uuid(5), templateKey: "general_announcement", templateVersion: 1,
  contentPackageId: uuid(3), contentPackageVersion: 1, configurationHash: "a".repeat(64), configurationSnapshot: values,
  referenceSnapshot: { contentPackage: { id: uuid(3), title: "Captured original package", version: 1 }, brand: { ...profile, name: "Original Brand" },
    audiences: [profile, { ...profile, id: uuid(8), name: "Second audience" }], destination: { id: uuid(9), title: "<script>untrusted</script>", canonicalUrl: "javascript:alert(1)" } },
  campaignId: uuid(7), planningVersionId: uuid(8), generationId: uuid(9),
  preparedDrafts: [{ draftId: uuid(5), versionId: uuid(6) }, { draftId: uuid(8), versionId: uuid(9) }],
  createdBy: props.userId, createdAt: "2026-09-15T15:30:42.125Z",
};
describe("plain-language preparation fields", () => {
  it("shows frozen expected revision alongside changed current revision", () => {
    const html = renderToStaticMarkup(createElement(PreparationFields, { ...props, values, onChange: vi.fn() }));
    expect(html).toContain("Saved package · v1"); expect(html).toContain("The current package is revision 2 (Approved café 🚀)");
    expect(html).toContain("this saved request still uses revision 1");
  });
  it("provides labeled optional controls with no inferred account, JSON, schedule, or activation", () => {
    const html = renderToStaticMarkup(createElement(PreparationFields, { ...props, values, onChange: vi.fn() }));
    for (const label of ["Campaign name", "Approved Content Package", "Published Brand Profile version", "No Brand Profile", "No Destination", "Published Audience Profile versions", "Information depth", "Promotional strength", "Timezone"]) expect(html).toContain(label);
    expect(html).toContain("one General audience draft"); expect(html).toContain("This does not schedule a run.");
    expect(html).not.toContain("JSON"); expect(html).not.toMatch(/<button[^>]*>Activate/);
  });
});
describe("immutable preparation result", () => {
  it("renders every initial variant, captured names and exact IDs, ISO time and no external publishing claim", () => {
    const html = renderToStaticMarkup(createElement(CampaignPreparationResult, { preparation, userId: props.userId, canWrite: true, availableDraftIds: preparation.preparedDrafts.map((draft) => draft.draftId) }));
    expect(html).toContain("Prepared—not activated");
    expect(html).toContain("Captured original package · v1"); expect(html).toContain("Original Brand · v3");
    for (const draft of preparation.preparedDrafts) { expect(html).toContain(`href="/drafts/${draft.draftId}"`); expect(html).toContain(draft.versionId); }
    expect(html).toContain("Review Captured audience draft"); expect(html).toContain("Review Second audience draft");
    expect(html).toContain("current revision may be newer"); expect(html).toContain("2026-09-15T15:30:42.125Z");
    expect(html).toContain("Unversioned historical context"); expect(html).toContain("&lt;script&gt;untrusted&lt;/script&gt;");
    expect(html).not.toContain('href="javascript:'); expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/<button[^>]*>(Activate|Publish|Approve)/);
  });
  it("shows inaccessible historical drafts honestly and omits writer actions for readers", () => {
    const html = renderToStaticMarkup(createElement(CampaignPreparationResult, { preparation, userId: props.userId, canWrite: false, availableDraftIds: [] }));
    expect(html.match(/Historical draft is no longer accessible/g)).toHaveLength(2);
    expect(html).not.toContain('href="/drafts/' + uuid(5)); expect(html).not.toContain("Advanced campaign editor"); expect(html).not.toContain("Prepare another");
    expect(html).toContain(preparation.preparedDrafts[0].versionId);
  });
});
