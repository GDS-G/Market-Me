// Frozen workflow-only 1.19 policy decisions. Change new behavior in the V2 path.
import type { CampaignStep } from "@market-me/domain";

export interface CampaignExecutionIssue {
  code: "autonomy_execution_disabled" | "reserved_step" | "unsupported_schedule" | "unsupported_condition" | "invalid_schedule";
  stepId?: string;
  message: string;
}

/** Activation/runtime checks are separate from authoring so unsupported plans remain editable. */
export function validateCampaignExecution(
  autonomyMode: string,
  steps: readonly CampaignStep[],
): readonly CampaignExecutionIssue[] {
  const issues: CampaignExecutionIssue[] = [];
  if (!["approval_required", "approve_uncertain", "approve_first_occurrence", "campaign_approval", "confidence_based", "fully_autonomous", "custom"].includes(autonomyMode)) {
    issues.push({ code: "autonomy_execution_disabled", message: "This campaign's autonomy mode does not authorize execution. Keep it for drafting or select an execution mode before activation." });
  }
  for (const step of steps) {
    if (step.id === "__campaign__") {
      issues.push({ code: "reserved_step", stepId: step.id, message: "The step ID __campaign__ is reserved for campaign approval. Choose another step ID." });
    }
    if (Object.keys(step.condition ?? {}).length > 0) {
      issues.push({ code: "unsupported_condition", stepId: step.id, message: `Step ${step.name} has an execution condition that is not implemented. Its saved condition is preserved; conditional execution cannot be activated yet.` });
    }
    const schedule = step.scheduleType ?? "immediate";
    if (!["immediate", "exact_time", "dependency"].includes(schedule)) {
      issues.push({ code: "unsupported_schedule", stepId: step.id, message: `Step ${step.name} uses ${schedule.replaceAll("_", " ")} scheduling, which is not implemented. Its saved plan is preserved; choose immediate, exact time, or dependency scheduling before activation.` });
    } else if (schedule === "exact_time" && (!step.scheduledAt || !Number.isFinite(Date.parse(step.scheduledAt)))) {
      issues.push({ code: "invalid_schedule", stepId: step.id, message: `Step ${step.name} requires a valid exact execution time.` });
    }
  }
  return issues;
}

/** Without reviewed confidence/history evidence, conditional approval modes cannot waive review. */
export function campaignStepRequiresApproval(autonomyMode: string, step: CampaignStep): boolean {
  if (step.approvalRequired || step.operationType === "request_approval") return true;
  if (step.operationType === "wait") return false;
  return autonomyMode !== "fully_autonomous" && autonomyMode !== "custom" && autonomyMode !== "campaign_approval";
}


