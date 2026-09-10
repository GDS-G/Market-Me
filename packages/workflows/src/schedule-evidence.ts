import type { StoredStepScheduleState } from "@market-me/database";
import type { CampaignScheduledStepExecutionInput } from "./types";

/** Scheduling evidence is useful only when it resolves the exact pinned execution target. */
export function assertScheduleEvidence(
  input: Omit<CampaignScheduledStepExecutionInput, "context" | "campaignStepRunId"> & { campaignStepRunId?: string },
  schedule: StoredStepScheduleState,
): void {
  if (schedule.workspaceId !== input.workspaceId || schedule.campaignId !== input.campaignId
    || schedule.campaignInstanceId !== input.instanceId || schedule.campaignVersionId !== input.campaignVersionId
    || schedule.stepKey !== input.stepKey || !schedule.campaignStepRunId
    || (input.campaignStepRunId !== undefined && schedule.campaignStepRunId !== input.campaignStepRunId)) {
    throw new Error("Stored schedule evidence does not match the immutable campaign execution target.");
  }
  for (const instant of [schedule.evaluatedAt, schedule.notBefore, schedule.deadline]) {
    if (instant !== undefined && !Number.isFinite(Date.parse(instant))) throw new Error("Stored schedule evidence contains an invalid clock or bound.");
  }
}
