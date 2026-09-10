import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { evaluateStepSchedule, type CampaignStep, type CampaignStepStatus, type StepSchedulePredecessor } from "@market-me/domain";
import type { StoredStepScheduleState } from "@market-me/database";
import type { CampaignActivities, CampaignSchedulingActivities, CampaignStepExecution, CampaignWorkflowInput } from "./types";
import {
  campaignState, campaignWorkflow, cancelCampaign, completeManualStep, decideCampaignApproval, pauseCampaign, resumeCampaign,
} from "./workflows";

const workflowsPath = fileURLToPath(new URL("./workflows.ts", import.meta.url));
const legacyPath = fileURLToPath(new URL("./legacy-capture-workflows.ts", import.meta.url));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

function step(id: string, overrides: Partial<CampaignStep> = {}): CampaignStep {
  return { id, name: id, operationType: "publish_content", desiredCapability: "publish_content", dependsOn: [],
    inputs: {}, outputs: {}, executionMethods: ["official_api"], approvalRequired: false, ...overrides };
}
function definition(steps: CampaignStep[], autonomyMode: CampaignWorkflowInput["autonomyMode"] = "fully_autonomous"): CampaignWorkflowInput {
  return { workspaceId: randomUUID(), campaignId: randomUUID(), campaignVersionId: randomUUID(), instanceId: randomUUID(),
    timezone: "UTC", autonomyMode, context: {}, steps };
}

