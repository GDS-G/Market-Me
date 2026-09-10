import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { DISCORD_WEBHOOK_CAPABILITIES, encryptToken } from "@market-me/connectors";
import {
  CampaignRepository, createDatabaseClient, MarketMeRepository, PublishingRepository,
  type CampaignDraftWrite, type DatabaseClient,
} from "@market-me/database";
import { createCampaignActivities, type CampaignScheduledStepExecutionInput } from "@market-me/workflows";
import { CampaignExecutionRouter } from "./execution";

const databaseUrl = process.env.DATABASE_URL;
const appBaseUrl = "https://market-me-qa.example.invalid";
const webhookId = "123456789012345678";
const webhook = `https://discord.com/api/webhooks/${webhookId}/syntheticWebhookTokenForIntegrationTestsOnly123456`;
const identity = { webhookId, channelId: "234567890123456789", guildId: "345678901234567890" };
const predecessorContent = "Integration predecessor — café 🚀";
const windowContent = "Integration window — déjà vu 🚀";
let sql: DatabaseClient | undefined;

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(async () => { await sql?.end(); });

describe.skipIf(!databaseUrl)("scheduled publication through real database authority", () => {
  it("executes a real immediate predecessor and delayed window child, then recovers success after expiry and revocation without I/O", async () => {
    const fixture = await executionFixture(true);
    const provider = fakeDiscord();
    try {
      const target = (await fixture.publishing.getCampaignExecutionTarget(fixture.instanceId, "window"))!;
      // postgres.camel also normalizes nested JSON. Exercise that representation,
      // not the hand-built manifest used by the router's unit-test doubles.
      expect(target.connection?.capabilities.supportedActions).toMatchObject({ publishContent: true });
      expect(target.input).toMatchObject({ channelConnectionId: fixture.connection.id, content: windowContent, useTrackedLink: true });
      expect(target).toMatchObject({ campaignVersionId: fixture.versionId, dependencyDelaySeconds: 1 });
      const childInput = await fixture.input("window");
      await fixture.activities.setStepState({ instanceId: fixture.instanceId, stepKey: "window", status: "running" });
      await expect(fixture.activities.executeScheduledStep(childInput)).rejects.toMatchObject({
        name: "CampaignScheduleNotReadyError", schedule: { state: "waiting_dependencies", missingDependencies: ["prepare"] },
      });
      expect(provider.counts()).toEqual({ get: 0, post: 0 });

      await fixture.activities.setStepState({ instanceId: fixture.instanceId, stepKey: "prepare", status: "running" });
      const prepared = await fixture.activities.executeScheduledStep(await fixture.input("prepare"));
      expect(prepared).toMatchObject({ status: "succeeded", output: { externalId: "message-1" } });
      if (prepared.status !== "succeeded") throw new Error("Predecessor was not published");
      await fixture.activities.setStepState({ instanceId: fixture.instanceId, stepKey: "prepare", status: "succeeded", output: prepared.output });
      expect(provider.counts()).toEqual({ get: 1, post: 1 });
      expect(provider.posts[0]?.content).toBe(predecessorContent);

      const waiting = (await fixture.campaigns.getStepScheduleState(fixture.instanceId, "window"))!;
      expect(waiting.predecessors).toEqual([expect.objectContaining({ stepKey: "prepare", status: "succeeded", completedAt: expect.any(String) })]);
      expect(Date.parse(waiting.notBefore!)).toBe(Date.parse(waiting.predecessors[0]!.completedAt!) + 1_000);
      // Use real PostgreSQL time. No worker wall-clock mock may manufacture eligibility.
      await expect.poll(() => fixture.campaigns.getStepScheduleState(fixture.instanceId, "window"), { interval: 25, timeout: 5_000 })
        .toMatchObject({ state: "ready" });
      const published = await fixture.activities.executeScheduledStep(childInput);
      expect(published).toMatchObject({ status: "succeeded", output: { externalId: "message-2", trackedLinkId: expect.any(String) } });
      if (published.status !== "succeeded") throw new Error("Window publication did not succeed");
      await fixture.activities.setStepState({ instanceId: fixture.instanceId, stepKey: "window", status: "succeeded", output: published.output });
      expect(provider.counts()).toEqual({ get: 2, post: 2 });
      expect(provider.posts[1]?.content).toMatch(new RegExp(`^${windowContent}\\n\\nhttps://market-me-qa\\.example\\.invalid/r/[A-Za-z0-9_-]+$`));

      const original = (await fixture.publishing.getPublicationActionByIdempotencyKey(fixture.key("window")))!;
      expect(original).toMatchObject({ status: "succeeded", campaignInstanceId: fixture.instanceId, campaignStepRunId: childInput.campaignStepRunId,
        requestSnapshot: { content: provider.posts[1]!.content, providerPreflight: { checked: true, targetIdentity: identity },
          dispatchSchedule: { state: "ready", campaignVersionId: fixture.versionId, campaignStepRunId: childInput.campaignStepRunId } },
        responseMetadata: { trackedLinkId: published.output.trackedLinkId } });
      const originalLinks = await fixture.links();
      expect(originalLinks).toHaveLength(1);

      // Only this disposable fixture's pinned row is moved to simulate a retry
      // long after expiry. Production UI cannot edit a running version.
      await fixture.expireWindow();
      await sql!`UPDATE channel_connection SET status = 'revoked', encrypted_credentials = 'unusable-on-purpose' WHERE id = ${fixture.connection.id} AND workspace_id = ${fixture.workspaceId}`;
      await fixture.campaigns.setInstanceStatus(fixture.instanceId, "paused");
      const recovery = createCampaignActivities(fixture.campaigns, new CampaignExecutionRouter(fixture.publishing, undefined, undefined));
      expect(await recovery.executeScheduledStep(childInput)).toEqual(published);
      expect(provider.counts()).toEqual({ get: 2, post: 2 });
      expect(await fixture.links()).toEqual(originalLinks);
      expect(await fixture.publishing.getPublicationActionByIdempotencyKey(fixture.key("window"))).toEqual(original);
      expect(await fixture.publishing.getChannelConnection(fixture.workspaceId, fixture.connection.id)).toMatchObject({ status: "revoked", encryptedCredentials: "unusable-on-purpose" });
    } finally { await fixture.cleanup(); }
  }, 15_000);

  it("does not POST or create a dispatch claim when the stored window closes during the actual preflight GET", async () => {
    const fixture = await executionFixture(false);
    const provider = fakeDiscord(() => fixture.expireWindow());
    try {
      const input = await fixture.input("window");
      await fixture.activities.setStepState({ instanceId: fixture.instanceId, stepKey: "window", status: "running" });
      expect(await fixture.activities.executeScheduledStep(input)).toMatchObject({ status: "schedule_blocked", schedule: {
        state: "expired", reason: "deadline_reached", workspaceId: fixture.workspaceId,
        campaignVersionId: fixture.versionId, campaignStepRunId: input.campaignStepRunId,
      } });
      expect(provider.counts()).toEqual({ get: 1, post: 0 });
      expect(await fixture.publishing.getPublicationActionByIdempotencyKey(fixture.key("window"))).toBeUndefined();
    } finally { await fixture.cleanup(); }
  });

  it("does not resurrect a connection revoked while its preflight GET was in progress", async () => {
    const fixture = await executionFixture(false);
    const provider = fakeDiscord(async () => {
      await sql!`UPDATE channel_connection SET status = 'revoked' WHERE id = ${fixture.connection.id} AND workspace_id = ${fixture.workspaceId}`;
    });
    try {
      await fixture.activities.setStepState({ instanceId: fixture.instanceId, stepKey: "window", status: "running" });
      expect(await fixture.activities.executeScheduledStep(await fixture.input("window"))).toMatchObject({ status: "manual_required", reason: expect.stringContaining("revoked or changed during preflight") });
      expect(provider.counts()).toEqual({ get: 1, post: 0 });
      expect(await fixture.publishing.getChannelConnection(fixture.workspaceId, fixture.connection.id)).toMatchObject({ status: "revoked" });
      expect(await fixture.publishing.getPublicationActionByIdempotencyKey(fixture.key("window"))).toBeUndefined();
    } finally { await fixture.cleanup(); }
  });
});

