import { randomUUID } from "node:crypto";
import { DISCORD_WEBHOOK_CAPABILITIES } from "@market-me/connectors";
import { CampaignRepository, createDatabaseClient, DraftRepository, MarketMeRepository, ProfileRepository, PublishingRepository } from "@market-me/database";
import { FileSystemObjectStore, sha256Hex } from "@market-me/media";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = createDatabaseClient(databaseUrl);
const command = process.argv[2] ?? "seed";
const names = { campaign: "QA Draft Campaign 0.13", source: "QA Draft Source 0.13", audienceA: "QA Members 0.13", audienceB: "QA Partners 0.13", connection: "QA Preview Channel 0.15", destination: "QA Preview Destination 0.15" };

async function clean() {
  await sql.begin(async (transaction) => {
    const generations = await transaction<{ id: string }[]>`SELECT g.id FROM draft_generation g JOIN campaign_version cv ON cv.id = g.campaign_version_id JOIN campaign c ON c.id = cv.campaign_id WHERE c.name = ${names.campaign}`;
    if (generations.length) await transaction`DELETE FROM content_draft WHERE draft_generation_id IN ${transaction(generations.map((item) => item.id))}`;
    if (generations.length) await transaction`DELETE FROM draft_generation WHERE id IN ${transaction(generations.map((item) => item.id))}`;
    await transaction`DELETE FROM campaign WHERE name = ${names.campaign}`;
    await transaction`DELETE FROM audience_profile WHERE name IN (${names.audienceA}, ${names.audienceB})`;
    await transaction`DELETE FROM smart_source WHERE name = ${names.source}`;
    await transaction`DELETE FROM channel_connection WHERE name = ${names.connection}`;
    await transaction`DELETE FROM destination WHERE title = ${names.destination}`;
  });
}

