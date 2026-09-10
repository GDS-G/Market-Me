import { createHash, randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CampaignRepository } from "./campaign-repository";
import { normalizeCampaignFinalizationInput } from "./campaign-finalization-template";
import { compileGeneralAnnouncementPreparation } from "./campaign-preparation-template";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { loadExactTextPreviewInTransaction } from "./exact-preview-repository";
import { makeCampaignFinalizationFixture, finalizationBrandInput, finalizationAudienceInput,
  type CampaignFinalizationFixture as Fixture, type FinalizationFixtureOptions } from "./test-support/campaign-finalization-fixture";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!name.startsWith("market_me_qa_") && name !== "market_me_ci") {
    throw new Error("Finalization integration tests require an isolated market_me_qa_* or market_me_ci database.");
  }
}
let sql: DatabaseClient;
const network = vi.fn(() => { throw new Error("No provider or external network is permitted in finalization tests."); });
async function withFixture(run: (fixture: Fixture) => Promise<void>, options: FinalizationFixtureOptions = {}) {
  const fixture = await makeCampaignFinalizationFixture(sql, options);
  try { await run(fixture); expect(network).not.toHaveBeenCalled(); } finally { await fixture.cleanup(); }
}
async function counts(workspaceId: string) {
  return (await sql<Record<string, number>[]>`
    SELECT
      (SELECT count(*)::integer FROM campaign_finalization WHERE workspace_id = ${workspaceId}) AS finalizations,
      (SELECT count(*)::integer FROM campaign WHERE workspace_id = ${workspaceId}) AS campaigns,
      (SELECT count(*)::integer FROM campaign_version v JOIN campaign c ON c.id = v.campaign_id WHERE c.workspace_id = ${workspaceId}) AS versions,
      (SELECT count(*)::integer FROM campaign_version v JOIN campaign c ON c.id = v.campaign_id WHERE c.workspace_id = ${workspaceId} AND v.status = 'draft') AS editable_versions,
      (SELECT count(*)::integer FROM draft_generation WHERE workspace_id = ${workspaceId}) AS generations,
      (SELECT count(*)::integer FROM content_draft WHERE workspace_id = ${workspaceId}) AS drafts,
      (SELECT count(*)::integer FROM campaign_instance WHERE workspace_id = ${workspaceId}) AS instances,
      (SELECT count(*)::integer FROM campaign_workflow_command WHERE workspace_id = ${workspaceId}) AS commands,
      (SELECT count(*)::integer FROM publication_action WHERE workspace_id = ${workspaceId}) AS publications,
      (SELECT count(*)::integer FROM campaign_approval WHERE workspace_id = ${workspaceId}) AS campaign_approvals,
      (SELECT count(*)::integer FROM content_draft_approval WHERE workspace_id = ${workspaceId}) AS draft_approvals,
      (SELECT count(*)::integer FROM audit_event WHERE workspace_id = ${workspaceId} AND event_type = 'campaign.finalized') AS finalization_audits
  `)[0]!;
}
const baseline = { finalizations: 0, campaigns: 1, versions: 1, editableVersions: 0, generations: 1, drafts: 2,
  instances: 0, commands: 0, publications: 0, campaignApprovals: 0, draftApprovals: 1, finalizationAudits: 0 };
const finalized = { ...baseline, finalizations: 1, versions: 2, editableVersions: 1, finalizationAudits: 1 };

