import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { mastodonCapabilities, SLACK_WEBHOOK_CAPABILITIES } from "@market-me/connectors";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { PublishingRepository } from "./publishing-repository";
import { MarketMeRepository } from "./repositories";
import { CampaignRepository } from "./campaign-repository";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("publishing repository", () => {
  afterAll(async () => sql?.end());

  it("allows exactly one concurrent retry claimant and preserves the winning state", async () => {
    const fixture = await failedPublicationFixture();
    try {
      const { publishing, target, actionId, idempotencyKey } = fixture;
      const results = await Promise.all([
        publishing.retryPublicationAction(actionId, target, { content: "Reviewed retry" }),
        publishing.retryPublicationAction(actionId, target, { content: "Reviewed retry" }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await publishing.getPublicationActionByIdempotencyKey(idempotencyKey)).toMatchObject({ status: "dispatching", lastError: null });
      expect(await publishing.retryPublicationAction(actionId, target, { content: "Reviewed retry" })).toBe(false);
      await publishing.finishPublicationAction(actionId, { status: "succeeded", providerExternalId: "confirmed-message" });
      expect(await publishing.retryPublicationAction(actionId, target, { content: "Reviewed retry" })).toBe(false);
      expect(await publishing.getPublicationActionByIdempotencyKey(idempotencyKey)).toMatchObject({ status: "succeeded", providerExternalId: "confirmed-message" });
    } finally { await fixture.cleanup(); }
  });

  it("rechecks exact retry target, active policy, original account, and immutable version binding", async () => {
    const fixture = await failedPublicationFixture();
    const { publishing, campaigns, target, actionId, instance, connection, approvalId } = fixture;
    try {
      for (const changed of [
        { ...target, workspaceId: randomUUID() },
        { ...target, campaignId: randomUUID() },
        { ...target, campaignInstanceId: randomUUID() },
        { ...target, campaignStepRunId: randomUUID() },
        { ...target, connection: { ...connection, id: randomUUID() } },
        { ...target, connection: { ...connection, encryptedCredentials: "different-preflight-credentials" } },
      ]) {
        await expect(publishing.retryPublicationAction(actionId, changed, { content: "Reviewed retry" })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "publication_target_mismatch" })] });
      }
      await campaigns.setInstanceStatus(instance.id, "paused");
      await expect(publishing.retryPublicationAction(actionId, target, { content: "Reviewed retry" })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "execution_not_active" })] });
      await campaigns.setInstanceStatus(instance.id, "active");
      await sql!`UPDATE campaign_approval SET status = 'pending' WHERE id = ${approvalId}`;
      await expect(publishing.retryPublicationAction(actionId, { ...target, humanApprovalGranted: true }, { content: "Reviewed retry" })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "step_approval_required" })] });
      await sql!`UPDATE campaign_approval SET status = 'approved' WHERE id = ${approvalId}`;
      await sql!`UPDATE channel_connection SET status = 'revoked' WHERE id = ${connection.id}`;
      await expect(publishing.retryPublicationAction(actionId, target, { content: "Reviewed retry" })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "publication_target_mismatch" })] });
      await sql!`UPDATE channel_connection SET status = 'active', configuration = configuration || '{"webhookId":"different-account"}'::jsonb WHERE id = ${connection.id}`;
      const changedAccount = (await publishing.getCampaignExecutionTarget(instance.id, "publish"))!;
      await expect(publishing.retryPublicationAction(actionId, changedAccount, { content: "Reviewed retry" })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "publication_target_mismatch" })] });
      await sql!`UPDATE channel_connection SET configuration = ${sql!.json(connection.configuration as Record<string, never>)} WHERE id = ${connection.id}`;
      await sql!`UPDATE campaign_version SET autonomy_mode = 'draft_only' WHERE id = ${instance.campaignVersionId}`;
      await expect(publishing.retryPublicationAction(actionId, target, { content: "Reviewed retry" })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "autonomy_execution_disabled" })] });
      await sql!`UPDATE campaign_version SET autonomy_mode = 'approval_required' WHERE id = ${instance.campaignVersionId}`;
      // The original instance/version must still expose the exact bound step.
      await sql!`UPDATE campaign_step SET step_key = 'different-version-step' WHERE campaign_version_id = ${instance.campaignVersionId} AND step_key = 'publish'`;
      await expect(publishing.retryPublicationAction(actionId, target, { content: "Reviewed retry" })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "execution_target_missing" })] });
      expect((await publishing.getPublicationActionByIdempotencyKey(fixture.idempotencyKey))?.status).toBe("failed");
    } finally { await fixture.cleanup(); }
  });

  it.each(["missing", "partial"])("does not retry a failed action with a %s provider identity", async (identityState) => {
    const fixture = await failedPublicationFixture();
    try {
      if (identityState === "missing") {
        await sql!`UPDATE publication_action SET request_snapshot = request_snapshot - 'providerPreflight' WHERE id = ${fixture.actionId}`;
      } else {
        await sql!`UPDATE publication_action SET request_snapshot = jsonb_set(request_snapshot, '{providerPreflight,targetIdentity}', '{"webhookId":"retry-webhook"}'::jsonb) WHERE id = ${fixture.actionId}`;
      }
      await expect(fixture.publishing.retryPublicationAction(fixture.actionId, fixture.target, { content: "Reviewed retry" })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "publication_target_mismatch" })] });
      expect((await fixture.publishing.getPublicationActionByIdempotencyKey(fixture.idempotencyKey))?.status).toBe("failed");
    } finally { await fixture.cleanup(); }
  });

  it("rejects a retry whose rendered content or subject differs from the durable original", async () => {
    const fixture = await failedPublicationFixture();
    try {
      for (const request of [{ content: "Changed destination or copy" }, { content: "Reviewed retry", subject: "Changed subject" }]) {
        await expect(fixture.publishing.retryPublicationAction(fixture.actionId, fixture.target, request))
          .rejects.toMatchObject({ issues: [expect.objectContaining({ code: "publication_target_mismatch" })] });
      }
      expect((await fixture.publishing.getPublicationActionByIdempotencyKey(fixture.idempotencyKey))?.status).toBe("failed");
    } finally { await fixture.cleanup(); }
  });

  it.each(["account", "approval", "capabilities"])("does not claim if %s changes between authorization reads and the retry update", async (change) => {
    const fixture = await failedPublicationFixture();
    const readTarget = fixture.publishing.getCampaignExecutionTarget.bind(fixture.publishing);
    fixture.publishing.getCampaignExecutionTarget = async (instanceId, stepKey) => {
      const target = await readTarget(instanceId, stepKey);
      if (change === "account") {
        await sql!`UPDATE channel_connection SET configuration = configuration || '{"channelId":"retargeted-channel"}'::jsonb WHERE id = ${fixture.connection.id}`;
      } else if (change === "approval") {
        await sql!`UPDATE campaign_approval SET status = 'pending' WHERE id = ${fixture.approvalId}`;
      } else {
        await sql!`UPDATE channel_connection SET capabilities = '{"changed":true}'::jsonb WHERE id = ${fixture.connection.id}`;
      }
      return target;
    };
    try {
      expect(await fixture.publishing.retryPublicationAction(fixture.actionId, fixture.target, { content: "Reviewed retry" })).toBe(false);
      expect(await fixture.publishing.getPublicationActionByIdempotencyKey(fixture.idempotencyKey))
        .toMatchObject({ status: "failed", lastError: "Provider rate limited the original attempt" });
    } finally { await fixture.cleanup(); }
  });

  it("persists only a capability-backed Slack target identity", async () => {
    sql ??= createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const publishing = new PublishingRepository(sql);
    const { user, workspace } = await core.bootstrapDevelopmentWorkspace({
      email: `slack-${randomUUID()}@market-me.local`,
      displayName: "Slack Publishing Integration Test",
    });
    try {
      const connection = await publishing.saveChannelConnection({
        workspaceId: workspace.workspaceId,
        provider: "slack_webhook",
        name: "Slack announcements",
        encryptedCredentials: "encrypted-test-envelope",
        configuration: { teamId: "T01234567", serviceId: "B01234567", host: "hooks.slack.com" },
        capabilities: SLACK_WEBHOOK_CAPABILITIES as unknown as Record<string, unknown>,
      }, user.id);
      expect(connection).toMatchObject({
        provider: "slack_webhook",
        status: "active",
        configuration: { teamId: "T01234567", serviceId: "B01234567", host: "hooks.slack.com" },
      });
      await expect(sql`
        INSERT INTO channel_connection (
          id, workspace_id, provider, name, encrypted_credentials, configuration,
          capabilities, capabilities_observed_at, created_by
        ) VALUES (
          ${randomUUID()}, ${workspace.workspaceId}, 'slack_webhook', 'Invalid Slack target',
          'encrypted-test-envelope', '{"teamId":"unsafe"}'::jsonb,
          ${sql.json(SLACK_WEBHOOK_CAPABILITIES as unknown as Record<string, never>)}, now(), ${user.id}
        )
      `).rejects.toMatchObject({ code: "23514" });
    } finally {
      await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
      await sql`DELETE FROM app_user WHERE id = ${user.id}`;
    }
  });

  it("persists only a capability-backed Mastodon account and live limit", async () => {
    sql ??= createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const publishing = new PublishingRepository(sql);
    const { user, workspace } = await core.bootstrapDevelopmentWorkspace({
      email: `mastodon-${randomUUID()}@market-me.local`,
      displayName: "Mastodon Publishing Integration Test",
    });
    const media = {
      attachmentsPerMessage: 4, attachmentBytes: 10 * 1024 * 1024, attachmentPixels: 100_000_000,
      attachmentDescriptionCharacters: 1_500, supportedImageMimeTypes: ["image/jpeg", "image/png", "image/webp"] as const,
    };
    const configuration = {
      host: "social.example.test", instanceOrigin: "https://social.example.test", accountId: "account-1",
      username: "marketme", acct: "marketme", profileUrl: "https://social.example.test/@marketme", maxCharacters: 500,
      charactersReservedPerUrl: 23,
      ...media,
    };
    try {
      const connection = await publishing.saveChannelConnection({
        workspaceId: workspace.workspaceId,
        provider: "mastodon_account",
        name: "Mastodon brand account",
        encryptedCredentials: "encrypted-test-envelope",
        configuration,
        capabilities: mastodonCapabilities(500, 23, media) as unknown as Record<string, unknown>,
      }, user.id);
      expect(connection).toMatchObject({ provider: "mastodon_account", status: "active", configuration });
      await expect(sql`
        INSERT INTO channel_connection (
          id, workspace_id, provider, name, encrypted_credentials, configuration,
          capabilities, capabilities_observed_at, created_by
        ) VALUES (
          ${randomUUID()}, ${workspace.workspaceId}, 'mastodon_account', 'Invalid Mastodon target',
          'encrypted-test-envelope', ${sql.json({ ...configuration, maxCharacters: 499 })},
          ${sql.json(mastodonCapabilities(500, 23, media) as unknown as Record<string, never>)}, now(), ${user.id}
        )
      `).rejects.toMatchObject({ code: "23514" });
      const incompleteConfiguration = { ...configuration } as Record<string, unknown>;
      delete incompleteConfiguration.supportedImageMimeTypes;
      await expect(sql`
        INSERT INTO channel_connection (
          id, workspace_id, provider, name, encrypted_credentials, configuration,
          capabilities, capabilities_observed_at, created_by
        ) VALUES (
          ${randomUUID()}, ${workspace.workspaceId}, 'mastodon_account', 'Missing Mastodon media capability',
          'encrypted-test-envelope', ${sql.json(incompleteConfiguration as Record<string, never>)},
          ${sql.json(mastodonCapabilities(500, 23, media) as unknown as Record<string, never>)}, now(), ${user.id}
        )
      `).rejects.toMatchObject({ code: "23514" });
    } finally {
      await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
      await sql`DELETE FROM app_user WHERE id = ${user.id}`;
    }
  });
});

