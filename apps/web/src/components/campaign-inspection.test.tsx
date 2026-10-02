import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AUTONOMY_MODES, type CampaignStep, type CampaignVersion } from "@market-me/domain";
import type { StoredCampaign } from "@market-me/database";
import { CampaignInspection, campaignInspectionTiming } from "./campaign-inspection";

vi.mock("./campaign-inspection.module.css", () => ({ default: {} }));
const campaignId = "11111111-1111-4111-8111-111111111111";
const step: CampaignStep = { id: "publish", name: "Reviewed café <script>text</script>", desiredCapability: "content.publish",
  dependsOn: [], inputs: { credential: "NEVER_RENDER_INPUT" }, outputs: { token: "NEVER_RENDER_OUTPUT" },
  condition: { private: "NEVER_RENDER_CONDITION" }, executionMethods: ["official_api"], approvalRequired: true,
  operationType: "publish_content", scheduleType: "preferred_window", preferredWindowStart: "2026-10-02T10:20:30.123Z",
  preferredWindowEnd: "2026-10-02T11:20:30.456Z", maxAttempts: 2, timeoutSeconds: 60, optional: true };
const version: CampaignVersion = { id: "22222222-2222-4222-8222-222222222222", campaignId, versionNumber: 1, status: "published",
  objective: "awareness", contentPackageIds: [], audienceProfileVersionIds: [], informationDepth: "contextual", promotionalStrength: "light",
  autonomyMode: "approval_required", timezone: "America/Chicago", context: { secret: "NEVER_RENDER_CONTEXT" },
  successCriteria: [], successAction: "notify_only", steps: [step], createdAt: "2026-10-01T00:00:00Z" };
const campaign: StoredCampaign = { id: campaignId, workspaceId: "33333333-3333-4333-8333-333333333333", name: "QA", description: "",
  status: "scheduled", currentVersion: version, createdBy: "owner", createdAt: version.createdAt, updatedAt: version.createdAt };
const render = (value: StoredCampaign = campaign) => renderToStaticMarkup(createElement(CampaignInspection, { campaign: value }));

describe("read-only campaign inspection prototype", () => {
  it("separates published plan from an absent unpublished draft without mutation controls", () => {
    const html = render();
    expect(html).toContain("Published plan"); expect(html).toContain("No separate unpublished draft");
    expect(html).toContain("not a complete eligibility check");
    for (const element of ["<button", "<input", "<textarea", "<select", "<form"]) expect(html).not.toContain(element);
  });
  it("shows both saved versions independently instead of labeling a draft as live", () => {
    const html = render({ ...campaign, draftVersion: { ...version, id: "draft-version", versionNumber: 2, status: "draft", steps: [{ ...step, name: "Separate unpublished change" }] } });
    expect(html).toContain("Separate unpublished change"); expect(html).toContain("Reviewed café");
    expect(html).toContain("cannot change the governing version of an existing run");
  });
  it("handles draft-only and no-version campaigns without inventing a published plan", () => {
    const html = render({ ...campaign, currentVersion: undefined, draftVersion: { ...version, status: "draft" } });
    expect(html).toContain("No published plan yet"); expect(html).toContain("Reviewed café");
    expect(render({ ...campaign, currentVersion: undefined })).not.toContain("No workflow");
    expect(render({ ...campaign, currentVersion: undefined })).toContain("No separate unpublished draft");
  });
  it.each(["foreign campaign", "superseded"])("withholds inconsistent %s version contents", mismatch => {
    const invalid = mismatch === "foreign campaign" ? { ...version, campaignId: "foreign" } : { ...version, status: "superseded" as const };
    const html = render({ ...campaign, currentVersion: invalid });
    expect(html).toContain("observed version is unavailable or changed"); expect(html).not.toContain("Reviewed café");
  });
  it("escapes user labels and omits arbitrary input, output, context and condition payloads", () => {
    const html = render(); expect(html).toContain("&lt;script&gt;text&lt;/script&gt;"); expect(html).not.toContain("<script>");
    expect(html).not.toContain("NEVER_RENDER"); expect(html).not.toContain("credential");
  });
  it("preserves exact captured timing and distinguishes request starts from completion", () => {
    const html = render(); expect(html).toContain("2026-10-02T10:20:30.123Z inclusive");
    expect(html).toContain("2026-10-02T11:20:30.456Z exclusive"); expect(html).toContain("supported bounded routes");
    expect(campaignInspectionTiming({ ...step, scheduleType: "exact_time", scheduledAt: "2026-10-02T10:20:30.123Z" })).toContain("later execution is possible");
  });
  it.each(["recurring", "evergreen_queue", "conditional", "follow_up"] as const)("does not advertise %s execution from a stored enum", scheduleType => {
    expect(campaignInspectionTiming({ ...step, scheduleType })).toContain("saved plan only; execution is not supported");
  });
  it("labels incomplete timing and default/dependency modes without fabricating a time", () => {
    expect(campaignInspectionTiming({ ...step, scheduleType: "exact_time" })).toContain("incomplete");
    expect(campaignInspectionTiming({ ...step, preferredWindowEnd: undefined })).toContain("incomplete");
    expect(campaignInspectionTiming({ ...step, scheduleType: undefined })).toContain("When activated and eligible");
    expect(campaignInspectionTiming({ ...step, scheduleType: "dependency" })).toContain("required predecessors");
  });
  it.each(AUTONOMY_MODES)("provides a nonempty configured approval label for %s", autonomyMode => {
    const html = render({ ...campaign, currentVersion: { ...version, autonomyMode } });
    expect(html).not.toContain("undefined"); expect(html).toContain("Other policy and approval gates still apply");
    if (autonomyMode === "draft_only") expect(html).toContain("cannot activate");
  });
  it("does not turn an unchecked explicit gate into a promise of no approval", () => {
    expect(render({ ...campaign, currentVersion: { ...version, steps: [{ ...step, approvalRequired: false }] } })).toContain("campaign and policy gates may still require it");
  });
  it("bounds step and dependency detail with truthful coverage", () => {
    const steps = Array.from({ length: 101 }, (_, i) => ({ ...step, id: `step-${i}`, name: `Step label ${i}`, dependsOn: Array.from({ length: 21 }, (_, j) => `dependency-${j}`) }));
    const html = render({ ...campaign, currentVersion: { ...version, steps } });
    expect(html).toContain("first 100 of 101"); expect(html).not.toContain("Step label 100");
    expect(html).toContain("showing 20 of 21"); expect(html).not.toContain("dependency-20");
  });
  it("renders recorded goal units without currency conversion or invented measurement", () => {
    const html = render({ ...campaign, currentVersion: { ...version, successAction: "pause", successCriteria: [
      { id: "count", eventType: "lead", targetCount: 12 },
      { id: "value", metric: "value", eventType: "revenue", targetValue: 123.456, currency: "USD" },
    ] } });
    expect(html).toContain("12 recorded events"); expect(html).toContain("123.456 USD recorded value");
    expect(html).toContain("pause before future workflow steps"); expect(html).toContain("not measured results or attribution");
  });
});
