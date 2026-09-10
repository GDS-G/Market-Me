import { createHash, randomUUID } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CampaignPreparationRepository } from "./campaign-preparation-repository";
import { compileGeneralAnnouncementPreparation, type CampaignPreparationTemplateInput } from "./campaign-preparation-template";
import { CampaignRepository } from "./campaign-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { DraftRepository } from "./draft-repository";
import { ProfileRepository } from "./profile-repository";
import { MarketMeRepository } from "./repositories";
import type { BrandProfileDraftWrite, AudienceProfileDraftWrite, ContentPackageWrite } from "./models";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!name.startsWith("market_me_qa_") && name !== "market_me_ci") {
    throw new Error("Preparation integration tests require an isolated market_me_qa_* or market_me_ci database.");
  }
}
let sql: DatabaseClient;

function brandInput(workspaceId: string): BrandProfileDraftWrite {
  return { workspaceId, name: "Preparation fixture brand", description: "Synthetic reviewed brand", profile: {
    officialName: "Preparation Fixture", description: "Synthetic brand", products: [], services: [], valuePropositions: [],
    voice: { tones: ["clear"] }, terminology: { preferred: [], prohibited: [] }, style: {}, claims: [],
    evidenceRequirements: [], requiredDisclosures: [], attributionRules: [], competitorRules: [], channelPersonas: {},
  } };
}
function audienceInput(workspaceId: string, name: string): AudienceProfileDraftWrite {
  return { workspaceId, name, description: "Synthetic audience", audienceType: "community", profile: {
    purpose: "Explain the announcement", industries: [], roles: [], interests: [], locations: [], languages: ["en"],
    knowledgeLevel: "new", needs: [], motivations: [], objections: [], questions: [], preferredChannels: [], preferredFormats: [], exclusions: [],
  } };
}

