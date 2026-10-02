import { patched } from "@temporalio/workflow";
import { campaignWorkflowLegacyControlled } from "./legacy-execution-control-workflow";
import { campaignWorkflowScheduled } from "./scheduled-workflow";
import type { CampaignWorkflowInput, CampaignWorkflowState } from "./types";

export {
  campaignState, campaignSuccessReached, cancelCampaign, completeManualStep,
  decideCampaignApproval, pauseCampaign, resumeCampaign,
} from "./legacy-workflow";

export async function campaignWorkflow(input: CampaignWorkflowInput): Promise<CampaignWorkflowState> {
  // The compatibility derivative adds commands only for the new held result;
  // unmarked 1.19 histories retain their exact earlier command path.
  return patched("bounded-scheduling-v1")
    ? campaignWorkflowScheduled(input)
    : campaignWorkflowLegacyControlled(input);
}
