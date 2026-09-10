import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { mastodonCapabilities } from "@market-me/connectors";
import type { CampaignStep } from "@market-me/domain";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { CampaignRepository } from "./campaign-repository";
import { PublishingRepository, type ChannelProvider } from "./publishing-repository";
import { MarketMeRepository } from "./repositories";
import type { CampaignDraftWrite } from "./models";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;
const verifiedCapabilities = {
  supportedActions: { publish_content: true }, executionMethods: ["official_api"], features: { text: true, attachments: false },
};
const step = (id: string, overrides: Partial<CampaignStep> = {}): CampaignStep => ({
  id, name: id, operationType: "publish_content", desiredCapability: "publish_content", dependsOn: [],
  inputs: {}, outputs: {}, executionMethods: ["official_api"], approvalRequired: false, ...overrides,
});

describe.skipIf(!databaseUrl)("bounded campaign activation acceptance", () => {
  afterAll(async () => sql?.end());

  it("activates a verified official-only Discord text window and pins its immutable version and UTC milliseconds", async () => {
    const f = await fixture();
    try {
      const connection = await f.connection();
      const raw = (await sql!<{ publishing: string }[]>`SELECT capabilities->'supportedActions'->>'publish_content' AS publishing FROM channel_connection WHERE id = ${connection.id}`)[0]!;
      expect(raw.publishing).toBe("true");
      expect((connection.capabilities.supportedActions as Record<string, unknown>).publishContent).toBe(true);
      const authored = f.window("publish", connection.id);
      const { campaign, draft } = await f.published([authored]);
      const versionId = (await f.campaigns.getCampaign(f.workspace.workspaceId, campaign.id))!.currentVersion!.id;
      const instance = await f.activate(campaign.id);
      expect(instance).toMatchObject({ campaignVersionId: versionId, status: "scheduled" });
      expect((await f.campaigns.getWorkflowDefinition(instance!.id))?.steps[0]).toMatchObject({
        scheduleType: "preferred_window", preferredWindowStart: authored.preferredWindowStart, preferredWindowEnd: authored.preferredWindowEnd,
        inputs: { channelConnectionId: connection.id, content: "Exact bounded publication" }, executionMethods: ["official_api"], dependencyDelaySeconds: 0,
      });
      await f.campaigns.saveCampaignDraft(campaign.id, { ...draft, steps: [{ ...authored, preferredWindowEnd: new Date(Date.parse(authored.preferredWindowEnd!) + 60_000).toISOString(), inputs: { ...authored.inputs, content: "A newer reviewed plan" } }] }, f.user.id);
      await f.campaigns.publishCampaign(f.workspace.workspaceId, campaign.id);
      expect((await f.campaigns.getWorkflowDefinition(instance!.id))?.steps[0]).toMatchObject({ preferredWindowEnd: authored.preferredWindowEnd, inputs: authored.inputs });
      expect((await f.campaigns.getWorkflowDefinition(instance!.id))?.campaignVersionId).toBe(versionId);
      const queued = await sql!<{ commandType: string; campaignInstanceId: string }[]>`SELECT command_type, campaign_instance_id FROM campaign_workflow_command WHERE workspace_id = ${f.workspace.workspaceId}`;
      expect(queued).toEqual([{ commandType: "start", campaignInstanceId: instance!.id }]);
    } finally { await f.cleanup(); }
  });

  it.each([
    { label: "Mailchimp multi-stage delivery", provider: "mailchimp_email", methods: ["official_api"], operation: "publish_content" },
    { label: "manual-only delivery", provider: "discord_webhook", methods: ["manual_handoff"], operation: "publish_content" },
    { label: "official plus fallback delivery", provider: "discord_webhook", methods: ["official_api", "manual_handoff"], operation: "publish_content" },
    { label: "non-publication operation", provider: "discord_webhook", methods: ["official_api"], operation: "manual_handoff" },
  ] as const)("preserves but refuses a window with $label", async ({ provider, methods, operation }) => {
    const f = await fixture();
    try {
      const connection = await f.connection(provider);
      const authored = { ...f.window("publish", connection.id), executionMethods: methods, operationType: operation };
      const { campaign } = await f.published([authored]);
      await f.expectRejected(campaign.id, "preferred_window_route_unsupported");
      expect((await f.campaigns.getCampaign(f.workspace.workspaceId, campaign.id))?.currentVersion?.steps[0]).toMatchObject({ scheduleType: "preferred_window", executionMethods: methods, operationType: operation });
    } finally { await f.cleanup(); }
  });

  it.each(["revoked", "error"] as const)("refuses a channel made %s after the plan was published", async (status) => {
    const f = await fixture();
    try {
      const connection = await f.connection();
      const { campaign } = await f.published([f.window("publish", connection.id)]);
      await sql!`UPDATE channel_connection SET status = ${status} WHERE id = ${connection.id} AND workspace_id = ${f.workspace.workspaceId}`;
      await f.expectRejected(campaign.id, "preferred_window_connection_unavailable");
    } finally { await f.cleanup(); }
  });

  it.each([
    { label: "missing publish permission", capabilities: { supportedActions: {}, executionMethods: ["official_api"] } },
    { label: "false publish permission", capabilities: { supportedActions: { publish_content: false }, executionMethods: ["official_api"] } },
    { label: "missing official API capability", capabilities: { supportedActions: { publish_content: true }, executionMethods: ["manual_handoff"] } },
  ])("refuses a channel with $label", async ({ capabilities }) => {
    const f = await fixture();
    try {
      const connection = await f.connection();
      const { campaign } = await f.published([f.window("publish", connection.id)]);
      await sql!`UPDATE channel_connection SET capabilities = ${sql!.json(capabilities)} WHERE id = ${connection.id} AND workspace_id = ${f.workspace.workspaceId}`;
      await f.expectRejected(campaign.id, "preferred_window_connection_unavailable");
    } finally { await f.cleanup(); }
  });

  it.each(["slack_webhook", "mastodon_account"] as const)("refuses raw %s content without an exact approved Draft preview", async (provider) => {
    const f = await fixture();
    try {
      const connection = await f.connection(provider);
      const { campaign } = await f.published([f.window("publish", connection.id)]);
      await f.expectRejected(campaign.id, "draft_channel_preview_required");
    } finally { await f.cleanup(); }
  });

  it("refuses missing exact content and an unresolved channel ID", async () => {
    const f = await fixture();
    try {
      const connection = await f.connection();
      const { campaign } = await f.published([{ ...f.window("publish", connection.id), inputs: { channelConnectionId: connection.id, content: "  " } }]);
      await f.expectRejected(campaign.id, "publication_content_required");
      const { campaign: missing } = await f.published([f.window("publish", randomUUID())]);
      await f.expectRejected(missing.id, "preferred_window_route_unsupported");
    } finally { await f.cleanup(); }
  });

  it("cannot activate a bounded publication using another workspace's channel", async () => {
    const owner = await fixture(), foreign = await fixture();
    try {
      const connection = await foreign.connection();
      const { campaign } = await owner.published([owner.window("publish", connection.id)]);
      await owner.expectRejected(campaign.id, "preferred_window_route_unsupported");
      expect((await foreign.publishing.getChannelConnection(foreign.workspace.workspaceId, connection.id))?.status).toBe("active");
    } finally { await owner.cleanup(); await foreign.cleanup(); }
  });

  it("refuses a window already closed at the authoritative activation clock without queuing work", async () => {
    const f = await fixture();
    try {
      const connection = await f.connection();
      const expired = { ...f.window("publish", connection.id), preferredWindowStart: new Date(f.now - 120_000).toISOString(), preferredWindowEnd: new Date(f.now - 60_000).toISOString() };
      const { campaign } = await f.published([expired]);
      await f.expectRejected(campaign.id, "execution_schedule_expired");
      expect((await f.campaigns.getCampaign(f.workspace.workspaceId, campaign.id))?.currentVersion?.steps[0]).toMatchObject({ preferredWindowStart: expired.preferredWindowStart, preferredWindowEnd: expired.preferredWindowEnd });
    } finally { await f.cleanup(); }
  });

  it.each(["preferred_window", "dependency"] as const)("rejects an immediate companion predecessor in a mixed %s plan", async (scheduleType) => {
    const f = await fixture();
    try {
      const connection = await f.connection();
      const child = { ...f.window("publish", connection.id), scheduleType, dependsOn: ["open"], dependencyDelaySeconds: scheduleType === "dependency" ? 3 : 0 };
      const { campaign } = await f.published([
        step("open", { operationType: "manual_handoff", desiredCapability: "open_url", executionMethods: ["user_assisted", "manual_handoff"], inputs: { targetUrl: "https://example.test/owned" } }), child,
      ]);
      // This must be the mixed-plan timing restriction, not an absent/unhealthy companion fallback.
      await f.expectRejected(campaign.id, "bounded_companion_unsupported");
    } finally { await f.cleanup(); }
  });

  it("activates dependency delays on workflow-only wait and request-approval steps without a provider route", async () => {
    const f = await fixture();
    try {
      const { campaign } = await f.published([
        step("prepare", { operationType: "wait", desiredCapability: "workflow.wait", executionMethods: ["manual_handoff"], inputs: { durationSeconds: 1 } }),
        step("delay", { operationType: "wait", desiredCapability: "workflow.wait", executionMethods: ["manual_handoff"], dependsOn: ["prepare"], dependencyDelaySeconds: 7 }),
        step("review", { operationType: "request_approval", desiredCapability: "workflow.approval", executionMethods: ["manual_handoff"], dependsOn: ["delay"], dependencyDelaySeconds: 11, approvalRequired: true }),
      ]);
      const instance = (await f.activate(campaign.id))!;
      expect(instance.status).toBe("scheduled");
      expect((await f.campaigns.getWorkflowDefinition(instance.id))?.steps.map((value) => value.dependencyDelaySeconds)).toEqual([0, 7, 11]);
    } finally { await f.cleanup(); }
  });

  it.each(["preferred_window", "dependency"] as const)("activates a normal immediate publication predecessor followed by a delayed %s publication", async (scheduleType) => {
    const f = await fixture();
    try {
      const connection = await f.connection();
      const { campaign } = await f.published([
        step("first", { inputs: { channelConnectionId: connection.id, content: "First exact publication" } }),
        { ...f.window("follow", connection.id), scheduleType, dependsOn: ["first"], dependencyDelaySeconds: 5 },
      ]);
      const instance = (await f.activate(campaign.id))!;
      expect(instance.status).toBe("scheduled");
      expect((await f.campaigns.getStepScheduleState(instance.id, "follow"))?.state).toBe("waiting_dependencies");
      expect((await f.campaigns.getWorkflowDefinition(instance.id))?.steps[1]).toMatchObject({ scheduleType, dependencyDelaySeconds: 5, dependsOn: ["first"] });
    } finally { await f.cleanup(); }
  });
});