async function makeFixture() {
  const core = new MarketMeRepository(sql);
  const profiles = new ProfileRepository(sql);
  const campaigns = new CampaignRepository(sql);
  const preparation = new CampaignPreparationRepository(sql);
  const drafts = new DraftRepository(sql);
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({
    email: `preparation-qa-${randomUUID()}@market-me.local`, displayName: "Preparation QA",
  });
  const cleanup = async () => {
    await sql`DELETE FROM campaign_preparation WHERE workspace_id = ${workspace.workspaceId}`;
    await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
    await sql`DELETE FROM app_user WHERE id = ${user.id}`;
  };
  try {
    const source = await core.createSmartSource({
      workspaceId: workspace.workspaceId, name: "Preparation fixture source", provider: "local",
      locations: [{ providerLocationId: "fixture", displayPath: "/Fixtures" }], recursive: false,
      readinessMode: "immediate", stabilizationWindowSeconds: 0, allowedMimeTypes: ["text/plain"],
      ignorePatterns: [], contextPackIds: [], autonomyMode: "draft_only", enabled: true,
    }, user.id);
    await core.applySourceItemChanges({ workspaceId: workspace.workspaceId, smartSourceId: source.id,
      upserts: [{ workspaceId: workspace.workspaceId, smartSourceId: source.id, providerItemId: "announcement",
        name: "announcement.txt", displayPath: "/Fixtures/announcement.txt", mimeType: "text/plain", isFolder: false,
        contentHash: "sha256:preparation-fixture" }], deletedProviderItemIds: [] });
    const sourceItem = (await core.getSourceItemByProviderId(source.id, "announcement"))!;
    const packageInput: ContentPackageWrite = {
      workspaceId: workspace.workspaceId, smartSourceId: source.id, rootSourceItemId: sourceItem.id,
      title: "Reviewed community announcement", status: "ready", contextPackVersionIds: [], assets: [], conflicts: [],
      evidence: [
        { id: randomUUID(), claim: "Admission is free.", provenance: "authoritative_context", sourceReferences: [`source-item:${sourceItem.id}`], confidence: 1 },
        { id: randomUUID(), claim: "The event begins at noon.", provenance: "observed", sourceReferences: [`source-item:${sourceItem.id}`], confidence: 1 },
      ],
    };
    const contentPackage = await core.saveContentPackage(packageInput);
    await core.approveContentPackage({ workspaceId: workspace.workspaceId, packageId: contentPackage.id, actorUserId: user.id });
    const brand = await profiles.createBrandProfile(brandInput(workspace.workspaceId), user.id);
    const brandVersion = (await profiles.publishBrandProfile(workspace.workspaceId, brand.id, user.id))!.currentVersion!;
    const audienceA = await profiles.createAudienceProfile(audienceInput(workspace.workspaceId, "First audience"), user.id);
    const audienceB = await profiles.createAudienceProfile(audienceInput(workspace.workspaceId, "Second audience"), user.id);
    const audienceVersionA = (await profiles.publishAudienceProfile(workspace.workspaceId, audienceA.id, user.id))!.currentVersion!;
    const audienceVersionB = (await profiles.publishAudienceProfile(workspace.workspaceId, audienceB.id, user.id))!.currentVersion!;
    const destination = await campaigns.saveDestination({
      workspaceId: workspace.workspaceId, provider: "manual", canonicalUrl: "https://example.test/preparation",
      knownRedirects: [], title: "Reviewed landing page", description: "Synthetic destination", contentType: "web_page",
      identifiers: {}, topics: [], audiences: [], geography: [], status: "published", tracking: {},
    }, user.id);
    const input: CampaignPreparationTemplateInput = {
      workspaceId: workspace.workspaceId, contentPackageId: contentPackage.id, expectedPackageVersion: contentPackage.version,
      brandProfileVersionId: brandVersion.id, audienceProfileVersionIds: [audienceVersionB.id, audienceVersionA.id],
      destinationId: destination.id, informationDepth: "contextual", promotionalStrength: "informational",
    };
    return { core, profiles, campaigns, preparation, drafts, user, workspace, source, packageInput, contentPackage,
      brand, brandVersion, audienceA, audienceB, audienceVersionA, audienceVersionB, destination, input, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
type Fixture = Awaited<ReturnType<typeof makeFixture>>;
async function withFixture(run: (fixture: Fixture) => Promise<void>) {
  const fixture = await makeFixture();
  try { await run(fixture); } finally { await fixture.cleanup(); }
}
async function counts(workspaceId: string) {
  return (await sql<Record<string, number>[]>`
    SELECT
      (SELECT count(*)::integer FROM campaign_preparation WHERE workspace_id = ${workspaceId}) AS receipts,
      (SELECT count(*)::integer FROM campaign WHERE workspace_id = ${workspaceId}) AS campaigns,
      (SELECT count(*)::integer FROM draft_generation WHERE workspace_id = ${workspaceId}) AS generations,
      (SELECT count(*)::integer FROM content_draft WHERE workspace_id = ${workspaceId}) AS drafts,
      (SELECT count(*)::integer FROM campaign_instance WHERE workspace_id = ${workspaceId}) AS instances,
      (SELECT count(*)::integer FROM campaign_workflow_command WHERE workspace_id = ${workspaceId}) AS commands,
      (SELECT count(*)::integer FROM publication_action WHERE workspace_id = ${workspaceId}) AS publications,
      (SELECT count(*)::integer FROM campaign_approval WHERE workspace_id = ${workspaceId}) AS campaign_approvals,
      (SELECT count(*)::integer FROM content_draft_approval WHERE workspace_id = ${workspaceId}) AS draft_approvals,
      (SELECT count(*)::integer FROM audit_event WHERE workspace_id = ${workspaceId} AND event_type = 'campaign.prepared') AS preparation_audits,
      (SELECT count(*)::integer FROM audit_event WHERE workspace_id = ${workspaceId} AND event_type = 'draft.generated') AS generation_audits
  `)[0]!;
}
const zero = { receipts: 0, campaigns: 0, generations: 0, drafts: 0, instances: 0, commands: 0, publications: 0,
  campaignApprovals: 0, draftApprovals: 0, preparationAudits: 0, generationAudits: 0 };

const revocations = [
  { name: "membership", code: "access_denied", change: async (transaction: TransactionSql, f: Fixture) => transaction`
    UPDATE workspace_membership SET role = 'viewer' WHERE workspace_id = ${f.workspace.workspaceId} AND user_id = ${f.user.id}` },
  { name: "package", code: "package_not_approved", change: async (transaction: TransactionSql, f: Fixture) => transaction`
    UPDATE content_package SET status = 'ready' WHERE id = ${f.contentPackage.id}` },
  { name: "brand", code: "brand_unavailable", change: async (transaction: TransactionSql, f: Fixture) => transaction`
    UPDATE brand_profile SET status = 'archived' WHERE id = ${f.brand.id}` },
  { name: "audience", code: "audience_unavailable", change: async (transaction: TransactionSql, f: Fixture) => transaction`
    UPDATE audience_profile SET status = 'archived' WHERE id = ${f.audienceA.id}` },
  { name: "destination", code: "destination_unavailable", change: async (transaction: TransactionSql, f: Fixture) => transaction`
    UPDATE destination SET status = 'draft' WHERE id = ${f.destination.id}` },
] as const;

async function assertBlockedOn(holderPid: number) {
  await expect.poll(async () => (await sql<{ blocked: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_stat_activity
      WHERE datname = current_database() AND ${holderPid} = ANY(pg_blocking_pids(pid))) AS blocked
  `)[0]!.blocked, { timeout: 3_000, interval: 20 }).toBe(true);
}

describe.skipIf(!databaseUrl)("atomic review-first campaign preparation", () => {
  beforeAll(() => { sql = createDatabaseClient(databaseUrl!); });
  afterAll(async () => { vi.restoreAllMocks(); await sql?.end(); });

  it("atomically pins one planning campaign and generation, every ordered variant and exact receipt, without execution or approval", async () => withFixture(async (f) => {
    const key = randomUUID();
    const result = await f.preparation.prepare(f.input, key, f.user.id);
    const receipt = result.preparation;
    expect(result.replayed).toBe(false);
    expect(receipt).toMatchObject({ workspaceId: f.workspace.workspaceId, idempotencyKey: key,
      contentPackageId: f.contentPackage.id, contentPackageVersion: 1, createdBy: f.user.id, templateKey: "general_announcement", templateVersion: 1 });
    expect(receipt).not.toHaveProperty("canonicalPayload");
    expect(typeof receipt.createdAt).toBe("string");
    expect(new Date(receipt.createdAt).toISOString()).toBe(receipt.createdAt);
    const compiled = compileGeneralAnnouncementPreparation(f.input);
    expect(receipt.configurationSnapshot).toEqual(compiled.normalizedInput);
    expect(receipt.configurationHash).toBe(createHash("sha256").update(compiled.canonicalPayload).digest("hex"));
    expect(receipt.preparedDrafts).toHaveLength(2);
    expect(receipt.referenceSnapshot.audiences.map((audience) => audience.id)).toEqual(f.input.audienceProfileVersionIds);
    expect(receipt.referenceSnapshot.brand).toMatchObject({ id: f.brandVersion.id, rootId: f.brand.id, name: f.brand.name, versionNumber: 1 });
    const campaign = (await f.campaigns.getCampaign(f.workspace.workspaceId, receipt.campaignId))!;
    expect(campaign.currentVersion).toMatchObject({ id: receipt.planningVersionId, autonomyMode: "draft_only", contentPackageIds: [f.contentPackage.id] });
    expect(campaign.draftVersion).toBeUndefined();
    for (const [index, reference] of receipt.preparedDrafts.entries()) {
      const draft = (await f.drafts.get(f.workspace.workspaceId, reference.draftId))!;
      expect(draft).toMatchObject({ status: "working", audienceProfileVersionId: f.input.audienceProfileVersionIds![index],
        generation: { id: receipt.generationId, campaignVersionId: receipt.planningVersionId, contentPackageVersion: 1 },
        currentVersion: { id: reference.versionId, versionNumber: 1, status: "working" } });
    }
    expect(await f.preparation.get(f.workspace.workspaceId, receipt.id, f.user.id)).toEqual(receipt);
    expect(await f.preparation.getByKey(f.workspace.workspaceId, key, f.user.id)).toEqual(receipt);
    expect(await f.preparation.listForWorkspace(f.workspace.workspaceId, f.user.id)).toEqual([{ id: receipt.id, campaignId: receipt.campaignId }]);
    expect(await counts(f.workspace.workspaceId)).toEqual({ ...zero, receipts: 1, campaigns: 1, generations: 1, drafts: 2, preparationAudits: 1, generationAudits: 1 });
    await expect(f.campaigns.activateCampaign({ workspaceId: f.workspace.workspaceId, campaignId: receipt.campaignId, actorUserId: f.user.id }))
      .rejects.toMatchObject({ name: "CampaignValidationError", issues: expect.arrayContaining([{ code: "autonomy_execution_disabled", message: expect.any(String) }]) });
    expect((await counts(f.workspace.workspaceId)).instances).toBe(0);
  }));

  it("creates a General audience without inferring optional references", async () => withFixture(async (f) => {
    const result = await f.preparation.prepare({ workspaceId: f.workspace.workspaceId, contentPackageId: f.contentPackage.id, expectedPackageVersion: 1 }, randomUUID(), f.user.id);
    expect(result.preparation.preparedDrafts).toHaveLength(1);
    expect(result.preparation.referenceSnapshot).not.toHaveProperty("brand");
    expect(result.preparation.referenceSnapshot).not.toHaveProperty("destination");
    expect(result.preparation.referenceSnapshot.audiences).toEqual([]);
  }));

  it("serializes concurrent identical attempts and replays after source, profile and destination changes", async () => withFixture(async (f) => {
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => f.preparation.prepare(f.input, key, f.user.id)));
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(new Set(results.map((result) => result.preparation.id)).size).toBe(1);
    const original = results[0]!.preparation;
    await f.core.saveContentPackage({ ...f.packageInput, evidence: [{ id: randomUUID(), claim: "The source changed.", provenance: "observed", sourceReferences: ["revision:2"] }] });
    await sql`UPDATE brand_profile SET status = 'archived', name = 'Changed brand' WHERE id = ${f.brand.id}`;
    await sql`UPDATE audience_profile SET status = 'archived', name = 'Changed audience' WHERE id = ${f.audienceA.id}`;
    await sql`UPDATE destination SET title = 'Changed destination', canonical_url = 'https://example.test/changed', status = 'draft' WHERE id = ${f.destination.id}`;
    const replay = await f.preparation.prepare(f.input, key.toUpperCase(), f.user.id);
    expect(replay).toEqual({ preparation: original, replayed: true });
    expect((await counts(f.workspace.workspaceId)).campaigns).toBe(1);
    expect(original.referenceSnapshot.destination).toMatchObject({ title: "Reviewed landing page", canonicalUrl: "https://example.test/preparation", status: "published" });
    await expect(f.preparation.prepare(f.input, randomUUID(), f.user.id)).rejects.toMatchObject({ code: "package_version_mismatch" });
  }));

  it("conflicts on changed canonical settings and permits an explicit separate attempt", async () => withFixture(async (f) => {
    const key = randomUUID();
    const first = await f.preparation.prepare(f.input, key, f.user.id);
    await expect(f.preparation.prepare({ ...f.input, name: "A different campaign" }, key, f.user.id))
      .rejects.toMatchObject({ code: "idempotency_conflict", existingPreparationId: first.preparation.id });
    const other = await f.preparation.prepare({ ...f.input, audienceProfileVersionIds: [...f.input.audienceProfileVersionIds!].reverse() }, randomUUID(), f.user.id);
    expect(other.preparation.id).not.toBe(first.preparation.id);
    expect((await counts(f.workspace.workspaceId)).campaigns).toBe(2);
  }));

  it.each(["owner", "admin", "editor", "approver", "analyst", "viewer"])("requires an authorized writer role (%s)", async (role) => withFixture(async (f) => {
    await sql`UPDATE workspace_membership SET role = ${role} WHERE workspace_id = ${f.workspace.workspaceId} AND user_id = ${f.user.id}`;
    if (["owner", "admin", "editor"].includes(role)) {
      expect((await f.preparation.prepare(f.input, randomUUID(), f.user.id)).replayed).toBe(false);
    } else {
      await expect(f.preparation.prepare(f.input, randomUUID(), f.user.id)).rejects.toMatchObject({ code: "access_denied" });
      expect(await counts(f.workspace.workspaceId)).toEqual(zero);
    }
  }));

  it("requires current membership for replay and keeps receipt reads workspace scoped", async () => withFixture(async (f) => {
    const key = randomUUID();
    const receipt = (await f.preparation.prepare(f.input, key, f.user.id)).preparation;
    await sql`UPDATE workspace_membership SET role = 'viewer' WHERE workspace_id = ${f.workspace.workspaceId} AND user_id = ${f.user.id}`;
    await expect(f.preparation.prepare(f.input, key, f.user.id)).rejects.toMatchObject({ code: "access_denied" });
    expect(await f.preparation.get(f.workspace.workspaceId, receipt.id, f.user.id)).toEqual(receipt);
    expect(await f.preparation.get(randomUUID(), receipt.id, f.user.id)).toBeUndefined();
    expect(await f.preparation.get(f.workspace.workspaceId, receipt.id, randomUUID())).toBeUndefined();
    expect(await f.preparation.listForWorkspace(f.workspace.workspaceId, randomUUID())).toEqual([]);
    expect(await f.preparation.listForWorkspace(randomUUID(), f.user.id)).toEqual([]);
    await sql`DELETE FROM workspace_membership WHERE workspace_id = ${f.workspace.workspaceId} AND user_id = ${f.user.id}`;
    expect(await f.preparation.get(f.workspace.workspaceId, receipt.id, f.user.id)).toBeUndefined();
    expect(await f.preparation.getByKey(f.workspace.workspaceId, key, f.user.id)).toBeUndefined();
    expect(await f.preparation.listForWorkspace(f.workspace.workspaceId, f.user.id)).toEqual([]);
    await expect(f.preparation.prepare(f.input, key, f.user.id)).rejects.toMatchObject({ code: "access_denied" });
  }));

  it.each(["package", "brand", "audience", "destination", "workspace"])("rejects a foreign %s reference", async (kind) => withFixture(async (f) => withFixture(async (foreign) => {
    const overrides = kind === "package" ? { contentPackageId: foreign.contentPackage.id }
      : kind === "brand" ? { brandProfileVersionId: foreign.brandVersion.id }
      : kind === "audience" ? { audienceProfileVersionIds: [foreign.audienceVersionA.id] }
      : kind === "destination" ? { destinationId: foreign.destination.id } : { workspaceId: foreign.workspace.workspaceId };
    await expect(f.preparation.prepare({ ...f.input, ...overrides }, randomUUID(), f.user.id))
      .rejects.toMatchObject({ code: kind === "workspace" ? "access_denied" : `${kind}_unavailable` });
    expect(await counts(f.workspace.workspaceId)).toEqual(zero);
    expect(await counts(foreign.workspace.workspaceId)).toEqual(zero);
  })));

  it.each(["version", "approval"])("rejects stale package %s without partial writes", async (kind) => withFixture(async (f) => {
    if (kind === "approval") await sql`UPDATE content_package SET status = 'ready' WHERE id = ${f.contentPackage.id}`;
    await expect(f.preparation.prepare({ ...f.input, expectedPackageVersion: kind === "version" ? 2 : 1 }, randomUUID(), f.user.id))
      .rejects.toMatchObject({ code: kind === "version" ? "package_version_mismatch" : "package_not_approved" });
    expect(await counts(f.workspace.workspaceId)).toEqual(zero);
  }));

  it.each(["brand", "audience"] as const)("rejects archived, unpublished and superseded %s selections", async (kind) => withFixture(async (f) => {
    const rootId = kind === "brand" ? f.brand.id : f.audienceA.id;
    const versionId = kind === "brand" ? f.brandVersion.id : f.audienceVersionA.id;
    const table = kind === "brand" ? "brand_profile" : "audience_profile";
    await sql.unsafe(`UPDATE ${table} SET status = 'archived' WHERE id = $1`, [rootId]);
    await expect(f.preparation.prepare(f.input, randomUUID(), f.user.id)).rejects.toMatchObject({ code: `${kind}_unavailable` });
    await sql.unsafe(`UPDATE ${table} SET status = 'published' WHERE id = $1`, [rootId]);
    await sql.unsafe(`UPDATE ${table}_version SET status = 'draft' WHERE id = $1`, [versionId]);
    await expect(f.preparation.prepare(f.input, randomUUID(), f.user.id)).rejects.toMatchObject({ code: `${kind}_unavailable` });
    await sql.unsafe(`UPDATE ${table}_version SET status = 'published' WHERE id = $1`, [versionId]);
    if (kind === "brand") {
      await f.profiles.saveBrandProfileDraft(rootId, { ...brandInput(f.workspace.workspaceId), name: "Updated brand" }, f.user.id);
      await f.profiles.publishBrandProfile(f.workspace.workspaceId, rootId, f.user.id);
    } else {
      await f.profiles.saveAudienceProfileDraft(rootId, audienceInput(f.workspace.workspaceId, "Updated audience"), f.user.id);
      await f.profiles.publishAudienceProfile(f.workspace.workspaceId, rootId, f.user.id);
    }
    await expect(f.preparation.prepare(f.input, randomUUID(), f.user.id)).rejects.toMatchObject({ code: `${kind}_unavailable` });
    expect(await counts(f.workspace.workspaceId)).toEqual(zero);
  }));

  it.each(["information", "promotion"])("preserves existing %s ceilings", async (kind) => withFixture(async (f) => {
    if (kind === "information") await sql`UPDATE brand_profile_version SET information_depth_ceiling = 'minimal' WHERE id = ${f.brandVersion.id}`;
    else await sql`UPDATE audience_profile_version SET promotional_strength_ceiling = 'informational' WHERE id = ${f.audienceVersionA.id}`;
    const input = { ...f.input, promotionalStrength: kind === "promotion" ? "strong" as const : "informational" as const };
    const expectedError = { name: "CampaignValidationError", issues: expect.arrayContaining([
      { code: kind === "information" ? "information_depth_ceiling" : "promotional_strength_ceiling", message: expect.any(String) },
    ]) };
    await expect(f.preparation.prepare(input, randomUUID(), f.user.id)).rejects.toMatchObject(expectedError);
    // The beginner entry point and advanced Campaign authoring share the same
    // nullable profile-policy boundary; neither may bypass another profile's ceiling.
    await expect(f.campaigns.createCampaign(compileGeneralAnnouncementPreparation(input).campaign, f.user.id))
      .rejects.toMatchObject(expectedError);
    expect(await counts(f.workspace.workspaceId)).toEqual(zero);
  }));

  it("rolls back every generated variant, planning version, receipt and audit when generation fails", async () => withFixture(async (f) => {
    const original = DraftRepository.prototype.generateDraftsInTransaction;
    let generatedBeforeFailure = 0;
    const spy = vi.spyOn(DraftRepository.prototype, "generateDraftsInTransaction").mockImplementationOnce(async function (this: DraftRepository, transaction, input, actor) {
      const result = await original.call(this, transaction, input, actor);
      generatedBeforeFailure = result.drafts.length;
      throw new Error("Controlled failure after generating all variants");
    });
    const key = randomUUID();
    try { await expect(f.preparation.prepare(f.input, key, f.user.id)).rejects.toThrow("Controlled failure"); }
    finally { spy.mockRestore(); }
    expect(generatedBeforeFailure).toBe(2);
    expect(await counts(f.workspace.workspaceId)).toEqual(zero);
    expect(await f.preparation.getByKey(f.workspace.workspaceId, key, f.user.id)).toBeUndefined();
    expect((await f.preparation.prepare(f.input, key, f.user.id)).replayed).toBe(false);
  }));

  it.each(revocations)("observes $name revocation committed ahead of preparation", async (revocation) => withFixture(async (f) => {
    let reportLock!: (pid: number) => void;
    let releaseMutation!: () => void;
    const locked = new Promise<number>((resolve) => { reportLock = resolve; });
    const release = new Promise<void>((resolve) => { releaseMutation = resolve; });
    const mutation = sql.begin(async (transaction) => {
      await revocation.change(transaction, f);
      reportLock((await transaction<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid);
      await release;
    });
    const holderPid = await locked;
    const preparing = f.preparation.prepare(f.input, randomUUID(), f.user.id).then(
      (value) => ({ value }), (error: unknown) => ({ error }),
    );
    try { await assertBlockedOn(holderPid); }
    finally { releaseMutation(); await mutation; }
    expect(await preparing).toMatchObject({ error: { code: revocation.code } });
    expect(await counts(f.workspace.workspaceId)).toEqual(zero);
  }));

  it.each(revocations)("holds $name authorization through receipt commit when preparation wins", async (revocation) => withFixture(async (f) => {
    let reportLock!: (pid: number) => void;
    let releasePreparation!: () => void;
    const locked = new Promise<number>((resolve) => { reportLock = resolve; });
    const release = new Promise<void>((resolve) => { releasePreparation = resolve; });
    const original = DraftRepository.prototype.generateDraftsInTransaction;
    const spy = vi.spyOn(DraftRepository.prototype, "generateDraftsInTransaction").mockImplementationOnce(async function (this: DraftRepository, transaction, input, actor) {
      reportLock((await transaction<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid);
      await release;
      return original.call(this, transaction, input, actor);
    });
    const preparing = f.preparation.prepare(f.input, randomUUID(), f.user.id).then(
      (value) => ({ value }), (error: unknown) => ({ error }),
    );
    let mutation: Promise<unknown> | undefined;
    try {
      const holderPid = await locked;
      mutation = sql.begin(async (transaction) => { await revocation.change(transaction, f); });
      await assertBlockedOn(holderPid);
    } finally {
      releasePreparation();
      await preparing;
      await mutation;
      spy.mockRestore();
    }
    expect(await preparing).toMatchObject({ value: { replayed: false, preparation: { preparedDrafts: expect.any(Array) } } });
    expect(await counts(f.workspace.workspaceId)).toEqual({ ...zero, receipts: 1, campaigns: 1, generations: 1, drafts: 2, preparationAudits: 1, generationAudits: 1 });
  }));

  it("rechecks a profile's current published pointer after waiting for concurrent publication", async () => withFixture(async (f) => {
    const next = (await f.profiles.saveBrandProfileDraft(f.brand.id, { ...brandInput(f.workspace.workspaceId), name: "Next published brand" }, f.user.id))!.draftVersion!;
    let reportLock!: (pid: number) => void;
    let releasePublication!: () => void;
    const locked = new Promise<number>((resolve) => { reportLock = resolve; });
    const release = new Promise<void>((resolve) => { releasePublication = resolve; });
    const publication = sql.begin(async (transaction) => {
      await transaction`SELECT id FROM brand_profile WHERE id = ${f.brand.id} FOR UPDATE`;
      await transaction`UPDATE brand_profile_version SET status = 'superseded' WHERE id = ${f.brandVersion.id}`;
      await transaction`UPDATE brand_profile_version SET status = 'published' WHERE id = ${next.id}`;
      await transaction`UPDATE brand_profile SET current_version_id = ${next.id} WHERE id = ${f.brand.id}`;
      reportLock((await transaction<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid);
      await release;
    });
    const holderPid = await locked;
    const preparing = f.preparation.prepare(f.input, randomUUID(), f.user.id).then(
      (value) => ({ value }), (error: unknown) => ({ error }),
    );
    try { await assertBlockedOn(holderPid); }
    finally { releasePublication(); await publication; }
    expect(await preparing).toMatchObject({ error: { code: "brand_unavailable" } });
    expect(await counts(f.workspace.workspaceId)).toEqual(zero);
  }));

  it("uses consistent audience lock order even when concurrent attempts author opposite orders", async () => withFixture(async (f) => {
    const results = await Promise.all([
      f.preparation.prepare(f.input, randomUUID(), f.user.id),
      f.preparation.prepare({ ...f.input, audienceProfileVersionIds: [...f.input.audienceProfileVersionIds!].reverse() }, randomUUID(), f.user.id),
    ]);
    expect(results.every((result) => !result.replayed)).toBe(true);
    expect(results[0]!.preparation.referenceSnapshot.audiences.map((audience) => audience.id)).toEqual(f.input.audienceProfileVersionIds);
    expect(results[1]!.preparation.referenceSnapshot.audiences.map((audience) => audience.id)).toEqual([...f.input.audienceProfileVersionIds!].reverse());
    expect((await counts(f.workspace.workspaceId)).drafts).toBe(4);
  }));

  it("scopes the same retry key separately to each authorized workspace", async () => withFixture(async (f) => withFixture(async (other) => {
    const key = randomUUID();
    const one = await f.preparation.prepare(f.input, key, f.user.id);
    const two = await other.preparation.prepare(other.input, key, other.user.id);
    expect(one.preparation.id).not.toBe(two.preparation.id);
    expect(await f.preparation.getByKey(f.workspace.workspaceId, key, other.user.id)).toBeUndefined();
  })));

  it("rejects malformed attempt keys without writing a partial preparation", async () => withFixture(async (f) => {
    for (const key of ["", "not-a-uuid", null, 1, {}, "00000000-0000-0000-0000-000000000000"]) {
      await expect(f.preparation.prepare(f.input, key, f.user.id)).rejects.toMatchObject({ code: "invalid_idempotency_key" });
    }
    expect(await counts(f.workspace.workspaceId)).toEqual(zero);
  }));

  it("rejects receipt mutation and malformed, partial, duplicate or foreign initial draft references", async () => withFixture(async (f) => {
    const receipt = (await f.preparation.prepare(f.input, randomUUID(), f.user.id)).preparation;
    await expect(sql`UPDATE campaign_preparation SET configuration_snapshot = '{}'::jsonb WHERE id = ${receipt.id}`)
      .rejects.toMatchObject({ code: "23514" });
    const invalidDrafts: JSONValue[] = [[], [receipt.preparedDrafts[0]!] as unknown as JSONValue,
      [receipt.preparedDrafts[0]!, receipt.preparedDrafts[0]!] as unknown as JSONValue,
      [{ draftId: randomUUID(), versionId: randomUUID() }, receipt.preparedDrafts[1]!],
      [{ draftId: receipt.preparedDrafts[0]!.draftId, versionId: receipt.preparedDrafts[1]!.versionId }, receipt.preparedDrafts[1]!],
      [null, null], [{ draftId: "not-a-uuid", versionId: {} }, {}]];
    for (const preparedDrafts of invalidDrafts) {
      await expect(sql`
        INSERT INTO campaign_preparation (id, workspace_id, idempotency_key, template_key, template_version,
          content_package_id, content_package_version, canonical_payload, configuration_hash, configuration_snapshot,
          reference_snapshot, campaign_id, planning_version_id, generation_id, prepared_drafts, created_by)
        SELECT ${randomUUID()}, workspace_id, ${randomUUID()}, template_key, template_version,
          content_package_id, content_package_version, canonical_payload, configuration_hash, configuration_snapshot,
          reference_snapshot, campaign_id, planning_version_id, generation_id, ${sql.json(preparedDrafts)}, created_by
        FROM campaign_preparation WHERE id = ${receipt.id}
      `).rejects.toMatchObject({ code: "23514" });
    }
    await expect(sql`
      INSERT INTO campaign_preparation (id, workspace_id, idempotency_key, template_key, template_version,
        content_package_id, content_package_version, canonical_payload, configuration_hash, configuration_snapshot,
        reference_snapshot, campaign_id, planning_version_id, generation_id, prepared_drafts, created_by)
      SELECT ${randomUUID()}, workspace_id, ${randomUUID()}, template_key, template_version,
        content_package_id, content_package_version, canonical_payload, configuration_hash, configuration_snapshot,
        reference_snapshot, ${randomUUID()}, planning_version_id, generation_id, prepared_drafts, created_by
      FROM campaign_preparation WHERE id = ${receipt.id}
    `).rejects.toMatchObject({ code: "23514" });
    expect(await f.preparation.get(f.workspace.workspaceId, receipt.id, f.user.id)).toEqual(receipt);
    expect((await counts(f.workspace.workspaceId)).receipts).toBe(1);
  }));
});
