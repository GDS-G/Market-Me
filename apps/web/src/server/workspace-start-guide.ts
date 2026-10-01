import type { WorkspaceRole, WorkspaceStartSnapshot } from "@market-me/database";

export const WORKSPACE_START_STAGE_KEYS = Object.freeze(["source", "package", "prepare", "review", "launch", "monitor"] as const);
export type WorkspaceStartStageKey = (typeof WORKSPACE_START_STAGE_KEYS)[number];
export interface StartGuideAction { readonly label: string; readonly href: string }
export interface StartGuideRecommendation extends StartGuideAction { readonly key: string; readonly title: string; readonly reason: string }
export interface StartGuideStage {
  readonly key: WorkspaceStartStageKey;
  readonly title: string;
  readonly description: string;
  readonly evidence: string;
  readonly boundary: string;
  readonly handoff?: string;
  readonly signal: "empty" | "saved" | "attention";
  readonly action: StartGuideAction;
}
export interface WorkspaceStartGuide {
  readonly canWrite: boolean;
  readonly canReview: boolean;
  readonly roleSummary: string;
  readonly recommendation: StartGuideRecommendation;
  readonly stages: readonly StartGuideStage[];
}

const roleDescriptions: Readonly<Record<WorkspaceRole, string>> = Object.freeze({
  owner: "You can prepare work and review eligible requests. Every approval and launch still needs its own checks.",
  admin: "You can prepare work and review eligible requests. Every approval and launch still needs its own checks.",
  editor: "You can configure intake and prepare drafts. An owner, admin or approver must make approval decisions.",
  approver: "You can review eligible packages and approval requests. An owner, admin or editor prepares and launches work.",
  analyst: "You can inspect saved work. Ask a writer to prepare it and a reviewer to make approval decisions.",
  viewer: "You can inspect saved work. Ask a writer to prepare it and a reviewer to make approval decisions.",
});
const writers: readonly WorkspaceRole[] = Object.freeze(["owner", "admin", "editor"]);
const reviewers: readonly WorkspaceRole[] = Object.freeze(["owner", "admin", "approver"]);
const writerHandoff = "An owner, admin or editor handles this step.";
const reviewerHandoff = "An owner, admin or approver reviews eligible requests. Opening this guide grants no approval authority.";
const count = (value: number, noun: string, plural = `${noun}s`) => `${value} ${value === 1 ? noun : plural}`;

