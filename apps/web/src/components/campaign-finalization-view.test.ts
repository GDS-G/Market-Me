import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ExactPreviewSnapshotV1, StoredCampaign, StoredCampaignFinalization, StoredCampaignInstance } from "@market-me/database";
import { CampaignFinalizationResult, finalizationControlState } from "./campaign-finalization-result";
import { ExactPreviewDisplay } from "./exact-preview-display";
import { CampaignFinalizationActions, finalizationVersionRequest } from "./campaign-finalization-actions";
import { FinalizationTimingSummary } from "./campaign-finalization-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const uuid = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const snapshot = {
  schemaVersion: 1, rendererContract: "stored-channel-preview-text-v1",
  lineage: { workspaceId: uuid(1), campaignId: uuid(2), sourceCampaignVersionId: uuid(3), generationId: uuid(4), previewId: uuid(5), contentDraftId: uuid(6), contentDraftVersionId: uuid(7) },
  preview: { provider: "discord_webhook", channelConnectionId: uuid(8), destinationId: null, linkMode: "canonical", status: "ready", renderedSubject: null,
    renderedContent: "Café 🚀  exact spacing\n<script>no HTML</script>", subjectCount: null, subjectLimit: null, characterCount: 48, characterLimit: 2000,
    validationIssues: [], capabilityVersion: "test-v1", capabilityObservedAtUtcMicros: "2026-10-01T10:00:00.123456Z", capabilitySnapshot: {}, createdBy: uuid(9), createdAtUtcMicros: "2026-10-01T10:30:42.654321Z", assets: [] },
  connection: { id: uuid(8), workspaceId: uuid(1), provider: "discord_webhook", status: "active", identity: { webhookId: "123456789012345678", channelId: "223456789012345678", guildId: null } },
  destination: null, trackedLink: null,
} as const satisfies ExactPreviewSnapshotV1;
const fingerprint = `mm-preview-v1:sha256:${"a".repeat(64)}`;
const receipt = { id: uuid(9), workspaceId: uuid(1), campaignId: uuid(2), preparationId: uuid(4), planningVersionId: uuid(3), finalizedVersionId: uuid(5),
  contentDraftId: uuid(6), contentDraftVersionId: uuid(7), previewFingerprint: fingerprint, canonicalPreviewSnapshot: snapshot, createdAt: "2026-10-01T11:12:13.456789Z",
  compiledDefinition: { name: "Captured café launch", steps: [{ name: "Publish reviewed preview", scheduleType: "preferred_window", preferredWindowStart: "2026-10-02T10:30:42.125Z", preferredWindowEnd: "2026-10-02T12:00:00.999Z" }] },
  templateVersion: 1, configurationHash: "b".repeat(64),
} as unknown as StoredCampaignFinalization;
const draftCampaign = { id: receipt.campaignId, workspaceId: receipt.workspaceId, status: "draft", draftVersion: { id: receipt.finalizedVersionId }, currentVersion: { id: receipt.planningVersionId } } as StoredCampaign;
const publishedCampaign = { ...draftCampaign, draftVersion: undefined, currentVersion: { id: receipt.finalizedVersionId } } as StoredCampaign;
const run = { id: uuid(8), workspaceId: receipt.workspaceId, campaignId: receipt.campaignId, campaignVersionId: receipt.finalizedVersionId, status: "scheduled" } as StoredCampaignInstance;

describe("coherent exact preview presentation", () => {
  it("preserves copy, escapes HTML, and displays exact account IDs, token and SQL microseconds", () => {
    const html = renderToStaticMarkup(createElement(ExactPreviewDisplay, { snapshot, fingerprint, connectionName: "Chosen account" }));
    expect(html).toContain("Café 🚀  exact spacing\n&lt;script&gt;no HTML&lt;/script&gt;"); expect(html).not.toContain("<script>");
    expect(html).toContain("123456789012345678"); expect(html).toContain("223456789012345678"); expect(html).toContain(fingerprint);
    expect(html).toContain("2026-10-01T10:30:42.654321Z"); expect(html).toContain("2026-10-01T10:00:00.123456Z");
    expect(html).toContain("one current server selection"); expect(html).toContain("No Destination"); expect(html).toContain("None · text only");
  });
  it("does not relabel a historical receipt as a fresh preview or account validation", () => {
    const html = renderToStaticMarkup(createElement(ExactPreviewDisplay, { snapshot, fingerprint, historical: true }));
    expect(html).toContain("immutable finalization snapshot, not a fresh eligibility check"); expect(html).not.toContain("current display label");
  });
});

