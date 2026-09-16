import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CampaignPreparationRepository } from "./campaign-preparation-repository";
import { CampaignRepository } from "./campaign-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { ProfileRepository } from "./profile-repository";
import { MarketMeRepository } from "./repositories";
import { SourcePreparationRepository } from "./source-preparation-repository";
import { packageReviewPrecondition } from "./test-support/package-review-fixture";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!name.startsWith("market_me_qa_126_") && name !== "market_me_ci") {
    throw new Error("Source preparation integration requires an isolated market_me_qa_126_* or market_me_ci database.");
  }
}
let sql: DatabaseClient;

function audienceInput(workspaceId: string, name: string) {
  return { workspaceId, name, description: "Synthetic source preparation audience", audienceType: "community" as const,
    profile: { purpose: "Review a prepared announcement", industries: [], roles: [], interests: [], locations: [],
      languages: ["en"], knowledgeLevel: "new" as const, needs: [], motivations: [], objections: [], questions: [],
      preferredChannels: [], preferredFormats: [], exclusions: [] } };
}

async function makeFixture() {
  const core = new MarketMeRepository(sql);
  const profiles = new ProfileRepository(sql);
  const sourcePreparations = new SourcePreparationRepository(sql);
  const preparations = new CampaignPreparationRepository(sql);
  const campaigns = new CampaignRepository(sql);
  const { user: owner, workspace } = await core.bootstrapDevelopmentWorkspace({
    email: `source-preparation-owner-${randomUUID()}@market-me.local`, displayName: "Source preparation owner",
  });
  const writer = { id: randomUUID(), email: `source-preparation-writer-${randomUUID()}@market-me.local` };
  const cleanup = async () => {
    await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
    await sql`DELETE FROM app_user WHERE id IN ${sql([owner.id, writer.id])}`;
  };
  try {
    await sql.begin(async (tx) => {
      await tx`INSERT INTO app_user(id,email,normalized_email,display_name)
        VALUES (${writer.id},${writer.email},${writer.email},'Source preparation writer')`;
      await tx`INSERT INTO organization_membership(organization_id,user_id,role)
        VALUES (${workspace.organizationId},${writer.id},'member')`;
      await tx`INSERT INTO workspace_membership(workspace_id,user_id,role)
        VALUES (${workspace.workspaceId},${writer.id},'editor')`;
    });
    const source = await core.createSmartSource({ workspaceId: workspace.workspaceId, name: "Bound preparation source",
      provider: "local", locations: [{ providerLocationId: "bound", displayPath: "/Bound" }], recursive: false,
      readinessMode: "immediate", stabilizationWindowSeconds: 0, allowedMimeTypes: ["text/plain"], ignorePatterns: [],
      contextPackIds: [], autonomyMode: "draft_only", enabled: true }, owner.id);
    await core.applySourceItemChanges({ workspaceId: workspace.workspaceId, smartSourceId: source.id,
      deletedProviderItemIds: [], upserts: [{ workspaceId: workspace.workspaceId, smartSourceId: source.id,
        providerItemId: "announcement", name: "announcement.txt", displayPath: "/Bound/announcement.txt",
        mimeType: "text/plain", isFolder: false, contentHash: "sha256:source-bound-preparation" }] });
    const sourceItem = (await core.getSourceItemByProviderId(source.id, "announcement"))!;
    const contentPackage = await core.saveContentPackage({ workspaceId: workspace.workspaceId, smartSourceId: source.id,
      rootSourceItemId: sourceItem.id, title: "Source-bound announcement", status: "ready", contextPackVersionIds: [],
      assets: [], conflicts: [], evidence: [{ id: randomUUID(), claim: "Admission is free.",
        provenance: "authoritative_context", sourceReferences: [`source-item:${sourceItem.id}`], confidence: 1 }] });
    const audienceA = await profiles.createAudienceProfile(audienceInput(workspace.workspaceId, "Source audience A"), owner.id);
    const audienceB = await profiles.createAudienceProfile(audienceInput(workspace.workspaceId, "Source audience B"), owner.id);
    const audienceVersionA = (await profiles.publishAudienceProfile(workspace.workspaceId, audienceA.id, owner.id))!.currentVersion!;
    const audienceVersionB = (await profiles.publishAudienceProfile(workspace.workspaceId, audienceB.id, owner.id))!.currentVersion!;
    const bindingInput = { workspaceId: workspace.workspaceId, smartSourceId: source.id, enabled: true,
      name: "Source announcement", description: "Prepared automatically after exact review.",
      audienceProfileVersionIds: [audienceVersionB.id, audienceVersionA.id], informationDepth: "contextual" as const,
      promotionalStrength: "informational" as const, timezone: "UTC" };
    return { core, sourcePreparations, preparations, campaigns, owner, writer, workspace, source, contentPackage,
      audienceA, audienceB, audienceVersionA, audienceVersionB, bindingInput, cleanup };
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

async function approve(fixture: Fixture, actorUserId = fixture.owner.id) {
  const expected = await packageReviewPrecondition(sql, fixture.workspace.workspaceId, fixture.contentPackage.id, actorUserId);
  return fixture.core.approveContentPackage({ ...expected, workspaceId: fixture.workspace.workspaceId,
    packageId: fixture.contentPackage.id, actorUserId, idempotencyKey: randomUUID() });
}

async function commandCount(workspaceId: string) {
  return (await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM source_preparation_command
    WHERE workspace_id = ${workspaceId}`)[0]!.count;
}

describe.skipIf(!databaseUrl)("Smart Source preparation outbox", () => {
  beforeAll(async () => {
    sql = createDatabaseClient(databaseUrl!, { max: 12 });
    await sql`CREATE OR REPLACE FUNCTION test_pause_source_preparation_approval() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended(
          'source-preparation-test-pause:' || NEW.id::text, 0));
        RETURN NEW;
      END;
    $$`;
    await sql`DROP TRIGGER IF EXISTS zz_test_pause_source_preparation_approval ON content_package`;
    await sql`CREATE TRIGGER zz_test_pause_source_preparation_approval
      AFTER UPDATE OF current_approval_id ON content_package
      FOR EACH ROW WHEN (NEW.current_approval_id IS DISTINCT FROM OLD.current_approval_id)
      EXECUTE FUNCTION test_pause_source_preparation_approval()`;
  });
  afterAll(async () => {
    if (!sql) return;
    await sql`DROP TRIGGER IF EXISTS zz_test_pause_source_preparation_approval ON content_package`;
    await sql`DROP FUNCTION IF EXISTS test_pause_source_preparation_approval()`;
    await sql.end();
  });

  it("does not backfill, retains audience order, permits the same configuring writer to approve, and completes exact lineage", async () => withFixture(async (f) => {
    const historicalApproval = await approve(f);
    expect(await commandCount(f.workspace.workspaceId)).toBe(0);
    await expect(f.sourcePreparations.getSourcePreparationCommandForApproval(
      f.workspace.workspaceId, f.contentPackage.id, historicalApproval.approval.id, f.owner.id,
    )).resolves.toBeUndefined();

    const binding = await f.sourcePreparations.saveSourcePreparationBinding(f.bindingInput, f.owner.id);
    expect(binding).toMatchObject({ smartSourceId: f.source.id, writerUserId: f.owner.id, enabled: true, revision: 1,
      audienceProfileVersionIds: [f.audienceVersionB.id, f.audienceVersionA.id] });
    expect(await commandCount(f.workspace.workspaceId)).toBe(0);

    await expect(sql`
      INSERT INTO smart_source_preparation_binding (
        id, workspace_id, smart_source_id, writer_user_id, template_key, template_version,
        name, description, information_depth, promotional_strength, timezone, created_by, updated_by
      )
      SELECT gen_random_uuid(), workspace_id, smart_source_id, ${f.writer.id}, template_key, template_version,
        name, description, information_depth, promotional_strength, timezone, ${f.owner.id}, ${f.owner.id}
      FROM smart_source_preparation_binding WHERE id = ${binding.id}
    `).rejects.toMatchObject({ code: "23514" });
    await expect(sql`
      UPDATE smart_source_preparation_binding
      SET writer_user_id = ${f.writer.id}, updated_by = ${f.owner.id}, revision = revision + 1
      WHERE id = ${binding.id}
    `).rejects.toMatchObject({ code: "23514" });

    const approved = await approve(f);
    expect(await commandCount(f.workspace.workspaceId)).toBe(1);
    const queued = await f.sourcePreparations.getSourcePreparationCommandForApproval(
      f.workspace.workspaceId, f.contentPackage.id, approved.approval.id, f.owner.id,
    );
    expect(queued).toMatchObject({ status: "pending", expectedApprovalId: approved.approval.id,
      contentPackageId: f.contentPackage.id, contentPackageVersion: f.contentPackage.version, attemptCount: 0 });
    expect(queued).not.toHaveProperty("configurationSnapshot");
    expect(queued).not.toHaveProperty("bindingSnapshot");
    const [command] = (await f.sourcePreparations.claimSourcePreparationCommands(10)).commands;
    expect(command).toMatchObject({ bindingId: binding.id, bindingRevision: 1, smartSourceId: f.source.id,
      contentPackageId: f.contentPackage.id, contentPackageVersion: f.contentPackage.version,
      expectedApprovalId: approved.approval.id, expectedReviewFingerprint: approved.approval.reviewFingerprint,
      writerUserId: f.owner.id, attempt: 1, preparationIdempotencyKey: expect.any(String),
      configurationSnapshot: { audienceProfileVersionIds: [f.audienceVersionB.id, f.audienceVersionA.id] },
      bindingSnapshot: { audienceProfileVersionIds: [f.audienceVersionB.id, f.audienceVersionA.id], revision: 1 } });
    expect(command!.preparationIdempotencyKey).toBe(command!.id);

    const prepared = await f.preparations.prepare(command!.configurationSnapshot, command!.id, command!.writerUserId, {
      expectedReviewFingerprint: command!.expectedReviewFingerprint, expectedApprovalId: command!.expectedApprovalId,
    });
    expect(prepared.replayed).toBe(false);
    expect(prepared.preparation.referenceSnapshot.contentPackage.approvalId).toBe(command!.expectedApprovalId);
    await expect(f.sourcePreparations.completeSourcePreparationCommand({ commandId: command!.id, attempt: command!.attempt,
      preparationId: prepared.preparation.id, campaignId: prepared.preparation.campaignId })).resolves.toBe(true);
    await expect(f.sourcePreparations.completeSourcePreparationCommand({ commandId: command!.id, attempt: command!.attempt,
      preparationId: prepared.preparation.id, campaignId: prepared.preparation.campaignId })).resolves.toBe(false);

    const safety = (await sql<{
      campaignStatus: string; planningVersionStatus: string; autonomyMode: string; drafts: number;
      draftApprovals: number; campaignApprovals: number; finalizations: number; instances: number;
      workflowCommands: number; publicationActions: number;
    }[]>`
      SELECT campaign.status AS campaign_status, version.status AS planning_version_status,
        version.autonomy_mode,
        (SELECT count(*)::integer FROM content_draft WHERE workspace_id = ${f.workspace.workspaceId}) AS drafts,
        (SELECT count(*)::integer FROM content_draft_approval WHERE workspace_id = ${f.workspace.workspaceId}) AS draft_approvals,
        (SELECT count(*)::integer FROM campaign_approval WHERE workspace_id = ${f.workspace.workspaceId}) AS campaign_approvals,
        (SELECT count(*)::integer FROM campaign_finalization WHERE workspace_id = ${f.workspace.workspaceId}) AS finalizations,
        (SELECT count(*)::integer FROM campaign_instance WHERE workspace_id = ${f.workspace.workspaceId}) AS instances,
        (SELECT count(*)::integer FROM campaign_workflow_command WHERE workspace_id = ${f.workspace.workspaceId}) AS workflow_commands,
        (SELECT count(*)::integer FROM publication_action WHERE workspace_id = ${f.workspace.workspaceId}) AS publication_actions
      FROM campaign JOIN campaign_version version ON version.id = campaign.current_version_id
      WHERE campaign.id = ${prepared.preparation.campaignId}
        AND version.id = ${prepared.preparation.planningVersionId}
    `)[0]!;
    expect(safety).toEqual({
      campaignStatus: "draft", planningVersionStatus: "published", autonomyMode: "draft_only", drafts: 2,
      draftApprovals: 0, campaignApprovals: 0, finalizations: 0, instances: 0,
      workflowCommands: 0, publicationActions: 0,
    });

    const summaries = await f.sourcePreparations.listSourcePreparationCommands(f.workspace.workspaceId, f.source.id, f.owner.id);
    expect(summaries).toEqual([expect.objectContaining({ id: command!.id, status: "completed", attemptCount: 1,
      expectedApprovalId: approved.approval.id, preparationId: prepared.preparation.id, campaignId: prepared.preparation.campaignId })]);
    expect(summaries[0]).not.toHaveProperty("configurationSnapshot");
    expect(summaries[0]).not.toHaveProperty("bindingSnapshot");
    await expect(f.sourcePreparations.getSourcePreparationCommandForApproval(
      f.workspace.workspaceId, f.contentPackage.id, approved.approval.id, f.writer.id,
    )).resolves.toEqual(expect.objectContaining({ id: command!.id, status: "completed",
      preparationId: prepared.preparation.id, campaignId: prepared.preparation.campaignId }));
    await expect(f.sourcePreparations.getSourcePreparationCommandForApproval(
      f.workspace.workspaceId, randomUUID(), approved.approval.id, f.owner.id,
    )).resolves.toBeUndefined();
    await sql`DELETE FROM workspace_membership WHERE workspace_id = ${f.workspace.workspaceId} AND user_id = ${f.writer.id}`;
    await expect(f.sourcePreparations.getSourcePreparationCommandForApproval(
      f.workspace.workspaceId, f.contentPackage.id, approved.approval.id, f.writer.id,
    )).resolves.toBeUndefined();

    await expect(sql`
      WITH identity AS (SELECT gen_random_uuid() AS id)
      INSERT INTO source_preparation_command(id,workspace_id,binding_id,binding_revision,smart_source_id,
        content_package_id,content_package_version,expected_approval_id,expected_review_fingerprint,
        preparation_idempotency_key,writer_user_id,configuration_snapshot,binding_snapshot,next_attempt_at)
      SELECT identity.id, command.workspace_id, command.binding_id, command.binding_revision, command.smart_source_id,
        command.content_package_id, command.content_package_version, command.expected_approval_id,
        command.expected_review_fingerprint, identity.id, command.writer_user_id,
        command.configuration_snapshot, command.binding_snapshot, clock_timestamp()
      FROM source_preparation_command command CROSS JOIN identity WHERE command.id = ${command!.id}
    `).rejects.toMatchObject({ code: "23505" });
    const auditTypes = await sql<{ eventType: string }[]>`SELECT event_type FROM audit_event
      WHERE workspace_id = ${f.workspace.workspaceId} AND event_type LIKE 'source_preparation.%' ORDER BY created_at`;
    expect(auditTypes.map((row) => row.eventType)).toEqual([
      "source_preparation.binding_created", "source_preparation.command_completed",
    ]);
  }));

  it("pins the expected approval across a byte-identical reapproval race and preserves completed replay identity", async () => withFixture(async (f) => {
    await f.sourcePreparations.saveSourcePreparationBinding(f.bindingInput, f.owner.id);
    const firstApproval = await approve(f);
    const firstQueued = await f.sourcePreparations.getSourcePreparationCommandForApproval(
      f.workspace.workspaceId, f.contentPackage.id, firstApproval.approval.id, f.owner.id,
    );
    expect(firstQueued).toMatchObject({ status: "pending", expectedApprovalId: firstApproval.approval.id });
    const [first] = (await f.sourcePreparations.claimSourcePreparationCommands(1)).commands;
    await expect(f.preparations.prepare(first!.configurationSnapshot, first!.id, first!.writerUserId, {
      expectedReviewFingerprint: first!.expectedReviewFingerprint,
    })).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(f.preparations.prepare(first!.configurationSnapshot, first!.id, f.writer.id, {
      expectedReviewFingerprint: first!.expectedReviewFingerprint, expectedApprovalId: first!.expectedApprovalId,
    })).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(f.preparations.prepare({ ...first!.configurationSnapshot, name: "Substituted campaign" },
      first!.id, first!.writerUserId, {
        expectedReviewFingerprint: first!.expectedReviewFingerprint, expectedApprovalId: first!.expectedApprovalId,
      })).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect((await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM campaign_preparation
      WHERE workspace_id = ${f.workspace.workspaceId}`)[0]!.count).toBe(0);
    const secondApproval = await approve(f);
    expect(firstApproval.approval.reviewFingerprint).toBe(secondApproval.approval.reviewFingerprint);
    const secondQueued = await f.sourcePreparations.getSourcePreparationCommandForApproval(
      f.workspace.workspaceId, f.contentPackage.id, secondApproval.approval.id, f.owner.id,
    );
    expect(secondQueued).toMatchObject({ status: "pending", expectedApprovalId: secondApproval.approval.id });
    expect(secondQueued!.id).not.toBe(firstQueued!.id);
    await expect(f.preparations.prepare(first!.configurationSnapshot, first!.id, first!.writerUserId, {
      expectedReviewFingerprint: first!.expectedReviewFingerprint, expectedApprovalId: first!.expectedApprovalId,
    })).rejects.toMatchObject({ code: "approval_unavailable" });
    await expect(f.sourcePreparations.failSourcePreparationCommand({ commandId: first!.id, attempt: first!.attempt,
      errorCode: "approval_unavailable", retryable: false, safeError: "The exact approval is no longer current." }))
      .resolves.toBe("dead_letter");

    const [second] = (await f.sourcePreparations.claimSourcePreparationCommands(1)).commands;
    expect(second!.expectedApprovalId).toBe(secondApproval.approval.id);
    await expect(f.preparations.prepare(second!.configurationSnapshot, randomUUID(), second!.writerUserId, {
      expectedReviewFingerprint: second!.expectedReviewFingerprint, expectedApprovalId: "not-a-uuid",
    })).rejects.toMatchObject({ code: "invalid_review_input" });
    const prepared = await f.preparations.prepare(second!.configurationSnapshot, second!.id, second!.writerUserId, {
      expectedReviewFingerprint: second!.expectedReviewFingerprint, expectedApprovalId: second!.expectedApprovalId,
    });
    const thirdApproval = await approve(f);
    await expect(f.sourcePreparations.getSourcePreparationCommandForApproval(
      f.workspace.workspaceId, f.contentPackage.id, thirdApproval.approval.id, f.owner.id,
    )).resolves.toEqual(expect.objectContaining({ status: "pending", expectedApprovalId: thirdApproval.approval.id }));
    const replay = await f.preparations.prepare(second!.configurationSnapshot, second!.id, second!.writerUserId, {
      expectedReviewFingerprint: second!.expectedReviewFingerprint, expectedApprovalId: second!.expectedApprovalId,
    });
    expect(replay).toMatchObject({ replayed: true, preparation: { id: prepared.preparation.id } });
    await expect(f.preparations.prepare(second!.configurationSnapshot, second!.id, second!.writerUserId, {
      expectedReviewFingerprint: second!.expectedReviewFingerprint, expectedApprovalId: thirdApproval.approval.id,
    })).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(f.sourcePreparations.completeSourcePreparationCommand({ commandId: second!.id, attempt: second!.attempt,
      preparationId: prepared.preparation.id, campaignId: prepared.preparation.campaignId })).resolves.toBe(true);
  }));

  it("uses exact revision compare-and-swap and binds ordered Audience edits to that parent revision", async () => withFixture(async (f) => {
    const binding = await f.sourcePreparations.saveSourcePreparationBinding(f.bindingInput, f.owner.id);
    await expect(sql`DELETE FROM smart_source_preparation_binding_audience
      WHERE binding_id = ${binding.id} AND audience_profile_version_id = ${f.audienceVersionA.id}`)
      .rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE smart_source_preparation_binding_audience SET sort_order = sort_order
      WHERE binding_id = ${binding.id} AND audience_profile_version_id = ${f.audienceVersionA.id}`)
      .rejects.toMatchObject({ code: "23514" });
    await expect(sql.begin(async (tx) => {
      await tx`SELECT set_config('market_me.source_preparation_audience_admission', ${JSON.stringify({
        bindingId: binding.id, revision: binding.revision, updatedBy: f.owner.id,
      })}, true)`;
      await tx`DELETE FROM smart_source_preparation_binding_audience
        WHERE binding_id = ${binding.id} AND audience_profile_version_id = ${f.audienceVersionA.id}`;
    })).rejects.toMatchObject({ code: "23514" });

    const updated = await f.sourcePreparations.saveSourcePreparationBinding({
      ...f.bindingInput, expectedRevision: binding.revision, name: "Updated source announcement",
      audienceProfileVersionIds: [f.audienceVersionA.id, f.audienceVersionB.id],
    }, f.owner.id);
    expect(updated).toMatchObject({ revision: 2, name: "Updated source announcement",
      audienceProfileVersionIds: [f.audienceVersionA.id, f.audienceVersionB.id] });
    await expect(f.sourcePreparations.saveSourcePreparationBinding({
      ...f.bindingInput, expectedRevision: binding.revision, enabled: false,
    }, f.owner.id)).rejects.toMatchObject({ code: "binding_changed" });
    await expect(f.sourcePreparations.saveSourcePreparationBinding({
      ...f.bindingInput, enabled: false,
    }, f.owner.id)).rejects.toMatchObject({ code: "binding_changed" });
    expect(await f.sourcePreparations.getSourcePreparationBindingForSource(
      f.workspace.workspaceId, f.source.id, f.owner.id,
    )).toMatchObject({ revision: 2, enabled: true, name: "Updated source announcement" });
  }));

  it.each(["writer", "audience"] as const)("enqueues stale %s state and records a visible dead letter instead of suppressing the event", async (stale) => withFixture(async (f) => {
    await f.sourcePreparations.saveSourcePreparationBinding(f.bindingInput, f.writer.id);
    if (stale === "writer") {
      await sql`UPDATE workspace_membership SET role = 'viewer'
        WHERE workspace_id = ${f.workspace.workspaceId} AND user_id = ${f.writer.id}`;
    } else {
      await sql`UPDATE audience_profile SET status = 'archived' WHERE id = ${f.audienceB.id}`;
    }
    const approved = await approve(f);
    expect(await commandCount(f.workspace.workspaceId)).toBe(1);
    const [command] = (await f.sourcePreparations.claimSourcePreparationCommands(1)).commands;
    expect(command).toMatchObject({ expectedApprovalId: approved.approval.id, writerUserId: f.writer.id });
    await expect(f.preparations.prepare(command!.configurationSnapshot, command!.id, command!.writerUserId, {
      expectedReviewFingerprint: command!.expectedReviewFingerprint, expectedApprovalId: command!.expectedApprovalId,
    })).rejects.toMatchObject({ code: stale === "writer" ? "access_denied" : "audience_unavailable" });
    await expect(f.sourcePreparations.failSourcePreparationCommand({ commandId: command!.id, attempt: command!.attempt,
      errorCode: stale === "writer" ? "access_denied" : "audience_unavailable", retryable: false,
      safeError: "The saved binding requires review." })).resolves.toBe("dead_letter");
    expect(await f.sourcePreparations.listSourcePreparationCommands(f.workspace.workspaceId, f.source.id, f.owner.id))
      .toEqual([expect.objectContaining({ id: command!.id, status: "dead_letter", attemptCount: 1,
        lastErrorCode: stale === "writer" ? "access_denied" : "audience_unavailable",
        safeError: "The saved binding requires review." })]);
  }));

  it("keeps approval-linked preparation enabled when source synchronization is paused", async () => withFixture(async (f) => {
    const binding = await f.sourcePreparations.saveSourcePreparationBinding(f.bindingInput, f.owner.id);
    await sql`UPDATE smart_source SET enabled = false WHERE id = ${f.source.id}`;
    const approved = await approve(f);
    expect(await f.sourcePreparations.getSourcePreparationBindingForSource(
      f.workspace.workspaceId, f.source.id, f.owner.id,
    )).toMatchObject({ id: binding.id, enabled: true });
    const [command] = (await f.sourcePreparations.claimSourcePreparationCommands(1)).commands;
    expect(command).toMatchObject({ smartSourceId: f.source.id, expectedApprovalId: approved.approval.id });
  }));

  it("linearizes an observed enabled binding through approval commit before a concurrent disable", async () => withFixture(async (f) => {
    const binding = await f.sourcePreparations.saveSourcePreparationBinding(f.bindingInput, f.owner.id);
    let releaseHolder!: () => void;
    let holderReady!: (pid: number) => void;
    const releaseSignal = new Promise<void>((resolve) => { releaseHolder = resolve; });
    const holderReadySignal = new Promise<number>((resolve) => { holderReady = resolve; });
    const holder = sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(
        ${`source-preparation-test-pause:${f.contentPackage.id}`}, 0))`;
      const pid = (await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid;
      holderReady(pid);
      await releaseSignal;
    });
    const holderPid = await holderReadySignal;
    let approvalPromise: ReturnType<typeof approve> | undefined;
    let disablePromise: Promise<unknown> | undefined;
    try {
      approvalPromise = approve(f);
      await expect.poll(async () => (await sql<{ blocked: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND ${holderPid} = ANY(pg_blocking_pids(pid))) AS blocked
      `)[0]!.blocked, { timeout: 3_000, interval: 25 }).toBe(true);

      disablePromise = Promise.resolve(sql`UPDATE smart_source_preparation_binding
        SET enabled = false, writer_user_id = ${f.owner.id}, updated_by = ${f.owner.id}, revision = revision + 1
        WHERE id = ${binding.id}`);
      await expect.poll(async () => (await sql<{ blocked: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE pid <> pg_backend_pid() AND datname = current_database()
            AND query LIKE '%UPDATE smart_source_preparation_binding%'
            AND cardinality(pg_blocking_pids(pid)) > 0) AS blocked
      `)[0]!.blocked, { timeout: 3_000, interval: 25 }).toBe(true);

      releaseHolder();
      const approved = await approvalPromise;
      await disablePromise;
      await holder;
      expect(await f.sourcePreparations.getSourcePreparationBindingForSource(
        f.workspace.workspaceId, f.source.id, f.owner.id,
      )).toMatchObject({ id: binding.id, enabled: false, revision: 2 });
      expect(await f.sourcePreparations.listSourcePreparationCommands(
        f.workspace.workspaceId, f.source.id, f.owner.id,
      )).toEqual([expect.objectContaining({ expectedApprovalId: approved.approval.id, bindingRevision: 1 })]);
    } finally {
      releaseHolder();
      await Promise.allSettled([holder, ...(approvalPromise ? [approvalPromise] : []), ...(disablePromise ? [disablePromise] : [])]);
    }
  }), 10_000);

  it("serializes direct first binding creation after an approval that observed no binding", async () => withFixture(async (f) => {
    let releaseHolder!: () => void;
    let holderReady!: (pid: number) => void;
    const releaseSignal = new Promise<void>((resolve) => { releaseHolder = resolve; });
    const holderReadySignal = new Promise<number>((resolve) => { holderReady = resolve; });
    const holder = sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(
        ${`source-preparation-test-pause:${f.contentPackage.id}`}, 0))`;
      holderReady((await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid);
      await releaseSignal;
    });
    const holderPid = await holderReadySignal;
    let approvalPromise: ReturnType<typeof approve> | undefined;
    let insertPromise: Promise<unknown> | undefined;
    try {
      approvalPromise = approve(f);
      await expect.poll(async () => (await sql<{ blocked: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND ${holderPid} = ANY(pg_blocking_pids(pid))) AS blocked
      `)[0]!.blocked, { timeout: 3_000, interval: 25 }).toBe(true);

      const bindingId = randomUUID();
      insertPromise = Promise.resolve(sql`
        INSERT INTO smart_source_preparation_binding (
          id, workspace_id, smart_source_id, writer_user_id, template_key, template_version,
          name, description, information_depth, promotional_strength, timezone, enabled, created_by, updated_by
        ) VALUES (
          ${bindingId}, ${f.workspace.workspaceId}, ${f.source.id}, ${f.owner.id},
          'general_announcement', 1, 'Direct source announcement', '', 'contextual', 'informational',
          'UTC', true, ${f.owner.id}, ${f.owner.id}
        )
      `);
      await expect.poll(async () => (await sql<{ blocked: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE pid <> pg_backend_pid() AND datname = current_database()
            AND query LIKE '%INSERT INTO smart_source_preparation_binding%'
            AND cardinality(pg_blocking_pids(pid)) > 0) AS blocked
      `)[0]!.blocked, { timeout: 3_000, interval: 25 }).toBe(true);

      releaseHolder();
      await approvalPromise;
      await insertPromise;
      await holder;
      expect(await commandCount(f.workspace.workspaceId)).toBe(0);
      expect(await f.sourcePreparations.getSourcePreparationBindingForSource(
        f.workspace.workspaceId, f.source.id, f.owner.id,
      )).toMatchObject({ id: bindingId, enabled: true, revision: 1 });
    } finally {
      releaseHolder();
      await Promise.allSettled([holder, ...(approvalPromise ? [approvalPromise] : []), ...(insertPromise ? [insertPromise] : [])]);
    }
  }), 10_000);

  it("can disable unchanged stale references through the full save path and revalidates before re-enable", async () => withFixture(async (f) => {
    const destination = await f.campaigns.saveDestination({
      workspaceId: f.workspace.workspaceId, provider: "manual", canonicalUrl: "https://example.test/source-bound-disable",
      knownRedirects: [], title: "Source-bound destination", description: "Synthetic destination", contentType: "web_page",
      identifiers: {}, topics: [], audiences: [], geography: [], status: "published", tracking: {},
    }, f.owner.id);
    const configured = { ...f.bindingInput, destinationId: destination.id };
    const binding = await f.sourcePreparations.saveSourcePreparationBinding(configured, f.owner.id);
    await sql`UPDATE destination SET status = 'draft' WHERE id = ${destination.id}`;

    await expect(f.sourcePreparations.saveSourcePreparationBinding({
      ...configured, enabled: false, expectedRevision: binding.revision,
    }, f.owner.id))
      .resolves.toMatchObject({ id: binding.id, enabled: false, revision: 2, destinationId: destination.id });
    await expect(f.sourcePreparations.setSourcePreparationBindingEnabled({
      workspaceId: f.workspace.workspaceId, bindingId: binding.id, enabled: true,
    }, f.owner.id)).rejects.toMatchObject({ code: "destination_unavailable" });
    await expect(sql`UPDATE smart_source_preparation_binding
      SET enabled = true, writer_user_id = ${f.owner.id}, updated_by = ${f.owner.id}, revision = revision + 1
      WHERE id = ${binding.id}`).rejects.toMatchObject({ code: "23514" });
  }));

  it("revalidates retained Audience references before a disabled binding can be enabled", async () => withFixture(async (f) => {
    const binding = await f.sourcePreparations.saveSourcePreparationBinding(f.bindingInput, f.owner.id);
    await f.sourcePreparations.setSourcePreparationBindingEnabled({
      workspaceId: f.workspace.workspaceId, bindingId: binding.id, enabled: false,
    }, f.owner.id);
    await sql`UPDATE audience_profile SET status = 'archived' WHERE id = ${f.audienceA.id}`;
    await expect(f.sourcePreparations.setSourcePreparationBindingEnabled({
      workspaceId: f.workspace.workspaceId, bindingId: binding.id, enabled: true,
    }, f.owner.id)).rejects.toMatchObject({ code: "audience_unavailable" });
    await expect(sql`UPDATE smart_source_preparation_binding
      SET enabled = true, writer_user_id = ${f.owner.id}, updated_by = ${f.owner.id}, revision = revision + 1
      WHERE id = ${binding.id}`).rejects.toMatchObject({ code: "23514" });
  }));

  it("lets an already enqueued command survive a later binding disable while suppressing only later approvals", async () => withFixture(async (f) => {
    const binding = await f.sourcePreparations.saveSourcePreparationBinding(f.bindingInput, f.writer.id);
    const firstApproval = await approve(f);
    expect(await commandCount(f.workspace.workspaceId)).toBe(1);
    const disabled = await f.sourcePreparations.setSourcePreparationBindingEnabled({
      workspaceId: f.workspace.workspaceId, bindingId: binding.id, enabled: false,
    }, f.owner.id);
    expect(disabled).toMatchObject({ enabled: false, revision: 2, writerUserId: f.owner.id });
    await approve(f);
    expect(await commandCount(f.workspace.workspaceId)).toBe(1);
    const [claimed] = (await f.sourcePreparations.claimSourcePreparationCommands(1)).commands;
    expect(claimed).toMatchObject({ expectedApprovalId: firstApproval.approval.id,
      bindingRevision: 1, writerUserId: f.writer.id, bindingSnapshot: { enabled: true, revision: 1 } });
  }));

  it("uses SKIP LOCKED leases and attempt fences, rejects current invalid lineage, and reports retry versus dead letter", async () => withFixture(async (f) => {
    await f.sourcePreparations.saveSourcePreparationBinding(f.bindingInput, f.owner.id);
    await approve(f);
    const commandId = (await sql<{ id: string }[]>`SELECT id FROM source_preparation_command
      WHERE workspace_id = ${f.workspace.workspaceId}`)[0]!.id;
    await expect(sql`UPDATE source_preparation_command SET status = 'processing', attempt_count = 1,
      next_attempt_at = NULL, claimed_at = statement_timestamp(),
      lease_expires_at = statement_timestamp() + interval '2 hours', updated_at = clock_timestamp()
      WHERE id = ${commandId}`).rejects.toMatchObject({ code: "23514" });
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM source_preparation_command WHERE id = ${commandId} FOR UPDATE`;
      expect(await f.sourcePreparations.claimSourcePreparationCommands(1, 1)).toEqual({
        commands: [], recovered: 0, deadLettered: 0,
      });
    });
    const [first] = (await f.sourcePreparations.claimSourcePreparationCommands(1, 1)).commands;
    await expect(sql`UPDATE source_preparation_command SET configuration_snapshot = '{}'::jsonb WHERE id = ${first!.id}`)
      .rejects.toMatchObject({ code: "23514" });
    await expect.poll(async () => (await sql<{ expired: boolean }[]>`
      SELECT clock_timestamp() >= lease_expires_at AS expired FROM source_preparation_command WHERE id = ${first!.id}`)[0]!.expired,
    { timeout: 5_000, interval: 25 }).toBe(true);
    const [second] = (await f.sourcePreparations.claimSourcePreparationCommands(1, 30)).commands;
    expect(second).toMatchObject({ id: first!.id, attempt: 2 });
    await expect(f.sourcePreparations.completeSourcePreparationCommand({ commandId: first!.id, attempt: first!.attempt,
      preparationId: randomUUID(), campaignId: randomUUID() })).resolves.toBe(false);
    await expect(f.sourcePreparations.failSourcePreparationCommand({ commandId: first!.id, attempt: first!.attempt,
      errorCode: "stale", retryable: true, safeError: "Stale attempt." })).resolves.toBeUndefined();
    await expect(f.sourcePreparations.completeSourcePreparationCommand({ commandId: second!.id, attempt: second!.attempt,
      preparationId: randomUUID(), campaignId: randomUUID() })).rejects.toMatchObject({ code: "23514" });
    await expect(f.sourcePreparations.failSourcePreparationCommand({ commandId: second!.id, attempt: second!.attempt,
      errorCode: "transient", retryable: true, safeError: "Try again safely." })).resolves.toBe("failed");
    expect(await f.sourcePreparations.listSourcePreparationCommands(f.workspace.workspaceId, f.source.id, f.owner.id))
      .toEqual([expect.objectContaining({ id: second!.id, status: "failed", attemptCount: 2,
        lastErrorCode: "transient", safeError: "Try again safely.", nextAttemptAt: expect.any(String) })]);

    await approve(f);
    const [terminal] = (await f.sourcePreparations.claimSourcePreparationCommands(1)).commands;
    await expect(f.sourcePreparations.failSourcePreparationCommand({ commandId: terminal!.id, attempt: terminal!.attempt,
      errorCode: "invalid_configuration", retryable: false, safeError: "Review the source binding." }))
      .resolves.toBe("dead_letter");
    await expect(f.sourcePreparations.failSourcePreparationCommand({ commandId: terminal!.id, attempt: terminal!.attempt,
      errorCode: "invalid_configuration", retryable: false, safeError: "Review the source binding." }))
      .resolves.toBeUndefined();
  }), 15_000);

  it("reconciles an exact committed receipt instead of recording a retryable settlement failure", async () => withFixture(async (f) => {
    await f.sourcePreparations.saveSourcePreparationBinding(f.bindingInput, f.owner.id);
    await approve(f);
    const [command] = (await f.sourcePreparations.claimSourcePreparationCommands(1)).commands;
    const prepared = await f.preparations.prepare(command!.configurationSnapshot, command!.id,
      command!.writerUserId, { expectedReviewFingerprint: command!.expectedReviewFingerprint,
        expectedApprovalId: command!.expectedApprovalId });
    await expect(f.sourcePreparations.failSourcePreparationCommand({
      commandId: command!.id, attempt: command!.attempt, errorCode: "database_40001",
      retryable: true, safeError: "A temporary database condition interrupted draft preparation.",
    })).resolves.toBe("completed");
    expect(await f.sourcePreparations.listSourcePreparationCommands(
      f.workspace.workspaceId, f.source.id, f.owner.id,
    )).toEqual([expect.objectContaining({ id: command!.id, status: "completed", attemptCount: 1,
      preparationId: prepared.preparation.id, campaignId: prepared.preparation.campaignId })]);
  }));

  it("reconciles an exact receipt after the final lease and terminally closes an exhausted command without one", async () => withFixture(async (f) => {
    await f.sourcePreparations.saveSourcePreparationBinding(f.bindingInput, f.owner.id);
    await approve(f);
    const currentApproval = await approve(f);
    let claims = [...(await f.sourcePreparations.claimSourcePreparationCommands(2, 1)).commands];
    expect(claims).toHaveLength(2);
    for (let expectedAttempt = 2; expectedAttempt <= 8; expectedAttempt += 1) {
      await expect.poll(async () => (await sql<{ expired: boolean }[]>`
        SELECT bool_and(clock_timestamp() >= lease_expires_at) AS expired
        FROM source_preparation_command WHERE id IN ${sql(claims.map((command) => command.id))}
      `)[0]!.expired, { timeout: 3_000, interval: 25 }).toBe(true);
      claims = [...(await f.sourcePreparations.claimSourcePreparationCommands(2, 1)).commands];
      expect(claims.map((command) => command.attempt)).toEqual([expectedAttempt, expectedAttempt]);
    }
    const recoverable = claims.find((command) => command.expectedApprovalId === currentApproval.approval.id)!;
    const abandoned = claims.find((command) => command.id !== recoverable.id)!;
    await expect(sql`UPDATE source_preparation_command SET status = 'failed', next_attempt_at = clock_timestamp(),
      claimed_at = NULL, lease_expires_at = NULL, last_error_code = 'transient', safe_error = 'Unsafe ninth retry.'
      WHERE id = ${abandoned.id}`).rejects.toMatchObject({ code: "23514" });
    await sql`CREATE OR REPLACE FUNCTION test_delay_source_preparation_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM source_preparation_command WHERE id = NEW.idempotency_key) THEN
          PERFORM pg_sleep(4);
        END IF;
        RETURN NEW;
      END;
    $$`;
    await sql`DROP TRIGGER IF EXISTS test_delay_source_preparation_receipt ON campaign_preparation`;
    await sql`CREATE TRIGGER test_delay_source_preparation_receipt
      AFTER INSERT ON campaign_preparation FOR EACH ROW EXECUTE FUNCTION test_delay_source_preparation_receipt()`;
    let preparationPromise: ReturnType<CampaignPreparationRepository["prepare"]> | undefined;
    let prepared: Awaited<ReturnType<CampaignPreparationRepository["prepare"]>> | undefined;
    try {
      preparationPromise = f.preparations.prepare(recoverable.configurationSnapshot, recoverable.id,
        recoverable.writerUserId, { expectedReviewFingerprint: recoverable.expectedReviewFingerprint,
          expectedApprovalId: recoverable.expectedApprovalId });
      await expect.poll(async () => (await sql<{ sleeping: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE pid <> pg_backend_pid() AND datname = current_database()
            AND query ILIKE '%INSERT INTO campaign_preparation%'
            AND wait_event = 'PgSleep') AS sleeping
      `)[0]!.sleeping, { timeout: 3_000, interval: 25 }).toBe(true);
      await expect.poll(async () => (await sql<{ expired: boolean }[]>`
        SELECT bool_and(clock_timestamp() >= lease_expires_at) AS expired
        FROM source_preparation_command WHERE id IN ${sql(claims.map((command) => command.id))}
      `)[0]!.expired, { timeout: 3_000, interval: 25 }).toBe(true);

      // The in-flight receipt owns SHARE on its command. Lock-first cap cleanup
      // must skip it, while independently closing the other exhausted command.
      await expect(f.sourcePreparations.claimSourcePreparationCommands(2, 30)).resolves.toEqual({
        commands: [], recovered: 0, deadLettered: 1,
      });
      prepared = await preparationPromise;
    } finally {
      if (preparationPromise) await Promise.allSettled([preparationPromise]);
      await sql`DROP TRIGGER IF EXISTS test_delay_source_preparation_receipt ON campaign_preparation`;
      await sql`DROP FUNCTION IF EXISTS test_delay_source_preparation_receipt()`;
    }
    await expect(f.sourcePreparations.claimSourcePreparationCommands(2, 30)).resolves.toEqual({
      commands: [], recovered: 1, deadLettered: 0,
    });
    const summaries = await f.sourcePreparations.listSourcePreparationCommands(
      f.workspace.workspaceId, f.source.id, f.owner.id,
    );
    expect(summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: recoverable.id, status: "completed", attemptCount: 8,
        preparationId: prepared!.preparation.id, campaignId: prepared!.preparation.campaignId }),
      expect.objectContaining({ id: abandoned.id, status: "dead_letter", attemptCount: 8,
        lastErrorCode: "attempt_limit_exhausted" }),
    ]));
    expect(summaries.every((command) => command.attemptCount <= 8)).toBe(true);
  }), 25_000);
});