const revocations = [
  { name: "membership", code: "access_denied", change: (tx: TransactionSql, f: Fixture) => tx`
    UPDATE workspace_membership SET role = 'viewer' WHERE workspace_id = ${f.workspace.workspaceId} AND user_id = ${f.user.id}` },
  { name: "package", code: "package_not_approved", change: (tx: TransactionSql, f: Fixture) => tx`
    UPDATE content_package SET status = 'ready' WHERE id = ${f.contentPackage.id}` },
  { name: "brand", code: "brand_unavailable", change: (tx: TransactionSql, f: Fixture) => tx`
    UPDATE brand_profile SET status = 'archived' WHERE id = ${f.brand.id}` },
  { name: "audience", code: "audience_unavailable", change: (tx: TransactionSql, f: Fixture) => tx`
    UPDATE audience_profile SET status = 'archived' WHERE id = ${f.audienceA.id}` },
  { name: "destination", code: "preview_ineligible", change: (tx: TransactionSql, f: Fixture) => tx`
    UPDATE destination SET status = 'draft' WHERE id = ${f.destination.id}` },
  { name: "connection", code: "preview_ineligible", change: (tx: TransactionSql, f: Fixture) => tx`
    UPDATE channel_connection SET status = 'error' WHERE id = ${f.connection.id}` },
  { name: "approval", code: "preview_ineligible", change: (tx: TransactionSql, f: Fixture) => tx`
    UPDATE content_draft_approval SET status = 'rejected' WHERE id = ${f.approval.id}` },
  { name: "preview", code: "preview_changed", change: (tx: TransactionSql, f: Fixture) => tx`
    UPDATE draft_channel_preview SET created_at = created_at + interval '1 microsecond' WHERE id = ${f.preview.id}` },
] as const;
async function blockedOn(holderPid: number) {
  await expect.poll(async () => (await sql<{ blocked: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
      AND ${holderPid} = ANY(pg_blocking_pids(pid))) AS blocked
  `)[0]!.blocked, { timeout: 3_000, interval: 20 }).toBe(true);
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe.skipIf(!databaseUrl)("atomic exact-preview campaign finalization", () => {
  beforeAll(() => { sql = createDatabaseClient(databaseUrl!); vi.stubGlobal("fetch", network); });
  afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await sql?.end(); });

  it("atomically inserts an unpublished executable draft for one reviewed audience revision and exact immutable receipt", async () => withFixture(async (f) => {
    expect(await counts(f.workspace.workspaceId)).toEqual(baseline);
    const { finalization: receipt, replayed } = await f.finalizations.finalize(f.input, f.key, f.user.id);
    expect(replayed).toBe(false);
    expect(receipt).toMatchObject({ workspaceId: f.workspace.workspaceId, idempotencyKey: f.key,
      preparationId: f.receipt.id, campaignId: f.receipt.campaignId, planningVersionId: f.receipt.planningVersionId,
      contentDraftId: f.approvedDraft.id, contentDraftVersionId: f.approvedDraft.currentVersion.id,
      draftChannelPreviewId: f.preview.id, previewFingerprint: f.exact.token, templateVersion: 1, createdBy: f.user.id });
    expect(receipt.contentDraftVersionId).not.toBe(f.receipt.preparedDrafts[1]!.versionId);
    expect(f.approvedDraft.audienceProfileVersionId).toBe(f.audienceVersionA.id);
    expect(receipt.canonicalPreviewSnapshot).toEqual(f.exact.snapshot);
    expect(receipt.canonicalPreviewSnapshot.preview.capabilitySnapshot.supportedActions).toHaveProperty("publish_content", true);
    expect(receipt.canonicalPreviewSnapshot.preview.capabilityObservedAtUtcMicros).toBe("2026-01-01T00:00:00.123456Z");
    expect(receipt.configurationHash).toBe(createHash("sha256").update(normalizeCampaignFinalizationInput(f.input).canonicalPayload, "utf8").digest("hex"));
    expect(receipt.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
    expect(receipt).not.toHaveProperty("canonicalInput");
    const campaign = (await f.campaigns.getCampaign(f.workspace.workspaceId, f.receipt.campaignId))!;
    expect(campaign.currentVersion).toMatchObject({ id: f.receipt.planningVersionId, status: "published", autonomyMode: "draft_only" });
    expect(campaign.draftVersion).toMatchObject({ id: receipt.finalizedVersionId, versionNumber: 2, status: "draft", autonomyMode: "approval_required",
      audienceProfileVersionIds: [f.audienceVersionB.id, f.audienceVersionA.id] });
    expect(campaign.draftVersion!.steps).toHaveLength(1);
    expect(campaign.draftVersion!.steps[0]).toMatchObject({ id: "publish_prepared_preview", operationType: "publish_content", approvalRequired: true,
      executionMethods: ["official_api"], inputs: { draftChannelPreviewId: f.preview.id, draftChannelPreviewFingerprint: f.exact.token, channelConnectionId: f.connection.id } });
    expect(receipt.compiledDefinition.steps).toHaveLength(1);
    expect(receipt.compiledDefinition.context).toEqual({});
    expect(await f.finalizations.get(f.workspace.workspaceId, receipt.id, f.user.id)).toEqual(receipt);
    expect(await f.finalizations.getByKey(f.workspace.workspaceId, f.key, f.user.id)).toEqual(receipt);
    expect(await f.finalizations.getForCampaign(f.workspace.workspaceId, receipt.campaignId, f.user.id)).toEqual(receipt);
    expect(await counts(f.workspace.workspaceId)).toEqual(finalized);
  }));

  it.each(["discord_webhook", "slack_webhook", "mastodon_account"] as const)("accepts a reviewed %s tracked text preview with its trusted origin", async (provider) => withFixture(async (f) => {
    const result = await f.finalizations.finalize(f.input, f.key, f.user.id);
    expect(result.finalization.canonicalPreviewSnapshot.preview.provider).toBe(provider);
    expect(result.finalization.canonicalPreviewSnapshot.trackedLink).toMatchObject({
      publicRedirectUrl: expect.stringContaining(`${f.appBaseUrl}/r/`), campaignInstanceId: null, campaignStepRunId: null });
    expect(await counts(f.workspace.workspaceId)).toEqual(finalized);
  }, { provider, linkMode: "tracked" }));

  it("serializes five identical attempts and replays the original result after mutable references change", async () => withFixture(async (f) => {
    const results = await Promise.all(Array.from({ length: 5 }, () => f.finalizations.finalize(f.input, f.key, f.user.id)));
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(new Set(results.map((result) => result.finalization.id)).size).toBe(1);
    const original = results[0]!.finalization;
    await f.core.saveContentPackage({ ...f.packageInput, evidence: [{ id: randomUUID(), claim: "The announcement changed.", provenance: "observed", sourceReferences: ["revision:2"] }] });
    await sql`UPDATE brand_profile SET status = 'archived', name = 'Changed brand' WHERE id = ${f.brand.id}`;
    await sql`UPDATE audience_profile SET status = 'archived' WHERE id = ${f.audienceA.id}`;
    await sql`UPDATE destination SET status = 'draft', canonical_url = 'https://example.test/changed' WHERE id = ${f.destination.id}`;
    await sql`UPDATE channel_connection SET status = 'error' WHERE id = ${f.connection.id}`;
    await sql`UPDATE draft_channel_preview SET status = 'blocked' WHERE id = ${f.preview.id}`;
    expect(await f.finalizations.finalize({ ...f.input, templateVersion: 1 }, f.key.toUpperCase(), f.user.id))
      .toEqual({ finalization: original, replayed: true });
    expect(await counts(f.workspace.workspaceId)).toEqual(finalized);
  }));

  it("conflicts on changed intent and refuses a second receipt for the same preparation under another key", async () => withFixture(async (f) => {
    const first = (await f.finalizations.finalize(f.input, f.key, f.user.id)).finalization;
    await expect(f.finalizations.finalize({ ...f.input, timing: { type: "exact_time", scheduledAt: "2099-01-01T00:00:00Z" } }, f.key, f.user.id))
      .rejects.toMatchObject({ code: "idempotency_conflict", existingFinalizationId: first.id });
    await expect(f.finalizations.finalize(f.input, randomUUID(), f.user.id))
      .rejects.toMatchObject({ code: "already_finalized", existingFinalizationId: first.id });
    expect(await counts(f.workspace.workspaceId)).toEqual(finalized);
  }));

  it("serializes different keys for the same preparation without orphan drafts", async () => withFixture(async (f) => {
    const results = await Promise.allSettled([f.key, randomUUID()].map((key) => f.finalizations.finalize(f.input, key, f.user.id)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "already_finalized" } });
    expect(await counts(f.workspace.workspaceId)).toEqual(finalized);
  }));

  it.each(["owner", "admin", "editor", "approver", "analyst", "viewer"])("requires a current writer role for finalization (%s)", async (role) => withFixture(async (f) => {
    await sql`UPDATE workspace_membership SET role = ${role} WHERE workspace_id = ${f.workspace.workspaceId} AND user_id = ${f.user.id}`;
    if (["owner", "admin", "editor"].includes(role)) {
      expect((await f.finalizations.finalize(f.input, f.key, f.user.id)).replayed).toBe(false);
      expect(await counts(f.workspace.workspaceId)).toEqual(finalized);
    } else {
      await expect(f.finalizations.finalize(f.input, f.key, f.user.id)).rejects.toMatchObject({ code: "access_denied" });
      expect(await counts(f.workspace.workspaceId)).toEqual(baseline);
    }
  }));

  it("allows viewer receipt and selection reads but requires current writer access on completed replay", async () => withFixture(async (f) => {
    const receipt = (await f.finalizations.finalize(f.input, f.key, f.user.id)).finalization;
    await sql`UPDATE workspace_membership SET role = 'viewer' WHERE workspace_id = ${f.workspace.workspaceId} AND user_id = ${f.user.id}`;
    expect(await f.finalizations.get(f.workspace.workspaceId, receipt.id, f.user.id)).toEqual(receipt);
    expect(await f.finalizations.getPreviewSelection(f.workspace.workspaceId, f.receipt.id, f.preview.id, f.user.id)).toEqual(f.exact);
    await expect(f.finalizations.finalize(f.input, f.key, f.user.id)).rejects.toMatchObject({ code: "access_denied" });
    await sql`DELETE FROM workspace_membership WHERE workspace_id = ${f.workspace.workspaceId} AND user_id = ${f.user.id}`;
    expect(await f.finalizations.get(f.workspace.workspaceId, receipt.id, f.user.id)).toBeUndefined();
    expect(await f.finalizations.getByKey(f.workspace.workspaceId, f.key, f.user.id)).toBeUndefined();
    expect(await f.finalizations.getForCampaign(f.workspace.workspaceId, receipt.campaignId, f.user.id)).toBeUndefined();
    expect(await f.finalizations.getPreviewSelection(f.workspace.workspaceId, f.receipt.id, f.preview.id, f.user.id)).toBeUndefined();
    await expect(f.finalizations.finalize(f.input, f.key, f.user.id)).rejects.toMatchObject({ code: "access_denied" });
  }));

  it("scopes receipt reads, preview selection and the same retry key to authorized workspaces", async () => withFixture(async (f) => withFixture(async (foreign) => {
    const receipt = (await f.finalizations.finalize(f.input, f.key, f.user.id)).finalization;
    expect((await foreign.finalizations.finalize(foreign.input, f.key, foreign.user.id)).finalization.id).not.toBe(receipt.id);
    expect(await f.finalizations.get(foreign.workspace.workspaceId, receipt.id, foreign.user.id)).toBeUndefined();
    expect(await f.finalizations.getByKey(f.workspace.workspaceId, f.key, foreign.user.id)).toBeUndefined();
    expect(await f.finalizations.getForCampaign(f.workspace.workspaceId, receipt.campaignId, foreign.user.id)).toBeUndefined();
    expect(await f.finalizations.getPreviewSelection(f.workspace.workspaceId, f.receipt.id, f.preview.id, foreign.user.id)).toBeUndefined();
    expect(await f.finalizations.getPreviewSelection(f.workspace.workspaceId, foreign.receipt.id, f.preview.id, f.user.id)).toBeUndefined();
    expect(await f.finalizations.getPreviewSelection(f.workspace.workspaceId, f.receipt.id, foreign.preview.id, f.user.id)).toBeUndefined();
  })));

  it.each(["workspace", "preparation", "draft", "preview", "planningVersion", "draftVersion"])("rejects a foreign %s pin without partial writes", async (kind) => withFixture(async (f) => withFixture(async (foreign) => {
    const changed = kind === "workspace" ? { workspaceId: foreign.workspace.workspaceId }
      : kind === "preparation" ? { preparationId: foreign.receipt.id }
        : kind === "draft" ? { draftId: foreign.approvedDraft.id }
          : kind === "preview" ? { previewId: foreign.preview.id, expectedPreviewFingerprint: foreign.exact.token }
            : kind === "planningVersion" ? { expectedPlanningVersionId: foreign.receipt.planningVersionId }
              : { expectedDraftVersionId: foreign.approvedDraft.currentVersion.id };
    await expect(f.finalizations.finalize({ ...f.input, ...changed }, f.key, f.user.id)).rejects.toThrow();
    expect(await counts(f.workspace.workspaceId)).toEqual(baseline);
    expect(await counts(foreign.workspace.workspaceId)).toEqual(baseline);
  })));

  it("rejects an approved same-campaign draft from a later generation outside the original prepared draft set", async () => withFixture(async (f) => {
    const later = (await f.drafts.generate({ workspaceId: f.workspace.workspaceId, campaignId: f.receipt.campaignId, contentPackageId: f.contentPackage.id }, f.user.id))[0]!;
    await f.drafts.submit(f.workspace.workspaceId, later.id, f.user.id);
    const approval = (await f.drafts.listApprovals(f.workspace.workspaceId)).find((row) => row.contentDraftId === later.id)!;
    await f.drafts.decide({ workspaceId: f.workspace.workspaceId, approvalId: approval.id, decision: "approved", actorUserId: f.user.id });
    const preview = (await f.drafts.createChannelPreview({ ...f.previewInput, draftId: later.id }))!;
    expect(await f.finalizations.getPreviewSelection(f.workspace.workspaceId, f.receipt.id, preview.id, f.user.id)).toBeUndefined();
    const before = await counts(f.workspace.workspaceId);
    // Even a genuinely valid current token cannot turn later generation into original lineage.
    const exact = await sql.begin((tx) => loadExactTextPreviewInTransaction(tx, { workspaceId: f.workspace.workspaceId, previewId: preview.id }, { appBaseUrl: f.appBaseUrl }));
    await expect(f.finalizations.finalize({ ...f.input, draftId: later.id, expectedDraftVersionId: later.currentVersion.id,
      previewId: preview.id, expectedPreviewFingerprint: exact.token }, f.key, f.user.id))
      .rejects.toMatchObject({ name: "CampaignFinalizationTemplateValidationError", issues: [expect.objectContaining({ code: "lineage_mismatch" })] });
    expect(await counts(f.workspace.workspaceId)).toEqual(before);
  }));

  it("rejects a valid approved preview from a different preparation in the same authorized workspace", async () => withFixture(async (f) => {
    const second = (await f.preparations.prepare(f.preparationInput, randomUUID(), f.user.id)).preparation;
    expect(await f.finalizations.getPreviewSelection(f.workspace.workspaceId, second.id, f.preview.id, f.user.id)).toBeUndefined();
    const before = await counts(f.workspace.workspaceId);
    await expect(f.finalizations.finalize({ ...f.input, preparationId: second.id, expectedPlanningVersionId: second.planningVersionId }, f.key, f.user.id))
      .rejects.toMatchObject({ name: "CampaignFinalizationTemplateValidationError", issues: [expect.objectContaining({ code: "lineage_mismatch" })] });
    expect(await counts(f.workspace.workspaceId)).toEqual(before);
  }));

  it("accepts an original approved generation version without requiring a presentation revision", async () => withFixture(async (f) => {
    const result = await f.finalizations.finalize(f.input, f.key, f.user.id);
    expect(result.finalization.contentDraftVersionId).toBe(f.receipt.preparedDrafts[1]!.versionId);
    expect(await counts(f.workspace.workspaceId)).toEqual(finalized);
  }, { revise: false }));

  it("finalizes optional-default preparation without inferring profiles, audiences or a Destination", async () => withFixture(async (f) => {
    const preparation = (await f.preparations.prepare({ workspaceId: f.workspace.workspaceId,
      contentPackageId: f.contentPackage.id, expectedPackageVersion: f.contentPackage.version }, randomUUID(), f.user.id)).preparation;
    const draft = preparation.preparedDrafts[0]!;
    expect(preparation.preparedDrafts).toHaveLength(1);
    await f.drafts.submit(f.workspace.workspaceId, draft.draftId, f.user.id);
    const approval = (await f.drafts.listApprovals(f.workspace.workspaceId)).find((row) => row.contentDraftId === draft.draftId)!;
    await f.drafts.decide({ workspaceId: f.workspace.workspaceId, approvalId: approval.id, decision: "approved", actorUserId: f.user.id });
    const preview = (await f.drafts.createChannelPreview({ workspaceId: f.workspace.workspaceId, draftId: draft.draftId,
      channelConnectionId: f.connection.id, actorUserId: f.user.id }))!;
    const exact = (await f.finalizations.getPreviewSelection(f.workspace.workspaceId, preparation.id, preview.id, f.user.id))!;
    const before = await counts(f.workspace.workspaceId);
    const result = await f.finalizations.finalize({ workspaceId: f.workspace.workspaceId, preparationId: preparation.id,
      expectedPlanningVersionId: preparation.planningVersionId, draftId: draft.draftId, expectedDraftVersionId: draft.versionId,
      previewId: preview.id, expectedPreviewFingerprint: exact.token, timing: { type: "immediate" } }, f.key, f.user.id);
    expect(result.finalization.compiledDefinition).toMatchObject({ audienceProfileVersionIds: [], informationDepth: "contextual", promotionalStrength: "informational" });
    expect(result.finalization.compiledDefinition).not.toHaveProperty("brandProfileVersionId");
    expect(result.finalization.compiledDefinition).not.toHaveProperty("destinationId");
    expect(result.finalization.canonicalPreviewSnapshot.destination).toBeNull();
    expect(await counts(f.workspace.workspaceId)).toEqual({ ...before, finalizations: 1, versions: before.versions! + 1,
      editableVersions: 1, finalizationAudits: 1 });
  }));

  it("keeps typed preview eligibility errors on the authorized selection read", async () => withFixture(async (f) => {
    await sql`UPDATE content_draft_approval SET status = 'rejected' WHERE id = ${f.approval.id}`;
    await expect(f.finalizations.getPreviewSelection(f.workspace.workspaceId, f.receipt.id, f.preview.id, f.user.id))
      .rejects.toMatchObject({ name: "ExactPreviewReadError", code: "preview_ineligible" });
  }));

  it("rejects a changed package revision even when the replacement package was reapproved", async () => withFixture(async (f) => {
    await f.core.saveContentPackage({ ...f.packageInput, evidence: [{ id: randomUUID(), claim: "A replacement fact.", provenance: "observed", sourceReferences: ["revision:2"] }] });
    await f.core.approveContentPackage({ workspaceId: f.workspace.workspaceId, packageId: f.contentPackage.id, actorUserId: f.user.id });
    await expect(f.finalizations.finalize(f.input, f.key, f.user.id)).rejects.toMatchObject({ code: "package_version_mismatch" });
    expect(await counts(f.workspace.workspaceId)).toEqual(baseline);
  }));

  it.each(["brand", "audience"] as const)("requires the original %s pin to remain current and published", async (kind) => withFixture(async (f) => {
    if (kind === "brand") {
      await f.profiles.saveBrandProfileDraft(f.brand.id, { ...finalizationBrandInput(f.workspace.workspaceId), name: "Replacement brand" }, f.user.id);
      await f.profiles.publishBrandProfile(f.workspace.workspaceId, f.brand.id, f.user.id);
    } else {
      await f.profiles.saveAudienceProfileDraft(f.audienceA.id, finalizationAudienceInput(f.workspace.workspaceId, "Replacement audience"), f.user.id);
      await f.profiles.publishAudienceProfile(f.workspace.workspaceId, f.audienceA.id, f.user.id);
    }
    await expect(f.finalizations.finalize(f.input, f.key, f.user.id)).rejects.toMatchObject({ code: `${kind}_unavailable` });
    expect(await counts(f.workspace.workspaceId)).toEqual(baseline);
  }));

  it.each(["information", "promotion"] as const)("revalidates current %s controls without changing the prepared settings", async (kind) => withFixture(async (f) => {
    if (kind === "information") await sql`UPDATE brand_profile_version SET information_depth_ceiling = 'minimal' WHERE id = ${f.brandVersion.id}`;
    else await sql`UPDATE audience_profile_version SET promotional_strength_ceiling = 'informational' WHERE id = ${f.audienceVersionB.id}`;
    await expect(f.finalizations.finalize(f.input, f.key, f.user.id)).rejects.toMatchObject({ name: "CampaignValidationError",
      issues: expect.arrayContaining([expect.objectContaining({ code: kind === "information" ? "information_depth_ceiling" : "promotional_strength_ceiling" })]) });
    expect(await counts(f.workspace.workspaceId)).toEqual(baseline);
  }, { promotionalStrength: "strong" }));

  it.each([false, true])("never overwrites an existing advanced draft or published successor (published=%s)", async (published) => withFixture(async (f) => {
    await f.campaigns.saveCampaignDraft(f.receipt.campaignId, compileGeneralAnnouncementPreparation(f.preparationInput).campaign, f.user.id);
    if (published) await f.campaigns.publishCampaign(f.workspace.workspaceId, f.receipt.campaignId);
    const before = await counts(f.workspace.workspaceId);
    await expect(f.finalizations.finalize(f.input, f.key, f.user.id)).rejects.toMatchObject({ code: "campaign_changed" });
    expect(await counts(f.workspace.workspaceId)).toEqual(before);
  }));

  it("requires reselection after same-ID preview recreation and accepts only its new exact fingerprint", async () => withFixture(async (f) => {
    const recreated = (await f.drafts.createChannelPreview(f.previewInput))!;
    expect(recreated.id).toBe(f.preview.id);
    await expect(f.finalizations.finalize(f.input, f.key, f.user.id)).rejects.toMatchObject({ code: "preview_changed" });
    expect(await counts(f.workspace.workspaceId)).toEqual(baseline);
    const current = (await f.finalizations.getPreviewSelection(f.workspace.workspaceId, f.receipt.id, f.preview.id, f.user.id))!;
    expect(current.token).not.toBe(f.exact.token);
    expect((await f.finalizations.finalize({ ...f.input, expectedPreviewFingerprint: current.token }, f.key, f.user.id)).replayed).toBe(false);
  }));

  it("requires reselection after a current connection identity changes without changing preview bytes", async () => withFixture(async (f) => {
    await sql`UPDATE channel_connection SET configuration = jsonb_set(configuration, '{channelId}', '"323456789012345678"'::jsonb) WHERE id = ${f.connection.id}`;
    await expect(f.finalizations.finalize(f.input, f.key, f.user.id)).rejects.toMatchObject({ code: "preview_changed" });
    expect(await counts(f.workspace.workspaceId)).toEqual(baseline);
  }));

  it("rolls back the inserted executable draft when a later helper failure interrupts finalization", async () => withFixture(async (f) => {
    const original = CampaignRepository.prototype.insertPreparedExecutableDraftInTransaction;
    let inserted: string | undefined;
    const spy = vi.spyOn(CampaignRepository.prototype, "insertPreparedExecutableDraftInTransaction").mockImplementationOnce(async function (this: CampaignRepository, tx, input, actor) {
      const created = await original.call(this, tx, input, actor);
      inserted = created.campaignVersionId;
      throw new Error("Controlled failure after executable draft insert");
    });
    try { await expect(f.finalizations.finalize(f.input, f.key, f.user.id)).rejects.toThrow("Controlled failure"); }
    finally { spy.mockRestore(); }
    expect(inserted).toBeDefined();
    expect(await counts(f.workspace.workspaceId)).toEqual(baseline);
    expect(await f.finalizations.getByKey(f.workspace.workspaceId, f.key, f.user.id)).toBeUndefined();
    expect((await f.finalizations.finalize(f.input, f.key, f.user.id)).replayed).toBe(false);
  }));

  it("rejects malformed retry keys without creating a partial executable draft", async () => withFixture(async (f) => {
    for (const key of [null, 1, {}, "", "invalid", "00000000-0000-0000-0000-000000000000"]) {
      await expect(f.finalizations.finalize(f.input, key, f.user.id)).rejects.toMatchObject({ code: "invalid_idempotency_key" });
    }
    expect(await counts(f.workspace.workspaceId)).toEqual(baseline);
  }));

  it.each([
    { type: "exact_time" as const, scheduledAt: "2000-01-01T00:00:00.000Z" },
    { type: "preferred_window" as const, start: "2099-01-01T00:00:00.000Z", end: "2099-01-01T01:00:00.000Z" },
  ])("retains supported explicit $type timing without activation", async (timing) => withFixture(async (f) => {
    const result = await f.finalizations.finalize({ ...f.input, timing }, f.key, f.user.id);
    expect(result.finalization.compiledDefinition.steps[0]!.scheduleType).toBe(timing.type);
    expect(await counts(f.workspace.workspaceId)).toEqual(finalized);
  }));

  it("rejects an expired preferred window and rolls back all draft, receipt and audit writes", async () => withFixture(async (f) => {
    await expect(f.finalizations.finalize({ ...f.input, timing: { type: "preferred_window", start: "2000-01-01T00:00:00Z", end: "2000-01-01T01:00:00Z" } }, f.key, f.user.id))
      .rejects.toMatchObject({ code: "window_expired" });
    expect(await counts(f.workspace.workspaceId)).toEqual(baseline);
  }));

  it("uses fresh database time after lock waits rather than transaction-start time", async () => withFixture(async (f) => {
    const end = (await sql<{ instant: string }[]>`SELECT to_char((clock_timestamp() + interval '400 milliseconds') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS instant`)[0]!.instant;
    const release = gate(), entered = gate();
    const original = CampaignRepository.prototype.insertPreparedExecutableDraftInTransaction;
    const spy = vi.spyOn(CampaignRepository.prototype, "insertPreparedExecutableDraftInTransaction").mockImplementationOnce(async function (this: CampaignRepository, tx, input, actor) {
      entered.resolve(); await release.promise; return original.call(this, tx, input, actor);
    });
    const result = f.finalizations.finalize({ ...f.input, timing: { type: "preferred_window", start: "2000-01-01T00:00:00Z", end } }, f.key, f.user.id)
      .then((value) => ({ value }), (error: unknown) => ({ error }));
    try {
      await Promise.race([entered.promise, result.then(() => { throw new Error("Finalization exited before clock gate"); })]);
      await expect.poll(async () => (await sql<{ expired: boolean }[]>`SELECT clock_timestamp() >= ${end}::text::timestamptz AS expired`)[0]!.expired,
        { timeout: 3_000, interval: 20 }).toBe(true);
    } finally { release.resolve(); await result; spy.mockRestore(); }
    expect(await result).toMatchObject({ error: { code: "window_expired" } });
    expect(await counts(f.workspace.workspaceId)).toEqual(baseline);
  }));

  it.each(revocations)("observes $name changes committed before its authorization lock", async (change) => withFixture(async (f) => {
    const release = gate();
    let acquired!: (pid: number) => void;
    const locked = new Promise<number>((resolve) => { acquired = resolve; });
    const mutation = sql.begin(async (tx) => {
      await change.change(tx, f); acquired((await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid); await release.promise;
    });
    const pid = await locked;
    const result = f.finalizations.finalize(f.input, f.key, f.user.id).then((value) => ({ value }), (error: unknown) => ({ error }));
    try { await blockedOn(pid); } finally { release.resolve(); await mutation; }
    expect(await result).toMatchObject({ error: { code: change.code } });
    expect(await counts(f.workspace.workspaceId)).toEqual(baseline);
  }));

  it.each(revocations)("holds $name read authority through its atomic receipt commit when finalization wins", async (change) => withFixture(async (f) => {
    const release = gate();
    let acquired!: (pid: number) => void;
    const locked = new Promise<number>((resolve) => { acquired = resolve; });
    const original = CampaignRepository.prototype.insertPreparedExecutableDraftInTransaction;
    const spy = vi.spyOn(CampaignRepository.prototype, "insertPreparedExecutableDraftInTransaction").mockImplementationOnce(async function (this: CampaignRepository, tx, input, actor) {
      acquired((await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid);
      await release.promise; return original.call(this, tx, input, actor);
    });
    const result = f.finalizations.finalize(f.input, f.key, f.user.id).then((value) => ({ value }), (error: unknown) => ({ error }));
    let mutation: Promise<unknown> | undefined;
    try {
      const pid = await Promise.race([locked, result.then(() => { throw new Error("Finalization exited before authorization gate"); })]);
      mutation = sql.begin(async (tx) => { await change.change(tx, f); });
      await blockedOn(pid);
    } finally { release.resolve(); await result; await mutation; spy.mockRestore(); }
    expect(await result).toMatchObject({ value: { replayed: false, finalization: { previewFingerprint: f.exact.token } } });
    expect(await counts(f.workspace.workspaceId)).toEqual(finalized);
  }));
});
