import { randomBytes, randomUUID } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";
import {
  GENERATOR_MODEL,
  GENERATOR_PROVIDER,
  GENERATOR_VERSION,
  PROMPT_VERSION,
  generateGroundedDraft,
} from "@market-me/generation";
import { renderChannelPreview } from "@market-me/connectors";
import type {
  ChannelCapabilityManifest,
  ChannelProvider,
} from "@market-me/connectors";
import type {
  AudienceProfileData,
  BrandProfileData,
  ContentDraftVersion,
  DraftFormat,
  EvidenceItem,
} from "@market-me/domain";
import { DRAFT_FORMAT_CHARACTER_LIMITS } from "@market-me/generation";
import type { DatabaseClient } from "./client";
import type {
  StoredCampaignPreviewOption,
  StoredContentDraft,
  StoredContentDraftApproval,
  StoredDraftChannelPreview,
  StoredDraftGeneration,
  StoredDraftPreviewAsset,
} from "./models";

type DraftRow = Omit<StoredContentDraft, "currentVersion" | "generation"> & {
  currentVersionId: string;
};

export class DraftValidationError extends Error {
  constructor(readonly issues: readonly { code: string; message: string }[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "DraftValidationError";
  }
}

export class DraftRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async generate(
    input: {
      workspaceId: string;
      campaignId: string;
      contentPackageId: string;
      draftFormat?: DraftFormat;
    },
    actorUserId: string,
  ): Promise<readonly StoredContentDraft[]> {
    const ids = await this.sql.begin(async (transaction) => {
      const campaigns = await transaction<
        {
          campaignVersionId: string;
          campaignName: string;
          contentPackageIds: string[];
          brandProfileVersionId?: string;
          informationDepth: StoredDraftGeneration["informationDepth"];
          promotionalStrength: StoredDraftGeneration["promotionalStrength"];
        }[]
      >`
        SELECT cv.id AS campaign_version_id, c.name AS campaign_name, cv.content_package_ids,
          cv.brand_profile_version_id, cv.information_depth, cv.promotional_strength
        FROM campaign c JOIN campaign_version cv ON cv.id = c.current_version_id
        WHERE c.id = ${input.campaignId} AND c.workspace_id = ${input.workspaceId} AND cv.status IN ('published', 'superseded')
      `;
      const campaign = campaigns[0];
      if (!campaign)
        throw new DraftValidationError([
          {
            code: "campaign_not_published",
            message: "A published Campaign version is required.",
          },
        ]);
      if (!campaign.contentPackageIds.includes(input.contentPackageId))
        throw new DraftValidationError([
          {
            code: "package_not_bound",
            message:
              "The Content Package is not bound to the published Campaign version.",
          },
        ]);
      const packages = await transaction<
        { id: string; title: string; version: number; status: string }[]
      >`
        SELECT id, title, version, status FROM content_package WHERE id = ${input.contentPackageId} AND workspace_id = ${input.workspaceId}
      `;
      if (packages[0]?.status !== "approved")
        throw new DraftValidationError([
          {
            code: "package_not_approved",
            message: "An approved Content Package is required.",
          },
        ]);
      const evidence = await transaction<EvidenceItem[]>`
        SELECT id, fact_key, claim, provenance, source_references, confidence, context_pack_version_id, superseded_by_evidence_id
        FROM evidence_item WHERE content_package_id = ${input.contentPackageId} AND superseded_by_evidence_id IS NULL ORDER BY created_at, id
      `;
      const usable = evidence.filter(
        (item) => item.provenance !== "unresolved",
      );
      if (!usable.length)
        throw new DraftValidationError([
          {
            code: "evidence_required",
            message: "At least one resolved evidence item is required.",
          },
        ]);

      const brandRows = campaign.brandProfileVersionId
        ? await transaction<{ name: string; profile: BrandProfileData }[]>`
        SELECT b.name, bv.profile FROM brand_profile_version bv JOIN brand_profile b ON b.id = bv.brand_profile_id
        WHERE bv.id = ${campaign.brandProfileVersionId} AND b.workspace_id = ${input.workspaceId}
      `
        : [];
      const audiences = await transaction<
        { id: string; name: string; profile: AudienceProfileData }[]
      >`
        SELECT av.id, a.name, av.profile FROM campaign_version_audience_profile binding
        JOIN audience_profile_version av ON av.id = binding.audience_profile_version_id
        JOIN audience_profile a ON a.id = av.audience_profile_id
        WHERE binding.campaign_version_id = ${campaign.campaignVersionId} AND a.workspace_id = ${input.workspaceId}
        ORDER BY binding.sort_order
      `;
      const variants: readonly {
        id?: string;
        name?: string;
        profile?: AudienceProfileData;
      }[] = audiences.length ? audiences : [{}];
      const characterBudgetAudienceName = audiences.reduce<string | undefined>(
        (longest, audience) =>
          !longest || audience.name.length > longest.length
            ? audience.name
            : longest,
        undefined,
      );
      const generationId = randomUUID();
      const evidenceSnapshot = usable.map(
        ({ id, factKey, claim, provenance, sourceReferences, confidence }) => ({
          id,
          ...(factKey ? { factKey } : {}),
          claim,
          provenance,
          sourceReferences,
          ...(confidence !== undefined ? { confidence } : {}),
        }),
      );
      await transaction`
        INSERT INTO draft_generation (id, workspace_id, campaign_version_id, content_package_id, content_package_version,
          brand_profile_version_id, information_depth, promotional_strength, evidence_snapshot,
          generator_provider, generator_model, generator_version, prompt_version, draft_format, created_by)
        VALUES (${generationId}, ${input.workspaceId}, ${campaign.campaignVersionId}, ${input.contentPackageId}, ${packages[0]!.version},
          ${campaign.brandProfileVersionId ?? null}, ${campaign.informationDepth}, ${campaign.promotionalStrength},
          ${transaction.json(evidenceSnapshot as JSONValue)}, ${GENERATOR_PROVIDER}, ${GENERATOR_MODEL}, ${GENERATOR_VERSION}, ${PROMPT_VERSION}, ${input.draftFormat ?? "channel_neutral"}, ${actorUserId})
      `;
      const draftIds: string[] = [];
      for (const audience of variants) {
        let generated;
        try {
          generated = generateGroundedDraft({
            packageTitle: packages[0]!.title,
            evidence: usable,
            informationDepth: campaign.informationDepth,
            promotionalStrength: campaign.promotionalStrength,
            format: input.draftFormat ?? "channel_neutral",
            ...(characterBudgetAudienceName
              ? { characterBudgetAudienceName }
              : {}),
            ...(brandRows[0] ? { brand: brandRows[0] } : {}),
            ...(audience.id && audience.name && audience.profile
              ? { audience: { name: audience.name, profile: audience.profile } }
              : {}),
          });
        } catch (error) {
          throw new DraftValidationError([
            {
              code: "format_limit",
              message:
                error instanceof Error
                  ? error.message
                  : "The selected format cannot contain the approved evidence.",
            },
          ]);
        }
        const draftId = randomUUID();
        const versionId = randomUUID();
        draftIds.push(draftId);
        await transaction`
          INSERT INTO content_draft (id, workspace_id, draft_generation_id, audience_profile_version_id, current_version_id, created_by)
          VALUES (${draftId}, ${input.workspaceId}, ${generationId}, ${audience.id ?? null}, null, ${actorUserId})
        `;
        await transaction`
          INSERT INTO content_draft_version (id, content_draft_id, version_number, headline, body, call_to_action, hashtags, alt_text, rationale, presentation_choices, created_by)
          VALUES (${versionId}, ${draftId}, 1, ${generated.headline}, ${generated.body}, ${generated.callToAction ?? null}, ${[...generated.hashtags]}, ${generated.altText ?? null}, ${generated.rationale}, ${transaction.json(generated.presentationChoices as JSONValue)}, ${actorUserId})
        `;
        await transaction`UPDATE content_draft SET current_version_id = ${versionId} WHERE id = ${draftId}`;
        await this.insertClaims(transaction, versionId, generated.claims);
      }
      await this.audit(
        transaction,
        input.workspaceId,
        actorUserId,
        "draft.generated",
        "draft_generation",
        generationId,
        {
          campaignVersionId: campaign.campaignVersionId,
          contentPackageId: input.contentPackageId,
          draftIds,
        },
      );
      return draftIds;
    });
    const drafts = await this.list(input.workspaceId);
    return ids.map((id) => drafts.find((draft) => draft.id === id)!);
  }

