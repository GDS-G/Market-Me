import { randomUUID } from "node:crypto";
import type { JSONValue } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DISCORD_WEBHOOK_CAPABILITIES, SLACK_WEBHOOK_CAPABILITIES, mastodonCapabilities } from "@market-me/connectors";
import { CampaignRepository } from "./campaign-repository";
import { compileGeneralAnnouncementPreparation } from "./campaign-preparation-template";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { DraftRepository } from "./draft-repository";
import { PublishingRepository } from "./publishing-repository";
import { MarketMeRepository } from "./repositories";
import { loadExactTextPreviewInTransaction, lockExactTextPreviewInTransaction } from "./exact-preview-repository";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  const target = new URL(databaseUrl);
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!["market_me_qa_122_preparation", "market_me_qa_123_finalization", "market_me_ci"].includes(name)) {
    throw new Error("Exact-preview repository tests require the explicitly isolated QA122, QA123, or CI database.");
  }
}
let sql: DatabaseClient;
const observedAt = "2026-01-01T00:00:00.123456Z";
const createdAt = "2026-01-02T01:02:03.654321Z";
const expiresAt = "2099-12-31T23:59:59.987654Z";
const appBaseUrl = "https://market-me.example.test";
const network = vi.fn(() => { throw new Error("No provider or external network is permitted in exact-preview tests."); });
type Provider = "discord_webhook" | "slack_webhook" | "mastodon_account";
type Mode = "none" | "canonical" | "tracked";

