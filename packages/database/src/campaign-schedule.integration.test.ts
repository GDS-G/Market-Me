import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { CampaignStep } from "@market-me/domain";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { CampaignRepository, CampaignScheduleNotReadyError } from "./campaign-repository";
import { MarketMeRepository } from "./repositories";
import type { CampaignDraftWrite } from "./models";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;
const step = (id: string, dependsOn: readonly string[] = []): CampaignStep => ({
  id, name: id, operationType: "wait", desiredCapability: "workflow.wait", dependsOn,
  inputs: {}, outputs: {}, executionMethods: ["manual_handoff"], approvalRequired: false,
});

describe.skipIf(!databaseUrl)("campaign schedule groundwork", () => {
  afterAll(async () => sql?.end());

  it("round-trips default zero, bounded delay and millisecond UTC fields while refusing unsupported routes", async () => {
    const preferredWindowStart = "2030-09-10T09:00:00.123Z", preferredWindowEnd = "2030-09-10T10:00:00.456Z";
    const fixture = await scheduleFixture([step("prepare"), { ...step("publish", ["prepare"]), scheduleType: "preferred_window", preferredWindowStart, preferredWindowEnd, dependencyDelaySeconds: 17 }]);
    try {
      const read = (await fixture.campaigns.getCampaign(fixture.workspace.workspaceId, fixture.campaignId))!;
      expect(read.currentVersion?.steps[0].dependencyDelaySeconds).toBe(0);
      expect(read.currentVersion?.steps[1]).toMatchObject({ preferredWindowStart, preferredWindowEnd, dependencyDelaySeconds: 17 });
      expect((await fixture.campaigns.getWorkflowDefinition(fixture.instanceId))?.steps[1])
        .toMatchObject({ preferredWindowStart, preferredWindowEnd, dependencyDelaySeconds: 17 });
      const saved = await fixture.campaigns.saveCampaignDraft(fixture.campaignId, {
        ...fixture.draft, steps: [step("prepare"), { ...fixture.draft.steps[1], dependencyDelaySeconds: 29 }],
      }, fixture.user.id);
      expect(saved?.draftVersion?.steps[1].dependencyDelaySeconds).toBe(29);
      await fixture.campaigns.publishCampaign(fixture.workspace.workspaceId, fixture.campaignId);
      expect((await fixture.campaigns.getWorkflowDefinition(fixture.instanceId))?.steps[1].dependencyDelaySeconds).toBe(17);
      await expect(fixture.campaigns.activateCampaign({ workspaceId: fixture.workspace.workspaceId, campaignId: fixture.campaignId, actorUserId: fixture.user.id }))
        .rejects.toMatchObject({ issues: [expect.objectContaining({ code: "preferred_window_route_unsupported" })] });
      expect(await fixture.campaigns.getStepScheduleState(fixture.instanceId, "publish")).toMatchObject({
        state: "waiting_dependencies", missingDependencies: ["prepare"], notBefore: preferredWindowStart, deadline: preferredWindowEnd,
        campaignVersionId: fixture.versionId, workspaceId: fixture.workspace.workspaceId, campaignId: fixture.campaignId,
      });
    } finally { await fixture.cleanup(); }
  });

  it("enforces delay and finite ordered range checks at the database boundary", async () => {
    const fixture = await scheduleFixture([step("prepare"), step("publish", ["prepare"])]);
    try {
      for (const invalid of [-1, 31_536_001, 0.5]) {
        await expect(sql!`UPDATE campaign_step SET dependency_delay_seconds = ${invalid} WHERE campaign_version_id = ${fixture.versionId} AND step_key = 'publish'`).rejects.toBeDefined();
      }
      await expect(sql!`UPDATE campaign_step SET dependency_delay_seconds = 1 WHERE campaign_version_id = ${fixture.versionId} AND step_key = 'prepare'`)
        .rejects.toMatchObject({ code: "23514" });
      await sql!`UPDATE campaign_step SET dependency_delay_seconds = 31536000 WHERE campaign_version_id = ${fixture.versionId} AND step_key = 'publish'`;
      expect((await fixture.campaigns.getWorkflowDefinition(fixture.instanceId))?.steps[1].dependencyDelaySeconds).toBe(31_536_000);
      for (const [start, end] of [[null, "2030-01-01T00:00:00Z"], ["2030-01-01T00:00:00Z", null], ["2030-01-01T00:00:00Z", "2030-01-01T00:00:00Z"], ["2030-01-02T00:00:00Z", "2030-01-01T00:00:00Z"], ["-infinity", "infinity"]]) {
        await expect(sql!`UPDATE campaign_step SET schedule_type = 'preferred_window', preferred_window_start = ${start}::text::timestamptz, preferred_window_end = ${end}::text::timestamptz WHERE campaign_version_id = ${fixture.versionId} AND step_key = 'publish'`)
          .rejects.toMatchObject({ code: "23514" });
      }
      for (const exact of [null, "infinity", "-infinity"]) {
        await expect(sql!`UPDATE campaign_step SET schedule_type = 'exact_time', scheduled_at = ${exact}::text::timestamptz WHERE campaign_version_id = ${fixture.versionId} AND step_key = 'publish'`)
          .rejects.toMatchObject({ code: "23514" });
      }
    } finally { await fixture.cleanup(); }
  });

  it("uses only same-instance predecessors from the pinned version and their real completion evidence", async () => {
    const fixture = await scheduleFixture([step("prepare"), { ...step("publish", ["prepare"]), dependencyDelaySeconds: 60 }]);
    try {
      const otherInstance = await fixture.createInstance();
      await fixture.campaigns.setStepRunState({ instanceId: otherInstance, stepKey: "prepare", status: "running" });
      await fixture.campaigns.setStepRunState({ instanceId: otherInstance, stepKey: "prepare", status: "succeeded" });
      expect(await fixture.campaigns.getStepScheduleState(fixture.instanceId, "publish"))
        .toMatchObject({ state: "waiting_dependencies", missingDependencies: ["prepare"], predecessors: [{ stepKey: "prepare", status: "planned" }] });
      await fixture.campaigns.setStepRunState({ instanceId: fixture.instanceId, stepKey: "prepare", status: "running" });
      await fixture.campaigns.setStepRunState({ instanceId: fixture.instanceId, stepKey: "prepare", status: "partially_succeeded", output: { optionalSkipped: true } });
      const evaluated = (await fixture.campaigns.getStepScheduleState(fixture.instanceId, "publish"))!;
      expect(evaluated.state).toBe("waiting_until");
      expect(evaluated.campaignVersionId).toBe(fixture.versionId);
      expect(evaluated.predecessors).toHaveLength(1);
      expect(Date.parse(evaluated.notBefore!) - Date.parse(evaluated.predecessors[0].completedAt!)).toBe(60_000);
      expect(Date.parse(evaluated.evaluatedAt)).toBeLessThan(Date.parse(evaluated.notBefore!));
      await fixture.campaigns.saveCampaignDraft(fixture.campaignId, { ...fixture.draft, steps: [step("prepare"), { ...step("publish", ["prepare"]), dependencyDelaySeconds: 120 }] }, fixture.user.id);
      await fixture.campaigns.publishCampaign(fixture.workspace.workspaceId, fixture.campaignId);
      expect((await fixture.campaigns.getStepScheduleState(fixture.instanceId, "publish"))?.notBefore).toBe(evaluated.notBefore);
      expect(await fixture.campaigns.getStepScheduleState(randomUUID(), "publish")).toBeUndefined();
      expect(await fixture.campaigns.getStepScheduleState(fixture.instanceId, "not-a-step")).toBeUndefined();
    } finally { await fixture.cleanup(); }
  });

  it("preserves the first successful completion, output and attempt while ignoring stale terminal regressions", async () => {
    const fixture = await scheduleFixture([step("prepare"), { ...step("publish", ["prepare"]), dependencyDelaySeconds: 60 }]);
    try {
      await fixture.campaigns.setStepRunState({ instanceId: fixture.instanceId, stepKey: "prepare", status: "running" });
      await fixture.campaigns.setStepRunState({ instanceId: fixture.instanceId, stepKey: "prepare", status: "succeeded", output: { original: true } });
      const before = (await fixture.campaigns.getStepScheduleState(fixture.instanceId, "publish"))!;
      const runBefore = (await fixture.campaigns.getCampaignInstance(fixture.workspace.workspaceId, fixture.instanceId))!.stepRuns[0];
      for (const status of ["succeeded", "running", "waiting", "temporarily_failed", "permanently_failed", "manual_resolution", "schedule_blocked", "canceled"] as const) {
        await fixture.campaigns.setStepRunState({ instanceId: fixture.instanceId, stepKey: "prepare", status, output: { replaced: true }, error: "Stale activity" });
      }
      const runAfter = (await fixture.campaigns.getCampaignInstance(fixture.workspace.workspaceId, fixture.instanceId))!.stepRuns[0];
      expect(runAfter).toMatchObject({ status: "succeeded", output: { original: true }, attemptCount: 1, completedAt: runBefore.completedAt });
      expect((await fixture.campaigns.getStepScheduleState(fixture.instanceId, "publish"))?.notBefore).toBe(before.notBefore);
      const attempts = await sql!<{ status: string; output: Record<string, unknown>; completedAt: string }[]>`
        SELECT status, output, completed_at::text FROM campaign_step_attempt WHERE campaign_step_run_id = ${runBefore.id}
      `;
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({ status: "succeeded", output: { original: true } });
      await expect(fixture.campaigns.ensureStepApproval({ instanceId: fixture.instanceId, stepKey: "prepare", snapshot: {} }))
        .rejects.toMatchObject({ issues: [expect.objectContaining({ code: "execution_terminal" })] });
    } finally { await fixture.cleanup(); }
  });

  it("keeps schedule-blocked work terminal except cancellation, preserving the first closed evidence", async () => {
    const fixture = await scheduleFixture([step("prepare")]);
    try {
      await fixture.campaigns.setStepRunState({ instanceId: fixture.instanceId, stepKey: "prepare", status: "schedule_blocked", output: { deadline: "2030-01-01T00:00:00.123Z" }, error: "No legal request-start time remains" });
      const blocked = (await fixture.campaigns.getCampaignInstance(fixture.workspace.workspaceId, fixture.instanceId))!.stepRuns[0];
      for (const status of ["schedule_blocked", "waiting", "running", "manual_resolution", "succeeded", "permanently_failed"] as const) {
        await fixture.campaigns.setStepRunState({ instanceId: fixture.instanceId, stepKey: "prepare", status, output: { replaced: true } });
      }
      expect((await fixture.campaigns.getCampaignInstance(fixture.workspace.workspaceId, fixture.instanceId))!.stepRuns[0]).toMatchObject(blocked);
      await fixture.campaigns.setStepRunState({ instanceId: fixture.instanceId, stepKey: "prepare", status: "canceled", output: { replaced: true } });
      expect((await fixture.campaigns.getCampaignInstance(fixture.workspace.workspaceId, fixture.instanceId))!.stepRuns[0])
        .toMatchObject({ status: "canceled", completedAt: blocked.completedAt, output: blocked.output, lastError: blocked.lastError, attemptCount: 0 });
    } finally { await fixture.cleanup(); }
  });

  it("uses the database clock for expired windows and retains exact-time lower-bound-only behavior", async () => {
    const fixture = await scheduleFixture([step("prepare")]);
    try {
      await sql!`UPDATE campaign_step SET schedule_type = 'preferred_window', preferred_window_start = clock_timestamp() - interval '2 hours', preferred_window_end = clock_timestamp() - interval '1 hour' WHERE campaign_version_id = ${fixture.versionId}`;
      const expired = (await fixture.campaigns.getStepScheduleState(fixture.instanceId, "prepare"))!;
      expect(expired).toMatchObject({ state: "expired", reason: "deadline_reached" });
      expect(Date.parse(expired.evaluatedAt)).toBeGreaterThan(Date.parse(expired.deadline!));
      await sql!`UPDATE campaign_step SET schedule_type = 'exact_time', scheduled_at = clock_timestamp() - interval '1 hour' WHERE campaign_version_id = ${fixture.versionId}`;
      const exact = (await fixture.campaigns.getStepScheduleState(fixture.instanceId, "prepare"))!;
      expect(exact.state).toBe("ready");
      expect(exact.deadline).toBeUndefined();
      await sql!`UPDATE campaign_step SET scheduled_at = clock_timestamp() + interval '1 hour' WHERE campaign_version_id = ${fixture.versionId}`;
      expect(await fixture.campaigns.getStepScheduleState(fixture.instanceId, "prepare")).toMatchObject({ state: "waiting_until" });
    } finally { await fixture.cleanup(); }
  });

  it("rounds historical sub-millisecond evidence conservatively without extending a window", async () => {
    const fixture = await scheduleFixture([step("prepare"), { ...step("publish", ["prepare"]), dependencyDelaySeconds: 1 }]);
    try {
      await fixture.campaigns.setStepRunState({ instanceId: fixture.instanceId, stepKey: "prepare", status: "running" });
      await fixture.campaigns.setStepRunState({ instanceId: fixture.instanceId, stepKey: "prepare", status: "succeeded" });
      await sql!`UPDATE campaign_step_run SET completed_at = '2030-09-10T09:00:00.123456Z'::timestamptz WHERE campaign_instance_id = ${fixture.instanceId} AND campaign_step_id = (SELECT id FROM campaign_step WHERE campaign_version_id = ${fixture.versionId} AND step_key = 'prepare')`;
      await sql!`UPDATE campaign_step SET schedule_type = 'preferred_window', preferred_window_start = '2030-09-10T09:00:00.100456Z'::timestamptz, preferred_window_end = '2030-09-10T10:00:00.456789Z'::timestamptz WHERE campaign_version_id = ${fixture.versionId} AND step_key = 'publish'`;
      expect(await fixture.campaigns.getStepScheduleState(fixture.instanceId, "publish")).toMatchObject({
        state: "waiting_until", notBefore: "2030-09-10T09:00:01.124Z", deadline: "2030-09-10T10:00:00.456Z",
        predecessors: [{ stepKey: "prepare", status: "succeeded", completedAt: "2030-09-10T09:00:00.124Z" }],
      });
    } finally { await fixture.cleanup(); }
  });

  it("does not regress terminal instance status or completion on stale workflow writes", async () => {
    const fixture = await scheduleFixture([step("prepare")]);
    try {
      await fixture.campaigns.setInstanceStatus(fixture.instanceId, "completed");
      const completed = (await fixture.campaigns.getCampaignInstance(fixture.workspace.workspaceId, fixture.instanceId))!;
      for (const status of ["completed", "active", "paused", "failed", "canceled"] as const) await fixture.campaigns.setInstanceStatus(fixture.instanceId, status);
      expect(await fixture.campaigns.getCampaignInstance(fixture.workspace.workspaceId, fixture.instanceId)).toMatchObject({ status: "completed", completedAt: completed.completedAt });
      expect((await fixture.campaigns.getCampaign(fixture.workspace.workspaceId, fixture.campaignId))?.status).toBe("completed");
    } finally { await fixture.cleanup(); }
  });

  it("blocks a valid historical window that has no representable millisecond request-start instant", async () => {
    const fixture = await scheduleFixture([step("publish")]);
    try {
      await sql!`UPDATE campaign_step SET schedule_type = 'preferred_window',
        preferred_window_start = '2030-09-10T09:00:00.000100Z'::timestamptz,
        preferred_window_end = '2030-09-10T09:00:00.000900Z'::timestamptz
        WHERE campaign_version_id = ${fixture.versionId}`;
      expect(await fixture.campaigns.getStepScheduleState(fixture.instanceId, "publish")).toMatchObject({
        state: "expired", reason: "no_legal_time", notBefore: "2030-09-10T09:00:00.001Z", deadline: "2030-09-10T09:00:00.000Z",
        campaignInstanceId: fixture.instanceId, campaignVersionId: fixture.versionId, stepKey: "publish",
      });
    } finally { await fixture.cleanup(); }
  });

  it("cannot enqueue resume or manual completion around a schedule block; cancellation remains available", async () => {
    const fixture = await scheduleFixture([step("blocked"), step("manual")]);
    const queue = (commandType: "resume" | "manual_step_completed" | "cancel", stepKey?: string) => fixture.campaigns.queueInstanceCommand({
      workspaceId: fixture.workspace.workspaceId, instanceId: fixture.instanceId, commandType,
      payload: stepKey ? { stepKey, output: { confirmed: true } } : {}, idempotencyKey: `control:${randomUUID()}`, actorUserId: fixture.user.id,
    });
    try {
      await expect(queue("manual_step_completed", "manual")).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "manual_completion_unavailable" })] });
      await fixture.campaigns.setStepRunState({ instanceId: fixture.instanceId, stepKey: "manual", status: "manual_resolution" });
      expect(await queue("manual_step_completed", "manual")).toBe(true);
      await expect(queue("manual_step_completed", "missing")).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "manual_completion_unavailable" })] });
      await fixture.campaigns.setStepRunState({ instanceId: fixture.instanceId, stepKey: "blocked", status: "schedule_blocked", error: "Window closed" });
      for (const [commandType, stepKey] of [["resume", undefined], ["manual_step_completed", "blocked"], ["manual_step_completed", "manual"]] as const) {
        await expect(queue(commandType, stepKey)).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "schedule_blocked" })] });
      }
      expect(await queue("cancel")).toBe(true);
      const commands = await sql!<{ commandType: string }[]>`SELECT command_type FROM campaign_workflow_command WHERE campaign_instance_id = ${fixture.instanceId} ORDER BY created_at`;
      expect(commands).toEqual([{ commandType: "manual_step_completed" }, { commandType: "cancel" }]);
    } finally { await fixture.cleanup(); }
  });

  it("does not allow a late resume-state write or blocked sibling to reopen execution", async () => {
    const fixture = await scheduleFixture([step("blocked"), step("sibling")]);
    try {
      await fixture.campaigns.setStepRunState({ instanceId: fixture.instanceId, stepKey: "sibling", status: "running" });
      await fixture.campaigns.setStepRunState({ instanceId: fixture.instanceId, stepKey: "blocked", status: "schedule_blocked", error: "Window closed" });
      // Even before the separate pause write arrives, an active instance cannot admit siblings.
      await expect(fixture.campaigns.assertStepExecutionAuthorized(fixture.instanceId, "sibling", { allowBoundedScheduling: true }))
        .rejects.toMatchObject({ issues: [expect.objectContaining({ code: "execution_not_active" })] });
      await fixture.campaigns.setInstanceStatus(fixture.instanceId, "paused");
      for (const status of ["active", "scheduled", "awaiting_approval"] as const) {
        await fixture.campaigns.setInstanceStatus(fixture.instanceId, status);
        expect((await fixture.campaigns.getCampaignInstance(fixture.workspace.workspaceId, fixture.instanceId))?.status).toBe("paused");
      }
      await fixture.campaigns.setInstanceStatus(fixture.instanceId, "canceled");
      expect((await fixture.campaigns.getCampaignInstance(fixture.workspace.workspaceId, fixture.instanceId))?.status).toBe("canceled");
    } finally { await fixture.cleanup(); }
  });

  it("keeps legacy execution closed and admits bounded opt-in only with fresh ready evidence", async () => {
    const fixture = await scheduleFixture([step("prepare"), { ...step("publish", ["prepare"]), dependencyDelaySeconds: 60 }]);
    try {
      await fixture.campaigns.setStepRunState({ instanceId: fixture.instanceId, stepKey: "publish", status: "running" });
      await expect(fixture.campaigns.assertStepExecutionAuthorized(fixture.instanceId, "publish"))
        .rejects.toMatchObject({ issues: [expect.objectContaining({ code: "unsupported_delay" })] });
      await expect(fixture.campaigns.assertStepExecutionAuthorized(fixture.instanceId, "publish", { allowBoundedScheduling: true }))
        .rejects.toMatchObject({ name: "CampaignScheduleNotReadyError", schedule: { state: "waiting_dependencies", missingDependencies: ["prepare"] } });
      await fixture.campaigns.setStepRunState({ instanceId: fixture.instanceId, stepKey: "prepare", status: "running" });
      await fixture.campaigns.setStepRunState({ instanceId: fixture.instanceId, stepKey: "prepare", status: "succeeded" });
      await expect(fixture.campaigns.assertStepExecutionAuthorized(fixture.instanceId, "publish", { allowBoundedScheduling: true }))
        .rejects.toMatchObject({ name: "CampaignScheduleNotReadyError", schedule: { state: "waiting_until" } });
      await sql!`UPDATE campaign_step_run SET completed_at = clock_timestamp() - interval '2 minutes' WHERE campaign_instance_id = ${fixture.instanceId} AND campaign_step_id = (SELECT id FROM campaign_step WHERE campaign_version_id = ${fixture.versionId} AND step_key = 'prepare')`;
      await expect(fixture.campaigns.assertStepExecutionAuthorized(fixture.instanceId, "publish", { allowBoundedScheduling: true })).resolves.toBeUndefined();
      await sql!`UPDATE campaign_step SET schedule_type = 'preferred_window', preferred_window_start = clock_timestamp() - interval '2 hours', preferred_window_end = clock_timestamp() - interval '1 hour' WHERE campaign_version_id = ${fixture.versionId} AND step_key = 'publish'`;
      try {
        await fixture.campaigns.assertStepExecutionAuthorized(fixture.instanceId, "publish", { allowBoundedScheduling: true });
        throw new Error("An expired schedule was incorrectly admitted");
      } catch (error) {
        expect(error).toBeInstanceOf(CampaignScheduleNotReadyError);
        expect(error).toMatchObject({ issues: [expect.objectContaining({ code: "execution_schedule_expired" })], schedule: { state: "expired", reason: "deadline_reached", campaignVersionId: fixture.versionId } });
      }
      await fixture.campaigns.setInstanceStatus(fixture.instanceId, "paused");
      await expect(fixture.campaigns.assertStepExecutionAuthorized(fixture.instanceId, "publish", { allowBoundedScheduling: true }))
        .rejects.toMatchObject({ issues: [expect.objectContaining({ code: "execution_not_active" })] });
    } finally { await fixture.cleanup(); }
  });
});