  async list(workspaceId: string): Promise<StoredContentDraft[]> {
    return this.attach(
      await this.sql<DraftRow[]>`
      SELECT d.id, d.workspace_id, d.draft_generation_id, d.audience_profile_version_id,
        a.name AS audience_name, c.name AS campaign_name, p.title AS package_title,
        d.status, d.current_version_id, d.created_by, d.created_at, d.updated_at
      FROM content_draft d JOIN draft_generation g ON g.id = d.draft_generation_id
      JOIN campaign_version cv ON cv.id = g.campaign_version_id JOIN campaign c ON c.id = cv.campaign_id
      JOIN content_package p ON p.id = g.content_package_id
      LEFT JOIN audience_profile_version av ON av.id = d.audience_profile_version_id
      LEFT JOIN audience_profile a ON a.id = av.audience_profile_id
      WHERE d.workspace_id = ${workspaceId} ORDER BY d.updated_at DESC
    `,
    );
  }

  async get(
    workspaceId: string,
    id: string,
  ): Promise<StoredContentDraft | undefined> {
    return (
      await this.attach(
        await this.sql<DraftRow[]>`
      SELECT d.id, d.workspace_id, d.draft_generation_id, d.audience_profile_version_id,
        a.name AS audience_name, c.name AS campaign_name, p.title AS package_title,
        d.status, d.current_version_id, d.created_by, d.created_at, d.updated_at
      FROM content_draft d JOIN draft_generation g ON g.id = d.draft_generation_id
      JOIN campaign_version cv ON cv.id = g.campaign_version_id JOIN campaign c ON c.id = cv.campaign_id
      JOIN content_package p ON p.id = g.content_package_id
      LEFT JOIN audience_profile_version av ON av.id = d.audience_profile_version_id
      LEFT JOIN audience_profile a ON a.id = av.audience_profile_id
      WHERE d.workspace_id = ${workspaceId} AND d.id = ${id}
    `,
      )
    )[0];
  }

  async submit(
    workspaceId: string,
    id: string,
    actorUserId: string,
  ): Promise<StoredContentDraft | undefined> {
    const changed = await this.sql.begin(async (transaction) => {
      const rows = await transaction<
        {
          versionId: string;
          headline: string;
          body: string;
          audienceName?: string;
          campaignName: string;
          packageTitle: string;
        }[]
      >`
        SELECT d.current_version_id AS version_id, v.headline, v.body, a.name AS audience_name, c.name AS campaign_name, p.title AS package_title
        FROM content_draft d JOIN content_draft_version v ON v.id = d.current_version_id
        JOIN draft_generation g ON g.id = d.draft_generation_id JOIN campaign_version cv ON cv.id = g.campaign_version_id
        JOIN campaign c ON c.id = cv.campaign_id JOIN content_package p ON p.id = g.content_package_id
        LEFT JOIN audience_profile_version av ON av.id = d.audience_profile_version_id LEFT JOIN audience_profile a ON a.id = av.audience_profile_id
        WHERE d.id = ${id} AND d.workspace_id = ${workspaceId} AND d.status IN ('working', 'changes_requested') FOR UPDATE OF d, v
      `;
      if (!rows[0]) return false;
      const approvalId = randomUUID();
      const snapshot = {
        headline: rows[0].headline,
        body: rows[0].body,
        audienceName: rows[0].audienceName ?? "General",
        campaignName: rows[0].campaignName,
        packageTitle: rows[0].packageTitle,
      };
      await transaction`UPDATE content_draft SET status = 'pending_review', updated_at = now() WHERE id = ${id}`;
      await transaction`UPDATE content_draft_version SET status = 'pending_review' WHERE id = ${rows[0].versionId}`;
      await transaction`INSERT INTO content_draft_approval (id, workspace_id, content_draft_id, content_draft_version_id, request_snapshot, requested_by) VALUES (${approvalId}, ${workspaceId}, ${id}, ${rows[0].versionId}, ${transaction.json(snapshot)}, ${actorUserId})`;
      await this.audit(
        transaction,
        workspaceId,
        actorUserId,
        "draft.submitted",
        "content_draft",
        id,
        { approvalId, versionId: rows[0].versionId },
      );
      return true;
    });
    return changed ? this.get(workspaceId, id) : undefined;
  }

