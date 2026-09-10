import { patched } from "@temporalio/workflow";
import { campaignWorkflowLegacy } from "./legacy-workflow";
import { campaignWorkflowScheduled } from "./scheduled-workflow";
import type { CampaignWorkflowInput, CampaignWorkflowState } from "./types";

export {
  campaignState, campaignSuccessReached, cancelCampaign, completeManualStep,
  decideCampaignApproval, pauseCampaign, resumeCampaign,
} from "./legacy-workflow";

export async function campaignWorkflow(input: CampaignWorkflowInput): Promise<CampaignWorkflowState> {
  // Keep the unmarked 1.19 command path until all such histories leave retention.
  return patched("bounded-scheduling-v1")
    ? campaignWorkflowScheduled(input)
    : campaignWorkflowLegacy(input);
}
