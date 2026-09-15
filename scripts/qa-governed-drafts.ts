import { randomUUID } from "node:crypto";
import { DISCORD_WEBHOOK_CAPABILITIES } from "@market-me/connectors";
import { CampaignRepository, createDatabaseClient, DraftRepository, MarketMeRepository, ProfileRepository, PublishingRepository, ContentPackageReviewRepository } from "@market-me/database";
import { FileSystemObjectStore, sha256Hex } from "@market-me/media";

const commands = ["seed", "bridge", "clean"] as const;
type Command = typeof commands[number];
const requestedCommand = process.argv[2] ?? "seed";
if (!(commands as readonly string[]).includes(requestedCommand)) {
  throw new Error(`QA governed-drafts command must be exactly one of: ${commands.join(", ")}`);
}
const command = requestedCommand as Command;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!/^\/market_me_qa_[a-z0-9_]+$/.test(new URL(databaseUrl).pathname)) {
  throw new Error("Use an isolated market_me_qa_* database for browser fixtures");
}
const sql = createDatabaseClient(databaseUrl);
const names = { campaign: "QA Draft Campaign 0.13", source: "QA Draft Source 0.13", audienceA: "QA Members 0.13", audienceB: "QA Partners 0.13", connection: "QA Preview Channel 0.15", destination: "QA Preview Destination 0.15" };
const fixture = {
  advisoryLockName: "market-me:qa-governed-drafts:v1",
  actorEmail: "developer@market-me.local",
  organizationName: "Market Me QA Governed Drafts",
  organizationSlug: "market-me-qa-governed-drafts",
  workspaceName: "QA Governed Drafts",
  workspaceSlug: "governed-drafts",
} as const;

type FixtureAccess = { userId: string; workspaceId: string };

async function withFixtureCommandLock<T>(run: () => Promise<T>): Promise<T> {
  const lockSession = await sql.reserve();
  let acquired = false;
  try {
    await lockSession`SELECT pg_advisory_lock(hashtextextended(${fixture.advisoryLockName}, 0))`;
    acquired = true;
    return await run();
  } finally {
    try {
      if (acquired) {
        const released = (await lockSession<{ released: boolean }[]>`
          SELECT pg_advisory_unlock(hashtextextended(${fixture.advisoryLockName}, 0)) AS released
        `)[0]?.released;
        if (!released) throw new Error("QA governed-drafts advisory lock was not held by its reserved session");
      }
    } finally {
      lockSession.release();
    }
  }
}

async function getFixtureAccess(): Promise<FixtureAccess | undefined> {
  return (await sql<FixtureAccess[]>`
    SELECT actor.id AS user_id, workspace.id AS workspace_id
    FROM organization
    JOIN organization_membership membership ON membership.organization_id = organization.id
    JOIN app_user actor ON actor.id = membership.user_id
    JOIN workspace ON workspace.organization_id = organization.id
    JOIN workspace_membership workspace_access
      ON workspace_access.workspace_id = workspace.id AND workspace_access.user_id = actor.id
    WHERE organization.slug = ${fixture.organizationSlug}
      AND organization.name = ${fixture.organizationName}
      AND workspace.slug = ${fixture.workspaceSlug}
      AND workspace.name = ${fixture.workspaceName}
      AND actor.normalized_email = ${fixture.actorEmail}
      AND membership.role = 'owner'
      AND workspace_access.role = 'owner'
  `)[0];
}

async function clean() {
  await sql.begin(async (transaction) => {
    const organizations = await transaction<{ id: string; name: string }[]>`
      SELECT id, name FROM organization
      WHERE slug = ${fixture.organizationSlug}
      FOR UPDATE
    `;
    if (!organizations.length) return;
    const organization = organizations[0]!;
    if (organizations.length !== 1 || organization.name !== fixture.organizationName) {
      throw new Error("Refusing to clean a QA organization whose identity marker does not match");
    }

    const workspaces = await transaction<{ id: string; name: string; slug: string }[]>`
      SELECT id, name, slug FROM workspace
      WHERE organization_id = ${organization.id}
      FOR UPDATE
    `;
    const organizationMembers = await transaction<{ normalizedEmail: string; role: string }[]>`
      SELECT actor.normalized_email, membership.role
      FROM organization_membership membership
      JOIN app_user actor ON actor.id = membership.user_id
      WHERE membership.organization_id = ${organization.id}
    `;
    const workspaceMembers = workspaces.length === 1
      ? await transaction<{ normalizedEmail: string; role: string }[]>`
          SELECT actor.normalized_email, membership.role
          FROM workspace_membership membership
          JOIN app_user actor ON actor.id = membership.user_id
          WHERE membership.workspace_id = ${workspaces[0]!.id}
        `
      : [];
    const workspace = workspaces[0];
    const ownedFixture = workspaces.length === 1
      && workspace?.name === fixture.workspaceName
      && workspace.slug === fixture.workspaceSlug
      && organizationMembers.length === 1
      && organizationMembers[0]?.normalizedEmail === fixture.actorEmail
      && organizationMembers[0].role === "owner"
      && workspaceMembers.length === 1
      && workspaceMembers[0]?.normalizedEmail === fixture.actorEmail
      && workspaceMembers[0].role === "owner";
    if (!ownedFixture) {
      throw new Error("Refusing to clean a QA organization that is not the complete owned fixture workspace");
    }

    // Approval, Learning Review and proved-generation history is immutable while
    // its workspace survives. Delete the marked disposable aggregate so the
    // deferred guards observe authorized fixture lifecycle deletion at commit.
    await transaction`DELETE FROM organization WHERE id = ${organization.id}`;
  });
}