  async revise(input: {
    workspaceId: string;
    draftId: string;
    leadIn: string;
    callToAction?: string;
    hashtags: readonly string[];
    altText?: string;
    changeNote: string;
    actorUserId: string;
  }): Promise<StoredContentDraft | undefined> {
    const leadIn = input.leadIn.trim();
    if (/[.!?]/u.test(leadIn))
      throw new DraftValidationError([
        {
          code: "lead_in_not_presentational",
          message:
            "The lead-in cannot contain sentence punctuation or factual assertions.",
        },
      ]);
    if (
      new Set(input.hashtags.map((tag) => tag.toLocaleLowerCase())).size !==
        input.hashtags.length ||
      input.hashtags.some((tag) => !/^#[\p{L}\p{N}_]{1,50}$/u.test(tag))
    ) {
      throw new DraftValidationError([
        {
          code: "invalid_hashtags",
          message:
            "Hashtags must be unique and use # followed by letters, numbers, or underscores.",
        },
      ]);
    }
    const changed = await this.sql.begin(async (transaction) => {
      const rows = await transaction<
        {
          versionId: string;
          versionNumber: number;
          headline: string;
          rationale: string;
          presentationChoices: Record<string, unknown>;
          draftFormat: DraftFormat;
        }[]
      >`
        SELECT v.id AS version_id, v.version_number, v.headline, v.rationale, v.presentation_choices, g.draft_format
        FROM content_draft d JOIN content_draft_version v ON v.id = d.current_version_id JOIN draft_generation g ON g.id = d.draft_generation_id
        WHERE d.id = ${input.draftId} AND d.workspace_id = ${input.workspaceId} AND d.status IN ('working', 'changes_requested') FOR UPDATE OF d, v
      `;
      if (!rows[0]) return false;
      const factClaims = await transaction<
        { kind: "fact"; text: string; evidenceItemIds: string[] }[]
      >`
        SELECT claim.kind, claim.claim_text AS text, array_agg(binding.evidence_item_id ORDER BY binding.evidence_item_id) AS evidence_item_ids
        FROM content_draft_claim claim JOIN content_draft_claim_evidence binding ON binding.content_draft_claim_id = claim.id
        WHERE claim.content_draft_version_id = ${rows[0].versionId} AND claim.kind = 'fact' GROUP BY claim.id ORDER BY min(claim.sort_order)
      `;
      if (!factClaims.length)
        throw new DraftValidationError([
          {
            code: "facts_required",
            message:
              "A revised Draft must preserve at least one evidence-backed factual claim.",
          },
        ]);
      const facts = factClaims
        .map((claim) => claim.text.trim().replace(/[.!?]?$/, "."))
        .join(" ");
      const body = `${leadIn ? `${leadIn}: ` : ""}${facts}`;
      const limit = DRAFT_FORMAT_CHARACTER_LIMITS[rows[0].draftFormat];
      if (limit && body.length + (input.callToAction?.length ?? 0) > limit)
        throw new DraftValidationError([
          {
            code: "format_limit",
            message: `The revised copy exceeds the ${limit}-character ${rows[0].draftFormat} limit.`,
          },
        ]);
      const versionId = randomUUID();
      await transaction`UPDATE content_draft_version SET status = 'superseded' WHERE id = ${rows[0].versionId}`;
      await transaction`
        INSERT INTO content_draft_version (id, content_draft_id, version_number, status, headline, body, call_to_action, hashtags, alt_text, rationale, presentation_choices, source_version_id, change_note, created_by)
        VALUES (${versionId}, ${input.draftId}, ${rows[0].versionNumber + 1}, 'working', ${rows[0].headline}, ${body}, ${input.callToAction ?? null}, ${[...input.hashtags]}, ${input.altText ?? null}, ${rows[0].rationale}, ${transaction.json({ ...rows[0].presentationChoices, leadIn } as JSONValue)}, ${rows[0].versionId}, ${input.changeNote}, ${input.actorUserId})
      `;
      await this.insertClaims(transaction, versionId, [
        ...factClaims,
        ...(input.callToAction
          ? [
              {
                kind: "call_to_action" as const,
                text: input.callToAction,
                evidenceItemIds: [],
              },
            ]
          : []),
      ]);
      await transaction`UPDATE content_draft SET current_version_id = ${versionId}, status = 'working', updated_at = now() WHERE id = ${input.draftId}`;
      await this.audit(
        transaction,
        input.workspaceId,
        input.actorUserId,
        "draft.revised",
        "content_draft",
        input.draftId,
        {
          sourceVersionId: rows[0].versionId,
          versionId,
          changeNote: input.changeNote,
        },
      );
      return true;
    });
    return changed ? this.get(input.workspaceId, input.draftId) : undefined;
  }

  async createChannelPreview(input: {
    workspaceId: string;
    draftId: string;
    channelConnectionId: string;
    destinationId?: string;
    linkMode?: "canonical" | "tracked";
    appBaseUrl?: string;
    assetIds?: readonly string[];
    actorUserId: string;
  }): Promise<StoredDraftChannelPreview | undefined> {
    const previewId = await this.sql.begin(async (transaction) => {
      const drafts = await transaction<
        {
          versionId: string;
          headline: string;
          body: string;
          callToAction?: string;
          hashtags: string[];
          campaignId: string;
          brandProfileId?: string;
          contentPackageId: string;
        }[]
      >`
        SELECT v.id AS version_id, v.headline, v.body, v.call_to_action, v.hashtags,
          cv.campaign_id, brand_version.brand_profile_id, generation.content_package_id
        FROM content_draft d JOIN content_draft_version v ON v.id = d.current_version_id
        JOIN draft_generation generation ON generation.id = d.draft_generation_id
        JOIN campaign_version cv ON cv.id = generation.campaign_version_id
        LEFT JOIN brand_profile_version brand_version ON brand_version.id = cv.brand_profile_version_id
        WHERE d.id = ${input.draftId} AND d.workspace_id = ${input.workspaceId}
          AND d.status = 'approved' AND v.status = 'approved' FOR UPDATE OF d, v
      `;
      if (!drafts[0])
        throw new DraftValidationError([
          {
            code: "approved_draft_required",
            message:
              "Approve the exact Draft version before creating a channel preview.",
          },
        ]);
      const connections = await transaction<
        {
          id: string;
          provider: ChannelProvider;
          capabilities: Record<string, unknown>;
          capabilitiesObservedAt: string;
        }[]
      >`
        SELECT id, provider, capabilities, capabilities_observed_at FROM channel_connection
        WHERE id = ${input.channelConnectionId} AND workspace_id = ${input.workspaceId} AND status = 'active'
      `;
      if (!connections[0])
        throw new DraftValidationError([
          {
            code: "active_channel_required",
            message: "Select an active channel connection from this workspace.",
          },
        ]);
      const manifest = parseChannelManifest(
        connections[0].provider,
        connections[0].capabilities,
      );
      const assetIds = [...(input.assetIds ?? [])];
      if (new Set(assetIds).size !== assetIds.length)
        throw new DraftValidationError([
          {
            code: "duplicate_preview_asset",
            message: "Select each preview attachment only once.",
          },
        ]);
      if (assetIds.length && manifest.features?.attachments !== true)
        throw new DraftValidationError([
          {
            code: "attachments_unsupported",
            message:
              "This channel connection does not support media attachments.",
          },
        ]);
      const attachmentLimit = manifest.limits.attachmentsPerMessage ?? 0;
      if (assetIds.length > attachmentLimit)
        throw new DraftValidationError([
          {
            code: "attachment_count_limit",
            message: `This channel accepts at most ${attachmentLimit} attachments.`,
          },
        ]);
      const assets = assetIds.length
        ? await transaction<
            (StoredDraftPreviewAsset & {
              metadata: Record<string, unknown>;
              mediaStatus: string;
              rightsValidFrom?: string | Date;
              rightsPermittedChannels: string[];
              rightsPermittedChannelConnectionIds: string[];
              rightsPermittedCampaignIds: string[];
              rightsPermittedBrandProfileIds: string[];
            })[]
          >`
        SELECT asset.id AS content_asset_id, asset.source_asset_id, asset.object_key, asset.content_hash, asset.file_name,
          asset.mime_type, asset.byte_size, asset.metadata, asset.media_status,
          CASE WHEN asset.source_asset_id IS NULL THEN asset.alt_text ELSE source.alt_text END AS alt_text,
          CASE WHEN asset.source_asset_id IS NULL THEN asset.alt_text_status ELSE source.alt_text_status END AS alt_text_status,
          CASE WHEN source.id IS NULL THEN asset.scan_status ELSE source.scan_status END AS scan_status,
          CASE WHEN source.id IS NULL THEN asset.scan_revision ELSE source.scan_revision END AS scan_revision,
          COALESCE(source.scan_scanned_at, asset.scan_scanned_at) AS scan_scanned_at,
          CASE WHEN source.id IS NULL THEN asset.rights_status ELSE source.rights_status END AS rights_status,
          CASE WHEN source.id IS NULL THEN asset.rights_revision ELSE source.rights_revision END AS rights_revision,
          COALESCE(source.rights_reviewed_at, asset.rights_reviewed_at) AS rights_reviewed_at,
          COALESCE(source.rights_valid_from, asset.rights_valid_from) AS rights_valid_from,
          COALESCE(source.rights_expires_at, asset.rights_expires_at) AS rights_expires_at,
          CASE WHEN source.id IS NULL THEN asset.rights_permitted_channels ELSE source.rights_permitted_channels END AS rights_permitted_channels,
          ARRAY(
              SELECT scope.channel_connection_id::text
              FROM content_asset_rights_channel_connection scope
              WHERE scope.content_asset_id = CASE WHEN source.id IS NULL THEN asset.id ELSE source.id END
              ORDER BY scope.channel_connection_id
            ) AS rights_permitted_channel_connection_ids,
            ARRAY(
              SELECT scope.campaign_id::text FROM content_asset_rights_campaign scope
              WHERE scope.content_asset_id = CASE WHEN source.id IS NULL THEN asset.id ELSE source.id END
              ORDER BY scope.campaign_id
            ) AS rights_permitted_campaign_ids
            , ARRAY(
              SELECT scope.brand_profile_id::text
              FROM content_asset_rights_brand_profile scope
              WHERE scope.content_asset_id = CASE WHEN source.id IS NULL THEN asset.id ELSE source.id END
              ORDER BY scope.brand_profile_id
            ) AS rights_permitted_brand_profile_ids
        FROM content_asset asset
        LEFT JOIN content_asset source ON source.id = asset.source_asset_id
        WHERE asset.id IN ${transaction(assetIds)} AND asset.content_package_id = ${drafts[0].contentPackageId}
      `
        : [];
      const selected = new Map(
        assets.map((asset) => [asset.contentAssetId, asset]),
      );
      const issues: { code: string; message: string }[] = [];
      if (assets.length !== assetIds.length)
        issues.push({
          code: "preview_asset_not_found",
          message:
            "Every attachment must belong to this Draft generation's Content Package.",
        });
      for (const id of assetIds) {
        const asset = selected.get(id);
        if (!asset) continue;
        const imageFeature = asset.mimeType === "image/jpeg" ? "imageJpeg"
          : asset.mimeType === "image/png" ? "imagePng"
            : asset.mimeType === "image/webp" ? "imageWebp"
              : asset.mimeType === "image/gif" ? "imageGif" : undefined;
        if (!asset.objectKey || asset.mediaStatus !== "processed" || !imageFeature
          || manifest.features?.[imageFeature] !== true
          || !/^[^\\/\u0000]{1,255}\.(jpe?g|png|webp|gif)$/i.test(asset.fileName))
          issues.push({
            code: "preview_asset_type",
            message: `${asset.fileName} is not a processed image supported by this channel.`,
          });
        if (connections[0].provider === "mastodon_account" && asset.altTextStatus !== "approved")
          issues.push({
            code: "preview_asset_mastodon_alt_text",
            message: `${asset.fileName} requires approved alternative text for Mastodon publication.`,
          });
        if (
          asset.byteSize < 1 ||
          asset.byteSize > (manifest.limits.attachmentBytes ?? 0)
        )
          issues.push({
            code: "preview_asset_size",
            message: `${asset.fileName} exceeds this channel's attachment size limit.`,
          });
        const pixelLimit = manifest.limits.attachmentPixels;
        if (pixelLimit !== undefined) {
          const width = asset.metadata.width;
          const height = asset.metadata.height;
          if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
            || Number(width) < 1 || Number(height) < 1 || Number(width) * Number(height) > pixelLimit)
            issues.push({
              code: "preview_asset_pixels",
              message: `${asset.fileName} has unverifiable dimensions or exceeds this channel's pixel limit.`,
            });
        }
        if (!["approved", "decorative"].includes(asset.altTextStatus))
          issues.push({
            code: "preview_asset_accessibility",
            message: `${asset.fileName} needs approved alternative text or a decorative designation.`,
          });
        if (asset.altTextStatus === "approved" && !asset.altText?.trim())
          issues.push({
            code: "preview_asset_alt_text",
            message: `${asset.fileName} has approved status but no alternative text.`,
          });
        if (
          asset.altText &&
          (connections[0].provider === "mastodon_account" ? Array.from(asset.altText).length : asset.altText.length) >
            (manifest.limits.attachmentDescriptionCharacters ?? 0)
        )
          issues.push({
            code: "preview_asset_alt_text_limit",
            message: `${asset.fileName} alternative text exceeds this channel's description limit.`,
          });
        if (
          asset.scanStatus !== "clean" ||
          asset.scanRevision < 1 ||
          !asset.scanScannedAt
        )
          issues.push({
            code: "preview_asset_scan",
            message: `${asset.fileName} needs a completed malware scan before publication.`,
          });
        const now = new Date();
        if (
          asset.rightsStatus !== "cleared" ||
          asset.rightsRevision < 1 ||
          !asset.rightsReviewedAt ||
          (asset.rightsValidFrom && new Date(asset.rightsValidFrom) > now) ||
          (asset.rightsExpiresAt && new Date(asset.rightsExpiresAt) <= now) ||
          !asset.rightsPermittedChannels.includes(connections[0].provider) ||
          !asset.rightsPermittedChannelConnectionIds.includes(
            connections[0].id,
          ) ||
          !asset.rightsPermittedCampaignIds.includes(drafts[0].campaignId) ||
          !drafts[0].brandProfileId ||
          !asset.rightsPermittedBrandProfileIds.includes(
            drafts[0].brandProfileId,
          )
        )
          issues.push({
            code: "preview_asset_rights",
            message: `${asset.fileName} needs a current reviewed clearance for this channel, Campaign, and Brand Profile.`,
          });
      }
      if (issues.length) throw new DraftValidationError(issues);
      let destination: { id: string; canonicalUrl: string } | undefined;
      if (input.destinationId) {
        destination = (
          await transaction<{ id: string; canonicalUrl: string }[]>`
          SELECT id, canonical_url FROM destination WHERE id = ${input.destinationId} AND workspace_id = ${input.workspaceId} AND status = 'published'
        `
        )[0];
        if (!destination)
          throw new DraftValidationError([
            {
              code: "published_destination_required",
              message:
                "The selected Destination must be published in this workspace.",
            },
          ]);
      }
      const linkMode = input.linkMode ?? "canonical";
      if (linkMode === "tracked" && !destination)
        throw new DraftValidationError([
          {
            code: "tracked_destination_required",
            message:
              "A first-party tracked preview requires a published Destination.",
          },
        ]);
      const existing = (
        await transaction<
          { id: string; trackedLinkId?: string; trackedLinkSlug?: string }[]
        >`
        SELECT preview.id, link.id AS tracked_link_id, link.slug AS tracked_link_slug
        FROM draft_channel_preview preview
        LEFT JOIN tracked_link link ON link.draft_channel_preview_id = preview.id
        WHERE preview.content_draft_version_id = ${drafts[0].versionId}
          AND preview.channel_connection_id = ${connections[0].id}
          AND preview.destination_id IS NOT DISTINCT FROM ${destination?.id ?? null}::uuid
          AND preview.link_mode = ${linkMode}
      `
      )[0];
      const id = existing?.id ?? randomUUID();
      const trackedLinkSlug =
        linkMode === "tracked"
          ? (existing?.trackedLinkSlug ?? randomBytes(12).toString("base64url"))
          : undefined;
      const destinationUrl =
        linkMode === "tracked"
          ? trackedPreviewUrl(input.appBaseUrl, trackedLinkSlug!)
          : destination?.canonicalUrl;
      const rendered = renderChannelPreview(manifest, {
        subject: drafts[0].headline,
        body: drafts[0].body,
        ...(drafts[0].callToAction
          ? { callToAction: drafts[0].callToAction }
          : {}),
        hashtags: drafts[0].hashtags,
        ...(destinationUrl ? { destinationUrl } : {}),
      });
      const stored = await transaction<{ id: string }[]>`
        INSERT INTO draft_channel_preview (id, workspace_id, content_draft_id, content_draft_version_id, channel_connection_id,
          destination_id, link_mode, provider, capability_version, capability_observed_at, status, rendered_subject,
          subject_count, subject_limit, rendered_content, character_count, character_limit, validation_issues, capability_snapshot, created_by)
        VALUES (${id}, ${input.workspaceId}, ${input.draftId}, ${drafts[0].versionId}, ${connections[0].id},
          ${destination?.id ?? null}, ${linkMode}, ${manifest.provider}, ${manifest.version}, (SELECT capabilities_observed_at FROM channel_connection WHERE id = ${connections[0].id}),
          ${rendered.issues.length ? "blocked" : "ready"}, ${rendered.subject ?? null},
          ${rendered.subjectCount ?? null}, ${rendered.subjectLimit ?? null}, ${rendered.content}, ${rendered.characterCount},
          ${rendered.characterLimit ?? null}, ${transaction.json([...rendered.issues] as JSONValue)},
          ${transaction.json(connections[0].capabilities as JSONValue)}, ${input.actorUserId})
        ON CONFLICT (content_draft_version_id, channel_connection_id, destination_id, link_mode) DO UPDATE SET
          provider = EXCLUDED.provider, capability_version = EXCLUDED.capability_version,
          capability_observed_at = EXCLUDED.capability_observed_at, status = EXCLUDED.status,
          rendered_subject = EXCLUDED.rendered_subject, subject_count = EXCLUDED.subject_count, subject_limit = EXCLUDED.subject_limit,
          rendered_content = EXCLUDED.rendered_content, character_count = EXCLUDED.character_count,
          character_limit = EXCLUDED.character_limit, validation_issues = EXCLUDED.validation_issues,
          capability_snapshot = EXCLUDED.capability_snapshot, created_by = EXCLUDED.created_by, created_at = now()
        RETURNING id
      `;
      await transaction`DELETE FROM draft_channel_preview_asset WHERE draft_channel_preview_id = ${stored[0]!.id}`;
      for (const [sortOrder, assetId] of assetIds.entries()) {
        const asset = selected.get(assetId)!;
        await transaction`
          INSERT INTO draft_channel_preview_asset (draft_channel_preview_id, content_asset_id, sort_order, source_asset_id,
            object_key, content_hash, file_name, mime_type, byte_size, alt_text, alt_text_status, scan_status,
            scan_revision, scan_scanned_at,
            rights_status, rights_revision, rights_reviewed_at, rights_expires_at,
            rights_channel_connection_id, rights_campaign_id, rights_brand_profile_id)
          VALUES (${stored[0]!.id}, ${asset.contentAssetId}, ${sortOrder}, ${asset.sourceAssetId ?? null}, ${asset.objectKey},
            ${asset.contentHash}, ${asset.fileName}, ${asset.mimeType}, ${asset.byteSize}, ${asset.altText ?? null},
            ${asset.altTextStatus}, ${asset.scanStatus}, ${asset.scanRevision}, ${asset.scanScannedAt ?? null},
            ${asset.rightsStatus}, ${asset.rightsRevision},
            ${asset.rightsReviewedAt ?? null}, ${asset.rightsExpiresAt ?? null},
            ${connections[0].id}, ${drafts[0].campaignId}, ${drafts[0].brandProfileId ?? null})
        `;
      }
      if (linkMode === "tracked") {
        const utmParameters = {
          utm_source: connections[0].provider === "mailchimp_email"
            ? "mailchimp"
            : connections[0].provider === "slack_webhook" ? "slack"
              : connections[0].provider === "mastodon_account" ? "mastodon" : "discord",
          utm_medium: connections[0].provider === "mailchimp_email" ? "email" : "social",
          utm_campaign: drafts[0].campaignId,
          utm_content: drafts[0].versionId,
        };
        if (existing?.trackedLinkId)
          await transaction`
          UPDATE tracked_link SET canonical_url = ${destination!.canonicalUrl}, utm_parameters = ${transaction.json(utmParameters)}, status = 'active'
          WHERE id = ${existing.trackedLinkId} AND workspace_id = ${input.workspaceId}
        `;
        else
          await transaction`
          INSERT INTO tracked_link (id, workspace_id, destination_id, draft_channel_preview_id, slug, canonical_url, utm_parameters, created_by)
          VALUES (${randomUUID()}, ${input.workspaceId}, ${destination!.id}, ${stored[0]!.id}, ${trackedLinkSlug!}, ${destination!.canonicalUrl}, ${transaction.json(utmParameters)}, ${input.actorUserId})
        `;
      }
      await this.audit(
        transaction,
        input.workspaceId,
        input.actorUserId,
        "draft.channel_preview.created",
        "content_draft",
        input.draftId,
        {
          previewId: stored[0]!.id,
          versionId: drafts[0].versionId,
          channelConnectionId: connections[0].id,
          destinationId: destination?.id,
          linkMode,
          assetIds,
          status: rendered.issues.length ? "blocked" : "ready",
        },
      );
      return stored[0]!.id;
    });
    return (
      await this.listChannelPreviews(input.workspaceId, input.draftId)
    ).find((preview) => preview.id === previewId);
  }

