import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { assertFinalizedCampaignPreviewInTransaction } from "./campaign-finalization-proof";
import { PublishingRepository } from "./publishing-repository";
import { makeCampaignFinalizationFixture, type CampaignFinalizationFixture, type FinalizationFixtureOptions } from "./test-support/campaign-finalization-fixture";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl && !["market_me_qa_123_finalization", "market_me_ci"].includes(decodeURIComponent(new URL(databaseUrl).pathname.slice(1)))) {
  throw new Error("Finalization admission tests require the isolated QA123 or CI database.");
}
let sql: DatabaseClient;
const network = vi.fn(() => { throw new Error("Provider I/O is forbidden in finalization admission tests."); });
async function withFixture(run: (f: CampaignFinalizationFixture) => Promise<void>, options: FinalizationFixtureOptions = {}) {
  const fixture = await makeCampaignFinalizationFixture(sql, options);
  try { await run(fixture); expect(network).not.toHaveBeenCalled(); } finally { await fixture.cleanup(); }
}
async function finalize(f: CampaignFinalizationFixture) {
  const { finalization } = await f.finalizations.finalize(f.input, f.key, f.user.id);
  await f.campaigns.publishCampaign(f.workspace.workspaceId, f.receipt.campaignId, { expectedVersionId: finalization.finalizedVersionId });
  return finalization;
}
async function executable(f: CampaignFinalizationFixture) {
  const finalization = await finalize(f);
  const instance = (await f.campaigns.activateCampaign({ workspaceId: f.workspace.workspaceId, campaignId: f.receipt.campaignId,
    actorUserId: f.user.id, expectedVersionId: finalization.finalizedVersionId }))!;
  const stepKey = "publish_prepared_preview";
  await f.campaigns.setInstanceStatus(instance.id, "active");
  await f.campaigns.setStepRunState({ instanceId: instance.id, stepKey, status: "running" });
  const approvalId = await f.campaigns.ensureStepApproval({ instanceId: instance.id, stepKey, snapshot: { previewFingerprint: finalization.previewFingerprint } });
  await f.campaigns.decideApproval({ workspaceId: f.workspace.workspaceId, approvalId, decision: "approved", actorUserId: f.user.id, idempotencyKey: `approve:${approvalId}` });
  await f.campaigns.setStepRunState({ instanceId: instance.id, stepKey, status: "running" });
  const target = (await f.publishing.getCampaignExecutionTarget(instance.id, stepKey))!;
  const snapshot = { content: f.preview.renderedContent, provider: f.connection.provider,
    draftChannelPreviewId: f.preview.id, draftVersionId: f.approvedDraft.currentVersion.id,
    campaignFinalizationId: finalization.id, draftChannelPreviewFingerprint: finalization.previewFingerprint,
    providerPreflight: { checked: true, targetIdentity: f.connection.configuration } };
  const idempotencyKey = `finalized:${instance.id}`;
  return { finalization, instance, stepKey, target, snapshot, idempotencyKey, approvalId };
}
const changes: { name: string; mutate: (f: CampaignFinalizationFixture) => PromiseLike<unknown> }[] = [
  { name: "same-ID recreated preview", mutate: f => f.drafts.createChannelPreview(f.previewInput) },
  { name: "changed provider account", mutate: f => sql`UPDATE channel_connection SET configuration=jsonb_set(configuration,'{channelId}','"changed"'::jsonb) WHERE id=${f.connection.id}` },
  { name: "changed capability microsecond", mutate: f => sql`UPDATE channel_connection SET capabilities_observed_at=capabilities_observed_at+interval '1 microsecond' WHERE id=${f.connection.id}` },
  { name: "revoked exact draft approval", mutate: f => sql`UPDATE content_draft_approval SET status='rejected' WHERE id=${f.approval.id}` },
  { name: "changed tracked UTM", mutate: f => sql`UPDATE tracked_link SET utm_parameters='{"utm_campaign":"changed"}'::jsonb WHERE draft_channel_preview_id=${f.preview.id}` },
];

