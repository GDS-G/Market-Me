import { CampaignScheduleNotReadyError, type CampaignRepository } from "@market-me/database";
import { assertScheduleEvidence } from "./schedule-evidence";
import type {
  CampaignScheduledStepExecutionInput, CampaignSchedulingActivities, CampaignStepExecution, CampaignStepExecutionInput,
} from "./types";

export interface CampaignStepExecutor {
  execute(input: CampaignStepExecutionInput): Promise<CampaignStepExecution>;
  /**
   * Read-only exact-target recovery, before time/active-state checks.
   * Undefined proves no prior dispatch (or a known failed action); unresolved dispatches return manual_required.
   * No preflight, tracked link creation, media work, credential access or provider requests belong here.
   */
  recoverScheduledExecution?(input: CampaignScheduledStepExecutionInput): Promise<Exclude<CampaignStepExecution, { status: "schedule_blocked" }> | undefined>;
}

export function createCampaignActivities(repository: CampaignRepository, executor?: CampaignStepExecutor): CampaignSchedulingActivities {
  return {
    setInstanceState: ({ instanceId, status }) => repository.setInstanceStatus(instanceId, status),
    setStepState: (input) => repository.setStepRunState(input),
    requestStepApproval: (input) => repository.ensureStepApproval(input),
    executeStep: async (input) => {
      await repository.assertStepExecutionAuthorized(input.instanceId, input.stepKey);
      return executor?.execute(input) ?? { status: "manual_required", reason: "No execution router is configured." };
    },
    getStepScheduleState: async ({ instanceId, stepKey }) => {
      const schedule = await repository.getStepScheduleState(instanceId, stepKey);
      if (!schedule) throw new Error("Stored campaign schedule target is unavailable.");
      return schedule;
    },
    executeScheduledStep: async (input) => {
      const schedule = await repository.getStepScheduleState(input.instanceId, input.stepKey);
      if (!schedule) throw new Error("Stored campaign schedule target is unavailable.");
      assertScheduleEvidence(input, schedule);
      if (!executor?.recoverScheduledExecution) {
        return { status: "manual_required", reason: "This execution router does not support safe scheduled-execution recovery." };
      }
      // An already accepted/uncertain write must not be reclassified as safely expired on retry.
      const recovered = await executor.recoverScheduledExecution(input);
      if (recovered) return recovered;
      try {
        // This re-reads DB time after recovery and verifies active state, policy/approval, and dependency evidence.
        await repository.assertStepExecutionAuthorized(input.instanceId, input.stepKey, { allowBoundedScheduling: true });
        return await executor.execute(input);
      } catch (error) {
        if (!(error instanceof CampaignScheduleNotReadyError) || error.schedule.state !== "expired") throw error;
        // Admission/preflight may have waited on locks while a different attempt won the dispatch claim.
        const concurrentRecovery = await executor.recoverScheduledExecution(input);
        if (concurrentRecovery) return concurrentRecovery;
        assertScheduleEvidence(input, error.schedule);
        return { status: "schedule_blocked", reason: error.message, schedule: error.schedule };
      }
    },
  };
}