  async listChannelPreviews(
    workspaceId: string,
    draftId: string,
  ): Promise<StoredDraftChannelPreview[]> {
    const rows = await this.sql<Omit<StoredDraftChannelPreview, "assets">[]>`
      SELECT preview.id, preview.workspace_id, preview.content_draft_id, preview.content_draft_version_id,
        preview.channel_connection_id, connection.name AS channel_connection_name,
        preview.destination_id, destination.title AS destination_title, preview.link_mode,
        link.id AS tracked_link_id, link.slug AS tracked_link_slug, link.status AS tracked_link_status, preview.provider, preview.capability_version,
        preview.capability_observed_at, preview.status, preview.rendered_subject, preview.subject_count, preview.subject_limit,
        preview.rendered_content, preview.character_count,
        preview.character_limit, preview.validation_issues, preview.capability_snapshot,
        (connection.capabilities_observed_at IS DISTINCT FROM preview.capability_observed_at
          OR connection.status <> 'active'
          OR EXISTS (
            SELECT 1
            FROM draft_channel_preview_asset snapshot
            JOIN content_asset current_asset ON current_asset.id = snapshot.content_asset_id
            LEFT JOIN content_asset rights_source ON rights_source.id = current_asset.source_asset_id
            WHERE snapshot.draft_channel_preview_id = preview.id
              AND (
                snapshot.rights_status <> 'cleared'
                OR snapshot.rights_channel_connection_id IS DISTINCT FROM preview.channel_connection_id
                OR snapshot.rights_campaign_id IS DISTINCT FROM (
                  SELECT campaign_version.campaign_id FROM content_draft campaign_draft
                  JOIN draft_generation campaign_generation ON campaign_generation.id = campaign_draft.draft_generation_id
                  JOIN campaign_version ON campaign_version.id = campaign_generation.campaign_version_id
                  WHERE campaign_draft.id = preview.content_draft_id
                )
                OR snapshot.rights_brand_profile_id IS DISTINCT FROM (
                  SELECT brand_version.brand_profile_id
                  FROM content_draft campaign_draft
                  JOIN draft_generation campaign_generation ON campaign_generation.id = campaign_draft.draft_generation_id
                  JOIN campaign_version campaign_version ON campaign_version.id = campaign_generation.campaign_version_id
                  LEFT JOIN brand_profile_version brand_version ON brand_version.id = campaign_version.brand_profile_version_id
                  WHERE campaign_draft.id = preview.content_draft_id
                )
                OR snapshot.scan_status <> 'clean'
                OR snapshot.scan_revision <> CASE WHEN rights_source.id IS NULL
                  THEN current_asset.scan_revision ELSE rights_source.scan_revision END
                OR CASE WHEN rights_source.id IS NULL
                  THEN current_asset.scan_status ELSE rights_source.scan_status END <> 'clean'
                OR COALESCE(rights_source.scan_scanned_at, current_asset.scan_scanned_at) IS NULL
                OR snapshot.rights_revision <> CASE WHEN rights_source.id IS NULL
                  THEN current_asset.rights_revision ELSE rights_source.rights_revision END
                OR CASE WHEN rights_source.id IS NULL
                  THEN current_asset.rights_status ELSE rights_source.rights_status END <> 'cleared'
                OR COALESCE(rights_source.rights_reviewed_at, current_asset.rights_reviewed_at) IS NULL
                OR (COALESCE(rights_source.rights_valid_from, current_asset.rights_valid_from) IS NOT NULL
                  AND COALESCE(rights_source.rights_valid_from, current_asset.rights_valid_from) > now())
                OR (COALESCE(rights_source.rights_expires_at, current_asset.rights_expires_at) IS NOT NULL
                  AND COALESCE(rights_source.rights_expires_at, current_asset.rights_expires_at) <= now())
                OR NOT (preview.provider = ANY(CASE WHEN rights_source.id IS NULL
                  THEN current_asset.rights_permitted_channels ELSE rights_source.rights_permitted_channels END))
                OR NOT EXISTS (
                  SELECT 1 FROM content_asset_rights_channel_connection scope
                  WHERE scope.content_asset_id = CASE WHEN rights_source.id IS NULL
                    THEN current_asset.id ELSE rights_source.id END
                    AND scope.channel_connection_id = preview.channel_connection_id
                )
                OR NOT EXISTS (
                  SELECT 1 FROM content_asset_rights_campaign campaign_scope
                  WHERE campaign_scope.content_asset_id = CASE WHEN rights_source.id IS NULL
                    THEN current_asset.id ELSE rights_source.id END
                    AND campaign_scope.campaign_id = snapshot.rights_campaign_id
                )
                OR NOT EXISTS (
                  SELECT 1 FROM content_asset_rights_brand_profile brand_scope
                  WHERE brand_scope.content_asset_id = CASE WHEN rights_source.id IS NULL
                    THEN current_asset.id ELSE rights_source.id END
                    AND brand_scope.brand_profile_id = snapshot.rights_brand_profile_id
                )
              )
          )) AS is_stale,
        preview.created_by, preview.created_at
      FROM draft_channel_preview preview
      JOIN channel_connection connection ON connection.id = preview.channel_connection_id
      LEFT JOIN tracked_link link ON link.draft_channel_preview_id = preview.id
      LEFT JOIN destination ON destination.id = preview.destination_id
      WHERE preview.workspace_id = ${workspaceId} AND preview.content_draft_id = ${draftId}
      ORDER BY preview.created_at DESC
    `;
    return this.attachPreviewAssets(rows);
  }

