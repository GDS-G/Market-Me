import { allHandlersFinished, condition, proxyActivities, setHandler } from "@temporalio/workflow";
import { campaignStepRequiresApproval, validateCampaignExecution, validateCampaignGraph, type CampaignStep } from "@market-me/domain";
import type { StoredStepScheduleState } from "@market-me/database";
import {
  campaignState, campaignSuccessReached, cancelCampaign, completeManualStep,
  decideCampaignApproval, pauseCampaign, resumeCampaign,
} from "./legacy-workflow";
import { assertScheduleEvidence } from "./schedule-evidence";
import type {
  ApprovalDecision, CampaignSchedulingActivities, CampaignStepScheduleBlocked,
  CampaignWorkflowInput, CampaignWorkflowState,
} from "./types";

/** Independent branches use persisted predecessor completion clocks, never batch/wave start time. */
export async function campaignWorkflowScheduled(input: CampaignWorkflowInput): Promise<CampaignWorkflowState> {
  let paused = false;
  let canceled = false;
  let blocked = false;
  let failure: Error | undefined;
  let campaignApproved = input.autonomyMode !== "campaign_approval";
  let status: CampaignWorkflowState["status"] = "scheduled";
  let revision = 0;
  const states: Record<string, CampaignWorkflowState["stepStates"][string]> = Object.fromEntries(input.steps.map((step) => [step.id, "planned"]));
  const context: Record<string, unknown> = { ...input.context };
  const decisions = new Map<string, ApprovalDecision>();
  const requestedApprovals = new Set<string>();
  const manualOutputs = new Map<string, Record<string, unknown>>();
  const activities = proxyActivities<CampaignSchedulingActivities>({ startToCloseTimeout: "1 minute", retry: { maximumAttempts: 5 } });
  const stopped = () => canceled || blocked || failure !== undefined;
  const terminal = () => ["completed", "failed", "canceled"].includes(status);
  const snapshot = (): CampaignWorkflowState => ({ status, paused, canceled, stepStates: { ...states }, context: { ...context } });

  setHandler(campaignState, snapshot);
  setHandler(pauseCampaign, async () => {
    if (terminal() || blocked) return;
    paused = true; status = "paused"; revision++;
    await activities.setInstanceState({ instanceId: input.instanceId, status });
  });
  setHandler(resumeCampaign, async () => {
    if (terminal() || blocked) return;
    paused = false; status = campaignApproved ? "active" : "awaiting_approval"; revision++;
    await activities.setInstanceState({ instanceId: input.instanceId, status });
  });
  setHandler(cancelCampaign, () => {
    if (terminal()) return;
    canceled = true; paused = false; status = "canceled"; revision++;
    // Conditions/timers wake now. Already-dispatched activities settle before final cancellation.
  });
  setHandler(decideCampaignApproval, ({ stepKey, decision }) => {
    if (stopped() || terminal() || !requestedApprovals.has(stepKey)) return;
    decisions.set(stepKey, decision); revision++;
  });
  setHandler(completeManualStep, ({ stepKey, output }) => {
    // Do not pre-buffer completion: a stale/direct signal cannot complete an unstarted or blocked action.
    if (stopped() || terminal() || states[stepKey] !== "manual_resolution") return;
    manualOutputs.set(stepKey, output); revision++;
  });
  setHandler(campaignSuccessReached, async (signal) => {
    if (context["measurement.success"] || terminal()) return;
    const normalized = { ...signal, action: signal.action ?? "notify_only", triggerKey: signal.triggerKey ?? signal.triggerEventKey ?? "unknown", triggerSource: signal.triggerSource ?? "measurement_event" };
    context["measurement.success"] = normalized;
    if (normalized.action === "pause" && !blocked) {
      paused = true; status = "paused"; revision++;
      await activities.setInstanceState({ instanceId: input.instanceId, status });
    }
  });

  const issues = [
    ...validateCampaignExecution(input.autonomyMode, input.steps, { allowBoundedScheduling: true }),
    ...validateCampaignGraph(input.steps).issues,
  ];
  if (issues.length) {
    context["execution.validation"] = issues; status = "failed";
    await activities.setInstanceState({ instanceId: input.instanceId, status });
    await condition(allHandlersFinished);
    return snapshot();
  }

  async function blockStep(step: CampaignStep, execution: CampaignStepScheduleBlocked): Promise<void> {
    // Called only before dispatch, or with the executor's authoritative no-dispatch result.
    blocked = true; paused = true; status = "paused"; states[step.id] = "schedule_blocked"; revision++;
    const evidence = { reason: execution.reason, schedule: execution.schedule };
    context[`schedule.blocked.${step.id}`] = evidence;
    await activities.setStepState({ instanceId: input.instanceId, stepKey: step.id, status: "schedule_blocked", output: { scheduleBlocked: evidence }, error: execution.reason });
    await activities.setInstanceState({ instanceId: input.instanceId, status: canceled ? "canceled" : "paused" });
  }

  async function finishStep(step: CampaignStep, output: Record<string, unknown>, partial = false): Promise<void> {
    const next = partial ? "partially_succeeded" : "succeeded";
    context[`steps.${step.id}`] = output;
    // A successor wakes only after the durable completion (and its first DB timestamp) exists.
    await activities.setStepState({ instanceId: input.instanceId, stepKey: step.id, status: next, output });
    states[step.id] = next; revision++;
  }

  async function campaignGate(): Promise<void> {
    if (campaignApproved || stopped()) return;
    requestedApprovals.add("__campaign__");
    await activities.requestStepApproval({ instanceId: input.instanceId, stepKey: "__campaign__", snapshot: {
      name: "Approve campaign execution", approvalScope: "campaign", campaignVersionId: input.campaignVersionId,
      timezone: input.timezone, steps: input.steps,
    } });
    await condition(() => stopped() || (!paused && decisions.has("__campaign__")));
    if (stopped()) return;
    if (decisions.get("__campaign__") !== "approved") {
      failure = new Error(`Campaign approval ${decisions.get("__campaign__")}.`); revision++; return;
    }
    campaignApproved = true; decisions.delete("__campaign__"); requestedApprovals.delete("__campaign__"); revision++;
    status = "active";
    await activities.setInstanceState({ instanceId: input.instanceId, status });
  }

  async function runStep(step: CampaignStep): Promise<void> {
    if (stopped()) return;
    states[step.id] = "waiting";
    await activities.setStepState({ instanceId: input.instanceId, stepKey: step.id, status: "waiting" });
    const stepActivities = proxyActivities<CampaignSchedulingActivities>({ startToCloseTimeout: `${step.timeoutSeconds ?? 300} seconds`, retry: { maximumAttempts: step.maxAttempts ?? 3 } });
    let runId: string | undefined;
    let approved = !campaignStepRequiresApproval(input.autonomyMode, step);
    let waitUntil: number | undefined;
    while (!stopped()) {
      const observed = revision;
      const schedule = await activities.getStepScheduleState({ instanceId: input.instanceId, stepKey: step.id });
      assertScheduleEvidence({ ...input, stepKey: step.id, campaignStepRunId: runId }, schedule);
      runId = schedule.campaignStepRunId;
      context[`schedule.${step.id}`] = schedule;
      if (stopped()) return;
      if (schedule.state === "expired") {
        await blockStep(step, { status: "schedule_blocked", reason: schedule.reason === "no_legal_time" ? "No legal request-start time remains in this preferred window." : "The preferred request-start window has expired.", schedule });
        return;
      }
      if (campaignApproved && !approved && !requestedApprovals.has(step.id)) {
        requestedApprovals.add(step.id);
        await activities.requestStepApproval({ instanceId: input.instanceId, stepKey: step.id, snapshot: {
          name: step.name, operationType: step.operationType, inputs: step.inputs, desiredCapability: step.desiredCapability,
          campaignVersionId: input.campaignVersionId, campaignStepRunId: runId, stepKey: step.id,
          scheduledAt: step.scheduledAt, scheduleType: step.scheduleType ?? "immediate",
          preferredWindowStart: step.preferredWindowStart, preferredWindowEnd: step.preferredWindowEnd,
          dependencyDelaySeconds: step.dependencyDelaySeconds ?? 0, dependsOn: step.dependsOn,
          executionMethods: step.executionMethods, autonomyMode: input.autonomyMode,
        } });
        // Re-read the authoritative clock even if approval or expiry happened during the request activity.
        continue;
      }
      if (campaignApproved && !paused && decisions.has(step.id)) {
        const decision = decisions.get(step.id)!;
        decisions.delete(step.id); requestedApprovals.delete(step.id);
        if (decision !== "approved") {
          if (step.optional) { await finishStep(step, { skipped: true, approvalDecision: decision }, true); return; }
          states[step.id] = "failed";
          await activities.setStepState({ instanceId: input.instanceId, stepKey: step.id, status: "permanently_failed", error: `Approval ${decision}.` });
          throw new Error(`Approval ${decision} for required step ${step.id}.`);
        }
        approved = true;
      }
      if (schedule.state === "ready" && campaignApproved && approved && !paused) {
        if (step.operationType === "wait") {
          if (waitUntil === undefined) {
            const seconds = typeof step.inputs.durationSeconds === "number" ? step.inputs.durationSeconds : 0;
            waitUntil = Date.now() + Math.max(0, seconds) * 1_000;
          }
          if (Date.now() < waitUntil) { await waitForChange(schedule, observed, waitUntil); continue; }
        }
        if (states[step.id] !== "running") {
          states[step.id] = "running";
          await activities.setStepState({ instanceId: input.instanceId, stepKey: step.id, status: "running" });
          // Signals/DB latency may have changed eligibility while persisting the running state.
          continue;
        }
        if (step.operationType === "wait" || step.operationType === "request_approval") {
          await finishStep(step, {}); return;
        }
        // No expiry watcher runs while this activity is pending: it may already have written remotely.
        const execution = await stepActivities.executeScheduledStep({
          instanceId: input.instanceId, stepKey: step.id, workspaceId: input.workspaceId, campaignId: input.campaignId,
          campaignVersionId: input.campaignVersionId, campaignStepRunId: runId, context,
        });
        if (execution.status === "succeeded") { await finishStep(step, execution.output); return; }
        if (execution.status === "schedule_blocked") {
          assertScheduleEvidence({ ...input, stepKey: step.id, campaignStepRunId: runId }, execution.schedule);
          await blockStep(step, execution); return;
        }
        states[step.id] = "manual_resolution"; revision++;
        await activities.setStepState({ instanceId: input.instanceId, stepKey: step.id, status: "manual_resolution", error: execution.reason });
        // An uncertain dispatch never becomes safely expired merely because time passes.
        await condition(() => stopped() || (!paused && manualOutputs.has(step.id)));
        if (stopped()) return;
        const output = manualOutputs.get(step.id)!; manualOutputs.delete(step.id);
        await finishStep(step, output); return;
      }
      await waitForChange(schedule, observed);
    }
  }

  async function waitForChange(schedule: StoredStepScheduleState, observed: number, waitUntil?: number): Promise<void> {
    const delays: number[] = [];
    const clock = Date.parse(schedule.evaluatedAt);
    if (schedule.deadline) delays.push(Date.parse(schedule.deadline) - clock);
    if (schedule.state === "waiting_until") delays.push(Date.parse(schedule.notBefore) - clock);
    if (waitUntil !== undefined) delays.push(waitUntil - Date.now());
    const changed = () => stopped() || revision !== observed;
    if (delays.length) await condition(changed, Math.max(1, Math.min(...delays)));
    else await condition(changed);
  }

  async function captureFailure(work: () => Promise<void>): Promise<void> {
    try { await work(); }
    catch (error) { failure ??= error instanceof Error ? error : new Error(String(error)); revision++; }
  }

  if (!canceled) {
    status = paused ? "paused" : campaignApproved ? "active" : "awaiting_approval";
    await activities.setInstanceState({ instanceId: input.instanceId, status });
  }
  // Every branch waits independently. A quick predecessor releases its successor while unrelated work is in flight.
  await Promise.all([captureFailure(campaignGate), ...input.steps.map((step) => captureFailure(() => runStep(step)))]);
  if (blocked && !canceled) await condition(() => canceled);
  if (canceled) {
    for (const step of input.steps) {
      if (["planned", "waiting", "running", "schedule_blocked"].includes(states[step.id]!)) {
        await activities.setStepState({ instanceId: input.instanceId, stepKey: step.id, status: "canceled", error: "Campaign canceled." });
        states[step.id] = "canceled";
      }
    }
    status = "canceled";
  } else if (failure) {
    context["execution.failure"] = failure.message; status = "failed";
  } else status = "completed";
  await activities.setInstanceState({ instanceId: input.instanceId, status });
  await condition(allHandlersFinished);
  return snapshot();
}