async function failedPublicationFixture() {
  sql ??= createDatabaseClient(databaseUrl!);
  const core = new MarketMeRepository(sql);
  const campaigns = new CampaignRepository(sql);
  const publishing = new PublishingRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({
    email: `publication-retry-${randomUUID()}@market-me.local`, displayName: "Publication Retry Test",
  });
  const cleanup = async () => {
    await sql!`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
    await sql!`DELETE FROM app_user WHERE id = ${user.id}`;
  };
  try {
    const connection = await publishing.saveChannelConnection({
      workspaceId: workspace.workspaceId, provider: "discord_webhook", name: "Retry channel",
      encryptedCredentials: "test-envelope-not-used", capabilities: {},
      configuration: { webhookId: "retry-webhook", guildId: "retry-guild", channelId: "retry-channel" },
    }, user.id);
    const campaign = await campaigns.createCampaign({
      workspaceId: workspace.workspaceId, name: "Retry authority", description: "", objective: "awareness",
      contentPackageIds: [], audienceProfileVersionIds: [], informationDepth: "contextual", promotionalStrength: "light",
      autonomyMode: "approval_required", timezone: "UTC", context: {},
      steps: [{ id: "publish", name: "Publish", operationType: "publish_content", desiredCapability: "publish_content",
        dependsOn: [], inputs: { channelConnectionId: connection.id, content: "Reviewed retry" }, outputs: {},
        executionMethods: ["official_api"], approvalRequired: false }],
    }, user.id);
    await campaigns.publishCampaign(workspace.workspaceId, campaign.id);
    const instance = (await campaigns.activateCampaign({ workspaceId: workspace.workspaceId, campaignId: campaign.id, actorUserId: user.id }))!;
    await campaigns.setInstanceStatus(instance.id, "active");
    await campaigns.setStepRunState({ instanceId: instance.id, stepKey: "publish", status: "running" });
    const approvalId = await campaigns.ensureStepApproval({ instanceId: instance.id, stepKey: "publish", snapshot: { name: "Retry approval" } });
    await campaigns.decideApproval({ workspaceId: workspace.workspaceId, approvalId, decision: "approved", actorUserId: user.id, idempotencyKey: `approve:${approvalId}` });
    await campaigns.setStepRunState({ instanceId: instance.id, stepKey: "publish", status: "running" });
    const target = (await publishing.getCampaignExecutionTarget(instance.id, "publish"))!;
    const idempotencyKey = `retry:${instance.id}`;
    const started = await publishing.beginPublicationAction({ target, idempotencyKey, requestSnapshot: {
      content: "Reviewed retry", provider: "discord_webhook", providerPreflight: { checked: true, targetIdentity: connection.configuration },
    } });
    await publishing.finishPublicationAction(started.action.id, { status: "failed", error: "Provider rate limited the original attempt" });
    return { publishing, campaigns, connection, instance, target, actionId: started.action.id, idempotencyKey, approvalId, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