  async listCampaignPreviewOptions(
    workspaceId: string,
    campaignId: string,
  ): Promise<StoredCampaignPreviewOption[]> {
    const rows = await this.sql<Omit<StoredCampaignPreviewOption, "assets">[]>`
      SELECT preview.id, preview.workspace_id, preview.content_draft_id, preview.content_draft_version_id,
        preview.channel_connection_id, connection.name AS channel_connection_name,
        preview.destination_id, destination.title AS destination_title, preview.link_mode,
        link.id AS tracked_link_id, link.slug AS tracked_link_slug, link.status AS tracked_link_status, preview.provider, preview.capability_version,
        preview.capability_observed_at, preview.status, preview.rendered_subject, preview.subject_count, preview.subject_limit,
        preview.rendered_content, preview.character_count,
        preview.character_limit, preview.validation_issues, preview.capability_snapshot,
        (connection.capabilities_observed_at IS DISTINCT FROM preview.capability_observed_at
          OR connection.status <> 'active'
          OR EXISTS (
            SELECT 1
            FROM draft_channel_preview_asset snapshot
            JOIN content_asset current_asset ON current_asset.id = snapshot.content_asset_id
            LEFT JOIN content_asset rights_source ON rights_source.id = current_asset.source_asset_id
            WHERE snapshot.draft_channel_preview_id = preview.id
              AND (
                snapshot.rights_status <> 'cleared'
                OR snapshot.rights_channel_connection_id IS DISTINCT FROM preview.channel_connection_id
                OR snapshot.rights_campaign_id IS DISTINCT FROM source_version.campaign_id
                OR snapshot.rights_brand_profile_id IS DISTINCT FROM source_brand_version.brand_profile_id
                OR snapshot.scan_status <> 'clean'
                OR snapshot.scan_revision <> CASE WHEN rights_source.id IS NULL
                  THEN current_asset.scan_revision ELSE rights_source.scan_revision END
                OR CASE WHEN rights_source.id IS NULL
                  THEN current_asset.scan_status ELSE rights_source.scan_status END <> 'clean'
                OR COALESCE(rights_source.scan_scanned_at, current_asset.scan_scanned_at) IS NULL
                OR snapshot.rights_revision <> CASE WHEN rights_source.id IS NULL
                  THEN current_asset.rights_revision ELSE rights_source.rights_revision END
                OR CASE WHEN rights_source.id IS NULL
                  THEN current_asset.rights_status ELSE rights_source.rights_status END <> 'cleared'
                OR COALESCE(rights_source.rights_reviewed_at, current_asset.rights_reviewed_at) IS NULL
                OR (COALESCE(rights_source.rights_valid_from, current_asset.rights_valid_from) IS NOT NULL
                  AND COALESCE(rights_source.rights_valid_from, current_asset.rights_valid_from) > now())
                OR (COALESCE(rights_source.rights_expires_at, current_asset.rights_expires_at) IS NOT NULL
                  AND COALESCE(rights_source.rights_expires_at, current_asset.rights_expires_at) <= now())
                OR NOT (preview.provider = ANY(CASE WHEN rights_source.id IS NULL
                  THEN current_asset.rights_permitted_channels ELSE rights_source.rights_permitted_channels END))
                OR NOT EXISTS (
                  SELECT 1 FROM content_asset_rights_channel_connection scope
                  WHERE scope.content_asset_id = CASE WHEN rights_source.id IS NULL
                    THEN current_asset.id ELSE rights_source.id END
                    AND scope.channel_connection_id = preview.channel_connection_id
                )
                OR NOT EXISTS (
                  SELECT 1 FROM content_asset_rights_campaign campaign_scope
                  WHERE campaign_scope.content_asset_id = CASE WHEN rights_source.id IS NULL
                    THEN current_asset.id ELSE rights_source.id END
                    AND campaign_scope.campaign_id = source_version.campaign_id
                )
                OR NOT EXISTS (
                  SELECT 1 FROM content_asset_rights_brand_profile brand_scope
                  WHERE brand_scope.content_asset_id = CASE WHEN rights_source.id IS NULL
                    THEN current_asset.id ELSE rights_source.id END
                    AND brand_scope.brand_profile_id = source_brand_version.brand_profile_id
                )
              )
          )) AS is_stale,
        preview.created_by, preview.created_at, campaign.id AS campaign_id,
        source_version.id AS source_campaign_version_id,
        source_version.version_number AS source_campaign_version_number,
        draft_version.headline AS draft_headline, audience.name AS audience_name,
        (draft.current_version_id = preview.content_draft_version_id
          AND draft.status = 'approved' AND draft_version.status = 'approved') AS is_current_approved_version
      FROM draft_channel_preview preview
      JOIN content_draft draft ON draft.id = preview.content_draft_id
      JOIN content_draft_version draft_version ON draft_version.id = preview.content_draft_version_id
      JOIN draft_generation generation ON generation.id = draft.draft_generation_id
      JOIN campaign_version source_version ON source_version.id = generation.campaign_version_id
      LEFT JOIN brand_profile_version source_brand_version ON source_brand_version.id = source_version.brand_profile_version_id
      JOIN campaign ON campaign.id = source_version.campaign_id AND campaign.workspace_id = preview.workspace_id
      LEFT JOIN audience_profile_version audience_version ON audience_version.id = draft.audience_profile_version_id
      LEFT JOIN audience_profile audience ON audience.id = audience_version.audience_profile_id
      JOIN channel_connection connection ON connection.id = preview.channel_connection_id
      LEFT JOIN tracked_link link ON link.draft_channel_preview_id = preview.id
      LEFT JOIN destination ON destination.id = preview.destination_id
      WHERE preview.workspace_id = ${workspaceId} AND campaign.id = ${campaignId}
      ORDER BY preview.created_at DESC, preview.id
    `;
    return this.attachPreviewAssets(rows);
  }

