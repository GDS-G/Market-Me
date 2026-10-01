import { describe, expect, it } from "vitest";
import { WORKSPACE_START_COUNT_KEYS, type WorkspaceRole, type WorkspaceStartSnapshot } from "@market-me/database";
import { buildWorkspaceStartGuide, WORKSPACE_START_STAGE_KEYS } from "./workspace-start-guide";

const snapshot = (overrides: Partial<WorkspaceStartSnapshot> = {}): WorkspaceStartSnapshot => ({
  ...Object.fromEntries(WORKSPACE_START_COUNT_KEYS.map(key => [key, 0])) as Record<(typeof WORKSPACE_START_COUNT_KEYS)[number], number>,
  workspaceId: "11111111-1111-4111-8111-111111111111", role: "owner", observedAt: "2026-10-01T12:00:00.000Z", ...overrides,
});
const roles: readonly WorkspaceRole[] = ["owner", "admin", "editor", "approver", "analyst", "viewer"];

describe("role-aware start guide", () => {
  it.each(roles)("starts a real empty %s workspace without inventing progress or authority", role => {
    const guide = buildWorkspaceStartGuide(snapshot({ role }));
    const write = ["owner", "admin", "editor"].includes(role), review = ["owner", "admin", "approver"].includes(role);
    expect(guide).toMatchObject({ canWrite: write, canReview: review });
    expect(guide.recommendation).toMatchObject({ key: write ? "create_source" : "writer_handoff", href: write ? "/smart-sources/new" : "/team" });
    expect(guide.stages.map(s => s.key)).toEqual(WORKSPACE_START_STAGE_KEYS);
    expect(guide.stages.every(s => s.signal === "empty")).toBe(true);
    if (!write) expect(guide.stages.map(s => s.action.href)).not.toContain("/campaigns/prepare");
    if (!review) expect(guide.stages.find(s => s.key === "review")?.handoff).toContain("approver");
    expect(JSON.stringify(guide)).not.toMatch(/percent|100%|setup complete|ready to launch/i);
  });
  it.each(roles)("guides %s pending decisions without presenting them as assigned eligibility", role => {
    const guide = buildWorkspaceStartGuide(snapshot({ role, pendingDraftApprovals: 1, pendingWorkflowApprovals: 2 }));
    const review = ["owner", "admin", "approver"].includes(role);
    expect(guide.recommendation.key).toBe(review ? "pending_approvals" : "reviewer_handoff");
    expect(guide.recommendation.href).toBe(review ? "/approvals" : "/drafts");
    expect(guide.recommendation.reason).toContain("not necessarily assigned to you");
    expect(guide.stages.find(s => s.key === "review")?.action.href).toBe(review ? "/approvals" : "/drafts");
  });
  it.each(roles)("keeps paused/failed runs discoverable for %s", role => {
    const guide = buildWorkspaceStartGuide(snapshot({ role, attentionRunCount: 1, sourceCount: 0 }));
    expect(guide.recommendation).toMatchObject({ key: "run_attention", href: "/campaigns" });
    expect(guide.recommendation.reason).toContain("before considering any recovery");
  });
  it.each(roles)("does not offer %s package review powers that its role lacks", role => {
    const guide = buildWorkspaceStartGuide(snapshot({ role, packageCount: 1, packagesToReview: 1 }));
    const review = ["owner", "admin", "approver"].includes(role);
    expect(guide.recommendation.key).toBe(review ? "package_review" : "inspect_packages");
  });
  it.each([
    [{ draftsToEdit: 1, draftCount: 1 }, "draft_edit", "/drafts"],
    [{ openRunCount: 1, runCount: 1 }, "open_runs", "/calendar"],
    [{ approvedDraftCount: 1, draftCount: 1, campaignCount: 1 }, "launch_review", "/campaigns"],
    [{ approvedPackageCount: 1, packageCount: 1 }, "prepare", "/campaigns/prepare"],
    [{ failedPackageCount: 1, packageCount: 1 }, "package_attention", "/content-packages"],
    [{ draftCount: 1 }, "inspect_drafts", "/drafts"],
    [{ packageCount: 1 }, "inspect_packages", "/content-packages"],
    [{ campaignCount: 1 }, "inspect_campaigns", "/campaigns"],
    [{ runCount: 1, completedRunCount: 1 }, "inspect_campaigns", "/campaigns"],
    [{ sourceCount: 1 }, "inspect_sources", "/smart-sources"],
    [{ sourceCount: 1, enabledSourceCount: 1 }, "inspect_sources", "/smart-sources"],
  ] as const)("selects grounded navigation for %j", (counts, key, href) => {
    expect(buildWorkspaceStartGuide(snapshot(counts)).recommendation).toMatchObject({ key, href });
  });
  it("prioritizes real decisions and interrupted work over empty-source setup", () => {
    const competing = { pendingDraftApprovals: 2, attentionRunCount: 3, packagesToReview: 4, draftsToEdit: 5, approvedPackageCount: 6, sourceCount: 0 };
    expect(buildWorkspaceStartGuide(snapshot(competing)).recommendation.key).toBe("pending_approvals");
    expect(buildWorkspaceStartGuide(snapshot({ ...competing, pendingDraftApprovals: 0 })).recommendation.key).toBe("run_attention");
    expect(buildWorkspaceStartGuide(snapshot({ ...competing, pendingDraftApprovals: 0, attentionRunCount: 0 })).recommendation.key).toBe("package_review");
    expect(buildWorkspaceStartGuide(snapshot({ ...competing, pendingDraftApprovals: 0, attentionRunCount: 0, packagesToReview: 0 })).recommendation.key).toBe("draft_edit");
  });
  it("does not recommend new preparation over an existing draft or run", () => {
    expect(buildWorkspaceStartGuide(snapshot({ approvedPackageCount: 2, draftCount: 1 })).recommendation.key).toBe("inspect_drafts");
    expect(buildWorkspaceStartGuide(snapshot({ approvedPackageCount: 2, openRunCount: 1 })).recommendation.key).toBe("open_runs");
    const active = buildWorkspaceStartGuide(snapshot({ approvedDraftCount: 2, campaignCount: 1, openRunCount: 1 }));
    expect(active.recommendation.key).toBe("open_runs");
  });
  it("keeps approved statuses, internal plans and completed runs distinct from launch/delivery proof", () => {
    const guide = buildWorkspaceStartGuide(snapshot({ approvedPackageCount: 2, approvedDraftCount: 1, campaignCount: 1, draftOnlyPlanCount: 1, otherPublishedPlanCount: 1, runCount: 1, completedRunCount: 1 }));
    expect(guide.recommendation.href).toBe("/campaigns");
    expect(guide.recommendation.reason).toContain("checks can still block launch");
    expect(guide.stages.find(s => s.key === "package")?.boundary).toContain("separate from draft approval");
    expect(guide.stages.find(s => s.key === "prepare")?.boundary).toContain("does not approve drafts");
    expect(guide.stages.find(s => s.key === "launch")?.boundary).toContain("not external publication");
    expect(guide.stages.find(s => s.key === "monitor")?.boundary).toContain("not a delivery receipt");
    expect(guide.stages.every(s => s.action.href.startsWith("/") && !s.action.href.startsWith("/api/"))).toBe(true);
  });
  it("never infers healthy intake from enablement or an empty package list", () => {
    const guide = buildWorkspaceStartGuide(snapshot({ sourceCount: 4, enabledSourceCount: 4 }));
    expect(guide.recommendation.reason).toContain("Enablement alone is not connection health");
    expect(guide.stages.find(s => s.key === "source")?.boundary).toContain("does not interpret full content");
  });
  it("preserves read-only guidance even with all apparent milestones present", () => {
    const guide = buildWorkspaceStartGuide(snapshot({ role: "viewer", approvedDraftCount: 1, campaignCount: 1, approvedPackageCount: 1, draftCount: 1 }));
    expect(guide.recommendation.key).toBe("inspect_drafts");
    expect(guide.canWrite).toBe(false); expect(guide.canReview).toBe(false);
    expect(guide.stages.find(s => s.key === "launch")?.handoff).toContain("editor");
  });
  it("uses a campaign inspection handoff for a workflow-only request without granting approval", () => {
    expect(buildWorkspaceStartGuide(snapshot({ role: "editor", pendingWorkflowApprovals: 1 })).recommendation)
      .toMatchObject({ key: "reviewer_handoff", href: "/campaigns" });
  });
  it("is pure and freezes advisory collections without shared per-user state", () => {
    const input = Object.freeze(snapshot({ sourceCount: 2 })), before = JSON.stringify(input);
    const a = buildWorkspaceStartGuide(input), b = buildWorkspaceStartGuide(snapshot({ role: "viewer" }));
    expect(JSON.stringify(input)).toBe(before); expect(a.canWrite).toBe(true); expect(b.canWrite).toBe(false);
    expect(Object.isFrozen(a)).toBe(true); expect(Object.isFrozen(a.recommendation)).toBe(true); expect(Object.isFrozen(a.stages)).toBe(true);
    expect(a.stages.every(s => Object.isFrozen(s) && Object.isFrozen(s.action))).toBe(true);
  });
  it.each(["future_role", "organization_owner", "__proto__"])("fails closed for unsupported role %s", role => {
    expect(() => buildWorkspaceStartGuide(snapshot({ role: role as WorkspaceRole }))).toThrow("Current workspace role");
  });
});