async function makeFixture(provider: Provider = "discord_webhook", mode: Mode = "none") {
  const core = new MarketMeRepository(sql), campaigns = new CampaignRepository(sql);
  const drafts = new DraftRepository(sql), publishing = new PublishingRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({
    email: `exact-preview-${randomUUID()}@market-me.local`, displayName: "Exact preview isolated QA",
  });
  const cleanup = async () => {
    await sql`DELETE FROM draft_channel_preview_asset WHERE draft_channel_preview_id IN (SELECT id FROM draft_channel_preview WHERE workspace_id=${workspace.workspaceId})`;
    await sql`DELETE FROM tracked_link WHERE workspace_id=${workspace.workspaceId}`;
    await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`;
    await sql`DELETE FROM app_user WHERE id=${user.id}`;
  };
  try {
    const source = await core.createSmartSource({ workspaceId: workspace.workspaceId, name: "Exact preview fixture source", provider: "local",
      locations: [{ providerLocationId: "fixture", displayPath: "/ExactPreviewQA" }], recursive: false, readinessMode: "immediate",
      stabilizationWindowSeconds: 0, allowedMimeTypes: ["text/plain"], ignorePatterns: [], contextPackIds: [], autonomyMode: "draft_only", enabled: false }, user.id);
    await core.applySourceItemChanges({ workspaceId: workspace.workspaceId, smartSourceId: source.id,
      upserts: [{ workspaceId: workspace.workspaceId, smartSourceId: source.id, providerItemId: "announcement", name: "announcement.txt",
        displayPath: "/ExactPreviewQA/announcement.txt", mimeType: "text/plain", isFolder: false, contentHash: "sha256:exact-preview-fixture" }], deletedProviderItemIds: [] });
    const sourceItem = (await core.getSourceItemByProviderId(source.id, "announcement"))!;
    const contentPackage = await core.saveContentPackage({ workspaceId: workspace.workspaceId, smartSourceId: source.id,
      rootSourceItemId: sourceItem.id, title: "Café 🚀 announcement", status: "ready", contextPackVersionIds: [], assets: [], conflicts: [],
      evidence: [{ id: randomUUID(), claim: "Admission is free — café 🚀.", provenance: "authoritative_context", sourceReferences: ["QA original captured evidence"], confidence: 1 }] });
    await core.approveContentPackage({ workspaceId: workspace.workspaceId, packageId: contentPackage.id, actorUserId: user.id });
    const destination = mode === "none" ? undefined : await campaigns.saveDestination({ workspaceId: workspace.workspaceId,
      provider: "manual", canonicalUrl: "https://example.test/announcement?keep=a%2Fb", knownRedirects: [], title: "Original destination label",
      description: "Synthetic unversioned destination", contentType: "web_page", identifiers: {}, topics: [], audiences: [], geography: [], status: "published", tracking: {} }, user.id);
    const campaign = await campaigns.createCampaign(compileGeneralAnnouncementPreparation({ workspaceId: workspace.workspaceId,
      contentPackageId: contentPackage.id, expectedPackageVersion: 1, ...(destination ? { destinationId: destination.id } : {}) }).campaign, user.id);
    await campaigns.publishCampaign(workspace.workspaceId, campaign.id);
    const generated = (await drafts.generate({ workspaceId: workspace.workspaceId, campaignId: campaign.id, contentPackageId: contentPackage.id }, user.id))[0]!;
    await drafts.submit(workspace.workspaceId, generated.id, user.id);
    const approval = (await drafts.listApprovals(workspace.workspaceId))[0]!;
    await drafts.decide({ workspaceId: workspace.workspaceId, approvalId: approval.id, decision: "approved", actorUserId: user.id, notes: "Synthetic exact version review" });
    const configuration = provider === "discord_webhook"
      ? { webhookId: "123456789012345678", channelId: "223456789012345678", guildId: null }
      : provider === "slack_webhook" ? { teamId: "T01234567", serviceId: "B01234567", host: "hooks.slack.com" }
        : { accountId: "123456", instanceOrigin: "https://social.example.test", host: "social.example.test", username: "qa", acct: "qa", maxCharacters: 500, charactersReservedPerUrl: 23 };
    const capabilities = provider === "discord_webhook" ? DISCORD_WEBHOOK_CAPABILITIES : provider === "slack_webhook" ? SLACK_WEBHOOK_CAPABILITIES : mastodonCapabilities(500, 23);
    const connection = await publishing.saveChannelConnection({ workspaceId: workspace.workspaceId, provider,
      name: "Original connection label", encryptedCredentials: "synthetic-unusable-envelope-never-decrypted",
      configuration, capabilities: capabilities as unknown as Record<string, unknown> }, user.id);
    await sql`UPDATE channel_connection SET capabilities_observed_at=${observedAt}::text::timestamptz WHERE id=${connection.id}`;
    const previewInput = { workspaceId: workspace.workspaceId, draftId: generated.id, channelConnectionId: connection.id,
      ...(destination ? { destinationId: destination.id } : {}), linkMode: mode === "tracked" ? "tracked" as const : "canonical" as const,
      ...(mode === "tracked" ? { appBaseUrl } : {}), actorUserId: user.id };
    const preview = (await drafts.createChannelPreview(previewInput))!;
    await sql`UPDATE draft_channel_preview SET created_at=${createdAt}::text::timestamptz WHERE id=${preview.id}`;
    const link = mode === "tracked" ? (await sql<{ id: string; slug: string }[]>`SELECT id,slug FROM tracked_link WHERE draft_channel_preview_id=${preview.id}`)[0]! : undefined;
    if (link) await sql`UPDATE tracked_link SET expires_at=${expiresAt}::text::timestamptz WHERE id=${link.id}`;
    return { core, campaigns, drafts, publishing, user, workspace, contentPackage, sourceItem, campaign, generated, approval, connection, preview, previewInput, destination, link, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
type Fixture = Awaited<ReturnType<typeof makeFixture>>;
async function withFixture(run: (fixture: Fixture) => Promise<void>, provider: Provider = "discord_webhook", mode: Mode = "none") {
  const fixture = await makeFixture(provider, mode);
  try { await run(fixture); expect(network).not.toHaveBeenCalled(); } finally { await fixture.cleanup(); }
}
function input(f: Fixture) { return { workspaceId: f.workspace.workspaceId, previewId: f.preview.id }; }
function load(f: Fixture, options: { appBaseUrl?: string } = { appBaseUrl }) {
  return sql.begin(async (transaction) => loadExactTextPreviewInTransaction(transaction, input(f), options));
}
async function blockedOn(holderPid: number) {
  await expect.poll(async () => (await sql<{ blocked: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND ${holderPid}=ANY(pg_blocking_pids(pid))) AS blocked`)[0]!.blocked, { timeout: 3_000, interval: 20 }).toBe(true);
}