  async listApprovals(
    workspaceId: string,
    status: StoredContentDraftApproval["status"] = "pending",
  ): Promise<StoredContentDraftApproval[]> {
    return this.sql<
      StoredContentDraftApproval[]
    >`SELECT id, workspace_id, content_draft_id, content_draft_version_id, status, request_snapshot, requested_by, assigned_reviewer_id, decided_by, decision_notes, created_at, decided_at FROM content_draft_approval WHERE workspace_id = ${workspaceId} AND status = ${status} ORDER BY created_at`;
  }

  async decide(input: {
    workspaceId: string;
    approvalId: string;
    decision: "approved" | "rejected" | "changes_requested";
    notes?: string;
    actorUserId: string;
  }): Promise<StoredContentDraft | undefined> {
    const draftId = await this.sql.begin(async (transaction) => {
      const rows = await transaction<
        { contentDraftId: string; contentDraftVersionId: string }[]
      >`SELECT content_draft_id, content_draft_version_id FROM content_draft_approval WHERE id = ${input.approvalId} AND workspace_id = ${input.workspaceId} AND status = 'pending' FOR UPDATE`;
      if (!rows[0]) return undefined;
      await transaction`UPDATE content_draft_approval SET status = ${input.decision}, decided_by = ${input.actorUserId}, decision_notes = ${input.notes ?? null}, decided_at = now() WHERE id = ${input.approvalId}`;
      await transaction`UPDATE content_draft SET status = ${input.decision}, updated_at = now() WHERE id = ${rows[0].contentDraftId}`;
      await transaction`UPDATE content_draft_version SET status = ${input.decision} WHERE id = ${rows[0].contentDraftVersionId}`;
      await this.audit(
        transaction,
        input.workspaceId,
        input.actorUserId,
        `draft.${input.decision}`,
        "content_draft",
        rows[0].contentDraftId,
        { approvalId: input.approvalId, notes: input.notes },
      );
      return rows[0].contentDraftId;
    });
    return draftId ? this.get(input.workspaceId, draftId) : undefined;
  }