describe("protected finalization result controls", () => {
  it("offers only direct publication for the exact draft, with no editable fields or activation", () => {
    const html = renderToStaticMarkup(createElement(CampaignFinalizationResult, { finalization: receipt, campaign: draftCampaign, runs: [], canWrite: true }));
    expect(html).toContain("Publish this version"); expect(html).not.toContain("Activate this version"); expect(html).not.toContain("<form");
    expect(html).toContain("Advanced edits are blocked"); expect(html).toContain("one selected audience variant");
    expect(html).toContain("2026-10-02T10:30:42.125Z inclusive"); expect(html).toContain("2026-10-02T12:00:00.999Z exclusive");
    expect(html).toContain("2026-10-01T11:12:13.456789Z"); expect(html).toContain("did not publish, activate, approve, or send");
  });
  it("requires separate explicit confirmation before activating an already published exact version", () => {
    const html = renderToStaticMarkup(createElement(CampaignFinalizationActions, { workspaceId: receipt.workspaceId, campaignId: receipt.campaignId, versionId: receipt.finalizedVersionId, state: "published" }));
    expect(html).toContain("queue one workflow run"); expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Activate this version/);
    expect(html).not.toContain("Publish this version"); expect(html).toContain("still requires approval");
  });
  it("shows existing exact-version runs instead of another activation action", () => {
    const html = renderToStaticMarkup(createElement(CampaignFinalizationResult, { finalization: receipt, campaign: publishedCampaign, runs: [run], canWrite: true }));
    expect(html).toContain(`/campaign-instances/${run.id}`); expect(html).toContain("No additional activation is offered"); expect(html).not.toContain("Activate this version");
  });
  it("never offers publication or activation to read-only members", () => {
    const html = renderToStaticMarkup(createElement(CampaignFinalizationResult, { finalization: receipt, campaign: draftCampaign, runs: [], canWrite: false }));
    expect(html).not.toContain("<button"); expect(html).toContain("Writer access is required");
  });
  it.each([undefined, { ...draftCampaign, status: "archived" }, { ...draftCampaign, draftVersion: { id: uuid(8) } }, { ...draftCampaign, workspaceId: uuid(9) }])("withholds controls for unavailable, changed, archived, or foreign campaign state", (campaign) => {
    expect(finalizationControlState(receipt, campaign as StoredCampaign | undefined, [])).toBe("changed");
  });
  it("ignores unrelated runs instead of assigning another campaign's history", () => {
    expect(finalizationControlState(receipt, publishedCampaign, [{ ...run, campaignId: uuid(9) }])).toBe("published");
    expect(finalizationControlState(receipt, draftCampaign, [])).toBe("draft");
  });
  it("sends only the explicit workspace and immutable expected version in action requests", () => {
    expect(JSON.parse(finalizationVersionRequest(receipt.workspaceId, receipt.finalizedVersionId))).toEqual({ workspaceId: receipt.workspaceId, expectedVersionId: receipt.finalizedVersionId });
    expect(() => finalizationVersionRequest("", receipt.finalizedVersionId)).toThrow();
  });
  it("labels exact time as not-before and a window as half-open request-start bounds", () => {
    const exact = renderToStaticMarkup(createElement(FinalizationTimingSummary, { timing: { type: "exact_time", scheduledAt: "2026-10-01T10:30:42.125Z" } }));
    expect(exact).toContain("later execution is possible");
    const window = renderToStaticMarkup(createElement(FinalizationTimingSummary, { timing: { type: "preferred_window", start: "2026-10-01T10:30:42.125Z", end: "2026-10-01T11:30:42.999Z" } }));
    expect(window).toContain("inclusive"); expect(window).toContain("exclusive"); expect(window).toContain("Expiry requires attention");
  });
});