/** Advisory navigation only. No eligibility, per-item lineage, or automatic action is inferred from totals. */
export function buildWorkspaceStartGuide(s: WorkspaceStartSnapshot): WorkspaceStartGuide {
  if (!Object.hasOwn(roleDescriptions, s.role)) throw new Error("Current workspace role is required for the start guide.");
  const canWrite = writers.includes(s.role), canReview = reviewers.includes(s.role);
  const pending = s.pendingDraftApprovals > 0 || s.pendingWorkflowApprovals > 0;
  const approvalsReason = `${count(s.pendingDraftApprovals, "draft request")} and ${count(s.pendingWorkflowApprovals, "workflow request")} are pending in this workspace. They are not necessarily assigned to you; inspect each captured review before deciding.`;
  let recommendation: StartGuideRecommendation;
  if (canReview && pending) {
    recommendation = { key: "pending_approvals", title: "Decisions are waiting", reason: approvalsReason, label: "Inspect pending approvals", href: "/approvals" };
  } else if (s.attentionRunCount > 0) {
    recommendation = { key: "run_attention", title: "Check work that needs attention", reason: `${count(s.attentionRunCount, "run")} ${s.attentionRunCount === 1 ? "is" : "are"} paused or failed. Inspect the recorded reason and existing results before considering any recovery.`, label: "Inspect campaign runs", href: "/campaigns" };
  } else if (canReview && s.packagesToReview > 0) {
    recommendation = { key: "package_review", title: "Review incoming content", reason: `${count(s.packagesToReview, "package")} ${s.packagesToReview === 1 ? "is" : "are"} marked ready or needs review. Check current facts, conflicts and rights; the label alone is not approval eligibility.`, label: "Review content packages", href: "/content-packages" };
  } else if (canWrite && s.draftsToEdit > 0) {
    recommendation = { key: "draft_edit", title: "Continue preparing the copy", reason: `${count(s.draftsToEdit, "draft")} ${s.draftsToEdit === 1 ? "is" : "are"} working, rejected or changes requested. Inspect the evidence and make the necessary revisions before requesting review.`, label: "Inspect drafts to revise", href: "/drafts" };
  } else if (s.openRunCount > 0) {
    recommendation = { key: "open_runs", title: "Follow the work already in progress", reason: `${count(s.openRunCount, "run")} ${s.openRunCount === 1 ? "is" : "are"} awaiting approval, scheduled, active or paused. Saved timing and state do not guarantee delivery.`, label: "View campaign agenda", href: "/calendar" };
  } else if (pending) {
    recommendation = { key: "reviewer_handoff", title: "A reviewer is needed", reason: approvalsReason + " Your current role cannot approve these requests.",
      label: s.pendingDraftApprovals > 0 ? "Inspect existing drafts" : "Inspect campaigns", href: s.pendingDraftApprovals > 0 ? "/drafts" : "/campaigns" };
  } else if (canWrite && s.approvedDraftCount > 0 && s.campaignCount > 0) {
    recommendation = { key: "launch_review", title: "Inspect the next launch prerequisites", reason: `${count(s.approvedDraftCount, "draft")} ${s.approvedDraftCount === 1 ? "is" : "are"} marked approved. Open the matching campaign's original preparation receipt to inspect finalization. Current package, draft, preview, account and policy checks can still block launch.`, label: "Inspect prepared campaigns", href: "/campaigns" };
  } else if (canWrite && s.approvedPackageCount > 0 && s.draftCount === 0) {
    recommendation = { key: "prepare", title: "Turn reviewed content into drafts", reason: `${count(s.approvedPackageCount, "package")} ${s.approvedPackageCount === 1 ? "is" : "are"} marked approved and no unarchived drafts are saved. Preparation rechecks the exact current approval before creating a draft-only plan and copy.`, label: "Prepare a campaign", href: "/campaigns/prepare" };
  } else if (s.failedPackageCount > 0) {
    recommendation = { key: "package_attention", title: "Inspect content that could not finish", reason: `${count(s.failedPackageCount, "package")} ${s.failedPackageCount === 1 ? "is" : "are"} marked failed. Inspect the package and source history; this guide does not retry processing.`, label: "Inspect content packages", href: "/content-packages" };
  } else if (s.draftCount > 0) {
    recommendation = { key: "inspect_drafts", title: "Continue from the saved drafts", reason: `${count(s.draftCount, "unarchived draft")} ${s.draftCount === 1 ? "is" : "are"} saved. Inspect the current review state and ask an appropriate collaborator to handle the next action.`, label: "Inspect drafts", href: "/drafts" };
  } else if (s.packageCount > 0) {
    recommendation = { key: "inspect_packages", title: "Continue from the saved content", reason: `${count(s.packageCount, "package")} ${s.packageCount === 1 ? "is" : "are"} saved. Inspect interpretation and current review state; a writer prepares content and a reviewer approves the exact version.`, label: "Inspect content packages", href: "/content-packages" };
  } else if (s.campaignCount > 0 || s.runCount > 0) {
    recommendation = { key: "inspect_campaigns", title: "Inspect the saved campaign history", reason: "Campaign or run records already exist. Review their current plans and results before starting unrelated setup; a completed run is not proof of external delivery.", label: "Inspect campaigns", href: "/campaigns" };
  } else if (canWrite && s.sourceCount === 0) {
    recommendation = { key: "create_source", title: "Start with a folder", reason: "No Smart Source is configured. Choose where content arrives, review the folder and intake rules, then save a paused source. Nothing is activated by this guide.", label: "Set up a Smart Source", href: "/smart-sources/new" };
  } else if (s.sourceCount > 0) {
    recommendation = { key: "inspect_sources", title: s.enabledSourceCount ? "Check the content intake" : "Review the paused intake setup",
      reason: `${count(s.sourceCount, "source")} ${s.sourceCount === 1 ? "is" : "are"} configured, ${s.enabledSourceCount} enabled, and no packages are saved. Inspect folder access, rules and the metadata dry test before separately choosing synchronization. Enablement alone is not connection health.`,
      label: "Inspect Smart Sources", href: "/smart-sources" };
  } else {
    recommendation = { key: "writer_handoff", title: "Start with a workspace writer", reason: "No intake, content or campaigns are saved. An owner, admin or editor can connect a folder and prepare work. You can return here to inspect progress with your current role.", label: "View the workspace team", href: "/team" };
  }

  const stages: StartGuideStage[] = [
    { key: "source", title: "Choose where content arrives", description: "Connect a cloud folder or the local Companion, then save a Smart Source with the intake rules you reviewed.",
      evidence: `${count(s.sourceCount, "configured source")} · ${s.enabledSourceCount} enabled`, signal: s.sourceCount ? "saved" : "empty",
      boundary: "New guided sources start paused. A metadata dry test explains intake rules; it does not interpret full content, prove connection health or activate processing.",
      ...(!canWrite ? { handoff: writerHandoff } : {}), action: canWrite && !s.sourceCount ? { label: "Set up a Smart Source", href: "/smart-sources/new" } : { label: "Inspect Smart Sources", href: "/smart-sources" } },
    { key: "package", title: "Check what the content means", description: "A Content Package groups incoming material and supporting facts. Inspect interpretation, correct evidence, resolve conflicts and review rights before exact approval.",
      evidence: `${count(s.packageCount, "package")} · ${s.packagesToReview} ready or needing review · ${s.approvedPackageCount} marked approved · ${s.failedPackageCount} failed`,
      signal: s.packagesToReview || s.failedPackageCount ? "attention" : s.packageCount ? "saved" : "empty",
      boundary: "Package approval is separate from draft approval or permission to publish. Current content and policy are checked again by later steps.",
      ...(!canReview ? { handoff: reviewerHandoff } : {}), action: { label: canReview ? "Review content packages" : "Inspect content packages", href: "/content-packages" } },
    { key: "prepare", title: "Prepare a campaign and copy", description: "Start with an approved package. Review General Announcement settings, optionally copy a saved preset, and prepare evidence-backed draft variants.",
      evidence: `${count(s.campaignCount, "unarchived campaign")} · ${count(s.draftOnlyPlanCount, "current draft-only published plan")}`, signal: s.campaignCount ? "saved" : "empty",
      boundary: "Preparation creates a draft-only internal plan and working copy. It does not approve drafts, activate a run or send anything externally.",
      ...(!canWrite ? { handoff: writerHandoff } : {}), action: canWrite ? { label: "Open review-first preparation", href: "/campaigns/prepare" } : { label: "Inspect saved campaigns", href: "/campaigns" } },
    { key: "review", title: "Review and approve the exact draft", description: "Inspect the wording, evidence and required channel previews. A writer requests review; an eligible reviewer decides on the captured version.",
      evidence: `${count(s.draftCount, "unarchived draft")} · ${s.draftsToEdit} to revise · ${count(s.pendingDraftApprovals, "pending request")} · ${s.approvedDraftCount} marked approved`,
      signal: s.pendingDraftApprovals || s.draftsToEdit ? "attention" : s.draftCount ? "saved" : "empty",
      boundary: "Changes can require a new review. A stored approved status does not establish current preview, account, rights or launch eligibility.",
      ...(!canReview ? { handoff: reviewerHandoff } : {}), action: canReview && s.pendingDraftApprovals > 0 ? { label: "Inspect pending approvals", href: "/approvals" } : { label: "Inspect drafts and review state", href: "/drafts" } },
    { key: "launch", title: "Review the final plan before launch", description: "For prepared work, open its original preparation receipt in Campaigns. Review finalization and any supported channel previews, then separately inspect activation requirements.",
      evidence: `${count(s.otherPublishedPlanCount, "other current published plan")} · ${count(s.pendingWorkflowApprovals, "pending workflow request")}`,
      signal: s.pendingWorkflowApprovals ? "attention" : s.otherPublishedPlanCount ? "saved" : "empty",
      boundary: "An internal published plan is not external publication. Finalization, activation and workflow approval remain separate, checked operations; unsupported capabilities stay blocked.",
      ...(!canWrite ? { handoff: writerHandoff } : {}), action: { label: "Inspect campaigns and preparation receipts", href: "/campaigns" } },
    { key: "monitor", title: "Follow results and handle interruptions", description: "Use Campaigns and Calendar to inspect saved run state, timing, individual action results and recovery guidance.",
      evidence: `${count(s.runCount, "run")} · ${s.openRunCount} open · ${s.attentionRunCount} paused or failed · ${s.completedRunCount} marked completed`,
      signal: s.attentionRunCount ? "attention" : s.runCount ? "saved" : "empty",
      boundary: "A completed run is not a delivery receipt or engagement result. Inspect external action evidence; never restart successful steps just to recover another step.",
      action: { label: "View the campaign agenda", href: "/calendar" } },
  ];
  return Object.freeze({ canWrite, canReview, roleSummary: roleDescriptions[s.role], recommendation: Object.freeze(recommendation),
    stages: Object.freeze(stages.map(stage => Object.freeze({ ...stage, action: Object.freeze(stage.action) }))) });
}
