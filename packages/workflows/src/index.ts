import { Connection, WorkflowClient } from "@temporalio/client";
import type {
  CampaignRepository,
  CampaignWorkflowCommand,
} from "@market-me/database";
import type { CampaignSuccessSignal } from "./types";
import {
  campaignSuccessReached,
  campaignWorkflow,
  cancelCampaign,
  completeManualStep,
  decideCampaignApproval,
  pauseCampaign,
  resumeCampaign,
} from "./workflows";

export * from "./types";
export * from "./workflows";
export * from "./activities";

export interface CampaignDispatcherOptions {
  address: string;
  namespace?: string;
  taskQueue: string;
}

export class CampaignWorkflowDispatcher {
  private constructor(
    private readonly repository: CampaignRepository,
    private readonly connection: Connection,
    private readonly client: WorkflowClient,
    private readonly taskQueue: string,
  ) {}

  static async connect(
    repository: CampaignRepository,
    options: CampaignDispatcherOptions,
  ): Promise<CampaignWorkflowDispatcher> {
    const connection = await Connection.connect({ address: options.address });
    const client = new WorkflowClient({
      connection,
      namespace: options.namespace ?? "default",
    });
    return new CampaignWorkflowDispatcher(
      repository,
      connection,
      client,
      options.taskQueue,
    );
  }

  async processReadyCommands(
    limit: number,
  ): Promise<{ completed: number; failed: number }> {
    const commands = await this.repository.claimWorkflowCommands(limit);
    let completed = 0;
    let failed = 0;
    for (const command of commands) {
      try {
        await this.dispatch(command);
        await this.repository.finishWorkflowCommand(command.id);
        completed++;
      } catch (error) {
        await this.repository.finishWorkflowCommand(
          command.id,
          error instanceof Error
            ? error.message
            : "Unknown Temporal command error",
        );
        failed++;
      }
    }
    return { completed, failed };
  }

  async close(): Promise<void> {
    await this.connection.close();
  }

  private async dispatch(command: CampaignWorkflowCommand): Promise<void> {
    const workflowId = `campaign-${command.campaignInstanceId}`;
    if (command.commandType === "start") {
      const definition = await this.repository.getWorkflowDefinition(
        command.campaignInstanceId,
      );
      if (!definition)
        throw new Error("Campaign workflow definition not found");
      try {
        const handle = await this.client.start(campaignWorkflow, {
          taskQueue: this.taskQueue,
          workflowId,
          args: [definition],
        });
        await this.repository.markWorkflowStarted(
          command.campaignInstanceId,
          workflowId,
          handle.firstExecutionRunId,
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.name !== "WorkflowExecutionAlreadyStartedError"
        )
          throw error;
        await this.repository.markWorkflowStarted(
          command.campaignInstanceId,
          workflowId,
        );
      }
      return;
    }
    const handle = this.client.getHandle(workflowId);
    if (command.commandType === "pause") await handle.signal(pauseCampaign);
    else if (command.commandType === "resume")
      await handle.signal(resumeCampaign);
    else if (command.commandType === "cancel")
      await handle.signal(cancelCampaign);
    else if (command.commandType === "approval_decision")
      await handle.signal(
        decideCampaignApproval,
        command.payload as {
          stepKey: string;
          decision: "approved" | "rejected" | "changes_requested";
        },
      );
    else if (command.commandType === "manual_step_completed")
      await handle.signal(
        completeManualStep,
        command.payload as { stepKey: string; output: Record<string, unknown> },
      );
    else if (command.commandType === "success_criteria_met")
      await handle.signal(
        campaignSuccessReached,
        command.payload as unknown as CampaignSuccessSignal,
      );
    else
      throw new Error(
        `Unsupported campaign command type: ${String(command.commandType)}`,
      );
  }
}
