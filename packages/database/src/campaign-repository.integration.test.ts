import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { CampaignRepository } from "./campaign-repository";
import { PublishingRepository } from "./publishing-repository";
import { MarketMeRepository } from "./repositories";
import { CompanionRepository } from "./companion-repository";
import { hashCompanionSecret } from "@market-me/companion-protocol";
import type { CampaignDraftWrite } from "./models";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("campaign repositories", () => {
  afterAll(async () => sql?.end());

  it("binds direct publication creation to the running target and actual human approval", async () => {
    sql ??= createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const campaigns = new CampaignRepository(sql);
    const publishing = new PublishingRepository(sql);
    const { user, workspace } = await core.bootstrapDevelopmentWorkspace({ email: `publication-authority-${randomUUID()}@market-me.local`, displayName: "Publication Authority Test" });
    try {
      const connection = await publishing.saveChannelConnection({ workspaceId: workspace.workspaceId, provider: "discord_webhook", name: "Approved channel", encryptedCredentials: "test-not-used", capabilities: {} }, user.id);
      const other = await publishing.saveChannelConnection({ workspaceId: workspace.workspaceId, provider: "discord_webhook", name: "Other channel", encryptedCredentials: "test-not-used", capabilities: {} }, user.id);
      const campaign = await campaigns.createCampaign({
        workspaceId: workspace.workspaceId, name: "Publication authority", description: "", objective: "awareness", contentPackageIds: [], audienceProfileVersionIds: [], informationDepth: "contextual", promotionalStrength: "light", autonomyMode: "approval_required", timezone: "UTC", context: {},
        steps: [
          { id: "prepare", name: "Prepare", operationType: "wait", desiredCapability: "workflow.wait", dependsOn: [], inputs: {}, outputs: {}, executionMethods: ["manual_handoff"], approvalRequired: false },
          { id: "publish", name: "Publication", operationType: "publish_content", desiredCapability: "publish_content", dependsOn: ["prepare"], inputs: { channelConnectionId: connection.id, content: "Reviewed content" }, outputs: {}, executionMethods: ["official_api"], approvalRequired: false },
        ],
      }, user.id);
      await campaigns.publishCampaign(workspace.workspaceId, campaign.id);
      const instance = (await campaigns.activateCampaign({ workspaceId: workspace.workspaceId, campaignId: campaign.id, actorUserId: user.id }))!;
      const target = (await publishing.getCampaignExecutionTarget(instance.id, "publish"))!;
      expect(target.humanApprovalGranted).toBe(false);
      const start = { target, idempotencyKey: `authority:${instance.id}`, requestSnapshot: { content: "Reviewed content" } };
      await expect(publishing.beginPublicationAction(start)).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "execution_not_active" })] });
      await campaigns.setInstanceStatus(instance.id, "active");
      await campaigns.setStepRunState({ instanceId: instance.id, stepKey: "publish", status: "running" });
      await expect(publishing.beginPublicationAction({ ...start, target: { ...target, humanApprovalGranted: true } })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "step_approval_required" })] });
      const approval = await campaigns.ensureStepApproval({ instanceId: instance.id, stepKey: "publish", snapshot: { name: "Publication", inputs: target.input } });
      await campaigns.decideApproval({ workspaceId: workspace.workspaceId, approvalId: approval, decision: "approved", actorUserId: user.id, idempotencyKey: `decision:${approval}` });
      await campaigns.setStepRunState({ instanceId: instance.id, stepKey: "publish", status: "running" });
      const reviewed = (await publishing.getCampaignExecutionTarget(instance.id, "publish"))!;
      expect(reviewed.humanApprovalGranted).toBe(true);
      await expect(publishing.beginPublicationAction({ ...start, target: reviewed })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "execution_dependencies_incomplete" })] });
      await campaigns.setStepRunState({ instanceId: instance.id, stepKey: "prepare", status: "running" });
      await campaigns.setStepRunState({ instanceId: instance.id, stepKey: "prepare", status: "succeeded" });
      await sql`UPDATE campaign_step SET schedule_type = 'exact_time', scheduled_at = now() + interval '1 hour' WHERE campaign_version_id = ${instance.campaignVersionId} AND step_key = 'publish'`;
      await expect(publishing.beginPublicationAction({ ...start, target: reviewed })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "execution_not_due" })] });
      await sql`UPDATE campaign_step SET schedule_type = 'immediate', scheduled_at = null WHERE campaign_version_id = ${instance.campaignVersionId} AND step_key = 'publish'`;
      await expect(publishing.beginPublicationAction({ ...start, target: { ...reviewed, connection: other, channelConnectionId: other.id } })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "publication_target_mismatch" })] });
      await expect(publishing.beginPublicationAction({ ...start, target: { ...reviewed, campaignStepRunId: randomUUID() } })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "publication_target_mismatch" })] });
      const created = await publishing.beginPublicationAction({ ...start, target: reviewed });
      expect(created.created).toBe(true);
      expect((await publishing.beginPublicationAction({ ...start, target: reviewed })).created).toBe(false);
      expect((await publishing.listPublicationActions(workspace.workspaceId, instance.id))).toHaveLength(1);
    } finally {
      await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
      await sql`DELETE FROM app_user WHERE id = ${user.id}`;
    }
  });

  it("preserves unsupported authored plans, refuses activation, and records whole-campaign approval decisions", async () => {
    sql ??= createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const campaigns = new CampaignRepository(sql);
    const { user, workspace } = await core.bootstrapDevelopmentWorkspace({ email: `execution-authority-${randomUUID()}@market-me.local`, displayName: "Execution Authority Test" });
    const base: CampaignDraftWrite = {
      workspaceId: workspace.workspaceId, name: "Execution authority", description: "", objective: "awareness", contentPackageIds: [], audienceProfileVersionIds: [], informationDepth: "contextual", promotionalStrength: "light", autonomyMode: "fully_autonomous", timezone: "UTC", context: {},
      steps: [{ id: "publish", name: "Publication", operationType: "publish_content", desiredCapability: "publish_content", dependsOn: [], inputs: {}, outputs: {}, executionMethods: ["manual_handoff"], approvalRequired: false }],
    };
    try {
      for (const scheduleType of ["conditional", "follow_up", "preferred_window", "recurring", "evergreen_queue"] as const) {
        const draft = await campaigns.createCampaign({ ...base, steps: [{ ...base.steps[0], scheduleType, preferredWindowStart: "2026-09-10T09:00:00Z", preferredWindowEnd: "2026-09-10T17:00:00Z" }] }, user.id);
        await campaigns.publishCampaign(workspace.workspaceId, draft.id);
        await expect(campaigns.activateCampaign({ workspaceId: workspace.workspaceId, campaignId: draft.id, actorUserId: user.id })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "unsupported_schedule" })] });
        expect((await campaigns.getCampaign(workspace.workspaceId, draft.id))?.currentVersion?.steps[0].scheduleType).toBe(scheduleType);
      }
      const drafting = await campaigns.createCampaign({ ...base, autonomyMode: "draft_only" }, user.id);
      await campaigns.publishCampaign(workspace.workspaceId, drafting.id);
      await expect(campaigns.activateCampaign({ workspaceId: workspace.workspaceId, campaignId: drafting.id, actorUserId: user.id })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "autonomy_execution_disabled" })] });
      const conditioned = await campaigns.createCampaign({ ...base, steps: [{ ...base.steps[0], condition: { metric: "destination_visit", minimum: 10 } }] }, user.id);
      await campaigns.publishCampaign(workspace.workspaceId, conditioned.id);
      await expect(campaigns.activateCampaign({ workspaceId: workspace.workspaceId, campaignId: conditioned.id, actorUserId: user.id })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "unsupported_condition" })] });
      expect(await campaigns.listCampaignInstances(workspace.workspaceId)).toEqual([]);
      const queued = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM campaign_workflow_command WHERE workspace_id = ${workspace.workspaceId}`;
      expect(queued[0].count).toBe(0);

      const campaign = await campaigns.createCampaign({ ...base, autonomyMode: "campaign_approval" }, user.id);
      await campaigns.publishCampaign(workspace.workspaceId, campaign.id);
      const instance = (await campaigns.activateCampaign({ workspaceId: workspace.workspaceId, campaignId: campaign.id, actorUserId: user.id }))!;
      await campaigns.markWorkflowStarted(instance.id, `campaign-${instance.id}`);
      expect((await campaigns.getCampaignInstance(workspace.workspaceId, instance.id))?.status).toBe("awaiting_approval");
      const snapshot = { name: "Approve campaign execution", approvalScope: "campaign", campaignVersionId: instance.campaignVersionId, steps: base.steps };
      const approvalId = await campaigns.ensureStepApproval({ instanceId: instance.id, stepKey: "__campaign__", snapshot });
      expect(await campaigns.ensureStepApproval({ instanceId: instance.id, stepKey: "__campaign__", snapshot })).toBe(approvalId);
      const pending = await campaigns.listApprovals(workspace.workspaceId, "pending");
      expect(pending).toHaveLength(1);
      expect(pending[0].requestSnapshot).toEqual(snapshot);
      await campaigns.setInstanceStatus(instance.id, "active");
      await campaigns.setStepRunState({ instanceId: instance.id, stepKey: "publish", status: "running" });
      await expect(campaigns.assertStepExecutionAuthorized(instance.id, "publish")).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "campaign_approval_required" })] });
      expect(await campaigns.decideApproval({ workspaceId: randomUUID(), approvalId, decision: "approved", actorUserId: user.id, idempotencyKey: `wrong:${approvalId}` })).toBe(false);
      expect(await campaigns.decideApproval({ workspaceId: workspace.workspaceId, approvalId, decision: "approved", actorUserId: user.id, idempotencyKey: `approve:${approvalId}` })).toBe(true);
      expect(await campaigns.decideApproval({ workspaceId: workspace.workspaceId, approvalId, decision: "approved", actorUserId: user.id, idempotencyKey: `approve:${approvalId}` })).toBe(false);
      expect(await campaigns.ensureStepApproval({ instanceId: instance.id, stepKey: "__campaign__", snapshot })).toBe(approvalId);
      expect(await campaigns.listApprovals(workspace.workspaceId, "pending")).toEqual([]);
      const decisions = await sql<{ payload: Record<string, unknown> }[]>`SELECT payload FROM campaign_workflow_command WHERE campaign_instance_id = ${instance.id} AND command_type = 'approval_decision'`;
      expect(decisions).toEqual([{ payload: { stepKey: "__campaign__", decision: "approved", approvalId } }]);
      await expect(campaigns.assertStepExecutionAuthorized(instance.id, "publish")).resolves.toBeUndefined();
      await campaigns.setInstanceStatus(instance.id, "paused");
      await expect(campaigns.assertStepExecutionAuthorized(instance.id, "publish")).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "execution_not_active" })] });
      await campaigns.setInstanceStatus(instance.id, "failed");
      await campaigns.markWorkflowStarted(instance.id, `campaign-${instance.id}`);
      expect((await campaigns.getCampaignInstance(workspace.workspaceId, instance.id))?.status).toBe("failed");

      const reviewCampaign = await campaigns.createCampaign({ ...base, autonomyMode: "approval_required" }, user.id);
      await campaigns.publishCampaign(workspace.workspaceId, reviewCampaign.id);
      const reviewRun = (await campaigns.activateCampaign({ workspaceId: workspace.workspaceId, campaignId: reviewCampaign.id, actorUserId: user.id }))!;
      await campaigns.setInstanceStatus(reviewRun.id, "active");
      await campaigns.setStepRunState({ instanceId: reviewRun.id, stepKey: "publish", status: "running" });
      await expect(campaigns.assertStepExecutionAuthorized(reviewRun.id, "publish")).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "step_approval_required" })] });
      const stepApproval = await campaigns.ensureStepApproval({ instanceId: reviewRun.id, stepKey: "publish", snapshot: { name: "Publication" } });
      await campaigns.decideApproval({ workspaceId: workspace.workspaceId, approvalId: stepApproval, decision: "approved", actorUserId: user.id, idempotencyKey: `approve:${stepApproval}` });
      expect(await campaigns.ensureStepApproval({ instanceId: reviewRun.id, stepKey: "publish", snapshot: { name: "Publication" } })).toBe(stepApproval);
      await campaigns.setStepRunState({ instanceId: reviewRun.id, stepKey: "publish", status: "running" });
      await expect(campaigns.assertStepExecutionAuthorized(reviewRun.id, "publish")).resolves.toBeUndefined();
      await sql`UPDATE campaign_version SET autonomy_mode = 'draft_only' WHERE id = ${reviewRun.campaignVersionId}`;
      await expect(campaigns.assertStepExecutionAuthorized(reviewRun.id, "publish")).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "autonomy_execution_disabled" })] });
    } finally {
      await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
      await sql`DELETE FROM app_user WHERE id = ${user.id}`;
    }
  });

  it("versions a campaign and creates an idempotent workflow start command", async () => {
    sql ??= createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const campaigns = new CampaignRepository(sql);
    const publishing = new PublishingRepository(sql);
    const companion = new CompanionRepository(sql);
    const suffix = randomUUID();
    const { user, workspace } = await core.bootstrapDevelopmentWorkspace({
      email: `campaign-${suffix}@market-me.local`,
      displayName: "Campaign Integration Test",
    });
    try {
      const pairHash = hashCompanionSecret(`pair-${suffix}`);
      await companion.createPairingCode({
        workspaceId: workspace.workspaceId,
        codeHash: pairHash,
        expiresAt: new Date(Date.now() + 60_000),
        createdBy: user.id,
      });
      const worker = await companion.pairWorker({
        codeHash: pairHash,
        name: "Campaign companion",
        platform: "windows",
        architecture: "x86_64",
        appVersion: "0.8.0",
        tokenPrefix: "mm_worker_fixture",
        tokenHash: hashCompanionSecret(`worker-${suffix}`),
      });
      await companion.heartbeat({
        workerId: worker!.id,
        appVersion: "0.8.0",
        platform: "windows",
        architecture: "x86_64",
        healthState: "healthy",
        capabilities: { assistedOpenUrl: true },
        details: {},
      });
      const destination = await campaigns.saveDestination(
        {
          workspaceId: workspace.workspaceId,
          provider: "manual",
          canonicalUrl: `https://example.com/launch/${suffix}`,
          knownRedirects: [],
          title: "Launch page",
          description: "Canonical campaign destination",
          contentType: "landing_page",
          identifiers: { launchId: suffix },
          topics: ["launch"],
          audiences: ["customers"],
          geography: ["US"],
          language: "en",
          status: "published",
          tracking: { source: "market-me" },
        },
        user.id,
      );
      const draft = {
        workspaceId: workspace.workspaceId,
        name: "Launch campaign",
        description: "Durable manual launch workflow",
        objective: "awareness" as const,
        contentPackageIds: [],
        audienceProfileVersionIds: [],
        destinationId: destination.id,
        informationDepth: "contextual" as const,
        promotionalStrength: "standard" as const,
        autonomyMode: "approval_required" as const,
        timezone: "America/Chicago",
        context: { release: "0.4" },
        successCriteria: [
          {
            id: "traffic",
            eventType: "destination_visit" as const,
            targetCount: 1,
          },
          {
            id: "registrations",
            eventType: "registration" as const,
            targetCount: 3,
          },
          {
            id: "revenue_usd",
            eventType: "revenue" as const,
            metric: "value" as const,
            targetValue: 100,
            currency: "USD",
          },
        ],
        successAction: "pause" as const,
        steps: [
          {
            id: "review",
            name: "Review launch handoff",
            operationType: "manual_handoff" as const,
            desiredCapability: "open_url",
            dependsOn: [],
            inputs: {
              targetUrl: destination.canonicalUrl,
              instructions: "Review the launch page and confirm.",
            },
            outputs: { confirmation: "string" },
            executionMethods: ["user_assisted", "manual_handoff"] as const,
            approvalRequired: true,
            scheduleType: "immediate" as const,
            maxAttempts: 1,
            timeoutSeconds: 300,
          },
        ],
      };
      const created = await campaigns.createCampaign(draft, user.id);
      const otherCampaign = await campaigns.createCampaign(
        { ...draft, name: "Other scoped campaign" },
        user.id,
      );
      expect(created.draftVersion).toEqual(
        expect.objectContaining({
          versionNumber: 1,
          status: "draft",
          successAction: "pause",
        }),
      );
      const published = await campaigns.publishCampaign(
        workspace.workspaceId,
        created.id,
      );
      expect(published?.currentVersion).toEqual(
        expect.objectContaining({
          versionNumber: 1,
          status: "published",
          successAction: "pause",
        }),
      );
      const revised = await campaigns.saveCampaignDraft(
        created.id,
        { ...draft, description: "Revised future version" },
        user.id,
      );
      expect(revised?.currentVersion?.versionNumber).toBe(1);
      expect(revised?.draftVersion).toEqual(
        expect.objectContaining({ versionNumber: 2, status: "draft" }),
      );
      await sql`UPDATE destination SET status = 'draft' WHERE id = ${destination.id}`;
      await expect(
        campaigns.activateCampaign({
          workspaceId: workspace.workspaceId,
          campaignId: created.id,
          actorUserId: user.id,
        }),
      ).rejects.toThrow("destination must be published");
      await sql`UPDATE destination SET status = 'published' WHERE id = ${destination.id}`;
      const instance = await campaigns.activateCampaign({
        workspaceId: workspace.workspaceId,
        campaignId: created.id,
        actorUserId: user.id,
      });
      expect(instance).toEqual(
        expect.objectContaining({
          status: "scheduled",
          campaignVersionId: published!.currentVersion!.id,
        }),
      );
      expect(instance?.stepRuns).toHaveLength(1);
      const commands = await campaigns.claimWorkflowCommands(10);
      const start = commands.find(
        (command) => command.campaignInstanceId === instance!.id,
      );
      expect(start).toEqual(
        expect.objectContaining({ commandType: "start", attemptCount: 1 }),
      );
      await campaigns.markWorkflowStarted(
        instance!.id,
        `campaign-${instance!.id}`,
        "test-run",
      );
      await campaigns.finishWorkflowCommand(start!.id);
      expect(
        (
          await campaigns.getCampaignInstance(
            workspace.workspaceId,
            instance!.id,
          )
        )?.status,
      ).toBe("active");
      await campaigns.setStepRunState({
        instanceId: instance!.id,
        stepKey: "review",
        status: "waiting",
      });
      await campaigns.setStepRunState({
        instanceId: instance!.id,
        stepKey: "review",
        status: "running",
      });
      await campaigns.setStepRunState({
        instanceId: instance!.id,
        stepKey: "review",
        status: "running",
      });
      await campaigns.setStepRunState({
        instanceId: instance!.id,
        stepKey: "review",
        status: "succeeded",
        output: { confirmation: "done" },
      });
      const attempts = await sql<
        {
          attemptNumber: number;
          status: string;
          output: Record<string, unknown>;
        }[]
      >`
        SELECT attempt_number, status, output FROM campaign_step_attempt
        WHERE campaign_step_run_id = ${instance!.stepRuns[0].id}
      `;
      expect(attempts).toEqual([
        {
          attemptNumber: 1,
          status: "succeeded",
          output: { confirmation: "done" },
        },
      ]);
      const tracked = await publishing.createTrackedLink({
        workspaceId: workspace.workspaceId,
        destinationId: destination.id,
        campaignInstanceId: instance!.id,
        campaignStepRunId: instance!.stepRuns[0].id,
        utmParameters: { utm_source: "integration" },
        createdBy: user.id,
      });
      expect(tracked.utmParameters).toEqual({ utm_source: "integration" });
      expect(
        (
          await publishing.createTrackedLink({
            workspaceId: workspace.workspaceId,
            destinationId: destination.id,
            campaignInstanceId: instance!.id,
            campaignStepRunId: instance!.stepRuns[0].id,
            createdBy: user.id,
          })
        ).id,
      ).toBe(tracked.id);
      expect(
        await publishing.recordMeasurementEvent({
          workspaceId: workspace.workspaceId,
          eventKey: `visit:${tracked.id}`,
          eventType: "destination_visit",
          source: "test",
          campaignInstanceId: instance!.id,
          destinationId: destination.id,
          trackedLinkId: tracked.id,
          occurredAt: new Date().toISOString(),
        }),
      ).toBe(true);
      expect(
        await publishing.recordMeasurementEvent({
          workspaceId: workspace.workspaceId,
          eventKey: `visit:${tracked.id}`,
          eventType: "destination_visit",
          source: "test",
          campaignInstanceId: instance!.id,
          destinationId: destination.id,
          trackedLinkId: tracked.id,
          occurredAt: new Date().toISOString(),
        }),
      ).toBe(false);
      const ingestKey = await publishing.createMeasurementKey(
        workspace.workspaceId,
        "Integration key",
        user.id,
        {
          allowedEventTypes: ["registration", "revenue"],
          allowedCampaignIds: [created.id],
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      );
      const principal = await publishing.authenticateMeasurementKey(
        ingestKey.secret,
      );
      expect(principal).toEqual(
        expect.objectContaining({
          workspaceId: workspace.workspaceId,
          allowedEventTypes: ["registration", "revenue"],
          campaignScopeMode: "restricted",
          allowedCampaignIds: [created.id],
        }),
      );
      expect(
        await publishing.isMeasurementCampaignAllowed(principal!, {
          campaignId: created.id,
          campaignInstanceId: instance!.id,
          campaignStepRunId: instance!.stepRuns[0].id,
          trackedLinkId: tracked.id,
        }),
      ).toBe(true);
      expect(
        await publishing.isMeasurementCampaignAllowed(principal!, {
          campaignId: otherCampaign.id,
        }),
      ).toBe(false);
      expect(
        await publishing.isMeasurementCampaignAllowed(principal!, {}),
      ).toBe(false);
      expect(
        await publishing.isMeasurementCampaignAllowed(principal!, {
          campaignId: otherCampaign.id,
          campaignInstanceId: instance!.id,
        }),
      ).toBe(false);
      expect(
        await publishing.revokeMeasurementKey(
          workspace.workspaceId,
          ingestKey.id,
          user.id,
        ),
      ).toBe(true);
      expect(
        await publishing.revokeMeasurementKey(
          workspace.workspaceId,
          ingestKey.id,
          user.id,
        ),
      ).toBe(false);
      expect(
        await publishing.authenticateMeasurementKey(ingestKey.secret),
      ).toBeUndefined();
      expect(
        (await publishing.listMeasurementKeys(workspace.workspaceId))[0],
      ).toEqual(
        expect.objectContaining({
          id: ingestKey.id,
          status: "revoked",
          allowedEventTypes: ["registration", "revenue"],
          campaignScopeMode: "restricted",
          allowedCampaignIds: [created.id],
          expiresAt: expect.any(Date),
          revokedAt: expect.any(Date),
        }),
      );
      expect(
        await sql<{ eventType: string; data: Record<string, unknown> }[]>`
        SELECT event_type, data FROM audit_event WHERE workspace_id = ${workspace.workspaceId}
          AND subject_id = ${ingestKey.id} ORDER BY created_at
      `,
      ).toEqual([
        {
          eventType: "measurement.key.created",
          data: expect.objectContaining({
            campaignScopeMode: "restricted",
            allowedCampaignIds: [created.id],
          }),
        },
        {
          eventType: "measurement.key.revoked",
          data: expect.any(Object),
        },
      ]);
      const expiredKey = await publishing.createMeasurementKey(
        workspace.workspaceId,
        "Expired integration key",
        user.id,
        {
          allowedEventTypes: ["revenue"],
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      );
      await sql`UPDATE measurement_ingest_key SET expires_at = now() - interval '1 minute' WHERE id = ${expiredKey.id}`;
      expect(
        await publishing.authenticateMeasurementKey(expiredKey.secret),
      ).toBeUndefined();
      expect(
        (await publishing.listMeasurementKeys(workspace.workspaceId)).find(
          (key) => key.id === expiredKey.id,
        ),
      ).toEqual(
        expect.objectContaining({
          status: "expired",
          allowedEventTypes: ["revenue"],
          campaignScopeMode: "all",
          allowedCampaignIds: [],
        }),
      );
      await publishing.recordMeasurementEvent({
        workspaceId: workspace.workspaceId,
        eventKey: `conversion:${tracked.id}`,
        eventType: "registration",
        source: "test",
        campaignInstanceId: instance!.id,
        destinationId: destination.id,
        trackedLinkId: tracked.id,
        value: 1,
        occurredAt: new Date().toISOString(),
      });
      await publishing.recordMeasurementEvent({
        workspaceId: workspace.workspaceId,
        eventKey: `revenue-usd-a:${tracked.id}`,
        eventType: "revenue",
        source: "test",
        campaignInstanceId: instance!.id,
        destinationId: destination.id,
        trackedLinkId: tracked.id,
        value: 60,
        currency: "USD",
        occurredAt: new Date().toISOString(),
      });
      await publishing.recordMeasurementEvent({
        workspaceId: workspace.workspaceId,
        eventKey: `revenue-usd-b:${tracked.id}`,
        eventType: "revenue",
        source: "test",
        campaignInstanceId: instance!.id,
        destinationId: destination.id,
        trackedLinkId: tracked.id,
        value: 45,
        currency: "USD",
        occurredAt: new Date().toISOString(),
      });
      await publishing.recordMeasurementEvent({
        workspaceId: workspace.workspaceId,
        eventKey: `revenue-eur:${tracked.id}`,
        eventType: "revenue",
        source: "test",
        campaignInstanceId: instance!.id,
        destinationId: destination.id,
        trackedLinkId: tracked.id,
        value: 1000,
        currency: "EUR",
        occurredAt: new Date().toISOString(),
      });
      expect(
        await publishing.getCampaignMeasurementSummary(
          workspace.workspaceId,
          instance!.id,
        ),
      ).toEqual(
        expect.objectContaining({
          totals: {
            destination_visit: { count: 1, value: 0 },
            registration: { count: 1, value: 1 },
            revenue: { count: 3, value: 0 },
          },
          currencyTotals: { revenue: { EUR: 1000, USD: 105 } },
          criteria: [
            {
              id: "traffic",
              eventType: "destination_visit",
              metric: "count",
              targetCount: 1,
              currentCount: 1,
              met: true,
            },
            {
              id: "registrations",
              eventType: "registration",
              metric: "count",
              targetCount: 3,
              currentCount: 1,
              met: false,
            },
            {
              id: "revenue_usd",
              eventType: "revenue",
              metric: "value",
              targetValue: 100,
              currency: "USD",
              currentValue: 105,
              met: true,
            },
          ],
          allCriteriaMet: false,
        }),
      );
      const thresholdEventKeys = [
        `registration-threshold-a:${tracked.id}`,
        `registration-threshold-b:${tracked.id}`,
      ];
      expect(
        await Promise.all(
          thresholdEventKeys.map((eventKey) =>
            publishing.recordMeasurementEvent({
              workspaceId: workspace.workspaceId,
              eventKey,
              eventType: "registration",
              source: "test",
              campaignInstanceId: instance!.id,
              destinationId: destination.id,
              trackedLinkId: tracked.id,
              occurredAt: new Date().toISOString(),
            }),
          ),
        ),
      ).toEqual([true, true]);
      expect(
        await publishing.recordMeasurementEvent({
          workspaceId: workspace.workspaceId,
          eventKey: thresholdEventKeys[0],
          eventType: "registration",
          source: "test",
          campaignInstanceId: instance!.id,
          destinationId: destination.id,
          trackedLinkId: tracked.id,
          occurredAt: new Date().toISOString(),
        }),
      ).toBe(false);
      expect(
        await publishing.getCampaignMeasurementSummary(
          workspace.workspaceId,
          instance!.id,
        ),
      ).toEqual(
        expect.objectContaining({
          allCriteriaMet: true,
          successTransition: expect.objectContaining({
            status: "pending",
            queuedAt: expect.any(Date),
          }),
        }),
      );
      const thresholdCommands = await sql<
        {
          commandType: string;
          idempotencyKey: string;
          payload: Record<string, unknown>;
        }[]
      >`
        SELECT command_type, idempotency_key, payload FROM campaign_workflow_command
        WHERE campaign_instance_id = ${instance!.id} AND command_type = 'success_criteria_met'
      `;
      expect(thresholdCommands).toEqual([
        expect.objectContaining({
          commandType: "success_criteria_met",
          idempotencyKey: `campaign:${instance!.id}:success-criteria-met`,
          payload: expect.objectContaining({
            action: "pause",
            triggerEventKey: expect.any(String),
          }),
        }),
      ]);
      expect(thresholdEventKeys).toContain(
        thresholdCommands[0]?.payload.triggerEventKey,
      );
      expect(
        await campaigns.queueInstanceCommand({
          workspaceId: workspace.workspaceId,
          instanceId: instance!.id,
          commandType: "pause",
          idempotencyKey: `pause:${instance!.id}:1`,
          actorUserId: user.id,
        }),
      ).toBe(true);
      expect(
        await campaigns.queueInstanceCommand({
          workspaceId: workspace.workspaceId,
          instanceId: instance!.id,
          commandType: "pause",
          idempotencyKey: `pause:${instance!.id}:1`,
          actorUserId: user.id,
        }),
      ).toBe(false);
      const job = await companion.createJob({
        workspaceId: workspace.workspaceId,
        workerId: worker!.id,
        campaignInstanceId: instance!.id,
        campaignStepRunId: instance!.stepRuns[0].id,
        action: "open_url",
        actionMode: "confirm_before_submit",
        targetUrl: "https://example.com/launch",
        expectedOrigin: "https://example.com",
        allowedDomains: ["example.com"],
        instructions: "Confirm the Campaign handoff.",
        idempotencyKey: `campaign:${instance!.id}:step:review:open_url`,
        createdBy: user.id,
      });
      const claimed = await companion.claimNextJob(worker!.id);
      expect(claimed?.job.id).toBe(job.id);
      expect(
        await companion.completeJob({
          workerId: worker!.id,
          jobId: job.id,
          claimToken: claimed!.claimToken,
          status: "succeeded",
          result: { opened: true },
        }),
      ).toBe(true);
      expect(
        await companion.completeJob({
          workerId: worker!.id,
          jobId: job.id,
          claimToken: claimed!.claimToken,
          status: "succeeded",
          result: { opened: true },
        }),
      ).toBe(false);
      const companionCommands = await sql<
        { payload: Record<string, unknown> }[]
      >`
        SELECT payload FROM campaign_workflow_command WHERE idempotency_key = ${`companion-job:${job.id}:completed`}
      `;
      expect(companionCommands).toEqual([
        {
          payload: {
            stepKey: "review",
            output: { opened: true, companionJobId: job.id },
          },
        },
      ]);
    } finally {
      await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
      await sql`DELETE FROM app_user WHERE id = ${user.id}`;
    }
  });
});