async function main() {
try {
  if (command === "clean") {
    await clean();
    console.log(JSON.stringify({ cleaned: true }));
  } else if (command === "bridge") {
    const access = (await sql<{ userId: string; workspaceId: string }[]>`SELECT u.id AS user_id, m.workspace_id FROM app_user u JOIN workspace_membership m ON m.user_id = u.id WHERE u.email = 'developer@market-me.local' ORDER BY m.created_at LIMIT 1`)[0];
    if (!access) throw new Error("Development workspace is not bootstrapped");
    const core = new MarketMeRepository(sql); const campaigns = new CampaignRepository(sql); const drafts = new DraftRepository(sql);
    const campaign = (await campaigns.listCampaigns(access.workspaceId)).find((item) => item.name === names.campaign);
    const contentPackage = (await core.listContentPackages(access.workspaceId)).find((item) => item.title === "QA Evidence Launch 0.13");
    const connection = (await sql<{ id: string }[]>`SELECT id FROM channel_connection WHERE workspace_id=${access.workspaceId} AND name=${names.connection}`)[0];
    const destination = (await campaigns.listDestinations(access.workspaceId)).find((item) => item.title === names.destination);
    if (!campaign || !contentPackage || !connection || !destination) throw new Error("Run seed before bridge");
    const generated = await drafts.generate({ workspaceId: access.workspaceId, campaignId: campaign.id, contentPackageId: contentPackage.id, draftFormat: "social_standard" }, access.userId);
    await drafts.submit(access.workspaceId, generated[0]!.id, access.userId);
    const approval = (await drafts.listApprovals(access.workspaceId))[0]!;
    await drafts.decide({ workspaceId: access.workspaceId, approvalId: approval.id, decision: "approved", notes: "Release 0.18 approved tracked-preview acceptance", actorUserId: access.userId });
    const asset = contentPackage.assets.find((candidate) => candidate.role === "derivative" && candidate.mimeType === "image/png");
    if (!asset) throw new Error("Release 0.19 media fixture is missing");
    const preview = await drafts.createChannelPreview({ workspaceId: access.workspaceId, draftId: generated[0]!.id, channelConnectionId: connection.id, destinationId: destination.id, linkMode: "tracked", appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000", assetIds: [asset.id], actorUserId: access.userId });
    const audienceIds = campaign.currentVersion?.audienceProfileVersionIds ?? [];
    await campaigns.saveCampaignDraft(campaign.id, { workspaceId: access.workspaceId, name: names.campaign, description: "Release 0.18 approved tracked-preview execution", objective: "awareness", contentPackageIds: [contentPackage.id], destinationId: destination.id, audienceProfileVersionIds: audienceIds, informationDepth: "contextual", promotionalStrength: "light", autonomyMode: "approval_required", timezone: "America/Chicago", context: {}, steps: [{ id: "publish", name: "Publish exact approved tracked preview", operationType: "publish_content", desiredCapability: "publish_content", dependsOn: [], inputs: { draftChannelPreviewId: preview!.id }, outputs: { externalId: "string" }, executionMethods: ["official_api"], approvalRequired: false }] }, access.userId);
    await campaigns.publishCampaign(access.workspaceId, campaign.id);
    console.log(JSON.stringify({ workspaceId: access.workspaceId, campaignId: campaign.id, draftId: generated[0]!.id, previewId: preview!.id, connectionId: connection.id, destinationId: destination.id }));
  } else {
    await clean();
    const access = (await sql<{ userId: string; workspaceId: string }[]>`
      SELECT u.id AS user_id, m.workspace_id FROM app_user u JOIN workspace_membership m ON m.user_id = u.id
      WHERE u.email = 'developer@market-me.local' ORDER BY m.created_at LIMIT 1
    `)[0];
    if (!access) throw new Error("Development workspace is not bootstrapped");
    const core = new MarketMeRepository(sql); const profiles = new ProfileRepository(sql); const campaigns = new CampaignRepository(sql); const publishing = new PublishingRepository(sql);
    const source = await core.createSmartSource({ workspaceId: access.workspaceId, name: names.source, provider: "local", locations: [{ providerLocationId: "qa-draft", displayPath: "C:\\MarketMeQA" }], recursive: true, readinessMode: "immediate", stabilizationWindowSeconds: 0, allowedMimeTypes: ["text/plain"], ignorePatterns: [], contextPackIds: [], autonomyMode: "draft_only", enabled: true }, access.userId);
    await core.applySourceItemChanges({ workspaceId: access.workspaceId, smartSourceId: source.id, upserts: [{ workspaceId: access.workspaceId, smartSourceId: source.id, providerItemId: "qa-draft-facts", name: "facts.txt", displayPath: "C:\\MarketMeQA\\facts.txt", mimeType: "text/plain", isFolder: false, contentHash: "sha256:qa-draft-013" }], deletedProviderItemIds: [] });
    const item = await core.getSourceItemByProviderId(source.id, "qa-draft-facts");
    const saved = await core.saveContentPackage({ workspaceId: access.workspaceId, smartSourceId: source.id, rootSourceItemId: item!.id, title: "QA Evidence Launch 0.13", status: "ready", confidence: 0.98, contextPackVersionIds: [], assets: [], evidence: [
      { id: randomUUID(), factKey: "event.price", claim: "Admission is free", provenance: "authoritative_context", sourceReferences: [`source-item:${item!.id}`], confidence: 1 },
      { id: randomUUID(), factKey: "event.time", claim: "Doors open at nine", provenance: "observed", sourceReferences: [`source-item:${item!.id}`], confidence: 0.96 },
    ], conflicts: [] });
    await core.approveContentPackage({ workspaceId: access.workspaceId, packageId: saved.id, actorUserId: access.userId });
    const imageBytes = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    const digest = sha256Hex(imageBytes); const originalAssetId = randomUUID(); const derivativeAssetId = randomUUID();
    const store = new FileSystemObjectStore(process.env.MEDIA_STORAGE_ROOT ?? ".market-me/media");
    const originalKey = `originals/${digest}/qa-launch.png`; const derivativeKey = `derivatives/${digest}/qa-launch-preview.png`;
    await store.putImmutable(originalKey, imageBytes); await store.putImmutable(derivativeKey, imageBytes);
    await sql`INSERT INTO content_asset (id, content_package_id, source_item_id, role, file_name, mime_type, content_hash, extraction_status, metadata, object_key, byte_size, media_status, scan_status, rights_status, alt_text, alt_text_status)
      VALUES (${originalAssetId}, ${saved.id}, ${item!.id}, 'original', 'qa-launch.png', 'image/png', ${`sha256:${digest}`}, 'skipped', '{}'::jsonb, ${originalKey}, ${imageBytes.byteLength}, 'stored', 'not_configured', 'unchecked', 'Blue square Market Me launch graphic', 'approved')`;
    await sql`INSERT INTO content_asset (id, content_package_id, source_asset_id, role, file_name, mime_type, content_hash, extraction_status, metadata, object_key, byte_size, media_status, scan_status, rights_status, alt_text_status)
      VALUES (${derivativeAssetId}, ${saved.id}, ${originalAssetId}, 'derivative', 'qa-launch-preview.png', 'image/png', ${`sha256:${digest}`}, 'skipped', '{}'::jsonb, ${derivativeKey}, ${imageBytes.byteLength}, 'processed', 'not_configured', 'unchecked', 'not_applicable')`;
    const audienceVersions = [];
    for (const [name, knowledgeLevel] of [[names.audienceA, "new"], [names.audienceB, "expert"]] as const) {
      const audience = await profiles.createAudienceProfile({ workspaceId: access.workspaceId, name, description: "Release 0.13 browser acceptance fixture", audienceType: "community", profile: { purpose: "Explain the QA launch", industries: [], roles: [], interests: ["community"], locations: [], languages: ["en"], knowledgeLevel, needs: [], motivations: [], objections: [], questions: [], preferredChannels: [], preferredFormats: [], exclusions: [] } }, access.userId);
      audienceVersions.push((await profiles.publishAudienceProfile(access.workspaceId, audience.id, access.userId))!.currentVersion!.id);
    }
    const campaign = await campaigns.createCampaign({ workspaceId: access.workspaceId, name: names.campaign, description: "Release 0.13 browser acceptance fixture", objective: "awareness", contentPackageIds: [saved.id], audienceProfileVersionIds: audienceVersions, informationDepth: "contextual", promotionalStrength: "light", autonomyMode: "approval_required", timezone: "America/Chicago", context: {}, steps: [{ id: "review", name: "Review generated drafts", operationType: "request_approval", desiredCapability: "draft.approval", dependsOn: [], inputs: {}, outputs: {}, executionMethods: ["manual_handoff"], approvalRequired: true }] }, access.userId);
    await campaigns.publishCampaign(access.workspaceId, campaign.id);
    const connection = await publishing.saveChannelConnection({ workspaceId: access.workspaceId, provider: "discord_webhook", name: names.connection, encryptedCredentials: "qa-preview-no-delivery", capabilities: DISCORD_WEBHOOK_CAPABILITIES as unknown as Record<string, unknown> }, access.userId);
    const destination = await campaigns.saveDestination({ workspaceId: access.workspaceId, provider: "website", canonicalUrl: "https://example.com/qa-community-event", knownRedirects: [], title: names.destination, description: "Release 0.15 browser acceptance destination", contentType: "event", identifiers: {}, topics: ["community"], audiences: ["community"], geography: [], status: "published", tracking: {} }, access.userId);
    console.log(JSON.stringify({ workspaceId: access.workspaceId, campaignId: campaign.id, packageId: saved.id, derivativeAssetId, audiences: audienceVersions.length, connectionId: connection.id, destinationId: destination.id }));
  }
} finally {
  await sql.end();
}
}

void main();