async function scheduleFixture(steps: readonly CampaignStep[]) {
  sql ??= createDatabaseClient(databaseUrl!);
  const campaigns = new CampaignRepository(sql);
  const { user, workspace } = await new MarketMeRepository(sql).bootstrapDevelopmentWorkspace({ email: `schedule-${randomUUID()}@market-me.local`, displayName: "Scheduler Integration Test" });
  const cleanup = async () => {
    await sql!`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
    await sql!`DELETE FROM app_user WHERE id = ${user.id}`;
  };
  const draft: CampaignDraftWrite = { workspaceId: workspace.workspaceId, name: "Schedule fixture", description: "", objective: "awareness",
    contentPackageIds: [], audienceProfileVersionIds: [], informationDepth: "contextual", promotionalStrength: "light", autonomyMode: "fully_autonomous", timezone: "America/Chicago", context: {}, steps };
  try {
    const campaign = await campaigns.createCampaign(draft, user.id);
    await campaigns.publishCampaign(workspace.workspaceId, campaign.id);
    const versionId = (await campaigns.getCampaign(workspace.workspaceId, campaign.id))!.currentVersion!.id;
    // Synthetic persisted runs exercise the read-only evaluator independently of
    // provider-route eligibility. Public activation must still refuse windowed waits.
    const createInstance = async () => {
      const instanceId = randomUUID();
      await sql!`INSERT INTO campaign_instance (id, workspace_id, campaign_id, campaign_version_id, status, requested_by)
        VALUES (${instanceId}, ${workspace.workspaceId}, ${campaign.id}, ${versionId}, 'active', ${user.id})`;
      const persistedSteps = await sql!<{ id: string; stepKey: string }[]>`SELECT id, step_key FROM campaign_step WHERE campaign_version_id = ${versionId}`;
      for (const persisted of persistedSteps) await sql!`INSERT INTO campaign_step_run (id, campaign_instance_id, campaign_step_id, idempotency_key)
        VALUES (${randomUUID()}, ${instanceId}, ${persisted.id}, ${`schedule:${instanceId}:${persisted.stepKey}`})`;
      return instanceId;
    };
    return { campaigns, user, workspace, campaignId: campaign.id, versionId, draft, instanceId: await createInstance(), createInstance, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