describe.skipIf(!databaseUrl)("finalized exact-preview activation and publication admission", () => {
  beforeAll(() => { sql = createDatabaseClient(databaseUrl!); vi.stubGlobal("fetch", network); });
  afterAll(async () => { vi.unstubAllGlobals(); await sql?.end(); });

  it.each(["discord_webhook", "slack_webhook", "mastodon_account"] as const)("carries durable proof through %s new claim and failed retry", async provider => withFixture(async f => {
    const e = await executable(f);
    expect(e.target).toMatchObject({ campaignFinalizationId: e.finalization.id, draftChannelPreviewFingerprint: f.exact.token, draftPreviewEligible: true });
    const input = { target: e.target, idempotencyKey: e.idempotencyKey, requestSnapshot: e.snapshot };
    const started = await f.publishing.beginPublicationAction(input);
    expect(started.created).toBe(true);
    expect(started.action.requestSnapshot).toMatchObject(e.snapshot);
    expect((await f.publishing.beginPublicationAction(input)).created).toBe(false);
    await f.publishing.finishPublicationAction(started.action.id, { status: "failed", error: "Synthetic confirmed-not-sent failure" });
    expect(await f.publishing.retryPublicationAction(started.action.id, e.target, { content: e.snapshot.content })).toBe(true);
    expect(await f.publishing.retryPublicationAction(started.action.id, e.target, { content: e.snapshot.content })).toBe(false);
  }, { provider, linkMode: "tracked" }));

  it.each(changes)("blocks activation after $name without an instance or command", async ({ mutate }) => withFixture(async f => {
    const finalization = await finalize(f);
    await mutate(f);
    await expect(f.campaigns.activateCampaign({ workspaceId: f.workspace.workspaceId, campaignId: f.receipt.campaignId,
      actorUserId: f.user.id, expectedVersionId: finalization.finalizedVersionId })).rejects.toThrow();
    expect(await sql`SELECT id FROM campaign_instance WHERE campaign_id=${f.receipt.campaignId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM campaign_workflow_command WHERE workspace_id=${f.workspace.workspaceId}`).toHaveLength(0);
  }, { linkMode: "tracked" }));

  it.each(changes)("blocks a fresh claim and confirmed failed retry after $name", async ({ mutate }) => withFixture(async f => {
    const e = await executable(f);
    const started = await f.publishing.beginPublicationAction({ target: e.target, idempotencyKey: e.idempotencyKey, requestSnapshot: e.snapshot });
    await f.publishing.finishPublicationAction(started.action.id, { status: "failed", error: "Synthetic safe retry candidate" });
    await mutate(f);
    const current = (await f.publishing.getCampaignExecutionTarget(e.instance.id, e.stepKey))!;
    expect(current.draftPreviewEligible).toBe(false);
    // A forged caller eligibility bit cannot replace the locked database proof.
    const forged = { ...current, draftPreviewEligible: true };
    await expect(f.publishing.beginPublicationAction({ target: forged, idempotencyKey: `${e.idempotencyKey}:new`, requestSnapshot: e.snapshot })).rejects.toThrow();
    await expect(f.publishing.retryPublicationAction(started.action.id, forged, { content: e.snapshot.content })).rejects.toThrow();
    expect((await f.publishing.getPublicationActionByIdempotencyKey(e.idempotencyKey))?.status).toBe("failed");
    expect(await sql`SELECT id FROM publication_action WHERE workspace_id=${f.workspace.workspaceId}`).toHaveLength(1);
  }, { linkMode: "tracked" }));

  it("rejects an untrusted tracked origin at activation/proof and admission", async () => withFixture(async f => {
    const e = await executable(f);
    await expect(assertFinalizedCampaignPreviewInTransaction(sql, { workspaceId: f.workspace.workspaceId, campaignId: f.receipt.campaignId,
      campaignVersionId: e.finalization.finalizedVersionId }, { appBaseUrl: "https://changed.example.test" })).rejects.toMatchObject({ code: "finalized_preview_changed" });
    const other = new PublishingRepository(sql, { appBaseUrl: "https://changed.example.test" });
    await expect(other.beginPublicationAction({ target: e.target, idempotencyKey: e.idempotencyKey, requestSnapshot: e.snapshot })).rejects.toThrow();
    expect(await sql`SELECT id FROM publication_action WHERE workspace_id=${f.workspace.workspaceId}`).toHaveLength(0);
  }, { linkMode: "tracked" }));

  it("does not invalidate reviewed bytes for label and successful health updates", async () => withFixture(async f => {
    const e = await executable(f);
    await sql`UPDATE channel_connection SET name='Renamed display label',last_tested_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=${f.connection.id}`;
    await sql`UPDATE destination SET title='Renamed destination label' WHERE id=${f.destination.id}`;
    const target = (await f.publishing.getCampaignExecutionTarget(e.instance.id, e.stepKey))!;
    expect(target.draftPreviewEligible).toBe(true);
    expect((await f.publishing.beginPublicationAction({ target, idempotencyKey: e.idempotencyKey, requestSnapshot: e.snapshot })).created).toBe(true);
  }));

  it.each(["both null", "null stored and missing observed", "missing stored and null observed", "both missing"])("accepts an absent optional Discord guild: %s", async mode => withFixture(async f => {
    if (mode.startsWith("missing") || mode === "both missing") {
      await sql`UPDATE channel_connection SET configuration=configuration-'guildId' WHERE id=${f.connection.id}`;
    }
    // The canonical account identity intentionally maps absent guild to null.
    const e = await executable(f);
    const identity: Record<string, unknown> = { ...f.connection.configuration };
    if (mode === "null stored and missing observed" || mode === "both missing") delete identity.guildId;
    const requestSnapshot = { ...e.snapshot, providerPreflight: { checked: true, targetIdentity: identity } };
    expect((await f.publishing.beginPublicationAction({ target: e.target, idempotencyKey: e.idempotencyKey, requestSnapshot })).created).toBe(true);
  }));

  it.each(["unexpected guild", "missing webhook", "wrong channel"])("still rejects required or conflicting Discord identity: %s", async mode => withFixture(async f => {
    const e = await executable(f);
    const identity: Record<string, unknown> = { ...f.connection.configuration };
    if (mode === "unexpected guild") identity.guildId = "guild-not-reviewed";
    if (mode === "missing webhook") delete identity.webhookId;
    if (mode === "wrong channel") identity.channelId = "channel-not-reviewed";
    await expect(f.publishing.beginPublicationAction({ target: e.target, idempotencyKey: e.idempotencyKey,
      requestSnapshot: { ...e.snapshot, providerPreflight: { checked: true, targetIdentity: identity } } })).rejects.toThrow();
  }));

  it("rejects a caller-selected replacement for the actual preview-owned tracked link", async () => withFixture(async f => {
    const e = await executable(f);
    await expect(f.publishing.beginPublicationAction({ target: e.target, idempotencyKey: e.idempotencyKey,
      requestSnapshot: { ...e.snapshot, trackedLinkId: randomUUID() } })).rejects.toThrow();
    expect(await sql`SELECT id FROM publication_action WHERE workspace_id=${f.workspace.workspaceId}`).toHaveLength(0);
    expect((await f.publishing.beginPublicationAction({ target: e.target, idempotencyKey: e.idempotencyKey,
      requestSnapshot: { ...e.snapshot, trackedLinkId: f.exact.snapshot.trackedLink!.id } })).created).toBe(true);
  }, { linkMode: "tracked" }));

  it("waits on the actual preview-owned link and rechecks its committed UTM change", async () => withFixture(async f => {
    const e = await executable(f);
    const contender = createDatabaseClient(databaseUrl!, { max: 1 });
    let pending: Promise<unknown> | undefined;
    try {
      const [{ pid }] = await contender<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await sql.begin(async tx => {
        await tx`SELECT id FROM tracked_link WHERE draft_channel_preview_id=${f.preview.id} FOR UPDATE`;
        pending = new PublishingRepository(contender, { appBaseUrl: f.appBaseUrl }).beginPublicationAction({
          target: e.target, idempotencyKey: e.idempotencyKey, requestSnapshot: e.snapshot,
        }).then(value => ({ value }), (error: unknown) => ({ error }));
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const row = (await sql<{ blocked: boolean }[]>`SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=${pid}`)[0];
          if (row?.blocked) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        await tx`UPDATE tracked_link SET utm_parameters='{"utm_campaign":"committed-while-waiting"}'::jsonb WHERE draft_channel_preview_id=${f.preview.id}`;
      });
      expect(await pending).toMatchObject({ error: expect.any(Error) });
      expect(await sql`SELECT id FROM publication_action WHERE workspace_id=${f.workspace.workspaceId}`).toHaveLength(0);
    } finally { await pending; await contender.end(); }
  }, { linkMode: "tracked" }));

  it.each(["missing target provenance", "missing request provenance", "wrong fingerprint"])("fails closed for %s", async mode => withFixture(async f => {
    const e = await executable(f);
    const target = { ...e.target }, requestSnapshot: Record<string, unknown> = { ...e.snapshot };
    if (mode === "missing target provenance") { delete target.campaignFinalizationId; delete target.draftChannelPreviewFingerprint; }
    if (mode === "missing request provenance") { delete requestSnapshot.campaignFinalizationId; delete requestSnapshot.draftChannelPreviewFingerprint; }
    if (mode === "wrong fingerprint") requestSnapshot.draftChannelPreviewFingerprint = `mm-preview-v1:sha256:${"0".repeat(64)}`;
    await expect(f.publishing.beginPublicationAction({ target, idempotencyKey: e.idempotencyKey, requestSnapshot })).rejects.toThrow();
    expect(await sql`SELECT id FROM publication_action WHERE workspace_id=${f.workspace.workspaceId}`).toHaveLength(0);
  }));

  it.each(["succeeded", "dispatching"] as const)("keeps %s publication evidence readable after preview revocation", async status => withFixture(async f => {
    const e = await executable(f);
    const started = await f.publishing.beginPublicationAction({ target: e.target, idempotencyKey: e.idempotencyKey, requestSnapshot: e.snapshot });
    if (status === "succeeded") await f.publishing.finishPublicationAction(started.action.id, { status, providerExternalId: "synthetic-provider-receipt", responseMetadata: { accepted: true } });
    await sql`UPDATE channel_connection SET status='revoked' WHERE id=${f.connection.id}`;
    expect((await f.publishing.getCampaignExecutionTarget(e.instance.id, e.stepKey))?.draftPreviewEligible).toBe(false);
    const prior = await f.publishing.getPublicationActionByIdempotencyKey(e.idempotencyKey);
    expect(prior).toMatchObject({ id: started.action.id, status, requestSnapshot: e.snapshot });
    expect(await f.publishing.retryPublicationAction(started.action.id, e.target, { content: e.snapshot.content })).toBe(false);
    expect(await sql`SELECT id FROM publication_action WHERE workspace_id=${f.workspace.workspaceId}`).toHaveLength(1);
  }));

  it("discovers protection from receipt provenance and rejects another pinned version or step", async () => withFixture(async f => {
    const finalization = await finalize(f);
    for (const override of [{ campaignVersionId: f.receipt.planningVersionId }, { campaignVersionId: randomUUID() }, { stepKey: "substitute" }]) {
      await expect(assertFinalizedCampaignPreviewInTransaction(sql, { workspaceId: f.workspace.workspaceId, campaignId: f.receipt.campaignId,
        campaignVersionId: finalization.finalizedVersionId, ...override }, { appBaseUrl: f.appBaseUrl })).rejects.toMatchObject({ code: "finalized_plan_invalid" });
    }
    await expect(assertFinalizedCampaignPreviewInTransaction(sql, { workspaceId: f.workspace.workspaceId, campaignId: randomUUID(), campaignVersionId: randomUUID() })).resolves.toBeUndefined();
  }));
});
