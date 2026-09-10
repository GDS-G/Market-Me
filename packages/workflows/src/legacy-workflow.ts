// Command/timer logic frozen from 8e7c3df (1.19); retain until legacy histories leave retention.
import {
  allHandlersFinished,
  CancellationScope,
  condition,
  defineQuery,
  defineSignal,
  isCancellation,
  proxyActivities,
  setHandler,
  sleep,
} from "@temporalio/workflow";
import type { CampaignStep } from "@market-me/domain";
import { campaignStepRequiresApproval, validateCampaignExecution } from "./legacy-policies";
import type {
  ApprovalDecision,
  CampaignActivities,
  CampaignSuccessSignal,
  CampaignWorkflowInput,
  CampaignWorkflowState,
} from "./types";

export const pauseCampaign = defineSignal("pauseCampaign");
export const resumeCampaign = defineSignal("resumeCampaign");
export const cancelCampaign = defineSignal("cancelCampaign");
export const decideCampaignApproval = defineSignal<
  [{ stepKey: string; decision: ApprovalDecision }]
>("decideCampaignApproval");
export const completeManualStep =
  defineSignal<[{ stepKey: string; output: Record<string, unknown> }]>(
    "completeManualStep",
  );
export const campaignSuccessReached = defineSignal<[CampaignSuccessSignal]>(
  "campaignSuccessReached",
);
export const campaignState =
  defineQuery<CampaignWorkflowState>("campaignState");

