import { describe, expect, it, vi } from "vitest";
import type { CampaignStep, CampaignVersion } from "@market-me/domain";
import type { CampaignWorkflowDefinition, StoredCampaign, StoredCampaignInstance } from "@market-me/database";
import { buildCampaignAgenda, formatDashboardTime, loadCampaignAgenda, summarizeWorkspace } from "./dashboard-data";

const instant = "2026-09-10T15:00:00.000Z";
const step: CampaignStep = { id: "publish", name: "Publish article", desiredCapability: "publish_content", dependsOn: [], inputs: {}, outputs: {}, executionMethods: ["manual_handoff"], approvalRequired: true, scheduleType: "exact_time", scheduledAt: instant };
const version: CampaignVersion = {
  id: "version-1", campaignId: "campaign-1", versionNumber: 1, status: "published", objective: "awareness", contentPackageIds: [], audienceProfileVersionIds: [], informationDepth: "contextual", promotionalStrength: "standard", autonomyMode: "approval_required", timezone: "America/Chicago", context: {}, successCriteria: [], successAction: "notify_only", steps: [step], createdAt: instant,
};
const campaign: StoredCampaign = { id: "campaign-1", workspaceId: "workspace-1", name: "Launch", description: "", status: "active", currentVersion: version, createdBy: "user-1", createdAt: instant, updatedAt: instant };
const instance: StoredCampaignInstance = {
  id: "run-1", workspaceId: "workspace-1", campaignId: campaign.id, campaignVersionId: version.id, status: "active", context: {}, requestedBy: "user-1", createdAt: instant, updatedAt: instant, approvals: [],
  stepRuns: [{ id: "step-run-1", campaignInstanceId: "run-1", campaignStepId: "stored-step-1", stepKey: step.id, stepName: step.name, status: "waiting", idempotencyKey: "step-1", input: {}, output: {}, attemptCount: 0 }],
};
const definition: CampaignWorkflowDefinition = { instanceId: instance.id, workspaceId: instance.workspaceId, campaignId: campaign.id, campaignVersionId: version.id, timezone: version.timezone, autonomyMode: version.autonomyMode, context: {}, steps: [step] };

describe("workspace overview", () => {
  it("uses zeroes for empty persisted collections", () => {
    expect(summarizeWorkspace({ sources: [], packages: [], instances: [], campaignApprovals: [], draftApprovals: [] })).toEqual({ enabledSources: 0, packagesNeedingReview: 0, openRuns: 0, pendingApprovals: 0 });
  });

  it("counts saved statuses without treating historical approvals or completed runs as open", () => {
    expect(summarizeWorkspace({ sources: [{ enabled: true }, { enabled: false }], packages: [{ status: "needs_review" }, { status: "ready" }], instances: ["active", "paused", "scheduled", "awaiting_approval", "completed", "failed", "canceled"].map((status) => ({ status })), campaignApprovals: [{ status: "approved" }, { status: "pending" }], draftApprovals: [{ status: "pending" }, { status: "rejected" }] })).toEqual({ enabledSources: 1, packagesNeedingReview: 1, openRuns: 4, pendingApprovals: 2 });
  });

  it("labels timestamp timezone explicitly and handles invalid historical values", () => {
    expect(formatDashboardTime(instant)).toBe("Sep 10, 2026, 3:00 PM (UTC)");
    expect(formatDashboardTime(instant, "America/Chicago")).toBe("Sep 10, 2026, 10:00 AM (America/Chicago)");
    expect(formatDashboardTime(instant, "invalid/timezone")).toBe(formatDashboardTime(instant));
    expect(formatDashboardTime("not a date")).toBe("Unknown time");
    expect(formatDashboardTime("2026-09-10T15:00:01.125Z", "America/Chicago", "millisecond")).toBe("Sep 10, 2026, 10:00:01.125 AM (America/Chicago)");
    expect(formatDashboardTime("2026-09-10T15:00:01.125Z", "invalid/timezone", "millisecond")).toBe("Sep 10, 2026, 3:00:01.125 PM (UTC)");
  });
});

