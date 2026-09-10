import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StoredCampaignInstance } from "@market-me/database";
import { campaignInstanceControls } from "./campaign-instance-controls";
import { CampaignInstanceActions } from "./campaign-instance-actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const instance: StoredCampaignInstance = {
  id: "run-1", workspaceId: "workspace-1", campaignId: "campaign-1", campaignVersionId: "version-1", status: "paused", context: {}, requestedBy: "user-1", createdAt: "2026-09-10T15:00:00.000Z", updatedAt: "2026-09-10T15:00:00.000Z", approvals: [],
  stepRuns: [{ id: "step-1", campaignInstanceId: "run-1", campaignStepId: "stored-step-1", stepKey: "publish", stepName: "Publication", status: "manual_resolution", idempotencyKey: "step-1", input: {}, output: {}, attemptCount: 0 }],
};

describe("campaign instance controls", () => {
  it("renders no resume or completion button for a blocked run while keeping cancel", () => {
    const blocked = { ...instance, stepRuns: [...instance.stepRuns, { ...instance.stepRuns[0], id: "blocked", status: "schedule_blocked" as const }] };
    expect(campaignInstanceControls(blocked)).toMatchObject({ scheduleBlocked: true, canResume: false, canPause: false, canCancel: true, manualRuns: [] });
    const html = renderToStaticMarkup(createElement(CampaignInstanceActions, { workspaceId: "workspace-1", instance: blocked }));
    expect(html).toContain("Scheduling blocked");
    expect(html).not.toMatch(/<button[^>]*>Resume<\/button>/);
    expect(html).not.toMatch(/<button[^>]*>Record completion<\/button>/);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Cancel<\/button>/);
  });
  it("keeps valid paused manual resolution available and rejects foreign-instance steps", () => {
    expect(campaignInstanceControls(instance)).toMatchObject({ canResume: true, manualRuns: instance.stepRuns });
    const foreign = { ...instance, stepRuns: [{ ...instance.stepRuns[0], campaignInstanceId: "another-run" }] };
    expect(campaignInstanceControls(foreign).manualRuns).toEqual([]);
  });
  it.each(["completed", "failed", "canceled"] as const)("offers no further mutation for %s runs", (status) => {
    expect(campaignInstanceControls({ ...instance, status })).toMatchObject({ canResume: false, canPause: false, canCancel: false, manualRuns: [] });
  });
});