export async function campaignWorkflowLegacy(
  input: CampaignWorkflowInput,
): Promise<CampaignWorkflowState> {
  let paused = false;
  let canceled = false;
  let campaignApprovalGranted = input.autonomyMode !== "campaign_approval";
  let status: CampaignWorkflowState["status"] = "scheduled";
  const stepStates: Record<
    string,
    | "planned"
    | "waiting"
    | "running"
    | "succeeded"
    | "partially_succeeded"
    | "failed"
    | "canceled"
  > = Object.fromEntries(input.steps.map((step) => [step.id, "planned"]));
  const approvalDecisions = new Map<string, ApprovalDecision>();
  const manualOutputs = new Map<string, Record<string, unknown>>();
  const context: Record<string, unknown> = { ...input.context };
  const activeStepScopes = new Set<CancellationScope>();
  const instanceActivities = proxyActivities<CampaignActivities>({
    startToCloseTimeout: "1 minute",
    retry: { maximumAttempts: 5 },
  });

  setHandler(pauseCampaign, async () => {
    paused = true;
    status = "paused";
    await instanceActivities.setInstanceState({
      instanceId: input.instanceId,
      status: "paused",
    });
  });
  setHandler(resumeCampaign, async () => {
    paused = false;
    status = campaignApprovalGranted ? "active" : "awaiting_approval";
    await instanceActivities.setInstanceState({
      instanceId: input.instanceId,
      status,
    });
  });
  setHandler(cancelCampaign, () => {
    canceled = true;
    paused = false;
    status = "canceled";
    for (const scope of activeStepScopes) scope.cancel();
  });
  setHandler(decideCampaignApproval, ({ stepKey, decision }) => {
    approvalDecisions.set(stepKey, decision);
  });
  setHandler(completeManualStep, ({ stepKey, output }) => {
    manualOutputs.set(stepKey, output);
  });
  setHandler(campaignSuccessReached, async (signal) => {
    if (context["measurement.success"]) return;
    const normalizedSignal = {
      ...signal,
      action: signal.action ?? "notify_only",
      triggerKey: signal.triggerKey ?? signal.triggerEventKey ?? "unknown",
      triggerSource: signal.triggerSource ?? "measurement_event",
    };
    context["measurement.success"] = normalizedSignal;
    if (normalizedSignal.action === "pause") {
      paused = true;
      status = "paused";
      await instanceActivities.setInstanceState({
        instanceId: input.instanceId,
        status: "paused",
      });
    }
  });
  setHandler(campaignState, () => ({
    status,
    paused,
    canceled,
    stepStates: { ...stepStates },
    context: { ...context },
  }));

  try {
    const executionIssues = validateCampaignExecution(input.autonomyMode, input.steps);
    if (executionIssues.length) {
      status = "failed";
      context["execution.validation"] = executionIssues;
      await instanceActivities.setInstanceState({ instanceId: input.instanceId, status });
      await condition(allHandlersFinished);
      return { status, paused, canceled, stepStates, context };
    }
    if (input.autonomyMode === "campaign_approval") {
      status = "awaiting_approval";
      await instanceActivities.setInstanceState({ instanceId: input.instanceId, status });
      await instanceActivities.requestStepApproval({
        instanceId: input.instanceId,
        stepKey: "__campaign__",
        snapshot: {
          name: "Approve campaign execution",
          approvalScope: "campaign",
          campaignVersionId: input.campaignVersionId,
          timezone: input.timezone,
          steps: input.steps,
        },
      });
      await condition(() => (approvalDecisions.has("__campaign__") && !paused) || canceled);
      if (!canceled && approvalDecisions.get("__campaign__") !== "approved") {
        status = "failed";
        await instanceActivities.setInstanceState({ instanceId: input.instanceId, status });
        await condition(allHandlersFinished);
        return { status, paused, canceled, stepStates, context };
      }
      approvalDecisions.delete("__campaign__");
      campaignApprovalGranted = !canceled;
    }
    if (!canceled) {
      status = "active";
      await instanceActivities.setInstanceState({ instanceId: input.instanceId, status });
    }
    while (
      !canceled &&
      Object.values(stepStates).some((state) => state === "planned")
    ) {
      await condition(() => !paused || canceled);
      if (canceled) break;
      const eligible = input.steps.filter(
        (step) =>
          stepStates[step.id] === "planned" &&
          step.dependsOn.every(
            (dependency) =>
              stepStates[dependency] === "succeeded" ||
              stepStates[dependency] === "partially_succeeded",
          ),
      );
      if (!eligible.length)
        throw new Error(
          "No eligible campaign steps remain; dependency state is blocked.",
        );
      await Promise.all(
        eligible.map((step) =>
          executeStep(
            input,
            step,
            stepStates,
            approvalDecisions,
            manualOutputs,
            context,
            activeStepScopes,
            () => paused,
            () => canceled,
          ),
        ),
      );
    }
    if (canceled) {
      await instanceActivities.setInstanceState({
        instanceId: input.instanceId,
        status: "canceled",
      });
      await condition(allHandlersFinished);
      return { status: "canceled", paused, canceled, stepStates, context };
    }
    status = "completed";
    await instanceActivities.setInstanceState({
      instanceId: input.instanceId,
      status: "completed",
    });
    await condition(allHandlersFinished);
    return { status, paused, canceled, stepStates, context };
  } catch (error) {
    if (canceled && isCancellation(error)) {
      await CancellationScope.nonCancellable(async () => {
        for (const [stepKey, stepStatus] of Object.entries(stepStates)) {
          if (stepStatus === "waiting" || stepStatus === "running") {
            stepStates[stepKey] = "canceled";
            await instanceActivities.setStepState({
              instanceId: input.instanceId,
              stepKey,
              status: "canceled",
              error: "Campaign canceled.",
            });
          }
        }
        await instanceActivities.setInstanceState({
          instanceId: input.instanceId,
          status: "canceled",
        });
      });
      await condition(allHandlersFinished);
      return { status: "canceled", paused, canceled, stepStates, context };
    }
    status = "failed";
    await instanceActivities.setInstanceState({
      instanceId: input.instanceId,
      status: "failed",
    });
    throw error;
  }
}

