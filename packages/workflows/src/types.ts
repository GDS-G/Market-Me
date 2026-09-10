import type { CampaignWorkflowDefinition } from "@market-me/database";
import type {
  CampaignSuccessAction,
  CampaignSuccessEvaluation,
} from "@market-me/domain";

export type CampaignWorkflowInput = CampaignWorkflowDefinition;
export type ApprovalDecision = "approved" | "rejected" | "changes_requested";
export interface CampaignSuccessSignal {
  criteria: readonly CampaignSuccessEvaluation[];
  action?: CampaignSuccessAction;
  measuredAt: string;
  triggerKey?: string;
  triggerSource?: "measurement_event" | "mailchimp_campaign_report";
  triggerEventKey?: string;
}
export interface CampaignWorkflowState {
  status:
    "scheduled" | "awaiting_approval" | "active" | "paused" | "completed" | "failed" | "canceled";
  paused: boolean;
  canceled: boolean;
  stepStates: Readonly<
    Record<
      string,
      | "planned"
      | "waiting"
      | "running"
      | "succeeded"
      | "partially_succeeded"
      | "failed"
      | "canceled"
    >
  >;
  context: Readonly<Record<string, unknown>>;
}

export interface CampaignActivities {
  setInstanceState(input: {
    instanceId: string;
    status: "awaiting_approval" | "active" | "paused" | "completed" | "failed" | "canceled";
  }): Promise<void>;
  setStepState(input: {
    instanceId: string;
    stepKey: string;
    status:
      | "waiting"
      | "running"
      | "succeeded"
      | "partially_succeeded"
      | "permanently_failed"
      | "canceled"
      | "manual_resolution";
    output?: Record<string, unknown>;
    error?: string;
  }): Promise<void>;
  requestStepApproval(input: {
    instanceId: string;
    stepKey: string;
    snapshot: Record<string, unknown>;
  }): Promise<string>;
  executeStep(
    input: CampaignStepExecutionInput,
  ): Promise<CampaignStepExecution>;
}

export interface CampaignStepExecutionInput {
  instanceId: string;
  stepKey: string;
  context: Readonly<Record<string, unknown>>;
}

export type CampaignStepExecution =
  | { status: "succeeded"; output: Record<string, unknown> }
  | { status: "manual_required"; reason: string };
