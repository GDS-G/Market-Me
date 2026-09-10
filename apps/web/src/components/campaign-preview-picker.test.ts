import { describe, expect, it } from "vitest";
import type { StoredCampaignPreviewOption } from "@market-me/database";
import { assessCampaignPreview, readDraftChannelPreviewId, writeDraftChannelPreviewId } from "./campaign-preview-picker";

describe("Campaign preview picker", () => {
  it("accepts only a fresh ready current-approved preview with the exact Campaign Destination", () => {
    const option = preview();
    expect(assessCampaignPreview(option, "destination-1")).toEqual({ eligible: true, reasons: [] });
    expect(assessCampaignPreview({ ...option, isStale: true }, "destination-1")).toMatchObject({ eligible: false, reasons: [expect.stringContaining("stale")] });
    expect(assessCampaignPreview(option, "destination-2")).toMatchObject({ eligible: false, reasons: [expect.stringContaining("selected Destination")] });
    expect(assessCampaignPreview({ ...option, linkMode: "tracked" }, "destination-1")).toMatchObject({ eligible: false, reasons: [expect.stringContaining("tracked link")] });
  });

  it("writes the immutable preview reference while removing conflicting overrides", () => {
    const output = writeDraftChannelPreviewId(JSON.stringify({ custom: 7, appendDestination: true, useTrackedLink: true, channelConnectionId: "wrong" }), "preview-2");
    expect(JSON.parse(output)).toEqual({ custom: 7, draftChannelPreviewId: "preview-2" });
    expect(readDraftChannelPreviewId(output)).toBe("preview-2");
  });

  it("rejects non-object input and can remove a configured preview", () => {
    expect(() => writeDraftChannelPreviewId("[]", "preview-2")).toThrow("JSON object");
    expect(JSON.parse(writeDraftChannelPreviewId('{"draftChannelPreviewId":"preview-1","custom":true}', ""))).toEqual({ custom: true });
  });
});

function preview(): StoredCampaignPreviewOption {
  return {
    id: "preview-1", workspaceId: "workspace-1", contentDraftId: "draft-1", contentDraftVersionId: "draft-version-1",
    channelConnectionId: "connection-1", channelConnectionName: "Announcements", destinationId: "destination-1", destinationTitle: "Launch",
    linkMode: "canonical", provider: "discord_webhook", capabilityVersion: "1", capabilityObservedAt: "2026-08-06T00:00:00.000Z", status: "ready",
    renderedContent: "Approved copy", characterCount: 13, characterLimit: 2000, validationIssues: [], capabilitySnapshot: {}, assets: [], isStale: false,
    createdBy: "user-1", createdAt: "2026-08-06T00:00:00.000Z", campaignId: "campaign-1", sourceCampaignVersionId: "campaign-version-1",
    sourceCampaignVersionNumber: 1, draftHeadline: "Launch announcement", audienceName: "Members", isCurrentApprovedVersion: true,
  };
}