describe("bounded-scheduling-v1 durable orchestration", () => {
  let environment: TestWorkflowEnvironment;
  beforeAll(async () => { environment = await TestWorkflowEnvironment.createTimeSkipping(); }, 120_000);
  afterAll(async () => { await environment?.teardown(); });

  it("keeps the captured 1.19 command source and policy decisions immutable", async () => {
    // Do not regenerate these hashes to make a changed legacy workflow pass: old histories need these decisions.
    for (const [name, expected] of [
      ["legacy-workflow.ts", "321ef96c00412e8a9d2ab1ae107113aa7ac66f6f4d38965cacfa9247695587ce"],
      ["legacy-policies.ts", "35ca3f0a451e57848e2c5581339c648837ecdab0b7b657498a284d8e6d57f339"],
    ]) {
      const source = (await readFile(new URL(name!, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
      expect(createHash("sha256").update(source).digest("hex")).toBe(expected);
    }
  });

  function fixture(input: CampaignWorkflowInput, execute?: (key: string) => Promise<CampaignStepExecution>) {
    const persisted = new Map<string, { status: CampaignStepStatus; completedAt?: string }>();
    const executionTimes: { stepKey: string; time: number }[] = [];
    const approvalSnapshots = new Map<string, Record<string, unknown>>();
    const events: string[] = [];
    const activities: CampaignSchedulingActivities = {
      setInstanceState: async ({ status }) => { events.push(`instance:${status}`); },
      setStepState: async ({ stepKey, status }) => {
        const old = persisted.get(stepKey);
        persisted.set(stepKey, { status, completedAt: old?.completedAt ?? (["succeeded", "partially_succeeded"].includes(status) ? new Date(await environment.currentTimeMs()).toISOString() : undefined) });
        events.push(`${stepKey}:${status}`);
      },
      requestStepApproval: async ({ stepKey, snapshot }) => { approvalSnapshots.set(stepKey, snapshot); return randomUUID(); },
      getStepScheduleState: async ({ stepKey }): Promise<StoredStepScheduleState> => {
        const authored = input.steps.find((candidate) => candidate.id === stepKey)!;
        const now = await environment.currentTimeMs();
        const predecessors: StepSchedulePredecessor[] = authored.dependsOn.map((key) => ({ stepKey: key, status: persisted.get(key)?.status ?? "planned", completedAt: persisted.get(key)?.completedAt }));
        return { ...evaluateStepSchedule(authored, predecessors, now), evaluatedAt: new Date(now).toISOString(), predecessors,
          workspaceId: input.workspaceId, campaignId: input.campaignId, campaignInstanceId: input.instanceId,
          campaignVersionId: input.campaignVersionId, campaignStepRunId: `run-${stepKey}`, stepKey };
      },
      executeStep: async () => { throw new Error("V2 must never schedule the legacy executeStep activity."); },
      executeScheduledStep: async ({ stepKey }) => {
        executionTimes.push({ stepKey, time: await environment.currentTimeMs() });
        return execute ? execute(stepKey) : { status: "succeeded", output: { externalId: stepKey } };
      },
    };
    return { activities, persisted, executionTimes, approvalSnapshots, events };
  }

  async function workerFor(activities: CampaignSchedulingActivities) {
    const taskQueue = `bounded-${randomUUID()}`;
    return Worker.create({ connection: environment.nativeConnection, taskQueue, workflowsPath, activities });
  }
  async function start(worker: Worker, input: CampaignWorkflowInput) {
    return environment.client.workflow.start(campaignWorkflow, { taskQueue: worker.options.taskQueue, workflowId: randomUUID(), args: [input] });
  }
  async function windowStep(id: string, overrides: Partial<CampaignStep> = {}) {
    const now = await environment.currentTimeMs();
    return step(id, { scheduleType: "preferred_window", preferredWindowStart: new Date(now - 60_000).toISOString(),
      preferredWindowEnd: new Date(now + 60_000).toISOString(), ...overrides });
  }

  it("keeps exact-time not-before behavior and records/replays the new patch marker", async () => {
    const due = await environment.currentTimeMs() + 60_000;
    const input = definition([step("publish", { scheduleType: "exact_time", scheduledAt: new Date(due).toISOString() })]);
    const f = fixture(input), worker = await workerFor(f.activities);
    const history = await worker.runUntil(async () => {
      const handle = await start(worker, input);
      await environment.sleep(20_000);
      expect(f.executionTimes).toEqual([]);
      expect((await handle.result()).status).toBe("completed");
      expect(f.executionTimes[0]!.time).toBeGreaterThanOrEqual(due);
      return handle.fetchHistory();
    });
    const serialized = JSON.stringify(history);
    const markers = history.events?.filter((event) => event.markerRecordedEventAttributes).map((event) => event.markerRecordedEventAttributes!) ?? [];
    expect(markers).toHaveLength(1);
    const markerPayload = Object.values(markers[0]!.details ?? {}).flatMap((value) => value.payloads ?? []).map((payload) => Buffer.from(payload.data ?? []).toString("utf8")).join("");
    expect(markerPayload).toContain("bounded-scheduling-v1");
    expect(serialized).toContain("executeScheduledStep");
    expect(serialized).toContain("getStepScheduleState");
    await Worker.runReplayHistory({ workflowsPath }, history);
  }, 120_000);

  it("releases a delayed successor while an unrelated sibling is still running", async () => {
    const slowStarted = deferred<void>(), releaseSlow = deferred<void>(), childStarted = deferred<void>();
    const input = definition([step("fast"), step("slow"), step("child", { dependsOn: ["fast"], dependencyDelaySeconds: 2 })]);
    const f = fixture(input, async (key) => {
      if (key === "slow") { slowStarted.resolve(); await releaseSlow.promise; }
      if (key === "child") childStarted.resolve();
      return { status: "succeeded", output: { key } };
    });
    const worker = await workerFor(f.activities);
    await worker.runUntil(async () => {
      const handle = await start(worker, input);
      await slowStarted.promise;
      await expect.poll(() => f.persisted.get("fast")?.status).toBe("succeeded");
      const firstCompletion = Date.parse(f.persisted.get("fast")!.completedAt!);
      await environment.sleep(500);
      expect(f.executionTimes.map((value) => value.stepKey)).not.toContain("child");
      await environment.sleep(2_500);
      await childStarted.promise;
      expect(f.persisted.get("slow")?.status).toBe("running");
      expect(f.executionTimes.find((value) => value.stepKey === "child")!.time).toBeGreaterThanOrEqual(firstCompletion + 2_000);
      releaseSlow.resolve();
      expect((await handle.result()).status).toBe("completed");
    });
  }, 120_000);

  it.each(["step_approval", "campaign_approval", "paused", "dependency"] as const)("expires while waiting for %s and rejects resume/manual bypass", async (waitingFor) => {
    const blocked = await windowStep("publish", {
      approvalRequired: waitingFor === "step_approval",
      dependsOn: waitingFor === "dependency" ? ["predecessor"] : [],
    });
    const input = definition(waitingFor === "dependency" ? [
      step("predecessor", { operationType: "wait", desiredCapability: "workflow.wait", inputs: { durationSeconds: 3_600 } }), blocked,
    ] : [blocked], waitingFor === "campaign_approval" ? "campaign_approval" : "fully_autonomous");
    const f = fixture(input);
    if (waitingFor === "paused") input.steps = [{ ...blocked, preferredWindowStart: new Date(await environment.currentTimeMs() + 20_000).toISOString() }];
    const worker = await workerFor(f.activities);
    await worker.runUntil(async () => {
      const handle = await start(worker, input);
      if (waitingFor === "paused") await handle.signal(pauseCampaign);
      await environment.sleep(70_000);
      await expect.poll(async () => (await handle.query(campaignState)).stepStates.publish).toBe("schedule_blocked");
      const state = await handle.query(campaignState);
      expect(state.status).toBe("paused");
      expect(state.context["schedule.blocked.publish"]).toEqual(expect.objectContaining({ schedule: expect.objectContaining({ campaignVersionId: input.campaignVersionId, state: "expired" }) }));
      await handle.signal(resumeCampaign);
      await handle.signal(decideCampaignApproval, { stepKey: waitingFor === "campaign_approval" ? "__campaign__" : "publish", decision: "approved" });
      await handle.signal(completeManualStep, { stepKey: "publish", output: { forged: true } });
      expect((await handle.query(campaignState)).stepStates.publish).toBe("schedule_blocked");
      expect((await handle.query(campaignState)).status).toBe("paused");
      expect(f.executionTimes).toEqual([]);
      await handle.signal(cancelCampaign);
      const result = await handle.result();
      expect(result.status).toBe("canceled");
      expect(result.context["steps.publish"]).toBeUndefined();
    });
  }, 120_000);

  it("pins window and delay in the approval snapshot before authorizing execution", async () => {
    const input = definition([step("predecessor"), await windowStep("publish", { approvalRequired: true, dependsOn: ["predecessor"], dependencyDelaySeconds: 2 })]);
    const f = fixture(input), worker = await workerFor(f.activities);
    await worker.runUntil(async () => {
      const handle = await start(worker, input);
      await expect.poll(() => f.approvalSnapshots.has("publish")).toBe(true);
      expect(f.approvalSnapshots.get("publish")).toEqual(expect.objectContaining({
        campaignVersionId: input.campaignVersionId, campaignStepRunId: "run-publish", stepKey: "publish",
        preferredWindowStart: input.steps[1]!.preferredWindowStart, preferredWindowEnd: input.steps[1]!.preferredWindowEnd,
        dependencyDelaySeconds: 2, dependsOn: ["predecessor"],
      }));
      expect(f.executionTimes.map((entry) => entry.stepKey)).not.toContain("publish");
      await handle.signal(decideCampaignApproval, { stepKey: "publish", decision: "approved" });
      expect((await handle.result()).status).toBe("completed");
    });
  }, 120_000);

  it.each(["succeeded", "manual_required"] as const)("does not overwrite in-flight %s when a window passes", async (outcome) => {
    const entered = deferred<void>(), release = deferred<void>();
    const input = definition([await windowStep("publish")]);
    const f = fixture(input, async () => {
      entered.resolve(); await release.promise;
      return outcome === "succeeded" ? { status: "succeeded", output: { externalId: "accepted-after-cutoff" } } : { status: "manual_required", reason: "Provider may have accepted the request." };
    });
    const worker = await workerFor(f.activities);
    await worker.runUntil(async () => {
      input.steps = [{ ...input.steps[0]!, preferredWindowEnd: new Date(await environment.currentTimeMs() + 2_000).toISOString() }];
      const handle = await start(worker, input);
      await entered.promise;
      await environment.sleep(3_000);
      expect((await handle.query(campaignState)).stepStates.publish).toBe("running");
      release.resolve();
      if (outcome === "manual_required") {
        await expect.poll(async () => (await handle.query(campaignState)).stepStates.publish).toBe("manual_resolution");
        await environment.sleep(3_000);
        expect((await handle.query(campaignState)).stepStates.publish).toBe("manual_resolution");
        await handle.signal(completeManualStep, { stepKey: "publish", output: { externalId: "reconciled" } });
      }
      const result = await handle.result();
      expect(result.status).toBe("completed"); expect(result.stepStates.publish).toBe("succeeded");
      expect(f.events).not.toContain("publish:schedule_blocked");
      expect(f.executionTimes).toHaveLength(1);
    });
  }, 120_000);

  it("rejects early manual completion, then allows exact manual reconciliation", async () => {
    const now = await environment.currentTimeMs();
    const input = definition([step("manual", { scheduleType: "exact_time", scheduledAt: new Date(now + 20_000).toISOString() })]);
    const f = fixture(input, async () => ({ status: "manual_required", reason: "Reconcile exact target." }));
    const worker = await workerFor(f.activities);
    await worker.runUntil(async () => {
      const handle = await start(worker, input);
      await handle.signal(completeManualStep, { stepKey: "manual", output: { early: true } });
      await environment.sleep(21_000);
      await expect.poll(async () => (await handle.query(campaignState)).stepStates.manual).toBe("manual_resolution");
      expect((await handle.query(campaignState)).context["steps.manual"]).toBeUndefined();
      await handle.signal(completeManualStep, { stepKey: "manual", output: { confirmed: true } });
      expect((await handle.result()).context["steps.manual"]).toEqual({ confirmed: true });
    });
  }, 120_000);

  it("retains accepted success while cancellation stops pending dependency branches", async () => {
    const entered = deferred<void>(), release = deferred<void>();
    const input = definition([step("publish"), step("dependent", { dependsOn: ["publish"] })]);
    const f = fixture(input, async () => { entered.resolve(); await release.promise; return { status: "succeeded", output: { externalId: "already-accepted" } }; });
    const worker = await workerFor(f.activities);
    await worker.runUntil(async () => {
      const handle = await start(worker, input);
      await entered.promise;
      await handle.signal(cancelCampaign);
      expect((await handle.query(campaignState)).canceled).toBe(true);
      release.resolve();
      const result = await handle.result();
      expect(result.status).toBe("canceled"); expect(result.stepStates.publish).toBe("succeeded"); expect(result.stepStates.dependent).toBe("canceled");
      expect(f.executionTimes.map((entry) => entry.stepKey)).toEqual(["publish"]);
    });
  }, 120_000);

  it("preserves an in-flight sibling's late success when another branch expires", async () => {
    const entered = deferred<void>(), release = deferred<void>();
    const input = definition([step("inflight"), await windowStep("expires", { approvalRequired: true })]);
    const f = fixture(input, async () => { entered.resolve(); await release.promise; return { status: "succeeded", output: { externalId: "accepted-sibling" } }; });
    const worker = await workerFor(f.activities);
    await worker.runUntil(async () => {
      input.steps = [input.steps[0]!, { ...input.steps[1]!, preferredWindowEnd: new Date(await environment.currentTimeMs() + 2_000).toISOString() }];
      const handle = await start(worker, input);
      await entered.promise;
      await environment.sleep(3_000);
      expect((await handle.query(campaignState)).stepStates.expires).toBe("schedule_blocked");
      release.resolve();
      await expect.poll(async () => (await handle.query(campaignState)).stepStates.inflight).toBe("succeeded");
      expect((await handle.query(campaignState)).status).toBe("paused");
      await handle.signal(cancelCampaign);
      const result = await handle.result();
      expect(result.stepStates.inflight).toBe("succeeded");
      expect(result.context["steps.inflight"]).toEqual({ externalId: "accepted-sibling" });
      expect(f.executionTimes.map((entry) => entry.stepKey)).toEqual(["inflight"]);
    });
  }, 120_000);

  it("enforces approval floors on the new execution activity despite a disabled step gate", async () => {
    for (const autonomy of ["approval_required", "approve_uncertain", "approve_first_occurrence", "confidence_based"] as const) {
      const input = definition([step("publish")], autonomy), f = fixture(input), worker = await workerFor(f.activities);
      await worker.runUntil(async () => {
        const handle = await start(worker, input);
        await expect.poll(() => f.approvalSnapshots.has("publish")).toBe(true);
        expect(f.executionTimes).toEqual([]);
        await handle.signal(decideCampaignApproval, { stepKey: "publish", decision: "approved" });
        expect((await handle.result()).status).toBe("completed");
        expect(f.executionTimes.map((entry) => entry.stepKey)).toEqual(["publish"]);
      });
    }
  }, 120_000);

  it("requires a whole-campaign decision and then any additional explicit step review", async () => {
    const input = definition([step("first"), step("explicit", { approvalRequired: true })], "campaign_approval");
    const f = fixture(input), worker = await workerFor(f.activities);
    await worker.runUntil(async () => {
      const handle = await start(worker, input);
      await expect.poll(() => f.approvalSnapshots.has("__campaign__")).toBe(true);
      expect(f.executionTimes).toEqual([]);
      expect(f.approvalSnapshots.get("__campaign__")).toEqual(expect.objectContaining({ campaignVersionId: input.campaignVersionId, steps: input.steps }));
      await handle.signal(decideCampaignApproval, { stepKey: "__campaign__", decision: "approved" });
      await expect.poll(() => f.approvalSnapshots.has("explicit")).toBe(true);
      expect(f.executionTimes.map((entry) => entry.stepKey)).not.toContain("explicit");
      await handle.signal(decideCampaignApproval, { stepKey: "explicit", decision: "approved" });
      expect((await handle.result()).status).toBe("completed");
      expect(f.executionTimes.map((entry) => entry.stepKey).sort()).toEqual(["explicit", "first"]);
    });
  }, 120_000);

  it("keeps a blocked schedule closed after an older resume activity finishes", async () => {
    const resumed = deferred<void>(), releaseResume = deferred<void>();
    const input = definition([await windowStep("publish", { approvalRequired: true })]);
    const f = fixture(input);
    let activeWrites = 0;
    const original = f.activities.setInstanceState;
    f.activities.setInstanceState = async (value) => {
      if (value.status === "active" && ++activeWrites === 2) { resumed.resolve(); await releaseResume.promise; }
      await original(value);
    };
    const worker = await workerFor(f.activities);
    await worker.runUntil(async () => {
      input.steps = [{ ...input.steps[0]!, preferredWindowEnd: new Date(await environment.currentTimeMs() + 2_000).toISOString() }];
      const handle = await start(worker, input);
      await expect.poll(() => f.approvalSnapshots.has("publish")).toBe(true);
      await handle.signal(pauseCampaign);
      await handle.signal(resumeCampaign);
      await resumed.promise;
      await environment.sleep(3_000);
      expect((await handle.query(campaignState)).stepStates.publish).toBe("schedule_blocked");
      releaseResume.resolve();
      await handle.signal(decideCampaignApproval, { stepKey: "publish", decision: "approved" });
      await handle.signal(resumeCampaign);
      expect((await handle.query(campaignState)).status).toBe("paused");
      expect(f.executionTimes).toEqual([]);
      await handle.signal(cancelCampaign);
      expect((await handle.result()).status).toBe("canceled");
    });
  }, 120_000);

  it("refuses forbidden autonomy and still-unsupported schedule modes on the new path", async () => {
    const input = definition([step("publish")]), f = fixture(input), worker = await workerFor(f.activities);
    await worker.runUntil(async () => {
      for (const mode of ["draft_only", "suggest_only"] as const) {
        expect((await (await start(worker, { ...input, autonomyMode: mode as CampaignWorkflowInput["autonomyMode"] })).result()).status).toBe("failed");
      }
      for (const scheduleType of ["conditional", "follow_up", "recurring", "evergreen_queue"] as const) {
        expect((await (await start(worker, { ...input, steps: [step("publish", { scheduleType })] })).result()).status).toBe("failed");
      }
      expect((await (await start(worker, { ...input, steps: [step("publish", { dependsOn: ["missing"] })] })).result()).status).toBe("failed");
    });
    expect(f.executionTimes).toEqual([]); expect(f.approvalSnapshots.size).toBe(0);
  }, 120_000);

  it("records an actual unmarked 1.19 timer/approval/manual/dependency history and replays it on the patched wrapper", async () => {
    const input = definition([
      step("timer", { operationType: "wait", desiredCapability: "workflow.wait", scheduleType: "exact_time", scheduledAt: new Date(await environment.currentTimeMs() + 10_000).toISOString(), inputs: { durationSeconds: 60 } }),
      step("publish", { dependsOn: ["timer"], approvalRequired: true }),
      step("after", { operationType: "wait", desiredCapability: "workflow.wait", dependsOn: ["publish"], inputs: { durationSeconds: 5 } }),
    ]);
    const activities: CampaignActivities = { setInstanceState: async () => {}, setStepState: async () => {}, requestStepApproval: async () => "legacy-review", executeStep: async () => ({ status: "manual_required", reason: "Legacy handoff." }) };
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: `legacy-record-${randomUUID()}`, workflowsPath: legacyPath, activities });
    const history = await worker.runUntil(async () => {
      const handle = await start(worker, input);
      await handle.signal(decideCampaignApproval, { stepKey: "publish", decision: "approved" });
      await handle.signal(completeManualStep, { stepKey: "publish", output: { externalId: "legacy-proof" } });
      expect((await handle.result()).status).toBe("completed");
      return handle.fetchHistory();
    });
    expect(history.events?.some((event) => event.timerStartedEventAttributes)).toBe(true);
    expect(history.events?.some((event) => event.markerRecordedEventAttributes)).toBe(false);
    expect(history.events?.some((event) => event.activityTaskScheduledEventAttributes?.activityType?.name === "executeStep")).toBe(true);
    await Worker.runReplayHistory({ workflowsPath }, history);
  }, 120_000);

  it("replays a captured 1.19 cancellation of an active durable timer", async () => {
    const waiting = deferred<void>();
    const input = definition([step("wait", { operationType: "wait", desiredCapability: "workflow.wait", inputs: { durationSeconds: 3_600 } })]);
    const activities: CampaignActivities = {
      setInstanceState: async () => {}, setStepState: async ({ status }) => { if (status === "waiting") waiting.resolve(); },
      requestStepApproval: async () => "unused", executeStep: async () => ({ status: "manual_required", reason: "unused" }),
    };
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: `legacy-cancel-replay-${randomUUID()}`, workflowsPath: legacyPath, activities });
    const history = await worker.runUntil(async () => {
      const handle = await start(worker, input);
      await waiting.promise;
      await environment.sleep(1_000);
      await handle.signal(cancelCampaign);
      expect((await handle.result()).status).toBe("canceled");
      return handle.fetchHistory();
    });
    expect(history.events?.some((event) => event.timerCanceledEventAttributes)).toBe(true);
    expect(history.events?.some((event) => event.markerRecordedEventAttributes)).toBe(false);
    await Worker.runReplayHistory({ workflowsPath }, history);
  }, 120_000);
});
