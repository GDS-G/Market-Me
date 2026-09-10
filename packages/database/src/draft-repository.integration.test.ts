import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DISCORD_WEBHOOK_CAPABILITIES, MAILCHIMP_EMAIL_CAPABILITIES, mastodonCapabilities } from "@market-me/connectors";
import { CampaignRepository } from "./campaign-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { DraftRepository } from "./draft-repository";
import { ProfileRepository } from "./profile-repository";
import { PublishingRepository } from "./publishing-repository";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("governed draft repository", () => {
  afterAll(async () => sql?.end());

  it("captures exact evidence, generates audience variants, and approves an immutable version", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const profiles = new ProfileRepository(sql);
    const campaigns = new CampaignRepository(sql);
    const drafts = new DraftRepository(sql);
    const publishing = new PublishingRepository(sql);
    const suffix = randomUUID();
    const { user, workspace } = await core.bootstrapDevelopmentWorkspace({
      email: `draft-${suffix}@market-me.local`,
      displayName: "Draft Integration Test",
    });
    try {
      const source = await core.createSmartSource(
        {
          workspaceId: workspace.workspaceId,
          name: "Draft fixture",
          provider: "local",
          locations: [
            { providerLocationId: "fixture", displayPath: "C:\\fixture" },
          ],
          recursive: true,
          readinessMode: "immediate",
          stabilizationWindowSeconds: 0,
          allowedMimeTypes: ["text/plain"],
          ignorePatterns: [],
          contextPackIds: [],
          autonomyMode: "draft_only",
          enabled: true,
        },
        user.id,
      );
      await core.applySourceItemChanges({
        workspaceId: workspace.workspaceId,
        smartSourceId: source.id,
        upserts: [
          {
            workspaceId: workspace.workspaceId,
            smartSourceId: source.id,
            providerItemId: "draft-source",
            name: "facts.txt",
            displayPath: "C:\\fixture\\facts.txt",
            mimeType: "text/plain",
            isFolder: false,
            contentHash: "sha256:draft-fixture",
          },
        ],
        deletedProviderItemIds: [],
      });
      const item = await core.getSourceItemByProviderId(
        source.id,
        "draft-source",
      );
      const firstEvidenceId = randomUUID();
      const secondEvidenceId = randomUUID();
      const saved = await core.saveContentPackage({
        workspaceId: workspace.workspaceId,
        smartSourceId: source.id,
        rootSourceItemId: item!.id,
        title: "Evidence-backed launch",
        status: "ready",
        contextPackVersionIds: [],
        assets: [],
        evidence: [
          {
            id: firstEvidenceId,
            factKey: "launch.price",
            claim: "Admission is free",
            provenance: "authoritative_context",
            sourceReferences: [`source-item:${item!.id}`],
            confidence: 1,
          },
          {
            id: secondEvidenceId,
            factKey: "launch.time",
            claim: "Doors open at nine",
            provenance: "observed",
            sourceReferences: [`source-item:${item!.id}`],
            confidence: 0.95,
          },
        ],
        conflicts: [],
      });
      const approved = await core.approveContentPackage({
        workspaceId: workspace.workspaceId,
        packageId: saved.id,
        actorUserId: user.id,
      });
      expect(approved?.status).toBe("approved");
      const originalAssetId = randomUUID();
      const derivativeAssetId = randomUUID();
      await sql`
        INSERT INTO content_asset (id, content_package_id, source_item_id, role, file_name, mime_type, content_hash,
          extraction_status, metadata, object_key, byte_size, media_status, scan_status, scan_engine, scan_scanned_at, scan_revision, rights_status, alt_text, alt_text_status)
        VALUES (${originalAssetId}, ${saved.id}, ${item!.id}, 'original', 'launch.png', 'image/png', 'sha256:original',
          'skipped', '{}'::jsonb, ${`originals/${"a".repeat(64)}/launch.png`}, 4, 'processed', 'clean', 'clamd-test', now(), 1, 'unchecked', 'Blue launch graphic', 'approved')
      `;
      await sql`
        INSERT INTO content_asset (id, content_package_id, source_asset_id, role, file_name, mime_type, content_hash,
          extraction_status, metadata, object_key, byte_size, media_status, scan_status, scan_engine, scan_scanned_at, scan_revision, rights_status, alt_text_status)
        VALUES (${derivativeAssetId}, ${saved.id}, ${originalAssetId}, 'derivative', 'launch.webp', 'image/webp', 'sha256:derivative',
          'skipped', '{}'::jsonb, ${`derivatives/${"b".repeat(64)}/launch.webp`}, 3, 'processed', 'clean', 'clamd-test', now(), 1, 'unchecked', 'not_applicable')
      `;
      const connection = await publishing.saveChannelConnection(
        {
          workspaceId: workspace.workspaceId,
          provider: "discord_webhook",
          name: "Preview channel",
          encryptedCredentials: "test-envelope",
          capabilities: DISCORD_WEBHOOK_CAPABILITIES as unknown as Record<
            string,
            unknown
          >,
        },
        user.id,
      );
      const unauthorizedConnection = await publishing.saveChannelConnection(
        {
          workspaceId: workspace.workspaceId,
          provider: "discord_webhook",
          name: "Unauthorized channel",
          encryptedCredentials: "test-envelope-other",
          capabilities: DISCORD_WEBHOOK_CAPABILITIES as unknown as Record<
            string,
            unknown
          >,
        },
        user.id,
      );
      const emailConnection = await publishing.saveChannelConnection(
        {
          workspaceId: workspace.workspaceId,
          provider: "mailchimp_email",
          name: "Customer newsletter",
          encryptedCredentials: "test-mailchimp-envelope",
          configuration: { audienceId: "audience_1", audienceName: "Customers", dataCenter: "us21", fromName: "Market Me", replyTo: "owner@example.com" },
          capabilities: MAILCHIMP_EMAIL_CAPABILITIES as unknown as Record<string, unknown>,
        },
        user.id,
      );
      const mastodonMedia = {
        attachmentsPerMessage: 4, attachmentBytes: 10 * 1024 * 1024, attachmentPixels: 100_000_000,
        attachmentDescriptionCharacters: 1_500, supportedImageMimeTypes: ["image/jpeg", "image/png", "image/webp"] as const,
      };
      const mastodonConnection = await publishing.saveChannelConnection({
        workspaceId: workspace.workspaceId,
        provider: "mastodon_account",
        name: "Mastodon reviewed images",
        encryptedCredentials: "test-mastodon-envelope",
        configuration: {
          host: "social.example.test", instanceOrigin: "https://social.example.test", accountId: "account-1",
          username: "marketme", acct: "marketme", maxCharacters: 500, charactersReservedPerUrl: 23, ...mastodonMedia,
        },
        capabilities: mastodonCapabilities(500, 23, mastodonMedia) as unknown as Record<string, unknown>,
      }, user.id);
      await core.reviewAssetRights(
        {
          workspaceId: workspace.workspaceId,
          packageId: saved.id,
          assetId: originalAssetId,
          status: "cleared",
          owner: "Draft Fixture Rights Owner",
          sourceReference: "source:draft-fixture",
          proofReference: "license:draft-fixture",
          commercialUseAllowed: true,
          derivativeUseAllowed: true,
          worldwideUseAllowed: true,
          permittedChannels: ["discord_webhook"],
          permittedChannelConnectionIds: [connection.id],
          permittedCampaignIds: [],
          permittedBrandProfileIds: [],
          expiresAt: "2099-08-12T00:00:00.000Z",
          reviewNote: "Reviewed for exact Discord publication fixture.",
        },
        user.id,
      );
      const audience = await profiles.createAudienceProfile(
        {
          workspaceId: workspace.workspaceId,
          name: "New members",
          description: "Introductory audience",
          audienceType: "community",
          profile: {
            purpose: "Explain the event",
            industries: [],
            roles: [],
            interests: ["community"],
            locations: [],
            languages: ["en"],
            knowledgeLevel: "new",
            needs: [],
            motivations: [],
            objections: [],
            questions: [],
            preferredChannels: [],
            preferredFormats: [],
            exclusions: [],
          },
        },
        user.id,
      );
      const audienceVersion = (await profiles.publishAudienceProfile(
        workspace.workspaceId,
        audience.id,
        user.id,
      ))!.currentVersion!;
      const brand = await profiles.createBrandProfile(
        {
          workspaceId: workspace.workspaceId,
          name: "Draft rights brand",
          description: "Exact Brand Profile rights fixture",
          profile: {
            officialName: "Draft Rights Brand",
            description: "Exact Brand Profile rights fixture",
            products: [],
            services: [],
            valuePropositions: [],
            voice: { tones: ["clear"] },
            terminology: { preferred: [], prohibited: [] },
            style: {},
            claims: [],
            evidenceRequirements: [],
            requiredDisclosures: [],
            attributionRules: [],
            competitorRules: [],
            channelPersonas: {},
          },
        },
        user.id,
      );
      const brandVersion = (await profiles.publishBrandProfile(
        workspace.workspaceId,
        brand.id,
        user.id,
      ))!.currentVersion!;
      const campaign = await campaigns.createCampaign(
        {
          workspaceId: workspace.workspaceId,
          name: "Draft campaign",
          description: "Fixture",
          objective: "awareness",
          contentPackageIds: [saved.id],
          brandProfileVersionId: brandVersion.id,
          audienceProfileVersionIds: [audienceVersion.id],
          informationDepth: "contextual",
          promotionalStrength: "light",
          autonomyMode: "approval_required",
          timezone: "UTC",
          context: {},
          steps: [
            {
              id: "review",
              name: "Review",
              operationType: "manual_handoff",
              desiredCapability: "manual.handoff",
              dependsOn: [],
              inputs: {},
              outputs: {},
              executionMethods: ["manual_handoff"],
              approvalRequired: true,
            },
          ],
        },
        user.id,
      );
      await campaigns.publishCampaign(workspace.workspaceId, campaign.id);
      const brandCleared = await core.reviewAssetRights(
        {
          workspaceId: workspace.workspaceId,
          packageId: saved.id,
          assetId: originalAssetId,
          status: "cleared",
          owner: "Draft Fixture Rights Owner",
          sourceReference: "source:draft-fixture",
          proofReference: "license:draft-fixture-campaign",
          commercialUseAllowed: true,
          derivativeUseAllowed: true,
          worldwideUseAllowed: true,
          permittedChannels: ["discord_webhook"],
          permittedChannelConnectionIds: [connection.id],
          permittedCampaignIds: [campaign.id],
          permittedBrandProfileIds: [brand.id],
          expiresAt: "2099-08-12T00:00:00.000Z",
          reviewNote:
            "Reviewed for the exact Campaign and Discord account fixture.",
        },
        user.id,
      );
      expect(
        brandCleared?.assets.find((asset) => asset.id === originalAssetId),
      ).toMatchObject({
        rightsPermittedCampaignIds: [campaign.id],
        rightsPermittedBrandProfileIds: [brand.id],
      });

      const generated = await drafts.generate(
        {
          workspaceId: workspace.workspaceId,
          campaignId: campaign.id,
          contentPackageId: saved.id,
          draftFormat: "social_short",
        },
        user.id,
      );
      expect(generated).toHaveLength(1);
      expect(generated[0]).toMatchObject({
        audienceName: "New members",
        status: "working",
        currentVersion: { versionNumber: 1, status: "working" },
        generation: {
          contentPackageVersion: 1,
          generatorModel: "grounded-template",
          draftFormat: "social_short",
        },
      });
      expect(
        generated[0]!.currentVersion.claims
          .filter((claim) => claim.kind === "fact")
          .flatMap((claim) => claim.evidenceItemIds),
      ).toEqual([firstEvidenceId, secondEvidenceId]);
      const snapshot = generated[0]!.generation.evidenceSnapshot;
      await sql`UPDATE evidence_item SET claim = 'Changed after generation' WHERE id = ${firstEvidenceId}`;
      expect(
        (await drafts.get(workspace.workspaceId, generated[0]!.id))!.generation
          .evidenceSnapshot,
      ).toEqual(snapshot);

      expect(
        (await drafts.submit(workspace.workspaceId, generated[0]!.id, user.id))
          ?.status,
      ).toBe("pending_review");
      const approval = (await drafts.listApprovals(workspace.workspaceId))[0]!;
      expect(
        (
          await drafts.decide({
            workspaceId: workspace.workspaceId,
            approvalId: approval.id,
            decision: "changes_requested",
            notes: "Use partner framing",
            actorUserId: user.id,
          })
        )?.status,
      ).toBe("changes_requested");
      await expect(
        drafts.revise({
          workspaceId: workspace.workspaceId,
          draftId: generated[0]!.id,
          leadIn: "Partners. Admission is guaranteed",
          hashtags: [],
          changeNote: "Unsafe change",
          actorUserId: user.id,
        }),
      ).rejects.toMatchObject({ name: "DraftValidationError" });
      const revised = await drafts.revise({
        workspaceId: workspace.workspaceId,
        draftId: generated[0]!.id,
        leadIn: "For community partners",
        callToAction: "Explore the details.",
        hashtags: ["#MarketMe", "#Community"],
        altText: "Text announcement for the free launch event.",
        changeNote: "Applied reviewer audience framing.",
        actorUserId: user.id,
      });
      expect(revised).toMatchObject({
        status: "working",
        currentVersion: {
          versionNumber: 2,
          status: "working",
          sourceVersionId: generated[0]!.currentVersion.id,
          changeNote: "Applied reviewer audience framing.",
        },
      });
      const factShape = (
        claims: readonly {
          kind: string;
          text: string;
          evidenceItemIds: readonly string[];
        }[],
      ) =>
        claims
          .filter((claim) => claim.kind === "fact")
          .map(({ kind, text, evidenceItemIds }) => ({
            kind,
            text,
            evidenceItemIds,
          }));
      expect(factShape(revised!.currentVersion.claims)).toEqual(
        factShape(generated[0]!.currentVersion.claims),
      );
      await drafts.submit(workspace.workspaceId, generated[0]!.id, user.id);
      const secondApproval = (
        await drafts.listApprovals(workspace.workspaceId)
      )[0]!;
      const decided = await drafts.decide({
        workspaceId: workspace.workspaceId,
        approvalId: secondApproval.id,
        decision: "approved",
        notes: "Evidence verified",
        actorUserId: user.id,
      });
      expect(decided).toMatchObject({
        status: "approved",
        currentVersion: { status: "approved", versionNumber: 2 },
      });
      await expect(
        drafts.createChannelPreview({
          workspaceId: workspace.workspaceId,
          draftId: generated[0]!.id,
          channelConnectionId: unauthorizedConnection.id,
          assetIds: [derivativeAssetId],
          actorUserId: user.id,
        }),
      ).rejects.toMatchObject({
        name: "DraftValidationError",
        issues: [expect.objectContaining({ code: "preview_asset_rights" })],
      });
      const destination = await campaigns.saveDestination(
        {
          workspaceId: workspace.workspaceId,
          provider: "website",
          canonicalUrl: "https://example.com/community",
          knownRedirects: [],
          title: "Community event",
          description: "Registration page",
          contentType: "event",
          identifiers: {},
          topics: [],
          audiences: [],
          geography: [],
          status: "published",
          tracking: {},
        },
        user.id,
      );
      const preview = await drafts.createChannelPreview({
        workspaceId: workspace.workspaceId,
        draftId: generated[0]!.id,
        channelConnectionId: connection.id,
        destinationId: destination.id,
        actorUserId: user.id,
      });
      expect(preview).toMatchObject({
        status: "ready",
        contentDraftVersionId: decided!.currentVersion.id,
        channelConnectionName: "Preview channel",
        destinationTitle: "Community event",
        characterLimit: 2000,
        isStale: false,
      });
      expect(preview!.renderedContent).toContain("Admission is free.");
      expect(preview!.renderedContent).toContain(
        "https://example.com/community",
      );
      expect(preview!.validationIssues).toEqual([]);
      const emailPreview = await drafts.createChannelPreview({
        workspaceId: workspace.workspaceId,
        draftId: generated[0]!.id,
        channelConnectionId: emailConnection.id,
        destinationId: destination.id,
        actorUserId: user.id,
      });
      expect(emailPreview).toMatchObject({
        provider: "mailchimp_email",
        channelConnectionName: "Customer newsletter",
        status: "ready",
        renderedSubject: decided!.currentVersion.headline,
        subjectCount: decided!.currentVersion.headline.length,
        subjectLimit: 150,
        characterLimit: 100000,
        assets: [],
        isStale: false,
      });
      expect(emailPreview!.renderedContent).not.toContain("#MarketMe");
      expect(emailPreview!.renderedContent).toContain("https://example.com/community");
      const trackedPreview = await drafts.createChannelPreview({
        workspaceId: workspace.workspaceId,
        draftId: generated[0]!.id,
        channelConnectionId: connection.id,
        destinationId: destination.id,
        linkMode: "tracked",
        appBaseUrl: "https://market-me.test",
        assetIds: [derivativeAssetId],
        actorUserId: user.id,
      });
      expect(trackedPreview).toMatchObject({
        status: "ready",
        linkMode: "tracked",
        trackedLinkStatus: "active",
        isStale: false,
      });
      expect(trackedPreview!.assets).toEqual([
        expect.objectContaining({
          contentAssetId: derivativeAssetId,
          sourceAssetId: originalAssetId,
          fileName: "launch.webp",
          altText: "Blue launch graphic",
          altTextStatus: "approved",
          scanStatus: "clean",
          scanRevision: 1,
          rightsStatus: "cleared",
          rightsRevision: 2,
          rightsChannelConnectionId: connection.id,
          rightsCampaignId: campaign.id,
          rightsBrandProfileId: brand.id,
          sortOrder: 0,
        }),
      ]);
      expect(trackedPreview!.renderedContent).toContain(
        `https://market-me.test/r/${trackedPreview!.trackedLinkSlug}`,
      );
      expect(trackedPreview!.renderedContent).not.toContain(
        "https://example.com/community",
      );
      await sql`DELETE FROM content_asset_rights_channel_connection WHERE content_asset_id = ${originalAssetId} AND channel_connection_id = ${connection.id}`;
      expect(
        (
          await drafts.listChannelPreviews(
            workspace.workspaceId,
            generated[0]!.id,
          )
        ).find((preview) => preview.id === trackedPreview!.id)?.isStale,
      ).toBe(true);
      await sql`INSERT INTO content_asset_rights_channel_connection (content_asset_id, channel_connection_id) VALUES (${originalAssetId}, ${connection.id})`;
      expect(
        (
          await drafts.listChannelPreviews(
            workspace.workspaceId,
            generated[0]!.id,
          )
        ).find((preview) => preview.id === trackedPreview!.id)?.isStale,
      ).toBe(false);
      await sql`DELETE FROM content_asset_rights_campaign WHERE content_asset_id = ${originalAssetId} AND campaign_id = ${campaign.id}`;
      expect(
        (
          await drafts.listChannelPreviews(
            workspace.workspaceId,
            generated[0]!.id,
          )
        ).find((preview) => preview.id === trackedPreview!.id)?.isStale,
      ).toBe(true);
      await sql`INSERT INTO content_asset_rights_campaign (content_asset_id, campaign_id) VALUES (${originalAssetId}, ${campaign.id})`;
      expect(
        (
          await drafts.listChannelPreviews(
            workspace.workspaceId,
            generated[0]!.id,
          )
        ).find((preview) => preview.id === trackedPreview!.id)?.isStale,
      ).toBe(false);
      await sql`DELETE FROM content_asset_rights_brand_profile WHERE content_asset_id = ${originalAssetId} AND brand_profile_id = ${brand.id}`;
      expect(
        (
          await drafts.listChannelPreviews(
            workspace.workspaceId,
            generated[0]!.id,
          )
        ).find((preview) => preview.id === trackedPreview!.id)?.isStale,
      ).toBe(true);
      await sql`INSERT INTO content_asset_rights_brand_profile (content_asset_id, brand_profile_id) VALUES (${originalAssetId}, ${brand.id})`;
      expect(
        (
          await drafts.listChannelPreviews(
            workspace.workspaceId,
            generated[0]!.id,
          )
        ).find((preview) => preview.id === trackedPreview!.id)?.isStale,
      ).toBe(false);
      await sql`UPDATE channel_connection SET capabilities_observed_at = capabilities_observed_at + interval '1 second' WHERE id = ${connection.id}`;
      expect(
        (
          await drafts.listChannelPreviews(
            workspace.workspaceId,
            generated[0]!.id,
          )
        )[0]!.isStale,
      ).toBe(true);
      const refreshedPreview = await drafts.createChannelPreview({
        workspaceId: workspace.workspaceId,
        draftId: generated[0]!.id,
        channelConnectionId: connection.id,
        destinationId: destination.id,
        actorUserId: user.id,
      });
      const refreshedTrackedPreview = await drafts.createChannelPreview({
        workspaceId: workspace.workspaceId,
        draftId: generated[0]!.id,
        channelConnectionId: connection.id,
        destinationId: destination.id,
        linkMode: "tracked",
        appBaseUrl: "https://market-me.test",
        assetIds: [derivativeAssetId],
        actorUserId: user.id,
      });
      const options = await drafts.listCampaignPreviewOptions(
        workspace.workspaceId,
        campaign.id,
      );
      expect(options).toHaveLength(3);
      expect(options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: refreshedPreview!.id,
            linkMode: "canonical",
          }),
          expect.objectContaining({
            id: emailPreview!.id,
            provider: "mailchimp_email",
            renderedSubject: decided!.currentVersion.headline,
            subjectLimit: 150,
            channelConnectionName: "Customer newsletter",
            isStale: false,
            status: "ready",
          }),
          expect.objectContaining({
            id: refreshedTrackedPreview!.id,
            campaignId: campaign.id,
            sourceCampaignVersionNumber: 1,
            linkMode: "tracked",
            trackedLinkStatus: "active",
            draftHeadline: decided!.currentVersion.headline,
            audienceName: "New members",
            channelConnectionName: "Preview channel",
            destinationTitle: "Community event",
            isCurrentApprovedVersion: true,
            isStale: false,
            status: "ready",
          }),
        ]),
      );
      await sql`UPDATE content_asset SET scan_status = 'failed', scan_revision = scan_revision + 1 WHERE id = ${originalAssetId}`;
      expect(
        (
          await drafts.listChannelPreviews(
            workspace.workspaceId,
            generated[0]!.id,
          )
        ).find((preview) => preview.id === refreshedTrackedPreview!.id)
          ?.isStale,
      ).toBe(true);
      await expect(
        drafts.createChannelPreview({
          workspaceId: workspace.workspaceId,
          draftId: generated[0]!.id,
          channelConnectionId: connection.id,
          destinationId: destination.id,
          linkMode: "tracked",
          appBaseUrl: "https://market-me.test",
          assetIds: [derivativeAssetId],
          actorUserId: user.id,
        }),
      ).rejects.toMatchObject({
        name: "DraftValidationError",
        issues: [expect.objectContaining({ code: "preview_asset_scan" })],
      });
      await sql`UPDATE content_asset SET scan_status = 'clean', scan_engine = 'clamd-test', scan_scanned_at = now(), scan_revision = scan_revision + 1 WHERE id = ${originalAssetId}`;
      const rescannedTrackedPreview = await drafts.createChannelPreview({
        workspaceId: workspace.workspaceId,
        draftId: generated[0]!.id,
        channelConnectionId: connection.id,
        destinationId: destination.id,
        linkMode: "tracked",
        appBaseUrl: "https://market-me.test",
        assetIds: [derivativeAssetId],
        actorUserId: user.id,
      });
      expect(rescannedTrackedPreview!.assets[0]).toMatchObject({
        scanStatus: "clean",
        scanRevision: 3,
      });
      const publicationCampaignDraft = {
        workspaceId: workspace.workspaceId,
        name: "Draft campaign",
        description: "Fixture",
        objective: "awareness",
        contentPackageIds: [saved.id],
        destinationId: destination.id,
        brandProfileVersionId: brandVersion.id,
        audienceProfileVersionIds: [audienceVersion.id],
        informationDepth: "contextual",
        promotionalStrength: "light",
        autonomyMode: "approval_required",
        timezone: "UTC",
        context: {},
        successCriteria: [
          { id: "email_opens", eventType: "email_unique_open", targetCount: 50 },
          { id: "email_clicks", eventType: "email_unique_click", targetCount: 25 },
        ],
        successAction: "notify_only",
        steps: [
          {
            id: "publish",
            name: "Publish approved preview",
            operationType: "publish_content",
            desiredCapability: "publish_content",
            dependsOn: [],
            inputs: { draftChannelPreviewId: rescannedTrackedPreview!.id },
            outputs: {},
            executionMethods: ["official_api"],
            approvalRequired: false,
          },
        ],
      } as const;
      await campaigns.saveCampaignDraft(
        campaign.id,
        publicationCampaignDraft,
        user.id,
      );
      await campaigns.publishCampaign(workspace.workspaceId, campaign.id);
      const instance = await campaigns.activateCampaign({
        workspaceId: workspace.workspaceId,
        campaignId: campaign.id,
        actorUserId: user.id,
      });
      expect(instance?.status).toBe("scheduled");
      await campaigns.setInstanceStatus(instance!.id, "active");
      await campaigns.setStepRunState({ instanceId: instance!.id, stepKey: "publish", status: "running" });
      const publicationApprovalId = await campaigns.ensureStepApproval({
        instanceId: instance!.id, stepKey: "publish",
        snapshot: { name: "Publish approved preview", inputs: publicationCampaignDraft.steps[0].inputs },
      });
      await campaigns.decideApproval({
        workspaceId: workspace.workspaceId, approvalId: publicationApprovalId,
        decision: "approved", actorUserId: user.id, idempotencyKey: `publication-approval:${instance!.id}`,
      });
      const executionTarget = await publishing.getCampaignExecutionTarget(instance!.id, "publish");
      expect(executionTarget).toMatchObject({
        brandProfileId: brand.id,
        channelConnectionId: connection.id,
        draftPreviewContent: rescannedTrackedPreview!.renderedContent,
        draftPreviewVersionId: decided!.currentVersion.id,
        draftPreviewTrackedLinkId: rescannedTrackedPreview!.trackedLinkId,
        draftPreviewEligible: true,
        draftPreviewAssets: [
          expect.objectContaining({
            contentAssetId: derivativeAssetId,
            contentHash: "sha256:derivative",
            scanRevision: 3,
            rightsBrandProfileId: brand.id,
          }),
        ],
      });
      const mediaHash = `sha256:${"d".repeat(64)}`;
      // Reporting fixtures intentionally synthesize historical provider actions. They do not
      // publish or substitute another account through the authorized publication boundary.
      const durableMastodonAction = { action: { id: randomUUID() } };
      await sql`INSERT INTO publication_action (id, workspace_id, campaign_instance_id, campaign_step_run_id,
        channel_connection_id, action_type, status, idempotency_key, request_snapshot)
        VALUES (${durableMastodonAction.action.id}, ${workspace.workspaceId}, ${instance!.id}, ${executionTarget!.campaignStepRunId},
          ${mastodonConnection.id}, 'publish_content', 'dispatching', ${`mastodon-media-fixture:${instance!.id}`}, ${sql.json({
          provider: "mastodon_account",
          attachments: [{ contentAssetId: derivativeAssetId, contentHash: mediaHash }],
        })})`;
      await expect(publishing.recordMastodonPublicationMedia({
        publicationActionId: durableMastodonAction.action.id,
        ordinal: 0,
        contentAssetId: derivativeAssetId,
        contentHash: mediaHash,
        providerMediaId: "media-1",
      })).resolves.toMatchObject({ ordinal: 0, contentAssetId: derivativeAssetId, contentHash: mediaHash, providerMediaId: "media-1" });
      await expect(publishing.recordMastodonPublicationMedia({
        publicationActionId: durableMastodonAction.action.id,
        ordinal: 0,
        contentAssetId: derivativeAssetId,
        contentHash: mediaHash,
        providerMediaId: "media-1",
      })).resolves.toMatchObject({ providerMediaId: "media-1" });
      await expect(publishing.recordMastodonPublicationMedia({
        publicationActionId: durableMastodonAction.action.id,
        ordinal: 0,
        contentAssetId: derivativeAssetId,
        contentHash: mediaHash,
        providerMediaId: "different-media",
      })).rejects.toThrow("exact publication attachment");
      await expect(publishing.listMastodonPublicationMedia(durableMastodonAction.action.id)).resolves.toEqual([
        expect.objectContaining({ ordinal: 0, providerMediaId: "media-1" }),
      ]);
      await publishing.finishPublicationAction(durableMastodonAction.action.id, {
        status: "succeeded",
        providerExternalId: "status-report-1",
        providerUrl: "https://social.example.test/@marketme/status-report-1",
        responseMetadata: { host: "social.example.test", visibility: "public" },
      });
      const mastodonReport = {
        statusId: "status-report-1", accountId: "account-1",
        statusUrl: "https://social.example.test/@marketme/status-report-1",
        repliesCount: 4, reblogsCount: 8, favouritesCount: 16,
        statusCreatedAt: "2026-08-12T05:00:00.000Z",
      };
      await expect(publishing.reconcileMastodonStatusReportCollectionAlerts(3599))
        .rejects.toThrow("max age");
      await expect(publishing.listMastodonStatusReportCollectionStates(workspace.workspaceId, instance!.id)).resolves.toEqual([
        expect.objectContaining({ publicationActionId: durableMastodonAction.action.id, operationalStatus: "pending" }),
      ]);
      await sql`UPDATE mastodon_status_report_collection_state SET next_attempt_at = now()
        WHERE publication_action_id = ${durableMastodonAction.action.id}`;
      await expect(publishing.listMastodonStatusReportCollectionStates(workspace.workspaceId, instance!.id)).resolves.toEqual([
        expect.objectContaining({ publicationActionId: durableMastodonAction.action.id, operationalStatus: "overdue" }),
      ]);
      // A just-due schedule is not an incident until the five-minute grace expires.
      await publishing.reconcileMastodonStatusReportCollectionAlerts(604800);
      await expect(publishing.listMastodonStatusReportCollectionAlerts(workspace.workspaceId)).resolves.toEqual([]);
      await sql`UPDATE mastodon_status_report_collection_state SET next_attempt_at = now() - interval '6 minutes'
        WHERE publication_action_id = ${durableMastodonAction.action.id}`;
      await Promise.all([
        publishing.reconcileMastodonStatusReportCollectionAlerts(604800),
        publishing.reconcileMastodonStatusReportCollectionAlerts(604800),
      ]);
      const [overdueAlert] = await publishing.listMastodonStatusReportCollectionAlerts(workspace.workspaceId);
      expect(overdueAlert).toMatchObject({
        alertType: "overdue", status: "active", affectedCount: 1,
        oldestAt: expect.any(Date), firstDetectedAt: expect.any(Date), lastDetectedAt: expect.any(Date),
      });
      await publishing.reconcileMastodonStatusReportCollectionAlerts(604800);
      await expect(publishing.listMastodonStatusReportCollectionAlerts(workspace.workspaceId)).resolves.toEqual([
        expect.objectContaining({ id: overdueAlert!.id, status: "active" }),
      ]);
      await expect(publishing.listMastodonStatusReportCollectionAlerts(randomUUID())).resolves.toEqual([]);
      await expect(publishing.claimMastodonStatusReportCollections(10, 604800)).resolves.toEqual([
        expect.objectContaining({
          workspaceId: workspace.workspaceId,
          publicationActionId: durableMastodonAction.action.id,
          providerStatusId: "status-report-1",
          providerAccountId: "account-1",
          providerStatusUrl: "https://social.example.test/@marketme/status-report-1",
          instanceOrigin: "https://social.example.test",
          encryptedCredentials: "test-mastodon-envelope",
          actorUserId: user.id,
          attemptCount: 1,
        }),
      ]);
      await expect(publishing.listMastodonStatusReportCollectionStates(workspace.workspaceId, instance!.id)).resolves.toEqual([
        expect.objectContaining({ publicationActionId: durableMastodonAction.action.id, operationalStatus: "collecting" }),
      ]);
      await publishing.reconcileMastodonStatusReportCollectionAlerts(604800);
      await expect(publishing.listMastodonStatusReportCollectionAlerts(workspace.workspaceId)).resolves.toEqual([
        expect.objectContaining({ id: overdueAlert!.id, status: "resolved", resolvedAt: expect.any(Date) }),
      ]);
      await expect(publishing.claimMastodonStatusReportCollections(10, 604800)).resolves.toEqual([]);
      await sql`UPDATE mastodon_status_report_collection_state SET claimed_at = now() - interval '6 minutes'
        WHERE publication_action_id = ${durableMastodonAction.action.id}`;
      await expect(publishing.listMastodonStatusReportCollectionStates(workspace.workspaceId, instance!.id)).resolves.toEqual([
        expect.objectContaining({ publicationActionId: durableMastodonAction.action.id, operationalStatus: "abandoned" }),
      ]);
      await expect(publishing.getMastodonStatusReportCollectionOperationsSummary(workspace.workspaceId)).resolves.toMatchObject({
        total: 1, pending: 0, scheduled: 0, retrying: 0, overdue: 0, collecting: 0, abandoned: 1,
        oldestAbandonedClaimAt: expect.any(Date),
      });
      await publishing.reconcileMastodonStatusReportCollectionAlerts(604800);
      const [abandonedAlert] = await publishing.listMastodonStatusReportCollectionAlerts(workspace.workspaceId);
      expect(abandonedAlert).toMatchObject({ alertType: "abandoned", status: "active", affectedCount: 1 });
      await expect(publishing.claimMastodonStatusReportCollections(10, 604800)).resolves.toEqual([
        expect.objectContaining({ publicationActionId: durableMastodonAction.action.id, attemptCount: 2 }),
      ]);
      await expect(publishing.completeMastodonStatusReportCollection(
        durableMastodonAction.action.id, { delaySeconds: 900 }, 1,
      )).resolves.toBe(false);
      await expect(publishing.recordMastodonStatusReportSnapshot(
        workspace.workspaceId, durableMastodonAction.action.id, mastodonReport, user.id, 1,
      )).rejects.toThrow("claim was superseded");
      await expect(publishing.listMastodonStatusReportSnapshots(workspace.workspaceId, instance!.id)).resolves.toEqual([]);
      await expect(publishing.listMastodonStatusReportCollectionStates(workspace.workspaceId, instance!.id)).resolves.toEqual([
        expect.objectContaining({ operationalStatus: "collecting", attemptCount: 2, claimedAt: expect.any(Date) }),
      ]);
      await expect(publishing.completeMastodonStatusReportCollection(durableMastodonAction.action.id, {
        delaySeconds: 300,
        errorCode: "transient",
      }, 2)).resolves.toBe(true);
      await publishing.reconcileMastodonStatusReportCollectionAlerts(604800);
      expect(await publishing.listMastodonStatusReportCollectionAlerts(workspace.workspaceId))
        .toContainEqual(expect.objectContaining({ id: abandonedAlert!.id, status: "resolved", resolvedAt: expect.any(Date) }));
      await expect(publishing.listMastodonStatusReportCollectionStates(workspace.workspaceId, instance!.id)).resolves.toEqual([
        expect.objectContaining({
          publicationActionId: durableMastodonAction.action.id,
          attemptCount: 2,
          lastErrorCode: "transient",
          lastAttemptAt: expect.any(Date),
          operationalStatus: "retrying",
        }),
      ]);
      await sql`UPDATE mastodon_status_report_collection_state SET next_attempt_at = now() - interval '6 minutes'
        WHERE publication_action_id = ${durableMastodonAction.action.id}`;
      // Retained schedules outside the collector window must not produce permanent alerts.
      await sql`UPDATE publication_action SET started_at = now() - interval '31 days'
        WHERE id = ${durableMastodonAction.action.id}`;
      await publishing.reconcileMastodonStatusReportCollectionAlerts(604800);
      expect((await publishing.listMastodonStatusReportCollectionAlerts(workspace.workspaceId))
        .filter((alert) => alert.status === "active")).toEqual([]);
      await expect(publishing.claimMastodonStatusReportCollections(10, 604800)).resolves.toEqual([]);
      await sql`UPDATE publication_action SET started_at = now() WHERE id = ${durableMastodonAction.action.id}`;
      await sql`UPDATE channel_connection SET capabilities = jsonb_set(capabilities, '{supportedActions,read_metrics}', 'false')
        WHERE id = ${mastodonConnection.id}`;
      await publishing.reconcileMastodonStatusReportCollectionAlerts(604800);
      expect((await publishing.listMastodonStatusReportCollectionAlerts(workspace.workspaceId))
        .filter((alert) => alert.status === "active")).toEqual([]);
      await sql`UPDATE channel_connection SET capabilities = jsonb_set(capabilities, '{supportedActions,read_metrics}', 'true')
        WHERE id = ${mastodonConnection.id}`;
      await publishing.reconcileMastodonStatusReportCollectionAlerts(604800);
      const [recurringAlert] = await publishing.listMastodonStatusReportCollectionAlerts(workspace.workspaceId);
      expect(recurringAlert).toMatchObject({ alertType: "overdue", status: "active", affectedCount: 1 });
      expect(recurringAlert!.id).not.toBe(overdueAlert!.id);
      await expect(publishing.claimMastodonStatusReportCollections(10, 604800)).resolves.toEqual([
        expect.objectContaining({ publicationActionId: durableMastodonAction.action.id, attemptCount: 3 }),
      ]);
      await expect(publishing.completeMastodonStatusReportCollection(durableMastodonAction.action.id, { delaySeconds: 900 }, 3))
        .resolves.toBe(true);
      await publishing.reconcileMastodonStatusReportCollectionAlerts(604800);
      const recoveredAlerts = await publishing.listMastodonStatusReportCollectionAlerts(workspace.workspaceId);
      expect(recoveredAlerts).toHaveLength(3);
      expect(recoveredAlerts.every((alert) => alert.status === "resolved" && alert.resolvedAt)).toBe(true);
      await expect(publishing.listMastodonStatusReportCollectionStates(workspace.workspaceId, instance!.id)).resolves.toEqual([
        expect.objectContaining({ publicationActionId: durableMastodonAction.action.id, operationalStatus: "scheduled", attemptCount: 3 }),
      ]);
      await expect(publishing.getMastodonStatusReportCollectionOperationsSummary(workspace.workspaceId)).resolves.toMatchObject({
        total: 1, pending: 0, scheduled: 1, retrying: 0, overdue: 0, collecting: 0, abandoned: 0,
      });
      await expect(publishing.getMastodonStatusReportTarget(
        workspace.workspaceId, durableMastodonAction.action.id,
      )).resolves.toMatchObject({
        accountId: "account-1", instanceOrigin: "https://social.example.test",
        action: { providerExternalId: "status-report-1", status: "succeeded" },
      });
      await expect(publishing.recordMastodonStatusReportSnapshot(
        workspace.workspaceId, durableMastodonAction.action.id, mastodonReport, user.id,
      )).resolves.toMatchObject({ created: true, snapshot: { repliesCount: 4, reblogsCount: 8, favouritesCount: 16 } });
      await expect(publishing.recordMastodonStatusReportSnapshot(
        workspace.workspaceId, durableMastodonAction.action.id, mastodonReport, user.id,
      )).resolves.toMatchObject({ created: false });
      await expect(publishing.listMastodonStatusReportSnapshots(workspace.workspaceId, instance!.id)).resolves.toEqual([
        expect.objectContaining({ publicationActionId: durableMastodonAction.action.id, statusId: "status-report-1", accountId: "account-1", favouritesCount: 16 }),
      ]);
      await expect(publishing.getCampaignMeasurementSummary(workspace.workspaceId, instance!.id)).resolves.toMatchObject({
        providerTotals: { mastodon_reply: 4, mastodon_reblog: 8, mastodon_favourite: 16 },
      });
      await expect(publishing.recordMastodonStatusReportSnapshot(
        workspace.workspaceId, durableMastodonAction.action.id, { ...mastodonReport, accountId: "wrong-account" }, user.id,
      )).rejects.toThrow("exact workspace publication, status, account, and URL");
      await expect(publishing.recordMastodonStatusReportSnapshot(
        workspace.workspaceId, durableMastodonAction.action.id, { ...mastodonReport, favouritesCount: 19 }, user.id,
      )).resolves.toMatchObject({ created: true });
      await expect(publishing.getCampaignMeasurementSummary(workspace.workspaceId, instance!.id)).resolves.toMatchObject({
        providerTotals: { mastodon_reply: 4, mastodon_reblog: 8, mastodon_favourite: 19 },
      });
      const durableEmailAction = { action: { id: randomUUID() } };
      await sql`INSERT INTO publication_action (id, workspace_id, campaign_instance_id, campaign_step_run_id,
        channel_connection_id, action_type, status, idempotency_key, request_snapshot)
        VALUES (${durableEmailAction.action.id}, ${workspace.workspaceId}, ${instance!.id}, ${executionTarget!.campaignStepRunId},
          ${emailConnection.id}, 'publish_content', 'dispatching', ${`mailchimp-fixture:${instance!.id}`},
          ${sql.json({ provider: "mailchimp_email", subject: emailPreview!.renderedSubject ?? "Fixture email" })})`;
      await publishing.recordPublicationProviderIdentity(durableEmailAction.action.id, "mail_campaign_1", "https://us21.admin.mailchimp.com/campaigns/show/?id=42");
      await sql`UPDATE mailchimp_report_collection_state SET next_attempt_at = now()
        WHERE publication_action_id = ${durableEmailAction.action.id}`;
      await expect(publishing.claimMailchimpReportCollections(10, 604800)).resolves.toEqual([
        expect.objectContaining({
          workspaceId: workspace.workspaceId,
          publicationActionId: durableEmailAction.action.id,
          providerCampaignId: "mail_campaign_1",
          audienceId: "audience_1",
          encryptedCredentials: "test-mailchimp-envelope",
          actorUserId: user.id,
          attemptCount: 1,
        }),
      ]);
      await expect(publishing.claimMailchimpReportCollections(10, 604800)).resolves.toEqual([]);
      await publishing.completeMailchimpReportCollection(durableEmailAction.action.id, {
        delaySeconds: 300,
        errorCode: "transient",
      });
      await expect(sql<{ lastErrorCode?: string; claimedAt?: string }[]>`
        SELECT last_error_code, claimed_at FROM mailchimp_report_collection_state
        WHERE publication_action_id = ${durableEmailAction.action.id}
      `).resolves.toEqual([expect.objectContaining({ lastErrorCode: "transient", claimedAt: null })]);
      await sql`UPDATE mailchimp_report_collection_state SET next_attempt_at = now()
        WHERE publication_action_id = ${durableEmailAction.action.id}`;
      await expect(publishing.claimMailchimpReportCollections(10, 604800)).resolves.toEqual([
        expect.objectContaining({ publicationActionId: durableEmailAction.action.id, attemptCount: 2 }),
      ]);
      await publishing.completeMailchimpReportCollection(durableEmailAction.action.id, { delaySeconds: 900 });
      await expect(sql<{ lastErrorCode?: string; lastSuccessAt?: string }[]>`
        SELECT last_error_code, last_success_at FROM mailchimp_report_collection_state
        WHERE publication_action_id = ${durableEmailAction.action.id}
      `).resolves.toEqual([expect.objectContaining({ lastErrorCode: null, lastSuccessAt: expect.any(Date) })]);
      await expect(publishing.getMailchimpWebhookTarget(emailConnection.id)).resolves.toMatchObject({
        workspaceId: workspace.workspaceId, connectionId: emailConnection.id,
        audienceId: "audience_1", encryptedCredentials: "test-mailchimp-envelope",
      });
      const webhookWakeup = { connectionId: emailConnection.id, audienceId: "audience_1", providerCampaignId: "mail_campaign_1", deliveryHash: "a".repeat(64), timestamp: 1_718_000_000 };
      await expect(publishing.wakeMailchimpReportCollectionFromWebhook(webhookWakeup)).resolves.toBe(true);
      await expect(publishing.wakeMailchimpReportCollectionFromWebhook(webhookWakeup)).resolves.toBe(false);
      await expect(publishing.wakeMailchimpReportCollectionFromWebhook({ ...webhookWakeup, providerCampaignId: "wrong_campaign", deliveryHash: "b".repeat(64), timestamp: webhookWakeup.timestamp + 1 })).resolves.toBe(false);
      await expect(publishing.listMailchimpReportCollectionStates(workspace.workspaceId, instance!.id)).resolves.toEqual([
        expect.objectContaining({ publicationActionId: durableEmailAction.action.id, webhookWakeupCount: "1", lastWebhookReceivedAt: expect.any(Date) }),
      ]);
      await expect(publishing.claimMailchimpReportCollections(10, 604800)).resolves.toEqual([
        expect.objectContaining({ publicationActionId: durableEmailAction.action.id, audienceId: "audience_1", attemptCount: 3 }),
      ]);
      await publishing.completeMailchimpReportCollection(durableEmailAction.action.id, { delaySeconds: 900 });
      await expect(publishing.configureMailchimpWebhook(workspace.workspaceId, emailConnection.id, "rotated-mailchimp-envelope", user.id)).resolves.toBe(true);
      await expect(publishing.getChannelConnection(workspace.workspaceId, emailConnection.id)).resolves.toMatchObject({
        encryptedCredentials: "rotated-mailchimp-envelope", configuration: expect.objectContaining({ webhookSigningConfigured: true }),
      });
      await expect(sql<{ count: string }[]>`SELECT count(*) FROM audit_event WHERE workspace_id = ${workspace.workspaceId} AND event_type = 'mailchimp.webhook-signing-configured' AND subject_id = ${emailConnection.id}`)
        .resolves.toEqual([{ count: "1" }]);
      const managedWebhook = {
        providerWebhookId: "provider_webhook_1",
        callbackUrl: `https://market.example/api/webhooks/mailchimp/${emailConnection.id}`,
        audienceId: "audience_1",
        configuredAt: "2026-08-12T08:00:00.000Z",
      };
      await expect(publishing.configureManagedMailchimpWebhook(
        workspace.workspaceId, emailConnection.id, "managed-mailchimp-envelope", managedWebhook, user.id,
      )).resolves.toBe(true);
      await expect(publishing.getChannelConnection(workspace.workspaceId, emailConnection.id)).resolves.toMatchObject({
        encryptedCredentials: "managed-mailchimp-envelope",
        configuration: expect.objectContaining({
          webhookSigningConfigured: true, webhookManagement: "managed",
          webhookProviderId: managedWebhook.providerWebhookId, webhookCallbackUrl: managedWebhook.callbackUrl,
          webhookAudienceId: managedWebhook.audienceId, webhookConfiguredAt: managedWebhook.configuredAt,
        }),
      });
      await expect(sql<{ count: string }[]>`SELECT count(*) FROM audit_event WHERE workspace_id = ${workspace.workspaceId} AND event_type = 'mailchimp.webhook-managed' AND subject_id = ${emailConnection.id}`)
        .resolves.toEqual([{ count: "1" }]);
      await expect(publishing.listMailchimpWebhookHealthStates(workspace.workspaceId)).resolves.toEqual([
        expect.objectContaining({
          connectionId: emailConnection.id, attemptCount: "0", consecutiveFailureCount: "0",
          lastHealthCode: null, lastErrorCode: null,
        }),
      ]);
      await expect(publishing.claimMailchimpWebhookHealthChecks(10)).resolves.toEqual([
        expect.objectContaining({
          workspaceId: workspace.workspaceId, connectionId: emailConnection.id,
          audienceId: managedWebhook.audienceId, expectedCallbackUrl: managedWebhook.callbackUrl,
          providerWebhookId: managedWebhook.providerWebhookId, encryptedCredentials: "managed-mailchimp-envelope", attemptCount: 1,
        }),
      ]);
      await publishing.completeMailchimpWebhookHealthCheck(emailConnection.id, { delaySeconds: 3600, healthCode: "managed_active" });
      await expect(publishing.listMailchimpWebhookHealthStates(workspace.workspaceId)).resolves.toEqual([
        expect.objectContaining({
          connectionId: emailConnection.id, attemptCount: "1", consecutiveFailureCount: "0",
          lastHealthCode: "managed_active", lastCheckedAt: expect.any(Date), lastErrorCode: null,
        }),
      ]);
      await sql`UPDATE mailchimp_webhook_health_state SET next_check_at = now() WHERE connection_id = ${emailConnection.id}`;
      await expect(publishing.claimMailchimpWebhookHealthChecks(10)).resolves.toHaveLength(1);
      await publishing.completeMailchimpWebhookHealthCheck(emailConnection.id, { delaySeconds: 3600, healthCode: "managed_drifted" });
      await expect(publishing.listMailchimpWebhookHealthStates(workspace.workspaceId)).resolves.toEqual([
        expect.objectContaining({ attemptCount: "2", consecutiveFailureCount: "1", lastHealthCode: "managed_drifted" }),
      ]);
      await expect(publishing.disableMailchimpWebhook(workspace.workspaceId, emailConnection.id, "api-key-only-envelope", user.id)).resolves.toBe(true);
      const disabledWebhookConnection = await publishing.getChannelConnection(workspace.workspaceId, emailConnection.id);
      expect(disabledWebhookConnection).toMatchObject({
        encryptedCredentials: "api-key-only-envelope", configuration: expect.objectContaining({ webhookSigningConfigured: false }),
      });
      expect(disabledWebhookConnection?.configuration).not.toHaveProperty("webhookProviderId");
      expect(disabledWebhookConnection?.configuration).not.toHaveProperty("webhookManagement");
      await expect(publishing.listMailchimpWebhookHealthStates(workspace.workspaceId)).resolves.toEqual([]);
      await expect(sql<{ count: string }[]>`SELECT count(*) FROM audit_event WHERE workspace_id = ${workspace.workspaceId} AND event_type = 'mailchimp.webhook-disabled' AND subject_id = ${emailConnection.id}`)
        .resolves.toEqual([{ count: "1" }]);
      await publishing.finishPublicationAction(durableEmailAction.action.id, { status: "failed", error: "Known content validation failure" });
      await expect(publishing.getPublicationActionByIdempotencyKey(`mailchimp-fixture:${instance!.id}`)).resolves.toMatchObject({
        status: "failed",
        providerExternalId: "mail_campaign_1",
        providerUrl: "https://us21.admin.mailchimp.com/campaigns/show/?id=42",
      });
      const aggregateReport = {
        campaignId: "mail_campaign_1", audienceId: "audience_1", emailsSent: 120,
        opensTotal: 80, uniqueOpens: 60, clicksTotal: 30, uniqueClicks: 20,
        unsubscribed: 2, hardBounces: 3, softBounces: 4, abuseReports: 1,
        sendTime: "2026-08-12T06:00:00.000Z",
      };
      await expect(publishing.recordMailchimpCampaignReportSnapshot(
        workspace.workspaceId, durableEmailAction.action.id, aggregateReport, user.id,
      )).resolves.toMatchObject({ created: true, publicationReconciled: true });
      await expect(publishing.recordMailchimpCampaignReportSnapshot(
        workspace.workspaceId, durableEmailAction.action.id, aggregateReport, user.id,
      )).resolves.toMatchObject({ created: false, publicationReconciled: false });
      await expect(publishing.getPublicationActionByIdempotencyKey(`mailchimp-fixture:${instance!.id}`)).resolves.toMatchObject({
        status: "succeeded",
        providerExternalId: "mail_campaign_1",
        responseMetadata: expect.objectContaining({ reportReconciled: true }),
      });
      await expect(publishing.listMailchimpCampaignReportSnapshots(workspace.workspaceId, instance!.id)).resolves.toEqual([
        expect.objectContaining({ publicationActionId: durableEmailAction.action.id, campaignId: "mail_campaign_1", audienceId: "audience_1", emailsSent: 120, uniqueOpens: 60, uniqueClicks: 20 }),
      ]);
      await expect(publishing.getCampaignMeasurementSummary(workspace.workspaceId, instance!.id)).resolves.toMatchObject({
        providerTotals: {
          email_sent: 120, email_unique_open: 60, email_unique_click: 20,
          email_unsubscribe: 2, email_bounce: 7, email_complaint: 1,
        },
        criteria: [
          expect.objectContaining({ id: "email_opens", currentCount: 60, met: true }),
          expect.objectContaining({ id: "email_clicks", currentCount: 20, met: false }),
        ],
        allCriteriaMet: false,
      });
      await expect(publishing.recordMailchimpCampaignReportSnapshot(
        workspace.workspaceId, durableEmailAction.action.id, { ...aggregateReport, audienceId: "wrong_audience" }, user.id,
      )).rejects.toThrow("exact workspace publication, Campaign, and audience");
      await expect(publishing.recordMailchimpCampaignReportSnapshot(
        workspace.workspaceId, durableEmailAction.action.id,
        { ...aggregateReport, clicksTotal: 35, uniqueClicks: 25 }, user.id,
      )).resolves.toMatchObject({ created: true, publicationReconciled: false });
      await expect(publishing.getCampaignMeasurementSummary(workspace.workspaceId, instance!.id)).resolves.toMatchObject({
        providerTotals: expect.objectContaining({ email_unique_open: 60, email_unique_click: 25 }),
        allCriteriaMet: true,
        successTransition: expect.objectContaining({ status: "pending" }),
      });
      await expect(sql<{ payload: Record<string, unknown> }[]>`
        SELECT payload FROM campaign_workflow_command
        WHERE campaign_instance_id = ${instance!.id} AND command_type = 'success_criteria_met'
      `).resolves.toEqual([
        expect.objectContaining({ payload: expect.objectContaining({
          triggerSource: "mailchimp_campaign_report",
          triggerKey: expect.stringMatching(/^mailchimp-report:/),
        }) }),
      ]);
      await expect(publishing.recordMailchimpCampaignReportSnapshot(
        workspace.workspaceId, durableEmailAction.action.id,
        { ...aggregateReport, clicksTotal: 15, uniqueClicks: 10 }, user.id,
      )).resolves.toMatchObject({ created: true, publicationReconciled: false });
      await expect(publishing.getCampaignMeasurementSummary(workspace.workspaceId, instance!.id)).resolves.toMatchObject({
        providerTotals: expect.objectContaining({ email_unique_click: 10 }),
        allCriteriaMet: false,
        successTransition: expect.objectContaining({ status: "pending" }),
      });
      await sql`UPDATE channel_connection
        SET configuration = jsonb_set(configuration, '{audienceId}', '"audience_2"'::jsonb), updated_at = now()
        WHERE id = ${emailConnection.id} AND workspace_id = ${workspace.workspaceId}`;
      await expect(publishing.listMailchimpCampaignReportSnapshots(workspace.workspaceId, instance!.id)).resolves.toEqual([
        expect.objectContaining({ publicationActionId: durableEmailAction.action.id, campaignId: "mail_campaign_1", audienceId: "audience_1", uniqueClicks: 10 }),
        expect.objectContaining({ publicationActionId: durableEmailAction.action.id, campaignId: "mail_campaign_1", audienceId: "audience_1", uniqueClicks: 25 }),
        expect.objectContaining({ publicationActionId: durableEmailAction.action.id, campaignId: "mail_campaign_1", audienceId: "audience_1", uniqueClicks: 20 }),
      ]);
      await expect(publishing.getMailchimpCampaignReportTarget(
        workspace.workspaceId, durableEmailAction.action.id,
      )).resolves.toMatchObject({
        audienceId: "audience_1",
        connection: { configuration: expect.objectContaining({ audienceId: "audience_2" }) },
      });
      await sql`UPDATE mailchimp_report_collection_state SET next_attempt_at = now()
        WHERE publication_action_id = ${durableEmailAction.action.id}`;
      await expect(publishing.claimMailchimpReportCollections(10, 604800)).resolves.toEqual([
        expect.objectContaining({ publicationActionId: durableEmailAction.action.id, audienceId: "audience_1" }),
      ]);
      await publishing.completeMailchimpReportCollection(durableEmailAction.action.id, { delaySeconds: 900 });
      await expect(publishing.recordMailchimpCampaignReportSnapshot(
        workspace.workspaceId, durableEmailAction.action.id,
        { ...aggregateReport, clicksTotal: 16, uniqueClicks: 11 }, user.id,
      )).resolves.toMatchObject({ created: true, publicationReconciled: false });
      const alternateBrand = await profiles.createBrandProfile(
        {
          workspaceId: workspace.workspaceId,
          name: "Alternate rights brand",
          description: "Brand reassignment rejection fixture",
          profile: {
            officialName: "Alternate Rights Brand",
            description: "Brand reassignment rejection fixture",
            products: [],
            services: [],
            valuePropositions: [],
            voice: { tones: ["clear"] },
            terminology: { preferred: [], prohibited: [] },
            style: {},
            claims: [],
            evidenceRequirements: [],
            requiredDisclosures: [],
            attributionRules: [],
            competitorRules: [],
            channelPersonas: {},
          },
        },
        user.id,
      );
      const alternateBrandVersion = (await profiles.publishBrandProfile(
        workspace.workspaceId,
        alternateBrand.id,
        user.id,
      ))!.currentVersion!;
      await campaigns.saveCampaignDraft(
        campaign.id,
        {
          ...publicationCampaignDraft,
          brandProfileVersionId: alternateBrandVersion.id,
        },
        user.id,
      );
      await campaigns.publishCampaign(workspace.workspaceId, campaign.id);
      await expect(
        campaigns.activateCampaign({
          workspaceId: workspace.workspaceId,
          campaignId: campaign.id,
          actorUserId: user.id,
        }),
      ).rejects.toMatchObject({
        name: "CampaignValidationError",
        issues: [
          expect.objectContaining({ code: "draft_channel_preview_invalid" }),
        ],
      });
      await campaigns.saveCampaignDraft(
        campaign.id,
        publicationCampaignDraft,
        user.id,
      );
      await campaigns.publishCampaign(workspace.workspaceId, campaign.id);
      const trackedLinkId = rescannedTrackedPreview!.trackedLinkId!;
      await sql`UPDATE tracked_link SET status = 'disabled' WHERE id = ${trackedLinkId}`;
      await expect(
        campaigns.activateCampaign({
          workspaceId: workspace.workspaceId,
          campaignId: campaign.id,
          actorUserId: user.id,
        }),
      ).rejects.toMatchObject({
        name: "CampaignValidationError",
        issues: [
          expect.objectContaining({ code: "draft_channel_preview_invalid" }),
        ],
      });
      await sql`UPDATE tracked_link SET status = 'active' WHERE id = ${trackedLinkId}`;
      await core.reviewAssetRights(
        {
          workspaceId: workspace.workspaceId,
          packageId: saved.id,
          assetId: originalAssetId,
          status: "restricted",
          owner: "Draft Fixture Rights Owner",
          sourceReference: "source:draft-fixture",
          proofReference: "license:revoked-after-preview",
          commercialUseAllowed: false,
          derivativeUseAllowed: false,
          worldwideUseAllowed: false,
          permittedChannels: [],
          permittedChannelConnectionIds: [],
          permittedCampaignIds: [],
          permittedBrandProfileIds: [],
          reviewNote: "Permission was withdrawn after preview creation.",
        },
        user.id,
      );
      expect(
        (
          await drafts.listChannelPreviews(
            workspace.workspaceId,
            generated[0]!.id,
          )
        ).find((preview) => preview.id === rescannedTrackedPreview!.id)
          ?.isStale,
      ).toBe(true);
      expect(
        (
          await drafts.listCampaignPreviewOptions(
            workspace.workspaceId,
            campaign.id,
          )
        ).find((preview) => preview.id === rescannedTrackedPreview!.id)
          ?.isStale,
      ).toBe(true);
      expect(
        await publishing.getCampaignExecutionTarget(instance!.id, "publish"),
      ).toMatchObject({ draftPreviewEligible: false });
      await expect(
        campaigns.activateCampaign({
          workspaceId: workspace.workspaceId,
          campaignId: campaign.id,
          actorUserId: user.id,
        }),
      ).rejects.toMatchObject({
        name: "CampaignValidationError",
        issues: [
          expect.objectContaining({ code: "draft_channel_preview_invalid" }),
        ],
      });
      const events = await sql<
        { eventType: string }[]
      >`SELECT event_type FROM audit_event WHERE workspace_id = ${workspace.workspaceId} AND event_type LIKE 'draft.%'`;
      expect(events.map((event) => event.eventType)).toEqual(
        expect.arrayContaining([
          "draft.generated",
          "draft.submitted",
          "draft.changes_requested",
          "draft.revised",
          "draft.approved",
          "draft.channel_preview.created",
        ]),
      );
    } finally {
      await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
      await sql`DELETE FROM app_user WHERE id = ${user.id}`;
    }
  });
});