async function fixture() {
  sql ??= createDatabaseClient(databaseUrl!);
  const core = new MarketMeRepository(sql), campaigns = new CampaignRepository(sql), publishing = new PublishingRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({ email: `bounded-activation-${randomUUID()}@market-me.local`, displayName: "Bounded Activation QA" });
  const now = Number((await sql<{ milliseconds: number }[]>`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::double precision AS milliseconds`)[0]!.milliseconds);
  const cleanup = async () => {
    await sql!`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
    await sql!`DELETE FROM app_user WHERE id = ${user.id}`;
  };
  const activate = (campaignId: string) => campaigns.activateCampaign({ workspaceId: workspace.workspaceId, campaignId, actorUserId: user.id });
  return {
    user, workspace, campaigns, publishing, now, cleanup, activate,
    connection: (provider: ChannelProvider = "discord_webhook") => publishing.saveChannelConnection({
      workspaceId: workspace.workspaceId, provider, name: "Synthetic bounded activation channel", encryptedCredentials: "qa-unused-no-provider-credential",
      capabilities: provider === "mastodon_account" ? mastodonCapabilities(500, 23) as unknown as Record<string, unknown> : verifiedCapabilities,
      configuration: provider === "mastodon_account"
        ? { host: "social.example.test", instanceOrigin: "https://social.example.test", accountId: "qa-account", username: "marketme", acct: "marketme", maxCharacters: 500, charactersReservedPerUrl: 23 }
        : { webhookId: "qa-webhook", channelId: "qa-channel" },
    }, user.id),
    window: (id: string, channelConnectionId: string): CampaignStep => step(id, {
      scheduleType: "preferred_window", preferredWindowStart: new Date(Math.floor(now / 1_000) * 1_000 + 300_123).toISOString(),
      preferredWindowEnd: new Date(Math.floor(now / 1_000) * 1_000 + 3_600_456).toISOString(),
      inputs: { channelConnectionId, content: "Exact bounded publication" },
    }),
    published: async (steps: readonly CampaignStep[]) => {
      const draft: CampaignDraftWrite = {
        workspaceId: workspace.workspaceId, name: "Bounded activation acceptance", description: "", objective: "awareness",
        contentPackageIds: [], audienceProfileVersionIds: [], informationDepth: "contextual", promotionalStrength: "light",
        autonomyMode: "fully_autonomous", timezone: "America/Chicago", context: {}, steps,
      };
      const campaign = await campaigns.createCampaign(draft, user.id);
      await campaigns.publishCampaign(workspace.workspaceId, campaign.id);
      return { campaign, draft };
    },
    expectRejected: async (campaignId: string, code: string) => {
      await expect(activate(campaignId)).rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ code })]) });
      expect(await campaigns.listCampaignInstances(workspace.workspaceId)).toEqual([]);
      expect((await sql!<{ count: number }[]>`SELECT count(*)::integer AS count FROM campaign_workflow_command WHERE workspace_id = ${workspace.workspaceId}`)[0]!.count).toBe(0);
    },
  };
}
