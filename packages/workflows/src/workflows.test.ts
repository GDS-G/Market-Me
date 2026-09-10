import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { CampaignActivities, CampaignWorkflowInput } from "./types";
import {
  campaignState,
  campaignSuccessReached,
  campaignWorkflow,
  cancelCampaign,
  completeManualStep,
  decideCampaignApproval,
  resumeCampaign,
} from "./workflows";

describe("campaignWorkflow", () => {
  let environment: TestWorkflowEnvironment;
  beforeAll(async () => {
    environment = await TestWorkflowEnvironment.createTimeSkipping();
  }, 120_000);
  afterAll(async () => {
    await environment?.teardown();
  });

  it("waits for approval and manual completion before releasing dependent steps", async () => {
    const events: string[] = [];
    const activities: CampaignActivities = {
      setInstanceState: async ({ status }) => {
        events.push(`instance:${status}`);
      },
      setStepState: async ({ stepKey, status }) => {
        events.push(`${stepKey}:${status}`);
      },
      requestStepApproval: async ({ stepKey }) => {
        events.push(`${stepKey}:approval`);
        return `approval-${stepKey}`;
      },
      executeStep: async () => ({
        status: "manual_required",
        reason: "test handoff",
      }),
    };
    const taskQueue = `campaign-test-${randomUUID()}`;
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue,
      workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
      activities,
    });
    const result = await worker.runUntil(async () => {
      const handle = await environment.client.workflow.start(campaignWorkflow, {
        taskQueue,
        workflowId: `campaign-test-${randomUUID()}`,
        args: [
          {
            instanceId: randomUUID(),
            workspaceId: randomUUID(),
            campaignId: randomUUID(),
            campaignVersionId: randomUUID(),
            timezone: "UTC",
            autonomyMode: "approval_required",
            context: {},
            steps: [
              {
                id: "publish",
                name: "Publish",
                operationType: "publish_content",
                desiredCapability: "publish.content",
                dependsOn: [],
                inputs: {},
                outputs: {},
                executionMethods: ["manual_handoff"],
                approvalRequired: true,
              },
              {
                id: "wait",
                name: "Wait",
                operationType: "wait",
                desiredCapability: "workflow.wait",
                dependsOn: ["publish"],
                inputs: { durationSeconds: 60 },
                outputs: {},
                executionMethods: ["manual_handoff"],
                approvalRequired: false,
              },
            ],
          },
        ],
      });
      const successSignal = {
        criteria: [
          {
            id: "traffic",
            eventType: "destination_visit" as const,
            metric: "count" as const,
            targetCount: 1,
            currentCount: 1,
            met: true,
          },
        ],
        action: "notify_only" as const,
        measuredAt: "2026-08-06T00:00:00.000Z",
        triggerEventKey: "measurement:first",
      };
      await handle.signal(campaignSuccessReached, successSignal);
      await handle.signal(campaignSuccessReached, {
        ...successSignal,
        triggerEventKey: "measurement:duplicate",
      });
      await handle.signal(decideCampaignApproval, {
        stepKey: "publish",
        decision: "approved",
      });
      await handle.signal(completeManualStep, {
        stepKey: "publish",
        output: { externalId: "post-1" },
      });
      return handle.result();
    });
    expect(result.status).toBe("completed");
    expect(result.context["steps.publish"]).toEqual({ externalId: "post-1" });
    expect(result.context["measurement.success"]).toEqual(
      expect.objectContaining({ triggerEventKey: "measurement:first" }),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        "publish:approval",
        "publish:succeeded",
        "wait:succeeded",
        "instance:completed",
      ]),
    );
  }, 120_000);

  it("cancels an in-flight durable timer and records canceled state", async () => {
    const events: string[] = [];
    const activities: CampaignActivities = {
      setInstanceState: async ({ status }) => {
        events.push(`instance:${status}`);
      },
      setStepState: async ({ stepKey, status }) => {
        events.push(`${stepKey}:${status}`);
      },
      requestStepApproval: async () => "unused",
      executeStep: async () => ({
        status: "manual_required",
        reason: "test handoff",
      }),
    };
    const taskQueue = `campaign-cancel-test-${randomUUID()}`;
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue,
      workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
      activities,
    });
    const result = await worker.runUntil(async () => {
      const handle = await environment.client.workflow.start(campaignWorkflow, {
        taskQueue,
        workflowId: `campaign-cancel-test-${randomUUID()}`,
        args: [
          {
            instanceId: randomUUID(),
            workspaceId: randomUUID(),
            campaignId: randomUUID(),
            campaignVersionId: randomUUID(),
            timezone: "UTC",
            autonomyMode: "approval_required",
            context: {},
            steps: [
              {
                id: "wait",
                name: "Long wait",
                operationType: "wait",
                desiredCapability: "workflow.wait",
                dependsOn: [],
                inputs: { durationSeconds: 86_400 },
                outputs: {},
                executionMethods: ["manual_handoff"],
                approvalRequired: false,
              },
            ],
          },
        ],
      });
      await handle.signal(cancelCampaign);
      return handle.result();
    });
    expect(result.status).toBe("canceled");
    expect(events).toEqual(expect.arrayContaining(["instance:canceled"]));
    expect(events).not.toContain("instance:failed");
  }, 120_000);

  it("persists pause and waits for resume before completing a manual step", async () => {
    const events: string[] = [];
    const activities: CampaignActivities = {
      setInstanceState: async ({ status }) => {
        events.push(`instance:${status}`);
      },
      setStepState: async ({ stepKey, status }) => {
        events.push(`${stepKey}:${status}`);
      },
      requestStepApproval: async () => "unused",
      executeStep: async () => ({
        status: "manual_required",
        reason: "test handoff",
      }),
    };
    const taskQueue = `campaign-pause-test-${randomUUID()}`;
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue,
      workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
      activities,
    });
    const result = await worker.runUntil(async () => {
      const handle = await environment.client.workflow.start(campaignWorkflow, {
        taskQueue,
        workflowId: `campaign-pause-test-${randomUUID()}`,
        args: [
          {
            instanceId: randomUUID(),
            workspaceId: randomUUID(),
            campaignId: randomUUID(),
            campaignVersionId: randomUUID(),
            timezone: "UTC",
            autonomyMode: "approval_required",
            context: {},
            steps: [
              {
                id: "handoff",
                name: "Handoff",
                operationType: "manual_handoff",
                desiredCapability: "manual.handoff",
                dependsOn: [],
                inputs: {},
                outputs: {},
                executionMethods: ["manual_handoff"],
                approvalRequired: false,
              },
            ],
          },
        ],
      });
      await handle.signal(campaignSuccessReached, {
        criteria: [
          {
            id: "traffic",
            eventType: "destination_visit",
            metric: "count",
            targetCount: 1,
            currentCount: 1,
            met: true,
          },
        ],
        action: "pause",
        measuredAt: "2026-08-06T00:00:00.000Z",
        triggerEventKey: "measurement:pause",
      });
      expect((await handle.query(campaignState)).status).toBe("paused");
      expect(
        (await handle.query(campaignState)).context["measurement.success"],
      ).toEqual(
        expect.objectContaining({
          action: "pause",
          triggerEventKey: "measurement:pause",
        }),
      );
      await handle.signal(completeManualStep, {
        stepKey: "handoff",
        output: { completed: true },
      });
      await handle.signal(decideCampaignApproval, { stepKey: "handoff", decision: "approved" });
      expect((await handle.query(campaignState)).status).toBe("paused");
      await handle.signal(resumeCampaign);
      return handle.result();
    });
    expect(result.status).toBe("completed");
    expect(events).toEqual(
      expect.arrayContaining([
        "instance:paused",
        "instance:active",
        "handoff:succeeded",
        "instance:completed",
      ]),
    );
  }, 120_000);

  it("refuses legacy queued draft-only and unsupported schedules before any external activity", async () => {
    const executed: string[] = [];
    const approvals: string[] = [];
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: `authority-block-${randomUUID()}`,
      workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
      activities: {
        setInstanceState: async () => {}, setStepState: async () => {},
        requestStepApproval: async ({ stepKey }: { stepKey: string }) => { approvals.push(stepKey); return "unused"; },
        executeStep: async ({ stepKey }: { stepKey: string }) => { executed.push(stepKey); return { status: "succeeded", output: {} }; },
      },
    });
    await worker.runUntil(async () => {
      for (const unsafe of [
        { autonomyMode: "draft_only" },
        { autonomyMode: "suggest_only" },
        { scheduleType: "conditional" },
        { scheduleType: "follow_up" },
        { scheduleType: "preferred_window" },
        { scheduleType: "recurring" },
        { scheduleType: "evergreen_queue" },
      ]) {
        const input = executableFixture();
        if (unsafe.autonomyMode) input.autonomyMode = unsafe.autonomyMode as CampaignWorkflowInput["autonomyMode"];
        if (unsafe.scheduleType) input.steps = input.steps.map((step) => ({ ...step, scheduleType: unsafe.scheduleType as NonNullable<typeof step.scheduleType> }));
        const result = await environment.client.workflow.execute(campaignWorkflow, {
          taskQueue: worker.options.taskQueue, workflowId: `unsafe-${randomUUID()}`, args: [input],
        });
        expect(result.status).toBe("failed");
        expect(result.stepStates).toEqual({ publish: "planned" });
        expect(result.context["execution.validation"]).toEqual([expect.objectContaining({ code: unsafe.autonomyMode ? "autonomy_execution_disabled" : "unsupported_schedule" })]);
      }
    });
    expect(executed).toEqual([]);
    expect(approvals).toEqual([]);
  }, 120_000);

  it("enforces campaign policy review even when a step disables its optional gate", async () => {
    const executed: string[] = [];
    let notifyApproval: () => void = () => {};
    const taskQueue = `authority-review-${randomUUID()}`;
    const worker = await Worker.create({
      connection: environment.nativeConnection, taskQueue,
      workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
      activities: {
        setInstanceState: async () => {}, setStepState: async () => {},
        requestStepApproval: async () => { notifyApproval(); return "review"; },
        executeStep: async () => { executed.push("publish"); return { status: "succeeded", output: { published: true } }; },
      },
    });
    await worker.runUntil(async () => {
      for (const autonomyMode of ["approval_required", "approve_uncertain", "approve_first_occurrence", "confidence_based"] as const) {
        const requested = new Promise<void>((resolve) => { notifyApproval = resolve; });
        const before = executed.length;
        const handle = await environment.client.workflow.start(campaignWorkflow, {
          taskQueue, workflowId: `review-${randomUUID()}`, args: [{ ...executableFixture(), autonomyMode }],
        });
        await requested;
        expect(executed).toHaveLength(before);
        expect((await handle.query(campaignState)).stepStates.publish).toBe("waiting");
        await handle.signal(decideCampaignApproval, { stepKey: "publish", decision: "approved" });
        expect((await handle.result()).status).toBe("completed");
        expect(executed).toHaveLength(before + 1);
      }
    });
  }, 120_000);

  it("gates the whole campaign before parallel work and retains explicit step approvals", async () => {
    const executed: string[] = [];
    const snapshots: Record<string, unknown>[] = [];
    let notifyApproval: () => void = () => {};
    const taskQueue = `whole-campaign-review-${randomUUID()}`;
    const worker = await Worker.create({
      connection: environment.nativeConnection, taskQueue,
      workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
      activities: {
        setInstanceState: async () => {}, setStepState: async () => {},
        requestStepApproval: async ({ snapshot }: { snapshot: Record<string, unknown> }) => { snapshots.push(snapshot); notifyApproval(); return "review"; },
        executeStep: async ({ stepKey }: { stepKey: string }) => { executed.push(stepKey); return { status: "succeeded", output: {} }; },
      },
    });
    await worker.runUntil(async () => {
      const requested = new Promise<void>((resolve) => { notifyApproval = resolve; });
      const input = executableFixture();
      input.autonomyMode = "campaign_approval";
      input.steps = [input.steps[0], { ...input.steps[0], id: "second", approvalRequired: true }];
      const handle = await environment.client.workflow.start(campaignWorkflow, { taskQueue, workflowId: `whole-${randomUUID()}`, args: [input] });
      await requested;
      expect((await handle.query(campaignState)).status).toBe("awaiting_approval");
      expect(executed).toEqual([]);
      expect(snapshots[0]).toEqual(expect.objectContaining({ approvalScope: "campaign", campaignVersionId: input.campaignVersionId, steps: input.steps }));
      const stepRequested = new Promise<void>((resolve) => { notifyApproval = resolve; });
      await handle.signal(decideCampaignApproval, { stepKey: "__campaign__", decision: "approved" });
      await stepRequested;
      expect(executed).not.toContain("second");
      await handle.signal(decideCampaignApproval, { stepKey: "second", decision: "approved" });
      expect((await handle.result()).status).toBe("completed");
      expect(executed.sort()).toEqual(["publish", "second"]);
      const rejectedRequest = new Promise<void>((resolve) => { notifyApproval = resolve; });
      const rejected = await environment.client.workflow.start(campaignWorkflow, { taskQueue, workflowId: `whole-reject-${randomUUID()}`, args: [input] });
      await rejectedRequest;
      await rejected.signal(decideCampaignApproval, { stepKey: "__campaign__", decision: "rejected" });
      expect((await rejected.result()).status).toBe("failed");
      expect(executed).toHaveLength(2);
    });
  }, 120_000);
});

function executableFixture(): CampaignWorkflowInput {
  return {
    instanceId: randomUUID(), workspaceId: randomUUID(), campaignId: randomUUID(), campaignVersionId: randomUUID(),
    timezone: "UTC", autonomyMode: "fully_autonomous", context: {},
    steps: [{ id: "publish", name: "Publication", operationType: "publish_content", desiredCapability: "publish_content", dependsOn: [], inputs: {}, outputs: {}, executionMethods: ["official_api"], approvalRequired: false }],
  };
}