/** All transport is synthetic. Unexpected URL/method is rejected, never forwarded. */
function fakeDiscord(onGet?: () => Promise<void>) {
  let get = 0;
  const posts: { content: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(url.origin + url.pathname).toBe(webhook);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (init?.method === "GET") {
      get++;
      await onGet?.();
      return Response.json({ id: identity.webhookId, channel_id: identity.channelId, guild_id: identity.guildId });
    }
    if (init?.method !== "POST") throw new Error("Unexpected fake-provider method");
    expect(url.searchParams.get("wait")).toBe("true");
    expect(typeof init.body).toBe("string");
    const payload = JSON.parse(init.body as string) as { content: string; allowed_mentions: { parse: unknown[] } };
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    posts.push({ content: payload.content });
    return Response.json({ id: `message-${posts.length}`, channel_id: identity.channelId, guild_id: identity.guildId });
  }));
  return { posts, counts: () => ({ get, post: posts.length }) };
}

async function executionFixture(withPredecessor: boolean) {
  if (!databaseUrl || !/^\/market_me_(?:qa_[a-z0-9_]+|ci)$/.test(new URL(databaseUrl).pathname)) {
    throw new Error("Scheduled execution integration tests require an isolated market_me_qa_* or market_me_ci database");
  }
  sql ??= createDatabaseClient(databaseUrl);
  const campaigns = new CampaignRepository(sql);
  const publishing = new PublishingRepository(sql, { appBaseUrl });
  const { user, workspace } = await new MarketMeRepository(sql).bootstrapDevelopmentWorkspace({
    email: `execution-schedule-${randomUUID()}@market-me.local`, displayName: "Synthetic execution integration test",
  });
  const cleanup = async () => {
    // Only IDs returned by this fixture's bootstrap are removed; no shared data.
    await sql!`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
    await sql!`DELETE FROM app_user WHERE id = ${user.id}`;
  };
  try {
    const encryptionKey = randomBytes(32).toString("base64");
    const connection = await publishing.saveChannelConnection({ workspaceId: workspace.workspaceId, provider: "discord_webhook", name: "Synthetic Discord",
      encryptedCredentials: encryptToken(webhook, encryptionKey), configuration: identity,
      capabilities: DISCORD_WEBHOOK_CAPABILITIES as unknown as Record<string, unknown> }, user.id);
    const destination = await campaigns.saveDestination({ workspaceId: workspace.workspaceId, provider: "manual", canonicalUrl: "https://destination.example.invalid/qa",
      knownRedirects: [], title: "Synthetic destination", description: "", contentType: "web_page", identifiers: {}, topics: [], audiences: [], geography: [], status: "published", tracking: {} }, user.id);
    const [{ now }] = await sql<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const base = { operationType: "publish_content" as const, desiredCapability: "publish_content", executionMethods: ["official_api" as const], approvalRequired: false, outputs: {} };
    const steps: CampaignDraftWrite["steps"] = [
      ...(withPredecessor ? [{ ...base, id: "prepare", name: "Immediate predecessor", scheduleType: "immediate" as const, dependsOn: [], inputs: { channelConnectionId: connection.id, content: predecessorContent } }] : []),
      { ...base, id: "window", name: "Window child", scheduleType: "preferred_window", dependsOn: withPredecessor ? ["prepare"] : [], dependencyDelaySeconds: withPredecessor ? 1 : 0,
        preferredWindowStart: new Date(new Date(now).getTime() - 60_000).toISOString(), preferredWindowEnd: new Date(new Date(now).getTime() + 120_000).toISOString(),
        inputs: { channelConnectionId: connection.id, content: windowContent, useTrackedLink: true, appendDestination: true } },
    ];
    const campaign = await campaigns.createCampaign({ workspaceId: workspace.workspaceId, name: "Synthetic bounded execution", description: "", objective: "awareness", destinationId: destination.id,
      contentPackageIds: [], audienceProfileVersionIds: [], informationDepth: "contextual", promotionalStrength: "light", autonomyMode: "fully_autonomous", timezone: "America/Chicago", context: {}, steps }, user.id);
    const published = (await campaigns.publishCampaign(workspace.workspaceId, campaign.id))!;
    const versionId = published.currentVersion!.id;
    const instanceId = randomUUID();
    // Persist the immutable test run directly so this integration test does not
    // bypass/flip the production activation rollout or launch a Temporal worker.
    await sql`INSERT INTO campaign_instance (id, workspace_id, campaign_id, campaign_version_id, status, requested_by)
      VALUES (${instanceId}, ${workspace.workspaceId}, ${campaign.id}, ${versionId}, 'active', ${user.id})`;
    const persisted = await sql<{ id: string; stepKey: string }[]>`SELECT id, step_key FROM campaign_step WHERE campaign_version_id = ${versionId}`;
    for (const step of persisted) await sql`INSERT INTO campaign_step_run (id, campaign_instance_id, campaign_step_id, idempotency_key)
      VALUES (${randomUUID()}, ${instanceId}, ${step.id}, ${`campaign:${instanceId}:step:${step.stepKey}`})`;
    const activities = createCampaignActivities(campaigns, new CampaignExecutionRouter(publishing, encryptionKey, appBaseUrl));
    return {
      campaigns, publishing, activities, connection, instanceId, versionId, workspaceId: workspace.workspaceId, cleanup,
      key: (stepKey: string) => `campaign:${instanceId}:step:${stepKey}:publish`,
      input: async (stepKey: string): Promise<CampaignScheduledStepExecutionInput> => {
        const schedule = (await campaigns.getStepScheduleState(instanceId, stepKey))!;
        return { workspaceId: schedule.workspaceId, campaignId: schedule.campaignId, instanceId: schedule.campaignInstanceId,
          campaignVersionId: schedule.campaignVersionId, campaignStepRunId: schedule.campaignStepRunId, stepKey: schedule.stepKey,
          // Malicious caller timing is inert: stored schedule evidence is authority.
          context: { dispatchDeadlineAt: 1, dispatchMonotonicDeadlineAt: Number.MAX_SAFE_INTEGER } };
      },
      links: () => sql!<{ id: string; slug: string }[]>`SELECT id, slug FROM tracked_link WHERE workspace_id = ${workspace.workspaceId} AND campaign_instance_id = ${instanceId} ORDER BY id`,
      expireWindow: async () => { await sql!`UPDATE campaign_step SET preferred_window_end = clock_timestamp() - interval '1 second' WHERE campaign_version_id = ${versionId} AND step_key = 'window'`; },
    };
  } catch (error) { await cleanup(); throw error; }
}