describe("campaign calendar agenda", () => {
  it("shows both authored window boundaries and delay from the pinned run version without inventing a dispatch time", () => {
    const windowStep = { ...step, dependsOn: ["prepare"], scheduleType: "preferred_window" as const, dependencyDelaySeconds: 90, preferredWindowStart: "2026-09-12T10:00:01.125Z", preferredWindowEnd: "2026-09-12T11:00:02.875Z" };
    const newer = { ...campaign, currentVersion: { ...version, id: "new-version", steps: [{ ...windowStep, preferredWindowEnd: "2026-10-01T12:00:00.000Z" }] } };
    const entries = buildCampaignAgenda("workspace-1", [newer], [instance], [{ ...definition, steps: [windowStep] }]);
    const run = entries.find((entry) => entry.origin === "run")!;
    expect(run).toMatchObject({ campaignVersionId: version.id, preferredWindowStart: windowStep.preferredWindowStart, preferredWindowEnd: windowStep.preferredWindowEnd, dependencyDelaySeconds: 90, timing: "Preferred request-start window" });
    expect(run.scheduledAt).toBeUndefined();
    expect(run.warnings.join(" ")).toContain("requires only official API");
    expect(run.warnings.join(" ")).not.toContain("requires the new scheduler");
    expect(entries.find((entry) => entry.origin === "published_plan")?.preferredWindowEnd).toBe("2026-10-01T12:00:00.000Z");
  });
  it("keeps a blocked step visible in open paused runs with an explicit recovery warning", () => {
    const entries = buildCampaignAgenda("workspace-1", [campaign], [{ ...instance, status: "paused", stepRuns: [{ ...instance.stepRuns[0], status: "schedule_blocked" }] }], [definition]);
    expect(entries[0]).toMatchObject({ status: "schedule_blocked", finished: false });
    expect(entries[0].warnings.join(" ")).toContain("do not resume or mark it manually complete");
  });
  it("does not invent range bounds for malformed historical window plans", () => {
    const entries = buildCampaignAgenda("workspace-1", [campaign], [instance], [{ ...definition, steps: [{ ...step, scheduleType: "preferred_window", preferredWindowStart: "invalid", preferredWindowEnd: instant }] }]);
    expect(entries[0]).toMatchObject({ timing: "Preferred window missing or invalid — cannot activate" });
    expect(entries[0].preferredWindowStart).toBeUndefined();
    expect(entries[0].scheduledAt).toBeUndefined();
  });
  it("uses each immutable run version and does not duplicate an activated plan", () => {
    const entries = buildCampaignAgenda("workspace-1", [campaign], [instance], [definition]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ scheduledAt: instant, timezone: "America/Chicago", href: "/campaign-instances/run-1", origin: "run", status: "waiting", finished: false });
    const changedCampaign = { ...campaign, currentVersion: { ...version, id: "version-2", steps: [{ ...step, scheduledAt: "2026-10-01T12:00:00Z" }] } };
    const historical = buildCampaignAgenda("workspace-1", [changedCampaign], [instance], [definition]);
    expect(historical.find((entry) => entry.origin === "run")?.scheduledAt).toBe(instant);
    expect(historical.find((entry) => entry.origin === "published_plan")?.scheduledAt).toBe("2026-10-01T12:00:00.000Z");
  });

  it("orders exact targets by instant, not text offsets, and does not invent times for dependencies", () => {
    const steps = [
      { ...step, id: "late", scheduledAt: "2026-09-10T10:00:00-07:00" },
      { ...step, id: "early", scheduledAt: "2026-09-10T11:00:00-04:00" },
      { ...step, id: "dependency", scheduleType: "dependency" as const, dependsOn: ["early"] },
    ];
    const entries = buildCampaignAgenda("workspace-1", [campaign], [instance], [{ ...definition, steps }]);
    expect(entries.map((entry) => entry.id)).toEqual(["run-1:early", "run-1:late", "run-1:dependency"]);
    expect(entries[2]).toMatchObject({ timing: "After dependencies; no fixed time" });
    expect(entries[2].scheduledAt).toBeUndefined();
  });

  it("keeps an unactivated published plan visible alongside a newer draft", () => {
    const draftVersion = { ...version, id: "draft-new", status: "draft" as const, versionNumber: 2 };
    const entries = buildCampaignAgenda("workspace-1", [{ ...campaign, draftVersion }], [], []);
    expect(entries.map((entry) => entry.origin).sort()).toEqual(["draft", "published_plan"]);
    expect(entries.every((entry) => entry.status === "Not activated")).toBe(true);
  });

  it("preserves unsupported draft schedules as plan-only entries with explicit blockers", () => {
    const draft = { ...version, id: "draft-1", status: "draft" as const, autonomyMode: "draft_only" as const, steps: [{ ...step, scheduleType: "recurring" as const }] };
    const entries = buildCampaignAgenda("workspace-1", [{ ...campaign, draftVersion: draft }], [instance], [definition]);
    const plan = entries.find((entry) => entry.origin === "draft")!;
    expect(plan).toMatchObject({ href: "/campaigns/campaign-1/edit", status: "Not activated", finished: false, timing: "recurring — scheduling not implemented" });
    expect(plan.scheduledAt).toBeUndefined();
    expect(plan.warnings).toHaveLength(2);
    expect(plan.warnings.join(" ")).toContain("does not authorize execution");
    expect(plan.warnings.join(" ")).toContain("not implemented");
  });

  it("marks terminal steps and terminal runs finished but leaves temporary failures open", () => {
    for (const status of ["succeeded", "permanently_failed", "canceled", "rolled_back"] as const) {
      const entries = buildCampaignAgenda("workspace-1", [campaign], [{ ...instance, stepRuns: [{ ...instance.stepRuns[0], status }] }], [definition]);
      expect(entries[0].finished).toBe(true);
    }
    expect(buildCampaignAgenda("workspace-1", [campaign], [{ ...instance, status: "canceled" }], [definition])[0].finished).toBe(true);
    expect(buildCampaignAgenda("workspace-1", [campaign], [{ ...instance, stepRuns: [{ ...instance.stepRuns[0], status: "temporarily_failed" }] }], [definition])[0].finished).toBe(false);
  });

  it("never leaks foreign workspace snapshots or falls back to a newer version", () => {
    const foreignCampaign = { ...campaign, id: "private-campaign", workspaceId: "workspace-2", name: "Private name" };
    const foreignRun = { ...instance, id: "private-run", workspaceId: "workspace-2" };
    const entries = buildCampaignAgenda("workspace-1", [campaign, foreignCampaign], [instance, foreignRun], [{ ...definition, workspaceId: "workspace-2", steps: [{ ...step, name: "Private step" }] }]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ stepName: "Run schedule unavailable", timing: "No verified schedule snapshot" });
    expect(JSON.stringify(entries)).not.toContain("Private");
    expect(entries[0].scheduledAt).toBeUndefined();
    expect(buildCampaignAgenda("workspace-1", [campaign], [instance], [{ ...definition, campaignVersionId: "wrong-version" }])[0].scheduledAt).toBeUndefined();
  });

  it("does not hide invalid exact times behind an invented schedule", () => {
    const entries = buildCampaignAgenda("workspace-1", [campaign], [instance], [{ ...definition, steps: [{ ...step, scheduledAt: "not-a-date" }] }]);
    expect(entries[0].timing).toBe("Exact time missing or invalid");
    expect(entries[0].scheduledAt).toBeUndefined();
    expect(entries[0].warnings.join(" ")).toMatch(/valid|absolute ISO/);
  });

  it("loads definitions only for authorized instance IDs, at most ten concurrently", async () => {
    const instances = Array.from({ length: 23 }, (_, index) => ({ ...instance, id: `run-${index}` }));
    let concurrent = 0;
    let peak = 0;
    const repository = {
      listCampaigns: vi.fn(async () => [campaign]),
      listCampaignInstances: vi.fn(async () => [...instances, { ...instance, id: "foreign-run", workspaceId: "workspace-2" }]),
      getWorkflowDefinition: vi.fn(async (instanceId: string) => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await Promise.resolve();
        concurrent -= 1;
        return { ...definition, instanceId };
      }),
    };
    const loaded = await loadCampaignAgenda("workspace-1", repository);
    expect(repository.listCampaigns).toHaveBeenCalledWith("workspace-1");
    expect(repository.listCampaignInstances).toHaveBeenCalledWith("workspace-1");
    expect(repository.getWorkflowDefinition).toHaveBeenCalledTimes(23);
    expect(repository.getWorkflowDefinition).not.toHaveBeenCalledWith("foreign-run");
    expect(peak).toBe(10);
    expect(loaded.entries).toHaveLength(23);
  });
});