async function createFixtureWorkspace(): Promise<FixtureAccess> {
  const actor = (await sql<{ id: string }[]>`
    SELECT id FROM app_user WHERE normalized_email = ${fixture.actorEmail}
  `)[0];
  if (!actor) throw new Error("Development workspace is not bootstrapped");
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  const brandId = randomUUID();
  await sql.begin(async (transaction) => {
    await transaction`INSERT INTO organization (id, name, slug)
      VALUES (${organizationId}, ${fixture.organizationName}, ${fixture.organizationSlug})`;
    await transaction`INSERT INTO organization_membership (organization_id, user_id, role)
      VALUES (${organizationId}, ${actor.id}, 'owner')`;
    await transaction`INSERT INTO workspace (id, organization_id, name, slug)
      VALUES (${workspaceId}, ${organizationId}, ${fixture.workspaceName}, ${fixture.workspaceSlug})`;
    await transaction`INSERT INTO workspace_membership (workspace_id, user_id, role)
      VALUES (${workspaceId}, ${actor.id}, 'owner')`;
    await transaction`INSERT INTO brand (id, workspace_id, name, is_default)
      VALUES (${brandId}, ${workspaceId}, ${fixture.workspaceName}, true)`;
  });
  return { userId: actor.id, workspaceId };
}

async function runCommand() {
  if (command === "clean") {
    await clean();
    console.log(JSON.stringify({ cleaned: true }));
  } else if (command === "bridge") {
    const access = await getFixtureAccess();
    if (!access) throw new Error("Run seed before bridge");
    const core = new MarketMeRepository(sql); const campaigns = new CampaignRepository(sql); const drafts = new DraftRepository(sql);
    const campaign = (await campaigns.listCampaigns(access.workspaceId)).find((item) => item.name === names.campaign);
    const contentPackage = (await core.listContentPackages(access.workspaceId)).find((item) => item.title === "QA Evidence Launch 0.13");
    const connection = (await sql<{ id: string }[]>`SELECT id FROM channel_connection WHERE workspace_id=${access.workspaceId} AND name=${names.connection}`)[0];
    const destination = (await campaigns.listDestinations(access.workspaceId)).find((item) => item.title === names.destination);
    if (!campaign || !contentPackage || !connection || !destination) throw new Error("Run seed before bridge");
    const review = await new ContentPackageReviewRepository(sql).getReview(access.workspaceId, contentPackage.id, access.userId);
    if (!review?.currentApprovalValid) throw new Error("Complete the package's scan, rights and exact approval in the review UI before running bridge. Seed does not fabricate these attestations.");
    const generated = await drafts.generate({ workspaceId: access.workspaceId, campaignId: campaign.id, contentPackageId: contentPackage.id,
      expectedPackageVersion: review.version, expectedReviewFingerprint: review.reviewFingerprint, draftFormat: "social_standard" }, access.userId);
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
    const access = await createFixtureWorkspace();
    const core = new MarketMeRepository(sql); const profiles = new ProfileRepository(sql); const campaigns = new CampaignRepository(sql); const publishing = new PublishingRepository(sql);
    const source = await core.createSmartSource({ workspaceId: access.workspaceId, name: names.source, provider: "local", locations: [{ providerLocationId: "qa-draft", displayPath: "C:\\MarketMeQA" }], recursive: true, readinessMode: "immediate", stabilizationWindowSeconds: 0, allowedMimeTypes: ["text/plain"], ignorePatterns: [], contextPackIds: [], autonomyMode: "draft_only", enabled: true }, access.userId);
    await core.applySourceItemChanges({ workspaceId: access.workspaceId, smartSourceId: source.id, upserts: [{ workspaceId: access.workspaceId, smartSourceId: source.id, providerItemId: "qa-draft-facts", name: "facts.txt", displayPath: "C:\\MarketMeQA\\facts.txt", mimeType: "text/plain", isFolder: false, contentHash: "sha256:qa-draft-013" }], deletedProviderItemIds: [] });
    const item = await core.getSourceItemByProviderId(source.id, "qa-draft-facts");
    const saved = await core.saveContentPackage({ workspaceId: access.workspaceId, smartSourceId: source.id, rootSourceItemId: item!.id, title: "QA Evidence Launch 0.13", status: "ready", confidence: 0.98, contextPackVersionIds: [], assets: [], evidence: [
      { id: randomUUID(), factKey: "event.price", claim: "Admission is free", provenance: "authoritative_context", sourceReferences: [`source-item:${item!.id}`], confidence: 1 },
      { id: randomUUID(), factKey: "event.time", claim: "Doors open at nine", provenance: "observed", sourceReferences: [`source-item:${item!.id}`], confidence: 0.96 },
    ], conflicts: [] });
    // Seed leaves material unapproved. Exact review occurs only after all assets,
    // real scan results and rights scopes have been displayed to a reviewer.
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
    console.log(JSON.stringify({ workspaceId: access.workspaceId, campaignId: campaign.id, packageId: saved.id, derivativeAssetId, audiences: audienceVersions.length,
      connectionId: connection.id, destinationId: destination.id, exactPackageReviewRequired: true }));
  }
}

async function main() {
  try {
    await withFixtureCommandLock(runCommand);
  } finally {
    await sql.end();
  }
}

void main();
