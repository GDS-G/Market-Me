import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DISCORD_WEBHOOK_CAPABILITIES, mastodonCapabilities, SLACK_WEBHOOK_CAPABILITIES } from "@market-me/connectors";
import type { JSONValue, TransactionSql } from "postgres";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { PublishingRepository } from "./publishing-repository";
import { MarketMeRepository } from "./repositories";
import { CampaignRepository } from "./campaign-repository";
import { DraftRepository } from "./draft-repository";

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

  it.each(["account", "approval", "capabilities", "credentials", "content"])("rechecks %s committed while retry admission waits on an instance lock", async (change) => {
    const fixture = await failedPublicationFixture();
    try {
      const result = await behindAdmissionLock(
        (transaction) => transaction`SELECT id FROM campaign_instance WHERE id = ${fixture.instance.id} FOR NO KEY UPDATE`,
        (publishing) => publishing.retryPublicationAction(fixture.actionId, fixture.target, { content: "Reviewed retry" }),
        async (transaction) => {
          if (change === "account") await transaction`UPDATE channel_connection SET configuration = configuration || '{"channelId":"retargeted-channel"}'::jsonb WHERE id = ${fixture.connection.id}`;
          else if (change === "approval") await transaction`UPDATE campaign_approval SET status = 'pending' WHERE id = ${fixture.approvalId}`;
          else if (change === "capabilities") await transaction`UPDATE channel_connection SET capabilities = '{"changed":true}'::jsonb WHERE id = ${fixture.connection.id}`;
          else if (change === "credentials") await transaction`UPDATE channel_connection SET encrypted_credentials = 'new-test-envelope' WHERE id = ${fixture.connection.id}`;
          else await transaction`UPDATE campaign_step SET inputs = inputs || '{"content":"Changed after preflight"}'::jsonb WHERE campaign_version_id = ${fixture.instance.campaignVersionId} AND step_key = 'publish'`;
        },
      );
      expect(result.error).toMatchObject({ issues: [expect.objectContaining({ code: change === "approval" ? "step_approval_required" : "publication_target_mismatch" })] });
      expect(await fixture.publishing.getPublicationActionByIdempotencyKey(fixture.idempotencyKey))
        .toMatchObject({ status: "failed", lastError: "Provider rate limited the original attempt" });
    } finally { await fixture.cleanup(); }
  });

  it.each(["begin", "retry"])("refuses %s after the window closes during a connection lock wait", async (mode) => {
    const fixture = await failedPublicationFixture();
    try {
      await sql!`UPDATE campaign_step SET schedule_type = 'preferred_window', preferred_window_start = clock_timestamp() - interval '1 minute', preferred_window_end = clock_timestamp() + interval '1 second' WHERE campaign_version_id = ${fixture.instance.campaignVersionId} AND step_key = 'publish'`;
      const target = (await fixture.publishing.getCampaignExecutionTarget(fixture.instance.id, "publish"))!;
      const key = `cutoff:${fixture.instance.id}`;
      const result = await behindAdmissionLock(
        (transaction) => transaction`SELECT id FROM channel_connection WHERE id = ${fixture.connection.id} FOR UPDATE`,
        (publishing) => mode === "retry" ? publishing.retryPublicationAction(fixture.actionId, target, { content: "Reviewed retry" })
          : publishing.beginPublicationAction({ target, idempotencyKey: key, requestSnapshot: fixture.snapshot }),
        async (transaction) => { await transaction`SELECT pg_sleep(1.1)`; },
      );
      expect(result.error).toMatchObject({ name: "CampaignScheduleNotReadyError", schedule: { state: "expired", reason: "deadline_reached" } });
      expect(await fixture.publishing.getPublicationActionByIdempotencyKey(key)).toBeUndefined();
      expect(await fixture.publishing.getPublicationActionByIdempotencyKey(fixture.idempotencyKey)).toMatchObject({ status: "failed", lastError: "Provider rate limited the original attempt" });
    } finally { await fixture.cleanup(); }
  });

  it("persists fresh bounded schedule evidence and recovers outcomes only for the exact pinned lineage", async () => {
    const fixture = await failedPublicationFixture();
    try {
      await sql!`UPDATE campaign_step SET schedule_type = 'preferred_window', preferred_window_start = clock_timestamp() - interval '1 minute', preferred_window_end = clock_timestamp() + interval '1 minute' WHERE campaign_version_id = ${fixture.instance.campaignVersionId} AND step_key = 'publish'`;
      const target = (await fixture.publishing.getCampaignExecutionTarget(fixture.instance.id, "publish"))!;
      const started = await fixture.publishing.beginPublicationAction({ target, idempotencyKey: `bounded:${fixture.instance.id}`, requestSnapshot: fixture.snapshot });
      expect(started.action.requestSnapshot.dispatchSchedule).toMatchObject({ state: "ready", campaignVersionId: fixture.instance.campaignVersionId, campaignStepRunId: fixture.target.campaignStepRunId });
      await fixture.publishing.finishPublicationAction(fixture.actionId, { status: "succeeded", providerExternalId: "accepted-before-cutoff" });
      await sql!`UPDATE channel_connection SET status = 'revoked' WHERE id = ${fixture.connection.id}`;
      await sql!`UPDATE campaign_step SET preferred_window_end = clock_timestamp() - interval '1 second' WHERE campaign_version_id = ${fixture.instance.campaignVersionId} AND step_key = 'publish'`;
      const input = { workspaceId: fixture.target.workspaceId, campaignId: fixture.target.campaignId, instanceId: fixture.instance.id,
        campaignVersionId: fixture.instance.campaignVersionId, campaignStepRunId: fixture.target.campaignStepRunId, stepKey: "publish" };
      expect(await fixture.publishing.getCampaignPublicationForRecovery(input)).toMatchObject({ status: "succeeded", providerExternalId: "accepted-before-cutoff" });
      for (const key of ["workspaceId", "campaignId", "instanceId", "campaignVersionId", "campaignStepRunId", "stepKey"] as const) {
        expect(await fixture.publishing.getCampaignPublicationForRecovery({ ...input, [key]: randomUUID() })).toBeUndefined();
      }
    } finally { await fixture.cleanup(); }
  });

  it.each(["begin", "retry"])("rechecks exact approved preview after a competing edit blocks %s", async (mode) => {
    const fixture = await failedPublicationFixture();
    try {
      const approved = await attachApprovedPreview(fixture);
      const key = `preview-changed:${fixture.instance.id}`;
      const result = await behindAdmissionLock(
        (transaction) => transaction`SELECT id FROM content_draft WHERE id = ${approved.draftId} FOR UPDATE`,
        (publishing) => mode === "retry" ? publishing.retryPublicationAction(approved.actionId, approved.target, { content: approved.snapshot.content })
          : publishing.beginPublicationAction({ target: approved.target, idempotencyKey: key, requestSnapshot: approved.snapshot }),
        async (transaction) => { await transaction`UPDATE draft_channel_preview SET rendered_content = 'Changed after review' WHERE id = ${approved.previewId}`; },
      );
      expect(result.error).toMatchObject({ issues: [expect.objectContaining({ code: "publication_target_mismatch" })] });
      expect(await fixture.publishing.getPublicationActionByIdempotencyKey(key)).toBeUndefined();
      expect(await fixture.publishing.getPublicationActionByIdempotencyKey(approved.idempotencyKey)).toMatchObject({ status: "failed" });
    } finally { await fixture.cleanup(); }
  });

  it.each(["approval", "version", "capability_snapshot", "preview_account"])("does not begin from a stale %s preview even when caller asserts eligibility", async (change) => {
    const fixture = await failedPublicationFixture();
    try {
      const approved = await attachApprovedPreview(fixture);
      if (change === "approval") await sql!`UPDATE content_draft_approval SET status = 'rejected' WHERE id = ${approved.draftApprovalId}`;
      else if (change === "version") await sql!`UPDATE content_draft SET status = 'archived' WHERE id = ${approved.draftId}`;
      else if (change === "capability_snapshot") await sql!`UPDATE channel_connection SET capabilities_observed_at = clock_timestamp() WHERE id = ${fixture.connection.id}`;
      else {
        const other = await fixture.publishing.saveChannelConnection({ workspaceId: fixture.target.workspaceId, provider: "discord_webhook", name: "Wrong preview account", encryptedCredentials: "other-test-envelope", capabilities: {}, configuration: { webhookId: "other-webhook", channelId: "other-channel" } }, fixture.user.id);
        await sql!`UPDATE campaign_step SET inputs = inputs || ${sql!.json({ channelConnectionId: other.id })} WHERE campaign_version_id = ${fixture.instance.campaignVersionId} AND step_key = 'publish'`;
      }
      const target = (await fixture.publishing.getCampaignExecutionTarget(fixture.instance.id, "publish"))!;
      await expect(fixture.publishing.beginPublicationAction({ target: { ...target, draftPreviewEligible: true }, idempotencyKey: `stale-preview:${fixture.instance.id}`, requestSnapshot: { ...approved.snapshot, providerPreflight: { checked: true, targetIdentity: target.connection!.configuration } } }))
        .rejects.toMatchObject({ issues: [expect.objectContaining({ code: "publication_target_mismatch" })] });
    } finally { await fixture.cleanup(); }
  });

  it.each([true, false])("never restores a revoked account from a delayed health result (ok=%s)", async (ok) => {
    const fixture = await failedPublicationFixture();
    try {
      await sql!`UPDATE channel_connection SET status = 'revoked' WHERE id = ${fixture.connection.id}`;
      expect(await fixture.publishing.recordConnectionTest(fixture.target.workspaceId, fixture.connection.id, { ok, configuration: { channelId: "stale-channel" }, error: "stale-test" }, fixture.connection)).toBe(false);
      expect(await fixture.publishing.getChannelConnection(fixture.target.workspaceId, fixture.connection.id)).toMatchObject({ status: "revoked", configuration: fixture.connection.configuration });
    } finally { await fixture.cleanup(); }
  });

  it.each(["credentials", "configuration"])("does not overwrite changed %s from a stale preflight test", async (change) => {
    const fixture = await failedPublicationFixture();
    try {
      if (change === "credentials") await sql!`UPDATE channel_connection SET encrypted_credentials = 'rotated-test-envelope' WHERE id = ${fixture.connection.id}`;
      else await sql!`UPDATE channel_connection SET configuration = configuration || '{"channelId":"new-approved-channel"}'::jsonb WHERE id = ${fixture.connection.id}`;
      expect(await fixture.publishing.recordConnectionTest(fixture.target.workspaceId, fixture.connection.id, { ok: true, configuration: fixture.connection.configuration }, fixture.connection)).toBe(false);
      const current = (await fixture.publishing.getChannelConnection(fixture.target.workspaceId, fixture.connection.id))!;
      expect(await fixture.publishing.recordConnectionTest(fixture.target.workspaceId, fixture.connection.id, { ok: true }, current)).toBe(true);
      expect(await fixture.publishing.getChannelConnection(fixture.target.workspaceId, fixture.connection.id)).toMatchObject({ configuration: current.configuration, encryptedCredentials: current.encryptedCredentials });
    } finally { await fixture.cleanup(); }
  });

  it("allows one concurrent initial claim and rejects content rendered from a stale destination", async () => {
    const fixture = await failedPublicationFixture();
    try {
      const destinationId = await attachDestination(fixture, { content: "Read {{destinationUrl}}" });
      const stale = (await fixture.publishing.getCampaignExecutionTarget(fixture.instance.id, "publish"))!;
      const oldSnapshot = { ...fixture.snapshot, content: "Read https://example.test/original", renderedDestinationUrl: "https://example.test/original" };
      await sql!`UPDATE destination SET canonical_url = 'https://example.test/current' WHERE id = ${destinationId}`;
      const key = `destination:${fixture.instance.id}`;
      await expect(fixture.publishing.beginPublicationAction({ target: stale, idempotencyKey: key, requestSnapshot: oldSnapshot })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "publication_target_mismatch" })] });
      const target = (await fixture.publishing.getCampaignExecutionTarget(fixture.instance.id, "publish"))!;
      await expect(fixture.publishing.beginPublicationAction({ target, idempotencyKey: key, requestSnapshot: oldSnapshot })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "publication_target_mismatch" })] });
      const input = { target, idempotencyKey: key, requestSnapshot: { ...fixture.snapshot, content: "Read https://example.test/current", renderedDestinationUrl: "https://example.test/current" } };
      const results = await Promise.all([fixture.publishing.beginPublicationAction(input), fixture.publishing.beginPublicationAction(input)]);
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(results[0].action.id).toBe(results[1].action.id);
    } finally { await fixture.cleanup(); }
  });

  it("recomputes raw tracked URLs only from trusted server configuration and exact active link lineage", async () => {
    const fixture = await failedPublicationFixture();
    try {
      const destinationId = await attachDestination(fixture, { content: "Read more", useTrackedLink: true, appendDestination: true });
      const link = await fixture.publishing.createTrackedLink({ workspaceId: fixture.target.workspaceId, destinationId, campaignInstanceId: fixture.instance.id, campaignStepRunId: fixture.target.campaignStepRunId, createdBy: fixture.user.id });
      const target = (await fixture.publishing.getCampaignExecutionTarget(fixture.instance.id, "publish"))!;
      const publishing = new PublishingRepository(sql!, { appBaseUrl: "https://market-me.example.test/" });
      const renderedDestinationUrl = `https://market-me.example.test/r/${link.slug}`;
      const snapshot = { ...fixture.snapshot, content: `Read more\n\n${renderedDestinationUrl}`, trackedLinkId: link.id, renderedDestinationUrl };
      const input = { target, idempotencyKey: `tracked:${fixture.instance.id}`, requestSnapshot: snapshot };
      await expect(fixture.publishing.beginPublicationAction(input)).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "publication_target_mismatch" })] });
      await expect(publishing.beginPublicationAction({ ...input, requestSnapshot: { ...snapshot, renderedDestinationUrl: "https://untrusted.example.test/r/forged" } })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "publication_target_mismatch" })] });
      const started = await publishing.beginPublicationAction(input);
      await publishing.finishPublicationAction(started.action.id, { status: "failed", error: "Tracked retry fixture" });
      expect(await publishing.retryPublicationAction(started.action.id, target, { content: snapshot.content })).toBe(true);
      await publishing.finishPublicationAction(started.action.id, { status: "failed", error: "Tracked retry fixture" });
      await sql!`UPDATE tracked_link SET status = 'disabled' WHERE id = ${link.id}`;
      await expect(publishing.retryPublicationAction(started.action.id, target, { content: snapshot.content })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "publication_target_mismatch" })] });
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
      encryptedCredentials: "test-envelope-not-used", capabilities: DISCORD_WEBHOOK_CAPABILITIES as unknown as Record<string, unknown>,
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
    const idempotencyKey = `campaign:${instance.id}:step:publish:publish`;
    const snapshot = {
      content: "Reviewed retry", provider: "discord_webhook", providerPreflight: { checked: true, targetIdentity: connection.configuration },
    };
    const started = await publishing.beginPublicationAction({ target, idempotencyKey, requestSnapshot: snapshot });
    await publishing.finishPublicationAction(started.action.id, { status: "failed", error: "Provider rate limited the original attempt" });
    return { publishing, campaigns, core, workspace, user, campaign, connection, instance, target, snapshot, actionId: started.action.id, idempotencyKey, approvalId, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

/** Observe an actual PostgreSQL lock wait before committing the competing edit. */
async function behindAdmissionLock(
  acquire: (transaction: TransactionSql) => PromiseLike<unknown>,
  operation: (publishing: PublishingRepository) => Promise<unknown>,
  mutate: (transaction: TransactionSql) => Promise<unknown>,
): Promise<{ value?: unknown; error?: unknown }> {
  const contender = createDatabaseClient(databaseUrl!, { max: 1 });
  let pending: Promise<{ value?: unknown; error?: unknown }> | undefined;
  try {
    const [{ pid }] = await contender<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await sql!.begin(async (transaction) => {
      await acquire(transaction);
      pending = operation(new PublishingRepository(contender)).then((value) => ({ value }), (error: unknown) => ({ error }));
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const [state] = await sql!<{ blocked: boolean }[]>`SELECT wait_event_type = 'Lock' AS blocked FROM pg_stat_activity WHERE pid = ${pid}`;
        if (state?.blocked) { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await mutate(transaction);
    });
    return await pending!;
  } finally { await pending; await contender.end(); }
}

async function attachApprovedPreview(fixture: Awaited<ReturnType<typeof failedPublicationFixture>>) {
  const { core, workspace, user, instance, connection, publishing } = fixture;
  const source = await core.createSmartSource({ workspaceId: workspace.workspaceId, name: "Publication admission fixture", provider: "local",
    locations: [{ providerLocationId: "fixture", displayPath: "C:\\fixture" }], recursive: true, readinessMode: "immediate", stabilizationWindowSeconds: 0,
    allowedMimeTypes: ["text/plain"], ignorePatterns: [], contextPackIds: [], autonomyMode: "draft_only", enabled: true }, user.id);
  await core.applySourceItemChanges({ workspaceId: workspace.workspaceId, smartSourceId: source.id, deletedProviderItemIds: [],
    upserts: [{ workspaceId: workspace.workspaceId, smartSourceId: source.id, providerItemId: "fixture", name: "facts.txt", displayPath: "C:\\fixture\\facts.txt", mimeType: "text/plain", isFolder: false, contentHash: "sha256:admission-fixture" }] });
  const item = (await core.getSourceItemByProviderId(source.id, "fixture"))!;
  const content = await core.saveContentPackage({ workspaceId: workspace.workspaceId, smartSourceId: source.id, rootSourceItemId: item.id,
    title: "Admission fixture", status: "approved", contextPackVersionIds: [], assets: [], evidence: [], conflicts: [] });
  const generationId = randomUUID(), draftId = randomUUID(), versionId = randomUUID(), draftApprovalId = randomUUID();
  await sql!.begin(async (transaction) => {
    await transaction`INSERT INTO draft_generation (id, workspace_id, campaign_version_id, content_package_id, content_package_version, information_depth, promotional_strength, evidence_snapshot, generator_provider, generator_model, generator_version, prompt_version, created_by)
      VALUES (${generationId}, ${workspace.workspaceId}, ${instance.campaignVersionId}, ${content.id}, 1, 'contextual', 'light', '{}', 'fixture', 'fixture', '1', '1', ${user.id})`;
    await transaction`INSERT INTO content_draft (id, workspace_id, draft_generation_id, status, created_by) VALUES (${draftId}, ${workspace.workspaceId}, ${generationId}, 'approved', ${user.id})`;
    await transaction`INSERT INTO content_draft_version (id, content_draft_id, version_number, status, headline, body, rationale, created_by) VALUES (${versionId}, ${draftId}, 1, 'approved', 'Approved headline', 'Reviewed preview content', 'Fixture', ${user.id})`;
    await transaction`UPDATE content_draft SET current_version_id = ${versionId} WHERE id = ${draftId}`;
    await transaction`INSERT INTO content_draft_approval (id, workspace_id, content_draft_id, content_draft_version_id, status, request_snapshot, requested_by) VALUES (${draftApprovalId}, ${workspace.workspaceId}, ${draftId}, ${versionId}, 'approved', '{}', ${user.id})`;
  });
  const preview = (await new DraftRepository(sql!).createChannelPreview({ workspaceId: workspace.workspaceId, draftId, channelConnectionId: connection.id, actorUserId: user.id }))!;
  await sql!`UPDATE campaign_step SET inputs = ${sql!.json({ channelConnectionId: connection.id, draftChannelPreviewId: preview.id })} WHERE campaign_version_id = ${instance.campaignVersionId} AND step_key = 'publish'`;
  const target = (await publishing.getCampaignExecutionTarget(instance.id, "publish"))!;
  const snapshot = { ...fixture.snapshot, content: preview.renderedContent, draftChannelPreviewId: preview.id, draftVersionId: versionId };
  const idempotencyKey = `preview:${instance.id}`;
  const started = await publishing.beginPublicationAction({ target, idempotencyKey, requestSnapshot: snapshot });
  await publishing.finishPublicationAction(started.action.id, { status: "failed", error: "Retry fixture" });
  return { draftId, draftApprovalId, previewId: preview.id, target, snapshot, actionId: started.action.id, idempotencyKey };
}

async function attachDestination(fixture: Awaited<ReturnType<typeof failedPublicationFixture>>, input: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  await sql!`INSERT INTO destination (id, workspace_id, provider, canonical_url, title, status, created_by)
    VALUES (${id}, ${fixture.target.workspaceId}, 'web', 'https://example.test/original', 'Publication destination fixture', 'published', ${fixture.user.id})`;
  await sql!`UPDATE campaign_version SET destination_id = ${id} WHERE id = ${fixture.instance.campaignVersionId}`;
  await sql!`UPDATE campaign_step SET inputs = ${sql!.json({ ...input, channelConnectionId: fixture.connection.id } as JSONValue)} WHERE campaign_version_id = ${fixture.instance.campaignVersionId} AND step_key = 'publish'`;
  return id;
}