const invalidPreviewMutations: { name: string; update: (f: Fixture) => Promise<unknown> }[] = [
  { name: "unapproved root", update: (f) => sql`UPDATE content_draft SET status='working' WHERE id=${f.generated.id}` },
  { name: "unapproved exact version", update: (f) => sql`UPDATE content_draft_version SET status='working' WHERE id=${f.generated.currentVersion.id}` },
  { name: "missing current version", update: (f) => sql`UPDATE content_draft SET current_version_id=NULL WHERE id=${f.generated.id}` },
  { name: "no real approved decision", update: (f) => sql`UPDATE content_draft_approval SET status='rejected' WHERE id=${f.approval.id}` },
  { name: "inactive connection", update: (f) => sql`UPDATE channel_connection SET status='error' WHERE id=${f.connection.id}` },
  { name: "missing account identity", update: (f) => sql`UPDATE channel_connection SET configuration=configuration-'webhookId' WHERE id=${f.connection.id}` },
  { name: "wrong preview provider", update: (f) => sql`UPDATE draft_channel_preview SET provider='slack_webhook' WHERE id=${f.preview.id}` },
  { name: "blocked preview", update: (f) => sql`UPDATE draft_channel_preview SET status='blocked' WHERE id=${f.preview.id}` },
  { name: "validation issue", update: (f) => sql`UPDATE draft_channel_preview SET validation_issues='[{"code":"blocked","message":"Requires review"}]'::jsonb WHERE id=${f.preview.id}` },
  { name: "changed stored copy", update: (f) => sql`UPDATE draft_channel_preview SET rendered_content=rendered_content||' ', character_count=character_count+1 WHERE id=${f.preview.id}` },
  { name: "wrong character count", update: (f) => sql`UPDATE draft_channel_preview SET character_count=character_count+1 WHERE id=${f.preview.id}` },
  { name: "wrong character limit", update: (f) => sql`UPDATE draft_channel_preview SET character_limit=character_limit+1 WHERE id=${f.preview.id}` },
  { name: "social subject present", update: (f) => sql`UPDATE draft_channel_preview SET rendered_subject='' WHERE id=${f.preview.id}` },
  { name: "social subject count present", update: (f) => sql`UPDATE draft_channel_preview SET subject_count=0 WHERE id=${f.preview.id}` },
  { name: "wrong capability version", update: (f) => sql`UPDATE draft_channel_preview SET capability_version='different' WHERE id=${f.preview.id}` },
  { name: "capability microsecond mismatch", update: (f) => sql`UPDATE draft_channel_preview SET capability_observed_at=capability_observed_at+interval '1 microsecond' WHERE id=${f.preview.id}` },
  { name: "infinite preview timestamp", update: (f) => sql`UPDATE draft_channel_preview SET created_at='infinity'::timestamptz WHERE id=${f.preview.id}` },
];