  private async attach(
    rows: readonly DraftRow[],
  ): Promise<StoredContentDraft[]> {
    if (!rows.length) return [];
    const versionIds = rows.map((row) => row.currentVersionId);
    const versions = await this.sql<
      (Omit<ContentDraftVersion, "claims"> & { contentDraftId: string })[]
    >`
      SELECT id, content_draft_id, version_number, status, headline, body, call_to_action, hashtags, alt_text, rationale, presentation_choices, source_version_id, change_note, created_by, created_at FROM content_draft_version WHERE id IN ${this.sql(versionIds)}
    `;
    const claims = await this.sql<
      {
        id: string;
        contentDraftVersionId: string;
        kind: "fact" | "call_to_action";
        text: string;
        evidenceItemIds: string[];
      }[]
    >`
      SELECT claim.id, claim.content_draft_version_id, claim.kind, claim.claim_text AS text, COALESCE(array_agg(binding.evidence_item_id) FILTER (WHERE binding.evidence_item_id IS NOT NULL), '{}') AS evidence_item_ids
      FROM content_draft_claim claim LEFT JOIN content_draft_claim_evidence binding ON binding.content_draft_claim_id = claim.id
      WHERE claim.content_draft_version_id IN ${this.sql(versionIds)} GROUP BY claim.id ORDER BY min(claim.sort_order)
    `;
    const generationIds = [
      ...new Set(rows.map((row) => row.draftGenerationId)),
    ];
    const generations = await this.sql<
      StoredDraftGeneration[]
    >`SELECT id, workspace_id, campaign_version_id, content_package_id, content_package_version, brand_profile_version_id, information_depth, promotional_strength, evidence_snapshot, generator_provider, generator_model, generator_version, prompt_version, draft_format, created_by, created_at FROM draft_generation WHERE id IN ${this.sql(generationIds)}`;
    return rows.map((row) => {
      const version = versions.find(
        (item) => item.id === row.currentVersionId,
      )!;
      return {
        ...row,
        currentVersion: {
          ...version,
          claims: claims
            .filter((claim) => claim.contentDraftVersionId === version.id)
            .map(({ contentDraftVersionId: _, ...claim }) => claim),
        },
        generation: generations.find(
          (item) => item.id === row.draftGenerationId,
        )!,
      };
    });
  }

