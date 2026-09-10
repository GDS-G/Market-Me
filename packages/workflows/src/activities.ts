import type { CampaignRepository } from "@market-me/database";
import type { CampaignActivities, CampaignStepExecution, CampaignStepExecutionInput } from "./types";

export function createCampaignActivities(repository: CampaignRepository, executor?: { execute(input: CampaignStepExecutionInput): Promise<CampaignStepExecution> }): CampaignActivities {
  return {
    setInstanceState: ({ instanceId, status }) => repository.setInstanceStatus(instanceId, status),
    setStepState: (input) => repository.setStepRunState(input),
    requestStepApproval: (input) => repository.ensureStepApproval(input),
    executeStep: async (input) => {
      await repository.assertStepExecutionAuthorized(input.instanceId, input.stepKey);
      return executor?.execute(input) ?? { status: "manual_required", reason: "No execution router is configured." };
    },
  };
}