async function executeStep(
  input: CampaignWorkflowInput,
  step: CampaignStep,
  stepStates: Record<
    string,
    | "planned"
    | "waiting"
    | "running"
    | "succeeded"
    | "partially_succeeded"
    | "failed"
    | "canceled"
  >,
  approvals: Map<string, ApprovalDecision>,
  manualOutputs: Map<string, Record<string, unknown>>,
  context: Record<string, unknown>,
  activeScopes: Set<CancellationScope>,
  isPaused: () => boolean,
  isCanceled: () => boolean,
): Promise<void> {
  const activities = proxyActivities<CampaignActivities>({
    startToCloseTimeout: `${step.timeoutSeconds ?? 300} seconds`,
    retry: { maximumAttempts: step.maxAttempts ?? 3 },
  });
  const scope = new CancellationScope();
  activeScopes.add(scope);
  try {
    await scope.run(async () => {
      stepStates[step.id] = "waiting";
      await activities.setStepState({
        instanceId: input.instanceId,
        stepKey: step.id,
        status: "waiting",
      });
      if (step.scheduleType === "exact_time" && step.scheduledAt) {
        const delay = Date.parse(step.scheduledAt) - Date.now();
        if (delay > 0) await sleep(delay);
      }
      if (step.operationType === "wait") {
        const durationSeconds =
          typeof step.inputs.durationSeconds === "number"
            ? step.inputs.durationSeconds
            : 0;
        if (durationSeconds > 0) await sleep(durationSeconds * 1000);
      }
      await condition(() => !isPaused() || isCanceled());
      if (campaignStepRequiresApproval(input.autonomyMode, step)) {
        await activities.requestStepApproval({
          instanceId: input.instanceId,
          stepKey: step.id,
          snapshot: {
            name: step.name,
            operationType: step.operationType,
            inputs: step.inputs,
            desiredCapability: step.desiredCapability,
            scheduledAt: step.scheduledAt,
            scheduleType: step.scheduleType ?? "immediate",
            executionMethods: step.executionMethods,
            autonomyMode: input.autonomyMode,
          },
        });
        await condition(
          () => (approvals.has(step.id) && !isPaused()) || isCanceled(),
        );
        const decision = approvals.get(step.id)!;
        approvals.delete(step.id);
        if (decision !== "approved") {
          if (!step.optional) {
            stepStates[step.id] = "failed";
            await activities.setStepState({
              instanceId: input.instanceId,
              stepKey: step.id,
              status: "permanently_failed",
              error: `Approval ${decision}.`,
            });
            throw new Error(
              `Approval ${decision} for required step ${step.id}.`,
            );
          }
          stepStates[step.id] = "partially_succeeded";
          await activities.setStepState({
            instanceId: input.instanceId,
            stepKey: step.id,
            status: "partially_succeeded",
            output: { skipped: true, approvalDecision: decision },
            error: `Optional step skipped after approval ${decision}.`,
          });
          return;
        }
      }
      if (
        step.operationType !== "wait" &&
        step.operationType !== "request_approval"
      ) {
        stepStates[step.id] = "running";
        await activities.setStepState({
          instanceId: input.instanceId,
          stepKey: step.id,
          status: "running",
        });
        const execution = await activities.executeStep({
          instanceId: input.instanceId,
          stepKey: step.id,
          context,
        });
        if (execution.status === "succeeded") {
          context[`steps.${step.id}`] = execution.output;
          stepStates[step.id] = "succeeded";
          await activities.setStepState({
            instanceId: input.instanceId,
            stepKey: step.id,
            status: "succeeded",
            output: execution.output,
          });
          return;
        }
        await activities.setStepState({
          instanceId: input.instanceId,
          stepKey: step.id,
          status: "manual_resolution",
          error: execution.reason,
        });
        await condition(
          () => (manualOutputs.has(step.id) && !isPaused()) || isCanceled(),
        );
      }
      if (stepStates[step.id] !== "running") {
        stepStates[step.id] = "running";
        await activities.setStepState({
          instanceId: input.instanceId,
          stepKey: step.id,
          status: "running",
        });
      }
      const output = manualOutputs.get(step.id) ?? {};
      manualOutputs.delete(step.id);
      context[`steps.${step.id}`] = output;
      stepStates[step.id] = "succeeded";
      await activities.setStepState({
        instanceId: input.instanceId,
        stepKey: step.id,
        status: "succeeded",
        output,
      });
    });
  } finally {
    activeScopes.delete(scope);
  }
}