  private async attachPreviewAssets<T extends { id: string }>(
    rows: readonly T[],
  ): Promise<(T & { assets: readonly StoredDraftPreviewAsset[] })[]> {
    if (!rows.length) return [];
    const assets = await this.sql<
      (StoredDraftPreviewAsset & { draftChannelPreviewId: string })[]
    >`
      SELECT draft_channel_preview_id, content_asset_id, sort_order, source_asset_id, object_key, content_hash,
        file_name, mime_type, byte_size, alt_text, alt_text_status, scan_status, scan_revision, scan_scanned_at, rights_status,
        rights_revision, rights_reviewed_at, rights_expires_at,
        rights_channel_connection_id, rights_campaign_id, rights_brand_profile_id
      FROM draft_channel_preview_asset
      WHERE draft_channel_preview_id IN ${this.sql(rows.map((row) => row.id))}
      ORDER BY draft_channel_preview_id, sort_order
    `;
    return rows.map((row) => ({
      ...row,
      assets: assets
        .filter((asset) => asset.draftChannelPreviewId === row.id)
        .map(({ draftChannelPreviewId: _, ...asset }) => ({
          ...asset,
          byteSize: Number(asset.byteSize),
          scanScannedAt: asset.scanScannedAt
            ? new Date(asset.scanScannedAt).toISOString()
            : undefined,
          rightsReviewedAt: asset.rightsReviewedAt
            ? new Date(asset.rightsReviewedAt).toISOString()
            : undefined,
          rightsExpiresAt: asset.rightsExpiresAt
            ? new Date(asset.rightsExpiresAt).toISOString()
            : undefined,
        })),
    }));
  }

  private async insertClaims(
    transaction: TransactionSql,
    versionId: string,
    claims: readonly {
      kind: "fact" | "call_to_action";
      text: string;
      evidenceItemIds: readonly string[];
    }[],
  ) {
    for (const [sortOrder, claim] of claims.entries()) {
      const claimId = randomUUID();
      await transaction`INSERT INTO content_draft_claim (id, content_draft_version_id, kind, claim_text, sort_order) VALUES (${claimId}, ${versionId}, ${claim.kind}, ${claim.text}, ${sortOrder})`;
      for (const evidenceId of claim.evidenceItemIds)
        await transaction`INSERT INTO content_draft_claim_evidence (content_draft_claim_id, evidence_item_id) VALUES (${claimId}, ${evidenceId})`;
    }
  }

  private async audit(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
    eventType: string,
    subjectType: string,
    subjectId: string,
    data: Record<string, unknown>,
  ) {
    await transaction`INSERT INTO audit_event (id, organization_id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data) SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, ${eventType}, ${subjectType}, ${subjectId}, ${transaction.json(data as JSONValue)} FROM workspace WHERE id = ${workspaceId}`;
  }
}

function parseChannelManifest(
  provider: ChannelProvider,
  value: Record<string, unknown>,
): ChannelCapabilityManifest {
  const supportedActions = value.supportedActions;
  const limits = value.limits;
  const actions = supportedActions as Record<string, unknown> | undefined;
  const publishContent = actions?.publish_content ?? actions?.publishContent;
  if (
    value.provider !== provider ||
    typeof value.version !== "string" ||
    typeof value.observedAt !== "string" ||
    !supportedActions ||
    typeof supportedActions !== "object" ||
    typeof publishContent !== "boolean" ||
    !limits ||
    typeof limits !== "object"
  ) {
    throw new DraftValidationError([
      {
        code: "invalid_capability_manifest",
        message:
          "The channel capability snapshot is incomplete; test the connection again.",
      },
    ]);
  }
  return {
    ...value,
    supportedActions: {
      publish_content: publishContent,
      read_metrics: Boolean(actions?.read_metrics ?? actions?.readMetrics),
      monitor_events: Boolean(
        actions?.monitor_events ?? actions?.monitorEvents,
      ),
    },
  } as unknown as ChannelCapabilityManifest;
}

function trackedPreviewUrl(
  appBaseUrl: string | undefined,
  slug: string,
): string {
  if (!appBaseUrl)
    throw new DraftValidationError([
      {
        code: "tracked_origin_required",
        message:
          "Configure APP_BASE_URL before creating a first-party tracked preview.",
      },
    ]);
  let parsed: URL;
  try {
    parsed = new URL(appBaseUrl);
  } catch {
    throw new DraftValidationError([
      {
        code: "tracked_origin_invalid",
        message: "APP_BASE_URL must be a valid HTTP or HTTPS origin.",
      },
    ]);
  }
  if (
    !(["http:", "https:"] as const).includes(
      parsed.protocol as "http:" | "https:",
    ) ||
    parsed.username ||
    parsed.password
  )
    throw new DraftValidationError([
      {
        code: "tracked_origin_invalid",
        message: "APP_BASE_URL must be a valid HTTP or HTTPS origin.",
      },
    ]);
  return `${parsed.origin}/r/${slug}`;
}
