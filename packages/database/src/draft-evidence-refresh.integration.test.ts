import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { CampaignRepository } from "./campaign-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { DraftRepository } from "./draft-repository";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!databaseName.startsWith("market_me_qa_") && databaseName !== "market_me_ci") {
    throw new Error("Draft evidence integration tests require an isolated market_me_qa_* or market_me_ci database.");
  }
}
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("immutable draft evidence after source refresh", () => {
  afterAll(async () => sql?.end());

  it("retains each approved claim's original evidence references while new drafts use the refreshed package", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const campaigns = new CampaignRepository(sql);
    const drafts = new DraftRepository(sql);
    const { user, workspace } = await core.bootstrapDevelopmentWorkspace({
      email: `draft-evidence-refresh-${randomUUID()}@market-me.local`,
      displayName: "Draft Evidence Refresh Integration Test",
    });

    try {
      const source = await core.createSmartSource({
        workspaceId: workspace.workspaceId,
        name: "Immutable evidence fixture",
        provider: "local",
        locations: [{ providerLocationId: "fixture", displayPath: "/Fixtures" }],
        recursive: false,
        readinessMode: "immediate",
        stabilizationWindowSeconds: 0,
        allowedMimeTypes: ["text/plain"],
        ignorePatterns: [],
        contextPackIds: [],
        autonomyMode: "draft_only",
        enabled: true,
      }, user.id);
      const sourceItem = {
        workspaceId: workspace.workspaceId,
        smartSourceId: source.id,
        providerItemId: "evidence-refresh-source",
        name: "facts.txt",
        displayPath: "/Fixtures/facts.txt",
        mimeType: "text/plain",
        isFolder: false,
      };
      await core.applySourceItemChanges({
        workspaceId: workspace.workspaceId,
        smartSourceId: source.id,
        upserts: [{ ...sourceItem, contentHash: "sha256:evidence-refresh-v1" }],
        deletedProviderItemIds: [],
      });
      const item = (await core.getSourceItemByProviderId(source.id, sourceItem.providerItemId))!;
      const originalEvidenceIds = [randomUUID(), randomUUID()];
      const packageInput = {
        workspaceId: workspace.workspaceId,
        smartSourceId: source.id,
        rootSourceItemId: item.id,
        title: "Community event",
        status: "ready" as const,
        contextPackVersionIds: [],
        assets: [],
        conflicts: [],
      };
      const originalPackage = await core.saveContentPackage({
        ...packageInput,
        evidence: [
          {
            id: originalEvidenceIds[0]!, factKey: "event.price", claim: "Admission is free.",
            provenance: "authoritative_context", sourceReferences: [`source-item:${item.id}`, "revision:1"], confidence: 1,
          },
          {
            id: originalEvidenceIds[1]!, factKey: "event.time", claim: "Doors open at nine.",
            provenance: "observed", sourceReferences: [`source-item:${item.id}`, "revision:1"], confidence: 0.95,
          },
        ],
      });
      expect((await core.approveContentPackage({
        workspaceId: workspace.workspaceId, packageId: originalPackage.id, actorUserId: user.id,
      }))?.status).toBe("approved");

      const campaign = await campaigns.createCampaign({
        workspaceId: workspace.workspaceId,
        name: "Evidence-only planning fixture",
        description: "No activation, channel connection, or external publication.",
        objective: "awareness",
        contentPackageIds: [originalPackage.id],
        audienceProfileVersionIds: [],
        informationDepth: "contextual",
        promotionalStrength: "informational",
        autonomyMode: "draft_only",
        timezone: "UTC",
        context: {},
        steps: [{
          id: "review", name: "Review copy", operationType: "request_approval",
          desiredCapability: "workflow.approval", dependsOn: [], inputs: {}, outputs: {},
          executionMethods: ["manual_handoff"], approvalRequired: true,
        }],
      }, user.id);
      await campaigns.publishCampaign(workspace.workspaceId, campaign.id);
      const generationInput = {
        workspaceId: workspace.workspaceId, campaignId: campaign.id, contentPackageId: originalPackage.id,
      };
      const generated = await drafts.generate(generationInput, user.id);
      expect(generated).toHaveLength(1);
      const originalDraft = generated[0]!;
      const editableDraft = (await drafts.generate(generationInput, user.id))[0]!;
      expect(originalDraft.currentVersion.claims.filter((claim) => claim.kind === "fact")
        .flatMap((claim) => claim.evidenceItemIds).sort()).toEqual([...originalEvidenceIds].sort());
      await drafts.submit(workspace.workspaceId, originalDraft.id, user.id);
      const approval = (await drafts.listApprovals(workspace.workspaceId))[0]!;
      const approvedDraft = (await drafts.decide({
        workspaceId: workspace.workspaceId, approvalId: approval.id,
        decision: "approved", actorUserId: user.id,
      }))!;
      expect(approvedDraft.status).toBe("approved");
      const originalSnapshot = approvedDraft.generation.evidenceSnapshot;
      const originalClaims = approvedDraft.currentVersion.claims;

      // Exercise the same upsert and replacement path as ingestion, not an in-place evidence edit.
      const changed = await core.applySourceItemChanges({
        workspaceId: workspace.workspaceId,
        smartSourceId: source.id,
        upserts: [{ ...sourceItem, contentHash: "sha256:evidence-refresh-v2" }],
        deletedProviderItemIds: [],
      });
      expect(changed.changedCount).toBe(1);
      const refreshedEvidenceId = randomUUID();
      const refreshedPackage = await core.saveContentPackage({
        ...packageInput,
        evidence: [{
          id: refreshedEvidenceId, factKey: "event.price", claim: "Admission costs ten dollars.",
          provenance: "authoritative_context", sourceReferences: [`source-item:${item.id}`, "revision:2"], confidence: 1,
        }],
      });
      expect(refreshedPackage.id).toBe(originalPackage.id);
      expect(refreshedPackage.version).toBe(originalPackage.version + 1);
      expect(refreshedPackage.status).toBe("ready");
      expect(refreshedPackage.evidence.map((entry) => entry.id)).toEqual([refreshedEvidenceId]);
      await expect(drafts.generate(generationInput, user.id)).rejects.toMatchObject({
        name: "DraftValidationError", issues: [{ code: "package_not_approved" }],
      });

      const historical = (await drafts.get(workspace.workspaceId, originalDraft.id))!;
      expect(historical.generation.contentPackageVersion).toBe(originalPackage.version);
      expect(historical.generation.evidenceSnapshot).toEqual(originalSnapshot);
      expect(historical.currentVersion.id).toBe(approvedDraft.currentVersion.id);
      expect(historical.currentVersion.body).toBe(approvedDraft.currentVersion.body);
      // Historical approval refers to the retained old version; it must not approve the new package.
      expect(historical.status).toBe("approved");
      expect.soft(historical.currentVersion.claims,
        "Refreshing source evidence must not erase an approved draft's per-claim snapshot references").toEqual(originalClaims);
      const snapshotIds = new Set(historical.generation.evidenceSnapshot.map((entry) => entry.id));
      for (const claim of historical.currentVersion.claims.filter((entry) => entry.kind === "fact")) {
        expect.soft(claim.evidenceItemIds.length, `Historical fact must remain grounded: ${claim.text}`).toBeGreaterThan(0);
        expect(claim.evidenceItemIds.every((id) => snapshotIds.has(id))).toBe(true);
        expect(claim.evidenceItemIds).not.toContain(refreshedEvidenceId);
      }
      const revised = (await drafts.revise({
        workspaceId: workspace.workspaceId, draftId: editableDraft.id,
        leadIn: "For returning members", hashtags: ["#Community"],
        changeNote: "Presentation-only revision after source refresh", actorUserId: user.id,
      }))!;
      expect(revised.currentVersion.versionNumber).toBe(2);
      expect(revised.currentVersion.claims.filter((claim) => claim.kind === "fact")
        .map(({ text, evidenceItemIds }) => ({ text, evidenceItemIds })))
        .toEqual(editableDraft.currentVersion.claims.filter((claim) => claim.kind === "fact")
          .map(({ text, evidenceItemIds }) => ({ text, evidenceItemIds })));
      expect(revised.generation.evidenceSnapshot).toEqual(editableDraft.generation.evidenceSnapshot);
      expect(await drafts.get(randomUUID(), originalDraft.id)).toBeUndefined();
      expect(await drafts.revise({
        workspaceId: randomUUID(), draftId: editableDraft.id, leadIn: "Unauthorized", hashtags: [],
        changeNote: "Must not cross workspace", actorUserId: user.id,
      })).toBeUndefined();
      await expect(sql`
        INSERT INTO content_draft_claim_evidence (content_draft_claim_id, evidence_item_id)
        VALUES (${originalClaims[0]!.id}, ${refreshedEvidenceId})
      `).rejects.toMatchObject({ code: "23514" });
      await expect(sql`
        UPDATE content_draft_claim_evidence SET evidence_item_id = ${refreshedEvidenceId}
        WHERE content_draft_claim_id = ${originalClaims[0]!.id}
      `).rejects.toMatchObject({ code: "23514" });
      const firstFact = originalClaims.find((claim) => claim.kind === "fact")!;
      await expect(sql`UPDATE content_draft_claim SET sort_order = -1 WHERE id = ${firstFact.id}`)
        .rejects.toMatchObject({ code: "23514" });
      await expect(sql`UPDATE content_draft_claim SET sort_order = 0
        WHERE content_draft_version_id = ${approvedDraft.currentVersion.id} AND id <> ${firstFact.id}`)
        .rejects.toMatchObject({ code: "23505" });
      const proofTampering: readonly [string, (transaction: TransactionSql) => Promise<unknown>][] = [
        ["missing fact order", async (transaction) => transaction`
          UPDATE content_draft_version SET presentation_choices = '{}'::jsonb WHERE id = ${approvedDraft.currentVersion.id}
        `],
        ["non-array fact order", async (transaction) => transaction`
          UPDATE content_draft_version SET presentation_choices = '{"factOrder":null}'::jsonb WHERE id = ${approvedDraft.currentVersion.id}
        `],
        ["duplicate selected evidence", async (transaction) => transaction`
          UPDATE content_draft_version SET presentation_choices = ${transaction.json({ factOrder: [originalEvidenceIds[0]!, originalEvidenceIds[0]!] })}
          WHERE id = ${approvedDraft.currentVersion.id}
        `],
        ["duplicate snapshot identity with conflicting text", async (transaction) => transaction`
          UPDATE draft_generation SET evidence_snapshot = evidence_snapshot || ${transaction.json([{
            ...originalSnapshot.find((entry) => entry.id === firstFact.evidenceItemIds[0])!, claim: "Contradictory duplicate identity",
          }])}::jsonb WHERE id = ${approvedDraft.generation.id}
        `],
        ["non-array generation snapshot", async (transaction) => transaction`
          UPDATE draft_generation SET evidence_snapshot = '{}'::jsonb WHERE id = ${approvedDraft.generation.id}
        `],
        ["partial historical version with stale fact order", async (transaction) => transaction`
          DELETE FROM content_draft_claim WHERE content_draft_version_id = ${approvedDraft.currentVersion.id} AND id <> ${firstFact.id}
        `],
        ["same identity but changed snapshot claim", async (transaction) => transaction`
          UPDATE draft_generation SET evidence_snapshot = ${transaction.json(originalSnapshot.map((entry) => ({ ...entry, claim: "Not the original factual claim" })))}
          WHERE id = ${approvedDraft.generation.id}
        `],
      ];
      for (const [reason, tamper] of proofTampering) {
        const rollback = new Error(`Rollback owned proof fixture: ${reason}`);
        try {
          await sql.begin(async (transaction) => {
            await tamper(transaction);
            const valid = (await transaction<{ valid: boolean }[]>`
              SELECT draft_claim_snapshot_reference_valid(${firstFact.id}::uuid, ${firstFact.evidenceItemIds[0]!}::uuid) AS valid
            `)[0]!.valid;
            expect(valid, reason).toBe(false);
            // Re-admitting even the original ID must fail when whole-version proof is broken.
            await transaction`DELETE FROM content_draft_claim_evidence WHERE content_draft_claim_id = ${firstFact.id}`;
            await expect(transaction.savepoint(async (savepoint) => {
              await savepoint`INSERT INTO content_draft_claim_evidence (content_draft_claim_id, evidence_item_id)
                VALUES (${firstFact.id}, ${firstFact.evidenceItemIds[0]!})`;
            }), reason).rejects.toMatchObject({ code: "23514" });
            throw rollback;
          });
        } catch (error) {
          if (error !== rollback) throw error;
        }
      }
      expect((await drafts.get(workspace.workspaceId, originalDraft.id))!.currentVersion.claims).toEqual(originalClaims);

      await core.approveContentPackage({
        workspaceId: workspace.workspaceId, packageId: refreshedPackage.id, actorUserId: user.id,
      });
      const freshDraft = (await drafts.generate(generationInput, user.id))[0]!;
      expect(freshDraft.id).not.toBe(originalDraft.id);
      expect(freshDraft.status).toBe("working");
      expect(freshDraft.generation.contentPackageVersion).toBe(refreshedPackage.version);
      expect(freshDraft.generation.evidenceSnapshot.map((entry) => entry.id)).toEqual([refreshedEvidenceId]);
      expect(freshDraft.currentVersion.claims.filter((claim) => claim.kind === "fact")
        .flatMap((claim) => claim.evidenceItemIds)).toEqual([refreshedEvidenceId]);
      expect((await drafts.listApprovals(workspace.workspaceId, "approved")).map((entry) => entry.contentDraftId))
        .toEqual([originalDraft.id]);
      expect.soft((await drafts.get(workspace.workspaceId, originalDraft.id))!.currentVersion.claims,
        "Generating from a refreshed package must not rewrite earlier approved claim evidence").toEqual(originalClaims);

      // An old partially erased history must fail closed, never drop only the missing fact.
      await sql`DELETE FROM content_draft_claim_evidence WHERE content_draft_claim_id = ${revised.currentVersion.claims[0]!.id}`;
      await expect(drafts.revise({
        workspaceId: workspace.workspaceId, draftId: editableDraft.id, leadIn: "For everyone", hashtags: [],
        changeNote: "Must preserve every fact", actorUserId: user.id,
      })).rejects.toMatchObject({ name: "DraftValidationError", issues: [{ code: "facts_required" }] });
      expect((await drafts.get(workspace.workspaceId, editableDraft.id))!.currentVersion.id).toBe(revised.currentVersion.id);

      // Generation must wait for a concurrent package refresh and observe its new review state.
      let releaseRefresh!: () => void;
      let reportLock!: (pid: number) => void;
      const release = new Promise<void>((resolve) => { releaseRefresh = resolve; });
      const locked = new Promise<number>((resolve) => { reportLock = resolve; });
      const refresh = sql.begin(async (transaction) => {
        await transaction`SELECT id FROM content_package WHERE id = ${originalPackage.id} FOR UPDATE`;
        reportLock((await transaction<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]!.pid);
        await release;
        await transaction`UPDATE content_package SET status = 'ready', version = version + 1 WHERE id = ${originalPackage.id}`;
      });
      const holderPid = await locked;
      const concurrentGeneration = drafts.generate(generationInput, user.id).then(
        () => ({ succeeded: true as const }),
        (error: unknown) => ({ succeeded: false as const, error }),
      );
      try {
        await expect.poll(async () => (await sql!<{ blocked: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND ${holderPid} = ANY(pg_blocking_pids(pid))
              AND query LIKE '%content_package%' AND query LIKE '%FOR SHARE%') AS blocked
        `)[0]!.blocked, { timeout: 3_000, interval: 20 }).toBe(true);
      } finally {
        releaseRefresh();
        await refresh;
      }
      expect(await concurrentGeneration).toMatchObject({
        succeeded: false, error: { name: "DraftValidationError", issues: [{ code: "package_not_approved" }] },
      });
      // A current live row reusing an old UUID still cannot replace historical snapshot content.
      await core.saveContentPackage({
        ...packageInput,
        evidence: [{
          id: firstFact.evidenceItemIds[0]!, claim: "New live content under a reused UUID.",
          provenance: "observed", sourceReferences: ["revision:reused-identity"], confidence: 1,
        }],
      });
      const afterIdentityReuse = (await drafts.get(workspace.workspaceId, originalDraft.id))!;
      expect(afterIdentityReuse.currentVersion.claims).toEqual(originalClaims);
      expect(afterIdentityReuse.generation.evidenceSnapshot).toEqual(originalSnapshot);
    } finally {
      await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
      await sql`DELETE FROM app_user WHERE id = ${user.id}`;
    }
  });
});
