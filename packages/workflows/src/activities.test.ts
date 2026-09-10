import { describe, expect, it, vi } from "vitest";
import { CampaignScheduleNotReadyError, type CampaignRepository, type StoredStepScheduleState } from "@market-me/database";
import { createCampaignActivities } from "./activities";
import type { CampaignScheduledStepExecutionInput } from "./types";

describe("persisted campaign execution authority", () => {
  it("stops an already-queued activity before the executor when persisted approval is missing", async () => {
    const verify = vi.fn().mockRejectedValue(new Error("This campaign action has not been approved for execution."));
    const execute = vi.fn();
    const repository = { assertStepExecutionAuthorized: verify } as unknown as CampaignRepository;
    await expect(createCampaignActivities(repository, { execute }).executeStep({ instanceId: "legacy-run", stepKey: "publish", context: {} })).rejects.toThrow("has not been approved");
    expect(verify).toHaveBeenCalledWith("legacy-run", "publish");
    expect(execute).not.toHaveBeenCalled();
  });

  it("checks the exact stored target before allowing the executor", async () => {
    const events: string[] = [];
    const repository = { assertStepExecutionAuthorized: async () => { events.push("authorized"); } } as unknown as CampaignRepository;
    const activities = createCampaignActivities(repository, { execute: async () => { events.push("execute"); return { status: "succeeded", output: { externalId: "publication" } }; } });
    expect(await activities.executeStep({ instanceId: "approved-run", stepKey: "publish", context: {} })).toEqual({ status: "succeeded", output: { externalId: "publication" } });
    expect(events).toEqual(["authorized", "execute"]);
  });
});

describe("bounded activity authority and exact-target recovery", () => {
  const input: CampaignScheduledStepExecutionInput = {
    workspaceId: "workspace", campaignId: "campaign", campaignVersionId: "version",
    instanceId: "instance", campaignStepRunId: "step-run", stepKey: "publish", context: { deadline: "2100-01-01" },
  };
  const expired: StoredStepScheduleState = {
    workspaceId: input.workspaceId, campaignId: input.campaignId, campaignVersionId: input.campaignVersionId,
    campaignInstanceId: input.instanceId, campaignStepRunId: input.campaignStepRunId, stepKey: input.stepKey,
    evaluatedAt: "2026-09-09T12:00:00.000Z", state: "expired", reason: "deadline_reached",
    deadline: "2026-09-09T12:00:00.000Z", predecessors: [],
  };

  it.each(["workspaceId", "campaignId", "campaignVersionId", "campaignInstanceId", "campaignStepRunId", "stepKey"] as const)("rejects mismatched %s evidence before recovery or execution", async (field) => {
    const recoverScheduledExecution = vi.fn(), execute = vi.fn(), verify = vi.fn();
    const repository = { getStepScheduleState: async () => ({ ...expired, [field]: "other" }), assertStepExecutionAuthorized: verify } as unknown as CampaignRepository;
    await expect(createCampaignActivities(repository, { execute, recoverScheduledExecution }).executeScheduledStep(input)).rejects.toThrow("immutable campaign");
    expect(recoverScheduledExecution).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it.each(["succeeded", "manual_required"] as const)("recovers %s before expiry or active-state checks without executing", async (status) => {
    const outcome = status === "succeeded" ? { status, output: { externalId: "accepted" } } : { status, reason: "Prior dispatch outcome is unresolved." };
    const verify = vi.fn().mockRejectedValue(new CampaignScheduleNotReadyError(expired)), execute = vi.fn();
    const repository = { getStepScheduleState: async () => expired, assertStepExecutionAuthorized: verify } as unknown as CampaignRepository;
    const result = await createCampaignActivities(repository, { execute, recoverScheduledExecution: async () => outcome }).executeScheduledStep(input);
    expect(result).toEqual(outcome); expect(verify).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });

  it("rechecks DB time after recovery and returns only authoritative proven expiry", async () => {
    const events: string[] = [], execute = vi.fn();
    const repository = {
      getStepScheduleState: async () => ({ ...expired, state: "ready", evaluatedAt: "2026-09-09T11:59:59.000Z" }),
      assertStepExecutionAuthorized: async () => { events.push("authorize"); throw new CampaignScheduleNotReadyError(expired); },
    } as unknown as CampaignRepository;
    const result = await createCampaignActivities(repository, { execute, recoverScheduledExecution: async () => { events.push("recover"); return undefined; } }).executeScheduledStep(input);
    expect(result).toEqual({ status: "schedule_blocked", reason: expect.any(String), schedule: expired });
    expect(events).toEqual(["recover", "authorize", "recover"]); expect(execute).not.toHaveBeenCalled();
  });

  it("does not relabel policy failures or not-before waiting as expired", async () => {
    const execute = vi.fn();
    for (const error of [
      new Error("Missing persisted approval."),
      new CampaignScheduleNotReadyError({ ...expired, state: "waiting_until", notBefore: "2026-09-10T12:00:00.000Z", deadline: undefined }),
    ]) {
      const repository = { getStepScheduleState: async () => expired, assertStepExecutionAuthorized: async () => { throw error; } } as unknown as CampaignRepository;
      await expect(createCampaignActivities(repository, { execute, recoverScheduledExecution: async () => undefined }).executeScheduledStep(input)).rejects.toBe(error);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("requires a recovery-capable router and opts only scheduled execution into bounded authority", async () => {
    const verify = vi.fn(), execute = vi.fn().mockResolvedValue({ status: "succeeded", output: {} });
    const repository = { getStepScheduleState: async () => expired, assertStepExecutionAuthorized: verify } as unknown as CampaignRepository;
    expect(await createCampaignActivities(repository, { execute }).executeScheduledStep(input)).toEqual({ status: "manual_required", reason: expect.stringContaining("recovery") });
    expect(verify).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
    await createCampaignActivities(repository, { execute, recoverScheduledExecution: async () => undefined }).executeScheduledStep(input);
    expect(verify).toHaveBeenCalledWith(input.instanceId, input.stepKey, { allowBoundedScheduling: true });
    expect(execute).toHaveBeenCalledWith(input);
  });

  it.each(["succeeded", "manual_required", undefined] as const)("rechecks concurrent recovery after executor admission expiry (%s)", async (outcome) => {
    const execute = vi.fn().mockRejectedValue(new CampaignScheduleNotReadyError(expired));
    const recovered = outcome === "succeeded" ? { status: outcome, output: { externalId: "concurrent-winner" } }
      : outcome === "manual_required" ? { status: outcome, reason: "Concurrent dispatch unresolved." } : undefined;
    const recoverScheduledExecution = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(recovered);
    const repository = { getStepScheduleState: async () => expired, assertStepExecutionAuthorized: async () => {} } as unknown as CampaignRepository;
    const result = await createCampaignActivities(repository, { execute, recoverScheduledExecution }).executeScheduledStep(input);
    expect(result).toEqual(recovered ?? { status: "schedule_blocked", reason: expect.any(String), schedule: expired });
    expect(execute).toHaveBeenCalledTimes(1); expect(recoverScheduledExecution).toHaveBeenCalledTimes(2);
  });
});
