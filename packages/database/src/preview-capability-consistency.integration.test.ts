import { randomUUID } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mastodonCapabilities } from "@market-me/connectors";
import { CampaignRepository } from "./campaign-repository";
import { compileGeneralAnnouncementPreparation } from "./campaign-preparation-template";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { DraftRepository } from "./draft-repository";
import { PublishingRepository } from "./publishing-repository";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!databaseName.startsWith("market_me_qa_") && databaseName !== "market_me_ci") {
    throw new Error("Preview consistency integration tests require an isolated market_me_qa_* or market_me_ci database.");
  }
}
let sql: DatabaseClient;
const oldStamp = "2026-01-01 00:00:00.123456+00";
const newStamp = "2026-01-02 00:00:00.654321+00";

async function withFixture(run: (fixture: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>) {
  const fixture = await makeFixture();
  try { await run(fixture); } finally { await fixture.cleanup(); }
}
async function makeFixture() {
  const core = new MarketMeRepository(sql);
  const campaigns = new CampaignRepository(sql);
  const drafts = new DraftRepository(sql);
  const publishing = new PublishingRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({
    email: `preview-consistency-${randomUUID()}@market-me.local`, displayName: "Preview consistency QA",
  });
  const cleanup = async () => {
    await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
    await sql`DELETE FROM app_user WHERE id = ${user.id}`;
  };
  try {
    const source = await core.createSmartSource({
      workspaceId: workspace.workspaceId, name: "Preview fixture source", provider: "local",
      locations: [{ providerLocationId: "fixture", displayPath: "/Fixtures" }], recursive: false,
      readinessMode: "immediate", stabilizationWindowSeconds: 0, allowedMimeTypes: ["text/plain"],
      ignorePatterns: [], contextPackIds: [], autonomyMode: "draft_only", enabled: true,
    }, user.id);
    await core.applySourceItemChanges({ workspaceId: workspace.workspaceId, smartSourceId: source.id,
      upserts: [{ workspaceId: workspace.workspaceId, smartSourceId: source.id, providerItemId: "announcement",
        name: "announcement.txt", displayPath: "/Fixtures/announcement.txt", mimeType: "text/plain", isFolder: false,
        contentHash: "sha256:preview-consistency-fixture" }], deletedProviderItemIds: [] });
    const item = (await core.getSourceItemByProviderId(source.id, "announcement"))!;
    const contentPackage = await core.saveContentPackage({
      workspaceId: workspace.workspaceId, smartSourceId: source.id, rootSourceItemId: item.id,
      title: "Reviewed community announcement", status: "ready", contextPackVersionIds: [], assets: [], conflicts: [],
      evidence: [{ id: randomUUID(), claim: "Admission to the community event is free.",
        provenance: "observed", sourceReferences: [`source-item:${item.id}`], confidence: 1 }],
    });
    await core.approveContentPackage({ workspaceId: workspace.workspaceId, packageId: contentPackage.id, actorUserId: user.id });
    const planning = compileGeneralAnnouncementPreparation({ workspaceId: workspace.workspaceId,
      contentPackageId: contentPackage.id, expectedPackageVersion: contentPackage.version }).campaign;
    const campaign = await campaigns.createCampaign(planning, user.id);
    await campaigns.publishCampaign(workspace.workspaceId, campaign.id);
    const generated = (await drafts.generate({ workspaceId: workspace.workspaceId,
      campaignId: campaign.id, contentPackageId: contentPackage.id }, user.id))[0]!;
    await drafts.submit(workspace.workspaceId, generated.id, user.id);
    const approval = (await drafts.listApprovals(workspace.workspaceId))[0]!;
    await drafts.decide({ workspaceId: workspace.workspaceId, approvalId: approval.id,
      decision: "approved", notes: "Synthetic exact evidence reviewed", actorUserId: user.id });
    const connection = await publishing.saveChannelConnection({
      workspaceId: workspace.workspaceId, provider: "mastodon_account", name: "Preview fixture Mastodon",
      encryptedCredentials: "synthetic-unusable-envelope-no-network",
      configuration: { host: "social.example.test", instanceOrigin: "https://social.example.test",
        accountId: "preview-fixture", username: "qa", acct: "qa", maxCharacters: 500, charactersReservedPerUrl: 23 },
      capabilities: mastodonCapabilities(500, 23) as unknown as Record<string, unknown>,
    }, user.id);
    await sql`UPDATE channel_connection SET capabilities_observed_at = ${oldStamp}::text::timestamptz WHERE id = ${connection.id}`;
    const input = { workspaceId: workspace.workspaceId, draftId: generated.id,
      channelConnectionId: connection.id, actorUserId: user.id };
    return { campaigns, drafts, publishing, campaign, planning, connection, generated, input, user, workspace, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

async function assertBlockedOn(holderPid: number) {
  await expect.poll(async () => (await sql<{ blocked: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_stat_activity
      WHERE datname = current_database() AND ${holderPid} = ANY(pg_blocking_pids(pid))) AS blocked
  `)[0]!.blocked, { timeout: 3_000, interval: 20 }).toBe(true);
}

async function updateCapabilities(transaction: TransactionSql, connectionId: string) {
  await transaction`UPDATE channel_connection
    SET capabilities = ${transaction.json(mastodonCapabilities(10, 23) as unknown as JSONValue)},
      configuration = jsonb_set(configuration, '{maxCharacters}', '10'::jsonb),
      capabilities_observed_at = ${newStamp}::text::timestamptz WHERE id = ${connectionId}`;
}

describe.skipIf(!databaseUrl)("consistent preview capability observations", () => {
  beforeAll(() => { sql = createDatabaseClient(databaseUrl!); });
  afterAll(async () => { await sql?.end(); });

  it("preserves microsecond precision from the same observation and keeps a normal preview fresh", async () => withFixture(async (f) => {
    const preview = (await f.drafts.createChannelPreview(f.input))!;
    expect(preview).toMatchObject({ status: "ready", isStale: false, characterLimit: 500 });
    const row = (await sql<{ exact: boolean; exactSnapshot: boolean; stamp: string }[]>`
      SELECT preview.capability_observed_at = connection.capabilities_observed_at AS exact,
        preview.capability_snapshot = connection.capabilities AS exact_snapshot,
        preview.capability_observed_at::text AS stamp FROM draft_channel_preview preview
      JOIN channel_connection connection ON connection.id = preview.channel_connection_id WHERE preview.id = ${preview.id}
    `)[0]!;
    expect(row).toEqual({ exact: true, exactSnapshot: true, stamp: oldStamp });
    expect((await f.drafts.listCampaignPreviewOptions(f.workspace.workspaceId, f.campaign.id))[0])
      .toMatchObject({ id: preview.id, isStale: false, isCurrentApprovedVersion: true });
  }));

  it("renders against new capabilities when the capability writer wins the lock", async () => withFixture(async (f) => {
    let reportLock!: (pid: number) => void;
    let releaseUpdate!: () => void;
    const locked = new Promise<number>((resolve) => { reportLock = resolve; });
    const release = new Promise<void>((resolve) => { releaseUpdate = resolve; });
    const update = sql.begin(async (transaction) => {
      await updateCapabilities(transaction, f.connection.id);
      reportLock((await transaction<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid);
      await release;
    });
    const holderPid = await locked;
    const creating = f.drafts.createChannelPreview(f.input);
    try { await assertBlockedOn(holderPid); } finally { releaseUpdate(); await update; }
    const preview = (await creating)!;
    expect(preview).toMatchObject({ status: "blocked", isStale: false, characterLimit: 10,
      validationIssues: expect.arrayContaining([expect.objectContaining({ code: "content_limit" })]) });
    expect(preview.capabilitySnapshot).toEqual((await f.publishing.getChannelConnection(f.workspace.workspaceId, f.connection.id))!.capabilities);
    expect((await sql<{ exact: boolean }[]>`SELECT capability_observed_at = ${newStamp}::text::timestamptz AS exact
      FROM draft_channel_preview WHERE id = ${preview.id}`)[0]!.exact).toBe(true);
  }));

  it("holds the observed connection through preview persistence and marks it stale after a later update", async () => withFixture(async (f) => {
    let reportLock!: (pid: number) => void;
    let releasePreview!: () => void;
    const locked = new Promise<number>((resolve) => { reportLock = resolve; });
    const release = new Promise<void>((resolve) => { releasePreview = resolve; });
    let intercepted = false;
    // Pause after a real capability SELECT completes, without replacing its data
    // or changing the repository's queries. Only this repository gets the hook.
    const wrappedSql = new Proxy(sql, {
      get(target, property, receiver) {
        if (property !== "begin") return Reflect.get(target, property, receiver);
        return (run: (transaction: TransactionSql) => Promise<unknown>) => target.begin(async (transaction) => {
          const wrappedTransaction = new Proxy(transaction, {
            apply(query, thisArg, args) {
              const result = Reflect.apply(query, thisArg, args);
              const queryText = Array.isArray(args[0]) ? args[0].join("?") : "";
              if (!intercepted && queryText.includes("SELECT id, provider, capabilities,")) {
                intercepted = true;
                return (async () => {
                  const rows = await result;
                  reportLock((await transaction<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid);
                  await release;
                  return rows;
                })();
              }
              return result;
            },
          });
          return run(wrappedTransaction);
        });
      },
    }) as DatabaseClient;
    const creating = new DraftRepository(wrappedSql).createChannelPreview(f.input);
    let updating: Promise<unknown> | undefined;
    try {
      const holderPid = await locked;
      updating = sql.begin(async (transaction) => { await updateCapabilities(transaction, f.connection.id); });
      await assertBlockedOn(holderPid);
    } finally { releasePreview(); await creating; await updating; }
    const preview = (await f.drafts.listChannelPreviews(f.workspace.workspaceId, f.generated.id))[0]!;
    expect(preview).toMatchObject({ status: "ready", isStale: true, characterLimit: 500 });
    expect(preview.capabilitySnapshot).toEqual(f.connection.capabilities);
    expect((await sql<{ exactOld: boolean; differsCurrent: boolean }[]>`
      SELECT preview.capability_observed_at = ${oldStamp}::text::timestamptz AS exact_old,
        preview.capability_observed_at <> connection.capabilities_observed_at AS differs_current
      FROM draft_channel_preview preview JOIN channel_connection connection ON connection.id = preview.channel_connection_id
      WHERE preview.id = ${preview.id}
    `)[0]).toEqual({ exactOld: true, differsCurrent: true });
    expect((await f.drafts.listCampaignPreviewOptions(f.workspace.workspaceId, f.campaign.id))[0]!.isStale).toBe(true);
    expect((await f.drafts.createChannelPreview(f.input))!).toMatchObject({ id: preview.id, status: "blocked", isStale: false, characterLimit: 10 });
  }));

  it.each(["foreign", "inactive"])("keeps %s connections unauthorized", async (kind) => withFixture(async (f) => {
    if (kind === "inactive") await sql`UPDATE channel_connection SET status = 'error' WHERE id = ${f.connection.id}`;
    await expect(f.drafts.createChannelPreview({ ...f.input, ...(kind === "foreign" ? { workspaceId: randomUUID() } : {}) }))
      .rejects.toMatchObject({ name: "DraftValidationError", issues: expect.arrayContaining([expect.objectContaining({ code: "active_channel_required" })]) });
    expect(await f.drafts.listChannelPreviews(f.workspace.workspaceId, f.generated.id)).toEqual([]);
  }));

  it("fails closed on historically camelized snapshots without rewriting their retained history", async () => withFixture(async (f) => {
    const preview = (await f.drafts.createChannelPreview(f.input))!;
    // Former writer persisted the driver's normalized JSON projection. Do not
    // guess aliases at the authority boundary: that old preview needs recreation.
    await sql`UPDATE draft_channel_preview SET capability_snapshot = ${sql.json(f.connection.capabilities as JSONValue)} WHERE id = ${preview.id}`;
    expect((await f.drafts.listChannelPreviews(f.workspace.workspaceId, f.generated.id))[0]!.isStale).toBe(true);
    expect((await f.drafts.listCampaignPreviewOptions(f.workspace.workspaceId, f.campaign.id))[0]!.isStale).toBe(true);
    expect((await sql<{ mismatched: boolean }[]>`SELECT capability_snapshot <> (SELECT capabilities FROM channel_connection WHERE id = ${f.connection.id})
      AS mismatched FROM draft_channel_preview WHERE id = ${preview.id}`)[0]!.mismatched).toBe(true);
    const recreated = (await f.drafts.createChannelPreview(f.input))!;
    expect(recreated).toMatchObject({ id: preview.id, status: "ready", isStale: false });
  }));

  it("rejects legacy mismatched snapshots even when their timestamp was incorrectly made current", async () => withFixture(async (f) => {
    const preview = (await f.drafts.createChannelPreview(f.input))!;
    await f.campaigns.saveCampaignDraft(f.campaign.id, { ...f.planning, autonomyMode: "approval_required",
      steps: [{ id: "publish", name: "Reviewed target", operationType: "publish_content", desiredCapability: "publish_content",
        dependsOn: [], inputs: { draftChannelPreviewId: preview.id }, outputs: {}, executionMethods: ["official_api"], approvalRequired: true }],
    }, f.user.id);
    await f.campaigns.publishCampaign(f.workspace.workspaceId, f.campaign.id);
    const instance = (await f.campaigns.activateCampaign({ workspaceId: f.workspace.workspaceId, campaignId: f.campaign.id, actorUserId: f.user.id }))!;
    expect((await f.publishing.getCampaignExecutionTarget(instance.id, "publish"))!.draftPreviewEligible).toBe(true);
    await sql.begin(async (transaction) => { await updateCapabilities(transaction, f.connection.id); });
    // Emulate an already-stored preview produced by the former split-read bug.
    await sql`UPDATE draft_channel_preview SET capability_observed_at = ${newStamp}::text::timestamptz WHERE id = ${preview.id}`;
    expect((await f.drafts.listChannelPreviews(f.workspace.workspaceId, f.generated.id))[0]!.isStale).toBe(true);
    expect((await f.drafts.listCampaignPreviewOptions(f.workspace.workspaceId, f.campaign.id))[0]!.isStale).toBe(true);
    expect((await f.publishing.getCampaignExecutionTarget(instance.id, "publish"))!.draftPreviewEligible).toBe(false);
    await expect(f.campaigns.activateCampaign({ workspaceId: f.workspace.workspaceId, campaignId: f.campaign.id, actorUserId: f.user.id }))
      .rejects.toMatchObject({ name: "CampaignValidationError" });
    expect((await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM publication_action WHERE workspace_id = ${f.workspace.workspaceId}`)[0]!.count).toBe(0);
  }));
});
