/** Test-only 1.52 entry point; the command source is frozen by a normalized SHA-256 assertion. */
import { patched } from "@temporalio/workflow";
import { campaignWorkflowLegacy } from "./legacy-workflow";
import { campaignWorkflowScheduled } from "./scheduled-pre-hold-workflow";
import type { CampaignWorkflowInput, CampaignWorkflowState } from "./types";

export async function campaignWorkflow(input: CampaignWorkflowInput): Promise<CampaignWorkflowState> {
  return patched("bounded-scheduling-v1") ? campaignWorkflowScheduled(input) : campaignWorkflowLegacy(input);
}