describe.skipIf(!databaseUrl)("exact raw text-preview repository", () => {
  beforeAll(() => { sql = createDatabaseClient(databaseUrl!); vi.stubGlobal("fetch", network); });
  beforeEach(() => { network.mockClear(); });
  afterAll(async () => { vi.unstubAllGlobals(); await sql?.end(); });

  it.each(["discord_webhook", "slack_webhook", "mastodon_account"] as const)("loads a coherent approved %s text preview without provider I/O", async (provider) => withFixture(async (f) => {
    const result = await load(f);
    expect(result.token).toMatch(/^mm-preview-v1:sha256:[0-9a-f]{64}$/);
    expect(JSON.parse(result.canonicalSnapshot)).toEqual(result.snapshot);
    expect(result.snapshot.lineage).toEqual({ workspaceId: f.workspace.workspaceId, campaignId: f.campaign.id,
      sourceCampaignVersionId: f.generated.generation.campaignVersionId, generationId: f.generated.generation.id,
      previewId: f.preview.id, contentDraftId: f.generated.id, contentDraftVersionId: f.generated.currentVersion.id });
    expect(result.snapshot.preview).toMatchObject({ provider, renderedContent: f.preview.renderedContent,
      renderedSubject: null, subjectCount: null, subjectLimit: null, assets: [], createdAtUtcMicros: createdAt,
      capabilityObservedAtUtcMicros: observedAt });
    expect(result.snapshot.preview.capabilitySnapshot.supportedActions).toHaveProperty("publish_content", true);
    expect(result.snapshot.preview.capabilitySnapshot.supportedActions).not.toHaveProperty("publishContent");
    expect(result.connectionName).toBe("Original connection label");
    expect(result.canonicalSnapshot).not.toContain("synthetic-unusable-envelope");
    expect(result.snapshot.connection.provider).toBe(provider);
    if (provider === "discord_webhook") expect(result.snapshot.connection.identity).toEqual({ webhookId: "123456789012345678", channelId: "223456789012345678", guildId: null });
  }, provider, provider === "mastodon_account" ? "tracked" : provider === "slack_webhook" ? "canonical" : "none"));

  it("preserves SQL microseconds and raw snake-case UTM keys without timezone or Date round trips", async () => withFixture(async (f) => {
    const utc = await sql.begin(async (transaction) => { await transaction`SET LOCAL TIME ZONE 'UTC'`; return loadExactTextPreviewInTransaction(transaction, input(f), { appBaseUrl }); });
    const chicago = await sql.begin(async (transaction) => { await transaction`SET LOCAL TIME ZONE 'America/Chicago'`; return loadExactTextPreviewInTransaction(transaction, input(f), { appBaseUrl }); });
    expect(chicago).toEqual(utc);
    expect(utc.snapshot.trackedLink).toMatchObject({ expiresAtUtcMicros: expiresAt, publicRedirectUrl: `${appBaseUrl}/r/${f.link!.slug}`, campaignInstanceId: null, campaignStepRunId: null });
    expect(utc.snapshot.trackedLink!.utmParameters).toHaveProperty("utm_source", "mastodon");
    expect(utc.snapshot.trackedLink!.utmParameters).not.toHaveProperty("utmSource");
  }, "mastodon_account", "tracked"));

  it("excludes presentation labels and routine health timestamps but returns current safe labels", async () => withFixture(async (f) => {
    const before = await load(f);
    await sql`UPDATE channel_connection SET name='Renamed connection',last_tested_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=${f.connection.id}`;
    await sql`UPDATE destination SET title='Renamed destination',description='Changed unrelated description',tracking='{"unrelated":true}'::jsonb WHERE id=${f.destination!.id}`;
    const after = await load(f);
    expect(after.token).toBe(before.token); expect(after.canonicalSnapshot).toBe(before.canonicalSnapshot);
    expect(after.connectionName).toBe("Renamed connection"); expect(after.destinationTitle).toBe("Renamed destination");
  }, "discord_webhook", "canonical"));

  it("changes the fingerprint when the same ID is recreated even with identical content", async () => withFixture(async (f) => {
    const before = await load(f); const recreated = (await f.drafts.createChannelPreview(f.previewInput))!;
    expect(recreated.id).toBe(f.preview.id); expect(recreated.renderedContent).toBe(before.snapshot.preview.renderedContent);
    const after = await load(f); expect(after.token).not.toBe(before.token);
    expect(after.snapshot.preview.createdAtUtcMicros).not.toBe(before.snapshot.preview.createdAtUtcMicros);
  }));

  it("includes explicit account identity changes even when display labels and rendered copy stay the same", async () => withFixture(async (f) => {
    const before = await load(f);
    await sql`UPDATE channel_connection SET configuration=jsonb_set(configuration,'{channelId}','"323456789012345678"'::jsonb) WHERE id=${f.connection.id}`;
    const after = await load(f); expect(after.token).not.toBe(before.token);
    expect(after.snapshot.preview.renderedContent).toBe(before.snapshot.preview.renderedContent);
  }));

  it("includes unknown raw capability fields without interpreting driver aliases", async () => withFixture(async (f) => {
    const before = await load(f);
    await sql`UPDATE channel_connection SET capabilities=capabilities||'{"qa_new_field":{"2":"two","10":"ten","publish_content":true}}'::jsonb WHERE id=${f.connection.id}`;
    await sql`UPDATE draft_channel_preview SET capability_snapshot=(SELECT capabilities FROM channel_connection WHERE id=${f.connection.id}) WHERE id=${f.preview.id}`;
    const after = await load(f); expect(after.token).not.toBe(before.token);
    expect(after.snapshot.preview.capabilitySnapshot.qa_new_field).toEqual({ "2": "two", "10": "ten", publish_content: true });
  }));

  it("rejects the historically camelized snapshot while retaining its raw row", async () => withFixture(async (f) => {
    await sql`UPDATE draft_channel_preview SET capability_snapshot=${sql.json(f.connection.capabilities as JSONValue)} WHERE id=${f.preview.id}`;
    await expect(load(f)).rejects.toThrow();
    const row = (await sql<{ snapshot: string }[]>`SELECT capability_snapshot::text AS snapshot FROM draft_channel_preview WHERE id=${f.preview.id}`)[0]!;
    expect(JSON.parse(row.snapshot).supportedActions).toHaveProperty("publishContent");
  }));

  it.each(["9007199254740993", "0.12345678901234567890123456789"])("rejects lossy raw JSONB number %s instead of fingerprinting rounded data", async (number) => withFixture(async (f) => {
    const raw = `{"qa_exact_number":${number}}`;
    await sql`UPDATE channel_connection SET capabilities=capabilities||${raw}::text::jsonb WHERE id=${f.connection.id}`;
    await sql`UPDATE draft_channel_preview SET capability_snapshot=(SELECT capabilities FROM channel_connection WHERE id=${f.connection.id}) WHERE id=${f.preview.id}`;
    await expect(load(f)).rejects.toThrow();
    expect((await sql<{ exact: string }[]>`SELECT capabilities->>'qa_exact_number' AS exact FROM channel_connection WHERE id=${f.connection.id}`)[0]!.exact).toBe(number);
  }));

  it.each(invalidPreviewMutations)("rejects $name before issuing a token", async ({ update }) => withFixture(async (f) => {
    await update(f); await expect(load(f)).rejects.toThrow();
  }));

  it("rejects a BC creation timestamp instead of aliasing its year to an AD fingerprint", async () => withFixture(async (f) => {
    await sql`UPDATE draft_channel_preview SET created_at='0001-01-02 01:02:03.654321 BC'::timestamptz WHERE id=${f.preview.id}`;
    await expect(load(f)).rejects.toThrow();
  }));

  it.each(["numeric", "conflicting_alias", "matching_alias"] as const)("rejects %s raw account identity instead of silently changing its runtime meaning", async (kind) => withFixture(async (f) => {
    if (kind === "numeric") await sql`UPDATE channel_connection SET configuration=jsonb_set(configuration,'{channelId}','223456789012345678'::jsonb) WHERE id=${f.connection.id}`;
    else if (kind === "matching_alias") await sql`UPDATE channel_connection SET configuration=configuration||'{"channel_id":"223456789012345678"}'::jsonb WHERE id=${f.connection.id}`;
    else await sql`UPDATE channel_connection SET configuration=configuration||'{"channel_id":"different-runtime-channel"}'::jsonb WHERE id=${f.connection.id}`;
    await expect(load(f)).rejects.toThrow();
  }));

  it("rejects a foreign workspace and a missing preview", async () => withFixture(async (f) => {
    await expect(sql.begin((transaction) => loadExactTextPreviewInTransaction(transaction, { workspaceId: randomUUID(), previewId: f.preview.id }))).rejects.toThrow();
    await expect(sql.begin((transaction) => loadExactTextPreviewInTransaction(transaction, { workspaceId: f.workspace.workspaceId, previewId: randomUUID() }))).rejects.toThrow();
  }));

  it("counts underlying attachment rows even though v1 only returns an empty attachment snapshot", async () => withFixture(async (f) => {
    const assetId = randomUUID();
    await sql`INSERT INTO content_asset(id,content_package_id,role,file_name,mime_type,content_hash,extraction_status) VALUES(${assetId},${f.contentPackage.id},'original','qa.png','image/png','qa-image-hash','skipped')`;
    await sql`INSERT INTO draft_channel_preview_asset(draft_channel_preview_id,content_asset_id,sort_order,object_key,content_hash,file_name,mime_type,byte_size,alt_text_status,scan_status,rights_status) VALUES(${f.preview.id},${assetId},0,'qa/image','qa-image-hash','qa.png','image/png',1,'decorative','not_configured','unchecked')`;
    await expect(load(f)).rejects.toThrow();
  }));

  it("requires the approved decision to name the same draft, not merely its version ID", async () => withFixture(async (f) => {
    const other = (await f.drafts.generate({ workspaceId: f.workspace.workspaceId, campaignId: f.campaign.id, contentPackageId: f.contentPackage.id }, f.user.id))[0]!;
    await sql`UPDATE content_draft_approval SET content_draft_id=${other.id} WHERE id=${f.approval.id}`;
    await expect(load(f)).rejects.toThrow();
  }));

  it("rejects a coherent raw observation that offers only manual handoff", async () => withFixture(async (f) => {
    await sql`UPDATE channel_connection SET capabilities=jsonb_set(capabilities,'{executionMethods}','["manual_handoff"]'::jsonb) WHERE id=${f.connection.id}`;
    await sql`UPDATE draft_channel_preview SET capability_snapshot=(SELECT capabilities FROM channel_connection WHERE id=${f.connection.id}) WHERE id=${f.preview.id}`;
    await expect(load(f)).rejects.toThrow();
  }));

  it("requires recreation before accepting a changed destination URL and fingerprints its new rendering", async () => withFixture(async (f) => {
    const before = await load(f);
    await sql`UPDATE destination SET canonical_url='https://example.test/next?exact=a%2Fb' WHERE id=${f.destination!.id}`;
    await expect(load(f)).rejects.toThrow();
    await f.drafts.createChannelPreview(f.previewInput);
    const after = await load(f); expect(after.token).not.toBe(before.token);
    expect(after.snapshot.destination!.canonicalUrl).toBe("https://example.test/next?exact=a%2Fb");
    expect(after.snapshot.preview.renderedContent).toContain("https://example.test/next?exact=a%2Fb");
  }, "discord_webhook", "canonical"));

  it.each(["draft", "future", "expired", "changed_url"] as const)("rejects %s destination state against fresh database time and rendering", async (kind) => withFixture(async (f) => {
    if (kind === "draft") await sql`UPDATE destination SET status='draft' WHERE id=${f.destination!.id}`;
    if (kind === "future") await sql`UPDATE destination SET available_at=clock_timestamp()+interval '1 day' WHERE id=${f.destination!.id}`;
    if (kind === "expired") await sql`UPDATE destination SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${f.destination!.id}`;
    if (kind === "changed_url") await sql`UPDATE destination SET canonical_url='https://example.test/replaced' WHERE id=${f.destination!.id}`;
    await expect(load(f)).rejects.toThrow();
  }, "slack_webhook", "canonical"));

  it.each(["disabled", "expired", "missing", "wrong_url"] as const)("rejects %s tracked-link state", async (kind) => withFixture(async (f) => {
    if (kind === "disabled") await sql`UPDATE tracked_link SET status='disabled' WHERE id=${f.link!.id}`;
    if (kind === "expired") await sql`UPDATE tracked_link SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${f.link!.id}`;
    if (kind === "missing") await sql`DELETE FROM tracked_link WHERE id=${f.link!.id}`;
    if (kind === "wrong_url") await sql`UPDATE tracked_link SET canonical_url='https://example.test/unapproved-target' WHERE id=${f.link!.id}`;
    await expect(load(f)).rejects.toThrow();
  }, "mastodon_account", "tracked"));

  it("pins raw UTM and link expiry changes although the displayed redirect URL is unchanged", async () => withFixture(async (f) => {
    const before = await load(f);
    await sql`UPDATE tracked_link SET utm_parameters=utm_parameters||'{"utm_term":"extra exact context"}'::jsonb WHERE id=${f.link!.id}`;
    const afterUtm = await load(f); expect(afterUtm.token).not.toBe(before.token);
    expect(afterUtm.snapshot.preview.renderedContent).toBe(before.snapshot.preview.renderedContent);
    await sql`UPDATE tracked_link SET expires_at=expires_at-interval '1 microsecond' WHERE id=${f.link!.id}`;
    const afterExpiry = await load(f); expect(afterExpiry.token).not.toBe(afterUtm.token);
    expect(afterExpiry.snapshot.trackedLink!.expiresAtUtcMicros).toBe("2099-12-31T23:59:59.987653Z");
  }, "mastodon_account", "tracked"));

  it("requires a trusted matching redirect origin only for tracked previews", async () => withFixture(async (f) => {
    await expect(load(f, {})).rejects.toThrow();
    await expect(load(f, { appBaseUrl: "https://changed.example.test" })).rejects.toThrow();
    await expect(load(f, { appBaseUrl: "javascript:alert(1)" })).rejects.toThrow();
  }, "slack_webhook", "tracked"));

  it("does not require APP_BASE_URL when there is no tracked link", async () => withFixture(async (f) => {
    expect((await load(f, {})).snapshot.trackedLink).toBeNull();
  }, "discord_webhook", "canonical"));

  it("observes connection mutation committed before its lock instead of using a pre-wait snapshot", async () => withFixture(async (f) => {
    let report!: (pid: number) => void, release!: () => void;
    const locked = new Promise<number>((resolve) => { report = resolve; }), released = new Promise<void>((resolve) => { release = resolve; });
    const writer = sql.begin(async (transaction) => {
      await transaction`UPDATE channel_connection SET capabilities_observed_at=capabilities_observed_at+interval '1 microsecond' WHERE id=${f.connection.id}`;
      report((await transaction<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid); await released;
    });
    const holderPid = await locked;
    const reading = sql.begin(async (transaction) => { await lockExactTextPreviewInTransaction(transaction, input(f)); return loadExactTextPreviewInTransaction(transaction, input(f)); });
    const rejected = expect(reading).rejects.toThrow();
    try { await blockedOn(holderPid); } finally { release(); await writer; }
    await rejected;
  }));

  it("holds exact preview authority locks until the reader commits, then observes the later mutation", async () => withFixture(async (f) => {
    let report!: (pid: number) => void, rejectLocked!: (reason: unknown) => void, release!: () => void;
    const locked = new Promise<number>((resolve, reject) => { report = resolve; rejectLocked = reject; }), released = new Promise<void>((resolve) => { release = resolve; });
    const reading = sql.begin(async (transaction) => {
      await lockExactTextPreviewInTransaction(transaction, input(f));
      const result = await loadExactTextPreviewInTransaction(transaction, input(f));
      report((await transaction<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid); await released; return result;
    });
    void reading.catch(rejectLocked);
    const holderPid = await locked;
    const writer = sql.begin(async (transaction) => { await transaction`UPDATE channel_connection SET status='error' WHERE id=${f.connection.id}`; });
    try { await blockedOn(holderPid); } finally { release(); await reading; await writer; }
    await expect(load(f)).rejects.toThrow();
  }));

  it("returns the newly recreated preview when that writer commits before the helper acquires its locks", async () => withFixture(async (f) => {
    const before = await load(f);
    let report!: (pid: number) => void, release!: () => void;
    const locked = new Promise<number>((resolve) => { report = resolve; }), released = new Promise<void>((resolve) => { release = resolve; });
    const writer = sql.begin(async (transaction) => {
      await transaction`UPDATE draft_channel_preview SET created_at=created_at+interval '1 microsecond' WHERE id=${f.preview.id}`;
      report((await transaction<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid); await released;
    });
    const holderPid = await locked;
    const reading = sql.begin(async (transaction) => { await lockExactTextPreviewInTransaction(transaction, input(f)); return loadExactTextPreviewInTransaction(transaction, input(f)); });
    try { await blockedOn(holderPid); } finally { release(); await writer; }
    const after = await reading; expect(after.token).not.toBe(before.token);
    expect(after.snapshot.preview.createdAtUtcMicros).toBe("2026-01-02T01:02:03.654322Z");
  }));

  it("excludes concurrent attachment insertion through the preview row's foreign-key lock", async () => withFixture(async (f) => {
    const assetId = randomUUID();
    await sql`INSERT INTO content_asset(id,content_package_id,role,file_name,mime_type,content_hash,extraction_status) VALUES(${assetId},${f.contentPackage.id},'original','qa.png','image/png','qa-image-hash','skipped')`;
    let report!: (pid: number) => void, rejectLocked!: (reason: unknown) => void, release!: () => void;
    const locked = new Promise<number>((resolve, reject) => { report = resolve; rejectLocked = reject; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const reading = sql.begin(async (transaction) => {
      await lockExactTextPreviewInTransaction(transaction, input(f));
      const result = await loadExactTextPreviewInTransaction(transaction, input(f));
      report((await transaction<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid);
      await released; return result;
    });
    void reading.catch(rejectLocked);
    let insertion: Promise<unknown> | undefined;
    try {
      const holderPid = await locked;
      insertion = sql.begin(async (transaction) => {
        await transaction`INSERT INTO draft_channel_preview_asset(draft_channel_preview_id,content_asset_id,sort_order,object_key,content_hash,file_name,mime_type,byte_size,alt_text_status,scan_status,rights_status) VALUES(${f.preview.id},${assetId},0,'qa/image','qa-image-hash','qa.png','image/png',1,'decorative','not_configured','unchecked')`;
      });
      await blockedOn(holderPid);
    } finally { release(); await reading; await insertion; }
    await expect(load(f)).rejects.toThrow();
  }));
});
