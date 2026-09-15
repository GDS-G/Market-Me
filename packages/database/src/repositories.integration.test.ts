import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { PublishingRepository } from "./publishing-repository";
import { packageReviewPrecondition } from "./test-support/package-review-fixture";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl && !/^\/(?:market_me_qa_[a-zA-Z0-9_]+|market_me_ci)$/.test(new URL(databaseUrl).pathname)) {
  throw new Error("Repository integration tests require an isolated market_me_qa_* or market_me_ci database.");
}
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("PostgreSQL repositories", () => {
  afterAll(async () => {
    await sql?.end();
  });

  it.each([
    ["rejects selecting an existing loser", [1, 2], 1, false],
    ["rejects excluding an existing winner", [0, 2], 2, false],
    ["allows a consistent repeated winner", [0, 2], 0, true],
  ] as const)("%s across overlapping live conflicts", async (_label, candidateIndexes, selectedIndex, allowed) => {
    const client = createDatabaseClient(databaseUrl!);
    const repository = new MarketMeRepository(client);
    const suffix = randomUUID();
    const { user, workspace } = await repository.bootstrapDevelopmentWorkspace({ email: `overlap-${suffix}@market-me.local`, displayName: "Overlap QA" });
    try {
      const source = await repository.createSmartSource({ workspaceId: workspace.workspaceId, name: "Overlap fixture", provider: "local",
        locations: [{ providerLocationId: suffix, displayPath: "/Fixture" }], recursive: true, readinessMode: "immediate",
        stabilizationWindowSeconds: 30, allowedMimeTypes: ["text/plain"], ignorePatterns: [], contextPackIds: [], autonomyMode: "draft_only", enabled: true }, user.id);
      await repository.applySourceItemChanges({ workspaceId: workspace.workspaceId, smartSourceId: source.id, upserts: [{ workspaceId: workspace.workspaceId,
        smartSourceId: source.id, providerItemId: suffix, name: "facts.txt", displayPath: "/Fixture/facts.txt", mimeType: "text/plain", isFolder: false, contentHash: "sha256:overlap" }], deletedProviderItemIds: [] });
      const item = (await repository.listSourceItems(source.id))[0]!;
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      const pkg = await repository.saveContentPackage({ workspaceId: workspace.workspaceId, smartSourceId: source.id, rootSourceItemId: item.id,
        title: "Overlap", status: "needs_review", contextPackVersionIds: [], assets: [], evidence: ids.map((id, index) => ({ id, factKey: `fact-${index}`,
          claim: `Fact ${index}`, provenance: "observed", sourceReferences: [`source-item:${item.id}`] })),
        conflicts: [{ factKey: "first", candidateEvidenceIds: [ids[0]!, ids[1]!] }, { factKey: "second", candidateEvidenceIds: candidateIndexes.map((index) => ids[index]!) }] });
      const first = pkg.conflicts.find((row) => row.factKey === "first")!; const second = pkg.conflicts.find((row) => row.factKey === "second")!;
      await repository.resolveEvidenceConflict({ ...await packageReviewPrecondition(client, workspace.workspaceId, pkg.id, user.id), workspaceId: workspace.workspaceId,
        packageId: pkg.id, actorUserId: user.id, conflictId: first.id, evidenceId: ids[0]! });
      const before = await packageReviewPrecondition(client, workspace.workspaceId, pkg.id, user.id);
      const operation = repository.resolveEvidenceConflict({ ...before, workspaceId: workspace.workspaceId, packageId: pkg.id, actorUserId: user.id,
        conflictId: second.id, evidenceId: ids[selectedIndex]! });
      if (allowed) {
        const after = await operation;
        expect(after?.blockers).toEqual([]); expect(after?.status).toBe("ready");
        expect(after?.effectiveEvidenceIds).toEqual([ids[0]]);
      } else {
        await expect(operation).rejects.toMatchObject({ code: "review_blocked", blockers: [{ code: "conflict_decisions_inconsistent" }] });
        expect(await packageReviewPrecondition(client, workspace.workspaceId, pkg.id, user.id)).toEqual(before);
        expect((await client<{ status: string }[]>`SELECT status FROM evidence_conflict WHERE id=${second.id}`)[0]!.status).toBe("open");
      }
      const proofCount = (await client<{ count: number }[]>`SELECT count(*)::integer AS count FROM learning_review_proof WHERE content_package_id=${pkg.id}`)[0]!.count;
      expect(proofCount).toBe(allowed ? 2 : 1);
    } finally {
      await client`DELETE FROM organization WHERE id=${workspace.organizationId}`;
      await client`DELETE FROM app_user WHERE id=${user.id}`;
      await client.end();
    }
  });

  it("persists a workspace-scoped Smart Source and its locations", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const repository = new MarketMeRepository(sql);
    const suffix = randomUUID();
    const { user, workspace } = await repository.bootstrapDevelopmentWorkspace({
      email: `integration-${suffix}@market-me.local`,
      displayName: "Integration Test",
    });

    try {
      const created = await repository.createSmartSource(
        {
          workspaceId: workspace.workspaceId,
          name: "Integration source",
          provider: "local",
          locations: [
            { providerLocationId: "fixture-folder", displayPath: "/Fixtures" },
          ],
          recursive: true,
          readinessMode: "immediate",
          stabilizationWindowSeconds: 30,
          allowedMimeTypes: ["text/plain"],
          ignorePatterns: [],
          contextPackIds: [],
          autonomyMode: "draft_only",
          enabled: true,
        },
        user.id,
      );

      const loaded = await repository.getSmartSource(
        workspace.workspaceId,
        created.id,
      );
      expect(loaded?.name).toBe("Integration source");
      expect(loaded?.locations).toEqual([
        expect.objectContaining({
          providerLocationId: "fixture-folder",
          displayPath: "/Fixtures",
        }),
      ]);

      const item = {
        workspaceId: workspace.workspaceId,
        smartSourceId: created.id,
        providerItemId: "fixture-item",
        providerParentId: "fixture-folder",
        name: "brief.txt",
        displayPath: "/Fixtures/brief.txt",
        mimeType: "text/plain",
        isFolder: false,
        contentHash: "sha256:fixture",
      };
      const firstApply = await repository.applySourceItemChanges({
        workspaceId: workspace.workspaceId,
        smartSourceId: created.id,
        upserts: [item],
        deletedProviderItemIds: [],
      });
      const replay = await repository.applySourceItemChanges({
        workspaceId: workspace.workspaceId,
        smartSourceId: created.id,
        upserts: [item],
        deletedProviderItemIds: [],
      });
      expect(firstApply.discoveredCount).toBe(1);
      expect(replay).toEqual({
        discoveredCount: 0,
        changedCount: 0,
        deletedCount: 0,
      });
      expect(await repository.listSourceItems(created.id)).toHaveLength(1);

      const deletion = await repository.applySourceItemChanges({
        workspaceId: workspace.workspaceId,
        smartSourceId: created.id,
        upserts: [],
        deletedProviderItemIds: ["fixture-item"],
      });
      expect(deletion.deletedCount).toBe(1);
      expect(await repository.listSourceItems(created.id)).toHaveLength(0);
    } finally {
      await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
      await sql`DELETE FROM app_user WHERE id = ${user.id}`;
    }
  });

  it("deduplicates webhook hints and claims them for cursor reconciliation", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const repository = new MarketMeRepository(sql);
    const suffix = randomUUID();
    const { user, workspace } = await repository.bootstrapDevelopmentWorkspace({
      email: `webhook-${suffix}@market-me.local`,
      displayName: "Webhook Integration Test",
    });

    try {
      const connectionId = await repository.saveStorageConnection({
        workspaceId: workspace.workspaceId,
        provider: "google_drive",
        displayName: "Webhook fixture",
        encryptedAccessToken: "fixture-envelope",
        scopes: ["drive.readonly"],
        createdBy: user.id,
      });
      await repository.createSmartSource(
        {
          workspaceId: workspace.workspaceId,
          storageConnectionId: connectionId,
          name: "Webhook source",
          provider: "google_drive",
          locations: [{ providerLocationId: "root", displayPath: "/" }],
          recursive: true,
          readinessMode: "immediate",
          stabilizationWindowSeconds: 30,
          allowedMimeTypes: [],
          ignorePatterns: [],
          contextPackIds: [],
          autonomyMode: "draft_only",
          enabled: true,
        },
        user.id,
      );

      expect(await repository.listWebhookSubscriptionTargets()).toContainEqual(
        expect.objectContaining({
          workspaceId: workspace.workspaceId,
          storageConnectionId: connectionId,
          provider: "google_drive",
          resource: "changes",
        }),
      );
      const webhookId = await repository.saveWebhookSubscription({
        storageConnectionId: connectionId,
        providerSubscriptionId: `channel-${suffix}`,
        providerResourceId: "resource-fixture",
        resource: "changes",
        clientStateHash: "hash-fixture",
        expiresAt: new Date(Date.now() + 60_000),
      });
      const first = await repository.enqueueWebhookEvent({
        webhookSubscriptionId: webhookId,
        providerEventId: "google:2",
        eventKind: "change",
        payload: { changed: "content" },
      });
      const replay = await repository.enqueueWebhookEvent({
        webhookSubscriptionId: webhookId,
        providerEventId: "google:2",
        eventKind: "change",
        payload: { changed: "content" },
      });
      expect(first).toBe(true);
      expect(replay).toBe(false);
      const claimed = await repository.claimWebhookEvents(10);
      expect(claimed).toContainEqual(
        expect.objectContaining({
          webhookSubscriptionId: webhookId,
          storageConnectionId: connectionId,
          providerEventId: "google:2",
          attemptCount: 1,
        }),
      );
      await repository.completeWebhookEvent(
        claimed.find((event) => event.webhookSubscriptionId === webhookId)!.id,
      );
    } finally {
      await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
      await sql`DELETE FROM app_user WHERE id = ${user.id}`;
    }
  });

  it("versions and publishes Context Packs without mutating the published snapshot", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const repository = new MarketMeRepository(sql);
    const suffix = randomUUID();
    const { user, workspace } = await repository.bootstrapDevelopmentWorkspace({
      email: `context-${suffix}@market-me.local`,
      displayName: "Context Integration Test",
    });
    const sourceId = randomUUID();
    const draft = {
      workspaceId: workspace.workspaceId,
      name: `Launch facts ${suffix}`,
      description: "Approved launch context",
      instructions: "Prefer the approved calendar for launch dates.",
      authorityRules: [
        {
          factKey: "launch.date",
          preferredSourceIds: [sourceId],
          resolution: "prefer_authority" as const,
        },
      ],
      sources: [
        {
          clientKey: sourceId,
          kind: "manual_text" as const,
          label: "Approved calendar",
          sourceReference: `manual:${suffix}`,
          selectedSections: ["Launch date"],
          authorityRank: 100,
          contentText: "Launch date: September 1, 2026",
        },
      ],
      facts: [
        {
          factKey: "launch.date",
          value: "2026-09-01",
          sourceClientKey: sourceId,
          status: "accepted" as const,
        },
      ],
    };

    try {
      const created = await repository.createContextPack(draft, user.id);
      expect(created.draftVersion).toEqual(
        expect.objectContaining({ versionNumber: 1, status: "draft" }),
      );
      const firstPublished = await repository.publishContextPack(
        workspace.workspaceId,
        created.id,
        user.id,
      );
      expect(firstPublished?.currentVersion).toEqual(
        expect.objectContaining({ versionNumber: 1, status: "published" }),
      );
      expect(firstPublished?.draftVersion).toBeUndefined();

      const secondSourceId = randomUUID();
      const secondDraft = await repository.saveContextPackDraft(
        created.id,
        {
          ...draft,
          instructions: "Use the revised approved calendar.",
          authorityRules: [
            {
              factKey: "launch.date",
              preferredSourceIds: [secondSourceId],
              resolution: "prefer_authority",
            },
          ],
          sources: [
            {
              ...draft.sources[0],
              clientKey: secondSourceId,
              sourceReference: `manual:${suffix}:v2`,
              contentText: "Launch date: September 3, 2026",
            },
          ],
          facts: [
            {
              ...draft.facts[0],
              value: "2026-09-03",
              sourceClientKey: secondSourceId,
            },
          ],
        },
        user.id,
      );
      expect(secondDraft?.currentVersion?.facts[0].value).toBe("2026-09-01");
      expect(secondDraft?.draftVersion).toEqual(
        expect.objectContaining({ versionNumber: 2, status: "draft" }),
      );

      const secondPublished = await repository.publishContextPack(
        workspace.workspaceId,
        created.id,
        user.id,
      );
      expect(secondPublished?.currentVersion?.facts[0].value).toBe(
        "2026-09-03",
      );
      const versions = await sql<{ versionNumber: number; status: string }[]>`
        SELECT version_number, status FROM context_pack_version
        WHERE context_pack_id = ${created.id} ORDER BY version_number
      `;
      expect(versions).toEqual([
        expect.objectContaining({ versionNumber: 1, status: "superseded" }),
        expect.objectContaining({ versionNumber: 2, status: "published" }),
      ]);
    } finally {
      await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
      await sql`DELETE FROM app_user WHERE id = ${user.id}`;
    }
  });

  it("persists evidence-backed Content Packages and claims ingestion work", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const repository = new MarketMeRepository(sql);
    const suffix = randomUUID();
    const { user, workspace } = await repository.bootstrapDevelopmentWorkspace({
      email: `package-${suffix}@market-me.local`,
      displayName: "Package Integration Test",
    });
    try {
      const source = await repository.createSmartSource(
        {
          workspaceId: workspace.workspaceId,
          name: "Package source",
          provider: "local",
          locations: [
            { providerLocationId: "fixture", displayPath: "/Fixture" },
          ],
          recursive: true,
          readinessMode: "immediate",
          stabilizationWindowSeconds: 0,
          allowedMimeTypes: ["image/png"],
          ignorePatterns: [],
          contextPackIds: [],
          autonomyMode: "draft_only",
          enabled: true,
        },
        user.id,
      );
      await repository.applySourceItemChanges({
        workspaceId: workspace.workspaceId,
        smartSourceId: source.id,
        upserts: [
          {
            workspaceId: workspace.workspaceId,
            smartSourceId: source.id,
            providerItemId: "package-item",
            name: "launch.png",
            displayPath: "/Fixture/launch.png",
            mimeType: "image/png",
            isFolder: false,
            contentHash: "sha256:fixture",
          },
        ],
        deletedProviderItemIds: [],
      });
      const item = await repository.getSourceItemByProviderId(
        source.id,
        "package-item",
      );
      expect(item).toBeDefined();
      const work = await repository.claimIngestionEvents(10);
      const event = work.find(
        (candidate) => candidate.smartSourceId === source.id,
      );
      expect(event).toEqual(
        expect.objectContaining({
          providerItemId: "package-item",
          attemptCount: 1,
        }),
      );
      await repository.finishIngestionEvent({
        eventId: event!.id,
        status: "processed",
      });
      const evidenceId = randomUUID();
      const unresolvedEvidenceId = randomUUID();
      const saved = await repository.saveContentPackage({
        workspaceId: workspace.workspaceId,
        smartSourceId: source.id,
        rootSourceItemId: item!.id,
        title: "Launch",
        status: "needs_review",
        contextPackVersionIds: [],
        assets: [
          {
            clientKey: "original",
            sourceItemId: item!.id,
            role: "original",
            fileName: "launch.png",
            mimeType: "image/png",
            contentHash: "sha256:fixture",
            objectKey:
              "originals/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/source",
            byteSize: 2048,
            processingVersion: "image-v1",
            recipe: { operation: "immutable_original" },
            mediaStatus: "processed",
            scanStatus: "clean",
            scanEngine: "clamd-test",
            scanScannedAt: "2026-08-12T00:00:00.000Z",
            scanRevision: 1,
            rightsStatus: "unchecked",
            altText: "Launch graphic",
            altTextStatus: "needs_review",
            extractionStatus: "skipped",
            metadata: {
              displayPath: "/Fixture/launch.png",
              width: 1200,
              height: 630,
            },
          },
          {
            clientKey: "derivative:web_preview",
            sourceAssetClientKey: "original",
            role: "derivative",
            fileName: "launch-web-preview.webp",
            mimeType: "image/webp",
            contentHash: "sha256:derivative",
            objectKey:
              "derivatives/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/image-v1/preview.webp",
            byteSize: 1024,
            processingVersion: "image-v1",
            recipe: { name: "web_preview", width: 1200 },
            mediaStatus: "processed",
            scanStatus: "clean",
            scanEngine: "clamd-test",
            scanScannedAt: "2026-08-12T00:00:00.000Z",
            scanRevision: 1,
            rightsStatus: "unchecked",
            altTextStatus: "not_applicable",
            extractionStatus: "skipped",
            metadata: { width: 1200, height: 630 },
          },
        ],
        evidence: [
          {
            id: evidenceId,
            factKey: "launch.date",
            claim: "launch.date: unknown",
            provenance: "authoritative_context",
            sourceReferences: [`source-item:${item!.id}`],
          },
          {
            id: unresolvedEvidenceId,
            factKey: "launch.owner",
            claim: "No authoritative launch owner was supplied.",
            provenance: "unresolved",
            sourceReferences: [`source-item:${item!.id}`],
          },
        ],
        conflicts: [
          { factKey: "launch.date", candidateEvidenceIds: [evidenceId] },
        ],
      });
      expect(saved.assets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "original",
            altTextStatus: "needs_review",
            objectKey: expect.stringMatching(/^originals\//),
          }),
          expect.objectContaining({
            role: "derivative",
            sourceAssetId: expect.any(String),
            processingVersion: "image-v1",
          }),
        ]),
      );
      expect(saved.evidence[0]).toEqual(
        expect.objectContaining({
          factKey: "launch.date",
          provenance: "authoritative_context",
        }),
      );
      expect(saved.conflicts[0]).toEqual(
        expect.objectContaining({ factKey: "launch.date", status: "open" }),
      );
      const precondition = () => packageReviewPrecondition(sql!, workspace.workspaceId, saved.id, user.id);
      const approvalInput = async () => ({ ...await precondition(), workspaceId: workspace.workspaceId,
        packageId: saved.id, actorUserId: user.id, idempotencyKey: randomUUID() });
      // An exact token is not permission to overwrite an ingestion/execution state.
      await sql`UPDATE content_package SET status='executing' WHERE id=${saved.id}`;
      const blockedInput = { ...await precondition(), workspaceId: workspace.workspaceId, packageId: saved.id, actorUserId: user.id };
      const materialState = () => sql!`SELECT jsonb_build_object('package',to_jsonb(p),
        'assets',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM content_asset a WHERE a.content_package_id=p.id),
        'evidence',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM evidence_item e WHERE e.content_package_id=p.id),
        'conflicts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM evidence_conflict c WHERE c.content_package_id=p.id)) AS state
        FROM content_package p WHERE p.id=${saved.id}`;
      const unchanged = await materialState();
      const originalImageId = saved.assets.find((asset) => asset.role === "original")!.id;
      await expect(repository.updateAssetAccessibility({ ...blockedInput, assetId: originalImageId, decorative: true })).rejects.toMatchObject({ code: "review_blocked" });
      await expect(repository.reviewAssetRights({ ...blockedInput, assetId: originalImageId, status: "restricted", owner: "Owner",
        sourceReference: "source:test", proofReference: "proof:test", reviewNote: "Review", commercialUseAllowed: false, derivativeUseAllowed: false,
        worldwideUseAllowed: false, permittedChannels: [], permittedChannelConnectionIds: [], permittedCampaignIds: [], permittedBrandProfileIds: [] }, user.id)).rejects.toMatchObject({ code: "review_blocked" });
      await expect(repository.resolveEvidenceConflict({ ...blockedInput, conflictId: saved.conflicts[0].id, evidenceId })).rejects.toMatchObject({ code: "review_blocked" });
      await expect(repository.resolveUnresolvedEvidence({ ...blockedInput, evidenceId: unresolvedEvidenceId, correctedClaim: "Must not write" })).rejects.toMatchObject({ code: "review_blocked" });
      expect(await materialState()).toEqual(unchanged);
      expect((await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM learning_review WHERE content_package_id=${saved.id}`)[0]!.count).toBe(0);
      expect((await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM audit_event WHERE workspace_id=${workspace.workspaceId}
        AND event_type IN ('content_asset.accessibility_updated','content_asset.rights_reviewed','content_package.conflict_resolved','content_package.evidence_corrected')`)[0]!.count).toBe(0);
      await sql`UPDATE content_package SET status=${saved.status} WHERE id=${saved.id}`;
      const originalReview = await precondition();
      const resolved = await repository.resolveEvidenceConflict({
        ...originalReview,
        workspaceId: workspace.workspaceId,
        packageId: saved.id,
        conflictId: saved.conflicts[0].id,
        evidenceId,
        actorUserId: user.id,
      });
      expect(resolved?.status).toBe("needs_review");
      await expect(repository.resolveEvidenceConflict({ ...originalReview, workspaceId: workspace.workspaceId,
        packageId: saved.id, conflictId: saved.conflicts[0].id, evidenceId, actorUserId: user.id })).rejects.toMatchObject({ code: "review_changed" });
      await expect(repository.resolveEvidenceConflict({ ...await precondition(), workspaceId: workspace.workspaceId,
        packageId: saved.id, conflictId: saved.conflicts[0].id, evidenceId, actorUserId: user.id })).rejects.toMatchObject({ code: "conflict_not_open" });
      await expect(repository.approveContentPackage(await approvalInput())).rejects.toMatchObject({ code: "review_blocked" });
      const corrected = await repository.resolveUnresolvedEvidence({
        ...await precondition(),
        workspaceId: workspace.workspaceId,
        packageId: saved.id,
        evidenceId: unresolvedEvidenceId,
        correctedClaim: "Jordan Lee owns the launch.",
        note: "Confirmed during Learning Review.",
        actorUserId: user.id,
      });
      expect(corrected?.status).toBe("needs_review");
      expect(corrected?.snapshot.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: unresolvedEvidenceId,
            provenance: "unresolved",
            supersededByEvidenceId: expect.any(String),
          }),
          expect.objectContaining({
            factKey: "launch.owner",
            claim: "Jordan Lee owns the launch.",
            provenance: "authoritative_context",
          }),
        ]),
      );
      await expect(repository.approveContentPackage(await approvalInput())).rejects.toMatchObject({ code: "review_blocked" });
      const reviewed = await repository.updateAssetAccessibility({
        ...await precondition(),
        workspaceId: workspace.workspaceId,
        packageId: saved.id,
        assetId: saved.assets.find((asset) => asset.role === "original")!.id,
        altText: "A blue launch announcement graphic with the September date.",
        decorative: false,
        actorUserId: user.id,
      });
      expect(
        reviewed?.snapshot.assets.find((asset) => asset.role === "original")?.accessibility,
      ).toEqual(
        expect.objectContaining({
          status: "approved",
          altText:
            "A blue launch announcement graphic with the September date.",
        }),
      );
      const rightsConnection = await new PublishingRepository(
        sql,
      ).saveChannelConnection(
        {
          workspaceId: workspace.workspaceId,
          provider: "discord_webhook",
          name: "Rights-scoped publishing account",
          encryptedCredentials: "test-envelope",
          capabilities: {},
        },
        user.id,
      );
      const restrictedRights = await repository.reviewAssetRights(
        {
          ...await precondition(),
          workspaceId: workspace.workspaceId,
          packageId: saved.id,
          assetId: saved.assets.find((asset) => asset.role === "original")!.id,
          status: "restricted",
          owner: "Fixture Rights Owner",
          sourceReference: "source:fixture-launch",
          proofReference: "license:fixture-restricted",
          commercialUseAllowed: true,
          derivativeUseAllowed: true,
          worldwideUseAllowed: true,
          permittedChannels: ["discord_webhook"],
          permittedChannelConnectionIds: [rightsConnection.id],
          permittedCampaignIds: [],
          permittedBrandProfileIds: [],
          attributionRequirement:
            "Credit is required but not execution-verifiable.",
          reviewNote: "Keep restricted until attribution can be enforced.",
        },
        user.id,
      );
      expect(
        restrictedRights?.snapshot.assets.filter((asset) =>
          asset.mimeType.startsWith("image/"),
        ).map((asset) => asset.rights),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "restricted",
            revision: 1,
          }),
        ]),
      );
      await expect(repository.approveContentPackage(await approvalInput())).rejects.toMatchObject({ code: "review_blocked" });
      const clearedRights = await repository.reviewAssetRights(
        {
          ...await precondition(),
          workspaceId: workspace.workspaceId,
          packageId: saved.id,
          assetId: saved.assets.find((asset) => asset.role === "original")!.id,
          status: "cleared",
          owner: "Fixture Rights Owner",
          licenseOwner: "Fixture Licensee",
          sourceReference: "source:fixture-launch",
          proofReference: "license:fixture-cleared",
          commercialUseAllowed: true,
          derivativeUseAllowed: true,
          worldwideUseAllowed: true,
          permittedChannels: ["discord_webhook"],
          permittedChannelConnectionIds: [rightsConnection.id],
          permittedCampaignIds: [],
          permittedBrandProfileIds: [],
          validFrom: "2026-01-01T00:00:00.123456-05:00",
          expiresAt: "2099-08-12T00:00:00.123457-05:00",
          reviewNote: "Worldwide commercial Discord use reviewed and cleared.",
        },
        user.id,
      );
      expect(
        clearedRights?.snapshot.assets.filter((asset) =>
          asset.mimeType.startsWith("image/"),
        ).map((asset) => asset.rights),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "cleared",
            owner: "Fixture Rights Owner",
            reviewedBy: user.id,
            revision: 2,
            validFromUtcMicros: "2026-01-01T05:00:00.123456Z",
            expiresAtUtcMicros: "2099-08-12T05:00:00.123457Z",
          }),
        ]),
      );
      expect(
        await repository.getContentAssetForAccess(
          saved.assets.find((asset) => asset.role === "derivative")!.id,
        ),
      ).toEqual(
        expect.objectContaining({
          mimeType: "image/webp",
          byteSize: 1024,
        }),
      );
      const originalAssetId = saved.assets.find(
        (asset) => asset.role === "original",
      )!.id;
      const precision = (await sql<{ exact: boolean }[]>`SELECT rights_valid_from='2026-01-01T05:00:00.123456Z'::timestamptz
        AND rights_expires_at='2099-08-12T05:00:00.123457Z'::timestamptz AS exact FROM content_asset WHERE id=${originalAssetId}`)[0]!;
      expect(precision.exact).toBe(true);
      // Synthetic scan changes model the package-root writer contract; no scanner/network is invoked.
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM content_package WHERE id=${saved.id} FOR UPDATE`;
        await tx`UPDATE content_asset SET scan_status = 'failed', scan_revision = scan_revision + 1 WHERE id = ${originalAssetId}`;
      });
      await expect(repository.approveContentPackage(await approvalInput())).rejects.toMatchObject({ code: "review_blocked" });
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM content_package WHERE id=${saved.id} FOR UPDATE`;
        await tx`UPDATE content_asset SET scan_status = 'clean', scan_engine = 'clamd-test', scan_scanned_at = clock_timestamp(), scan_revision = scan_revision + 1 WHERE id = ${originalAssetId}`;
      });
      const finalApprovalInput = await approvalInput();
      const finalApproval = await repository.approveContentPackage(finalApprovalInput);
      expect(finalApproval.review?.status).toBe("approved");
      expect(finalApproval.review?.currentApprovalValid).toBe(true);
      expect(finalApproval.approval.reviewSnapshot.assets.find((asset) => asset.id === originalAssetId)?.rights.expiresAtUtcMicros).toBe("2099-08-12T05:00:00.123457Z");
      expect((await repository.approveContentPackage(finalApprovalInput)).replayed).toBe(true);
      const proofs = await sql<{ action: string; decisionSnapshot: Record<string, unknown> }[]>`
        SELECT action,decision_snapshot FROM learning_review_proof WHERE workspace_id=${workspace.workspaceId}`;
      expect(proofs.map((row) => row.action).sort()).toEqual(["conflict_resolved", "corrected", "package_approved"]);
      expect(JSON.stringify(proofs)).toContain(unresolvedEvidenceId);
      expect(JSON.stringify(proofs)).toContain("No authoritative launch owner was supplied.");
      const rightsAudits = await sql<{ data: Record<string, unknown> }[]>`
        SELECT data FROM audit_event
        WHERE workspace_id = ${workspace.workspaceId}
          AND event_type = 'content_asset.rights_reviewed'
        ORDER BY created_at
      `;
      expect(rightsAudits).toHaveLength(2);
      expect(rightsAudits[1]!.data).toMatchObject({ beforeStatus: "restricted", afterStatus: "cleared",
        beforeRevision: 1, afterRevision: 2, permittedChannelCount: 1, permittedChannelConnectionCount: 1,
        permittedCampaignCount: 0, permittedBrandProfileCount: 0, hasExpiration: true, hasOutstandingRequirements: false });
      expect(JSON.stringify(rightsAudits)).not.toContain("license:fixture-cleared");
      expect(JSON.stringify(rightsAudits)).not.toContain("Fixture Rights Owner");
      expect(JSON.stringify(rightsAudits)).not.toContain("test-envelope");
      expect(
        await repository.listContentPackages(workspace.workspaceId),
      ).toHaveLength(1);
    } finally {
      await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
      await sql`DELETE FROM app_user WHERE id = ${user.id}`;
    }
  });
});
