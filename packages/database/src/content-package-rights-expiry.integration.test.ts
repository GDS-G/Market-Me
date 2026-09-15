import { randomUUID } from "node:crypto";
import { DISCORD_WEBHOOK_CAPABILITIES } from "@market-me/connectors";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CampaignPreparationRepository } from "./campaign-preparation-repository";
import { compileGeneralAnnouncementPreparation } from "./campaign-preparation-template";
import { CampaignRepository } from "./campaign-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { ContentPackageReviewRepository } from "./content-package-review-repository";
import { DraftRepository } from "./draft-repository";
import { PublishingRepository } from "./publishing-repository";
import { MarketMeRepository } from "./repositories";
import { packageGenerationPrecondition, packageReviewPrecondition } from "./test-support/package-review-fixture";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl && !/^market_me_qa_124(?:_|$)|^market_me_ci$/.test(decodeURIComponent(new URL(databaseUrl).pathname.slice(1)))) {
  throw new Error("Package rights expiry tests require an isolated market_me_qa_124_* or market_me_ci database.");
}
let sql: DatabaseClient;

async function makeFixture() {
  const core = new MarketMeRepository(sql);
  const campaigns = new CampaignRepository(sql);
  const publishing = new PublishingRepository(sql);
  const reviews = new ContentPackageReviewRepository(sql);
  const drafts = new DraftRepository(sql);
  const preparations = new CampaignPreparationRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({
    email: `package-rights-expiry-${randomUUID()}@market-me.local`, displayName: "Package rights expiry QA",
  });
  const cleanup = async () => {
    await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
    await sql`DELETE FROM app_user WHERE id = ${user.id}`;
  };
  try {
    const source = await core.createSmartSource({
      workspaceId: workspace.workspaceId, name: "Package rights expiry fixture", provider: "local",
      locations: [{ providerLocationId: "fixture", displayPath: "/PackageRightsExpiryQA" }], recursive: false,
      readinessMode: "immediate", stabilizationWindowSeconds: 0, allowedMimeTypes: ["text/plain"],
      ignorePatterns: [], contextPackIds: [], autonomyMode: "draft_only", enabled: false,
    }, user.id);
    await core.applySourceItemChanges({
      workspaceId: workspace.workspaceId, smartSourceId: source.id, deletedProviderItemIds: [],
      upserts: [{ workspaceId: workspace.workspaceId, smartSourceId: source.id, providerItemId: "facts", name: "facts.txt",
        displayPath: "/PackageRightsExpiryQA/facts.txt", mimeType: "text/plain", isFolder: false,
        contentHash: "sha256:package-rights-expiry-fixture" }],
    });
    const item = (await core.getSourceItemByProviderId(source.id, "facts"))!;
    const contentPackage = await core.saveContentPackage({
      workspaceId: workspace.workspaceId, smartSourceId: source.id, rootSourceItemId: item.id,
      title: "Time-bounded reviewed package", status: "ready", contextPackVersionIds: [], assets: [], conflicts: [],
      evidence: [{ id: randomUUID(), claim: "Admission is free", provenance: "authoritative_context",
        sourceReferences: [`source-item:${item.id}`], confidence: 1 }],
    });
    const assetId = randomUUID();
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM content_package WHERE id = ${contentPackage.id} FOR UPDATE`;
      await tx`INSERT INTO content_asset(id, content_package_id, source_item_id, role, file_name, mime_type, content_hash,
        extraction_status, metadata, object_key, byte_size, media_status, scan_status, scan_engine, scan_scanned_at,
        scan_revision, rights_status, alt_text, alt_text_status)
        VALUES (${assetId}, ${contentPackage.id}, ${item.id}, 'original', 'time-bound.png', 'image/png', 'sha256:time-bound-original',
          'skipped', '{}'::jsonb, ${`originals/${"c".repeat(64)}/time-bound.png`}, 4, 'processed', 'clean', 'clamd-test',
          clock_timestamp(), 1, 'unchecked', 'A time-bounded launch graphic.', 'approved')`;
    });
    const connection = await publishing.saveChannelConnection({
      workspaceId: workspace.workspaceId, provider: "discord_webhook", name: "Time-bounded account",
      encryptedCredentials: "synthetic-expiry-envelope",
      capabilities: DISCORD_WEBHOOK_CAPABILITIES as unknown as Record<string, unknown>,
    }, user.id);
    const compiled = compileGeneralAnnouncementPreparation({
      workspaceId: workspace.workspaceId, contentPackageId: contentPackage.id, expectedPackageVersion: contentPackage.version,
    });
    const campaign = await campaigns.createCampaign(compiled.campaign, user.id);
    await campaigns.publishCampaign(workspace.workspaceId, campaign.id);
    return { core, campaigns, reviews, drafts, preparations, user, workspace, contentPackage, assetId, connection, campaign, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

type Fixture = Awaited<ReturnType<typeof makeFixture>>;
async function withFixture(run: (fixture: Fixture) => Promise<void>) {
  const fixture = await makeFixture();
  try { await run(fixture); } finally { await fixture.cleanup(); }
}

function rightsDecision(fixture: Fixture, window: { validFrom?: string; expiresAt?: string }) {
  return {
    workspaceId: fixture.workspace.workspaceId,
    packageId: fixture.contentPackage.id,
    assetId: fixture.assetId,
    status: "cleared" as const,
    owner: "Synthetic rights owner",
    sourceReference: "source:package-rights-expiry",
    proofReference: "proof:package-rights-expiry",
    commercialUseAllowed: true,
    derivativeUseAllowed: true,
    worldwideUseAllowed: true,
    permittedChannels: ["discord_webhook"] as const,
    permittedChannelConnectionIds: [fixture.connection.id],
    permittedCampaignIds: [],
    permittedBrandProfileIds: [],
    reviewNote: "Synthetic time-bound clearance for database-clock acceptance.",
    ...window,
  };
}

async function rightsState(fixture: Fixture) {
  return (await sql<{ rightsStatus: string; rightsRevision: number; rightsReviewedAt: string | null;
    scopeCount: number; rightsAudits: number; packageStatus: string; currentApprovalId: string | null }[]>`
    SELECT asset.rights_status, asset.rights_revision, asset.rights_reviewed_at,
      (SELECT count(*)::integer FROM content_asset_rights_channel_connection scope
        WHERE scope.content_asset_id = asset.id) AS scope_count,
      (SELECT count(*)::integer FROM audit_event audit WHERE audit.workspace_id = package.workspace_id
        AND audit.event_type = 'content_asset.rights_reviewed') AS rights_audits,
      package.status AS package_status, package.current_approval_id
    FROM content_asset asset JOIN content_package package ON package.id = asset.content_package_id
    WHERE asset.id = ${fixture.assetId}`)[0]!;
}

async function consumerCounts(workspaceId: string) {
  return (await sql<Record<string, number>[]>`
    SELECT
      (SELECT count(*)::integer FROM campaign WHERE workspace_id = ${workspaceId}) AS campaigns,
      (SELECT count(*)::integer FROM campaign_version version JOIN campaign ON campaign.id = version.campaign_id
        WHERE campaign.workspace_id = ${workspaceId}) AS campaign_versions,
      (SELECT count(*)::integer FROM campaign_preparation WHERE workspace_id = ${workspaceId}) AS preparations,
      (SELECT count(*)::integer FROM draft_generation WHERE workspace_id = ${workspaceId}) AS generations,
      (SELECT count(*)::integer FROM content_draft WHERE workspace_id = ${workspaceId}) AS drafts,
      (SELECT count(*)::integer FROM content_draft_version version JOIN content_draft draft ON draft.id = version.content_draft_id
        WHERE draft.workspace_id = ${workspaceId}) AS draft_versions,
      (SELECT count(*)::integer FROM content_draft_claim claim JOIN content_draft_version version ON version.id = claim.content_draft_version_id
        JOIN content_draft draft ON draft.id = version.content_draft_id WHERE draft.workspace_id = ${workspaceId}) AS claims,
      (SELECT count(*)::integer FROM content_draft_claim_evidence binding JOIN content_draft_claim claim ON claim.id = binding.content_draft_claim_id
        JOIN content_draft_version version ON version.id = claim.content_draft_version_id
        JOIN content_draft draft ON draft.id = version.content_draft_id WHERE draft.workspace_id = ${workspaceId}) AS claim_bindings,
      (SELECT count(*)::integer FROM audit_event WHERE workspace_id = ${workspaceId}) AS audits
  `)[0]!;
}

describe.skipIf(!databaseUrl)("database-clock Content Package rights expiry", () => {
  beforeAll(() => { sql = createDatabaseClient(databaseUrl!, { max: 4 }); });
  afterAll(async () => { await sql?.end(); });

  it("rejects valid-from future and expiration-at-current-database-time without partial rights writes", async () => withFixture(async (f) => {
    const boundary = (await sql<{ now: string; future: string }[]>`
      SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now,
        to_char((clock_timestamp() + interval '1 day') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS future`)[0]!;
    const before = await rightsState(f);
    for (const window of [{ validFrom: boundary.future }, { expiresAt: boundary.now }]) {
      await expect(f.core.reviewAssetRights({
        ...rightsDecision(f, window),
        ...await packageReviewPrecondition(sql, f.workspace.workspaceId, f.contentPackage.id, f.user.id),
      }, f.user.id)).rejects.toMatchObject({ code: "invalid_review_input" });
      expect(await rightsState(f)).toEqual(before);
    }
    const databaseNow = (await sql<{ now: string }[]>`
      SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`)[0]!.now;
    expect(boundary.future > databaseNow).toBe(true);
    expect(boundary.now <= databaseNow).toBe(true);
  }));

  it("invalidates an unchanged approval through expiry and blocks generation and preparation without writes", async () => withFixture(async (f) => {
    const expiresAt = (await sql<{ instant: string }[]>`
      SELECT to_char((clock_timestamp() + interval '10 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS instant`)[0]!.instant;
    await f.core.reviewAssetRights({
      ...rightsDecision(f, { expiresAt }),
      ...await packageReviewPrecondition(sql, f.workspace.workspaceId, f.contentPackage.id, f.user.id),
    }, f.user.id);
    const approvalInput = await packageReviewPrecondition(sql, f.workspace.workspaceId, f.contentPackage.id, f.user.id);
    const approval = await f.core.approveContentPackage({
      ...approvalInput, workspaceId: f.workspace.workspaceId, packageId: f.contentPackage.id,
      actorUserId: f.user.id, idempotencyKey: randomUUID(),
    });
    const current = (await f.reviews.getReview(f.workspace.workspaceId, f.contentPackage.id, f.user.id))!;
    expect(current.currentApprovalValid).toBe(true);
    expect(current.blockers).toEqual([]);
    expect(current.reviewFingerprint).toBe(approval.approval.reviewFingerprint);
    const before = await consumerCounts(f.workspace.workspaceId);

    await expect.poll(async () => (await sql<{ expired: boolean }[]>`
      SELECT clock_timestamp() >= ${expiresAt}::text::timestamptz AS expired`)[0]!.expired,
    { timeout: 20_000, interval: 50 }).toBe(true);

    const expired = (await f.reviews.getReview(f.workspace.workspaceId, f.contentPackage.id, f.user.id))!;
    expect(expired.status).toBe("approved");
    expect(expired.reviewFingerprint).toBe(current.reviewFingerprint);
    expect(expired.currentApproval?.id).toBe(approval.approval.id);
    expect(expired.currentApprovalValid).toBe(false);
    expect(expired.evaluatedAt >= expiresAt).toBe(true);
    expect(expired.blockers).toEqual([
      expect.objectContaining({ code: "rights_expired", assetId: f.assetId }),
    ]);

    const generationInput = await packageGenerationPrecondition(sql, f.workspace.workspaceId, f.contentPackage.id, f.user.id);
    await expect(f.drafts.generate({
      ...generationInput, workspaceId: f.workspace.workspaceId, campaignId: f.campaign.id,
      contentPackageId: f.contentPackage.id, draftFormat: "social_standard",
    }, f.user.id)).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ code: "approval_unavailable" })]),
    });
    expect(await consumerCounts(f.workspace.workspaceId)).toEqual(before);

    const preparationKey = randomUUID();
    await expect(f.preparations.prepare({
      workspaceId: f.workspace.workspaceId, contentPackageId: f.contentPackage.id,
      expectedPackageVersion: f.contentPackage.version,
    }, preparationKey, f.user.id, { expectedReviewFingerprint: current.reviewFingerprint }))
      .rejects.toMatchObject({ code: "approval_unavailable" });
    expect(await f.preparations.getByKey(f.workspace.workspaceId, preparationKey, f.user.id)).toBeUndefined();
    expect(await consumerCounts(f.workspace.workspaceId)).toEqual(before);
  }), 30_000);
});
