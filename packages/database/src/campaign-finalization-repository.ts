import { createHash, randomUUID } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";
import type { DatabaseClient } from "./client";
import { CampaignRepository } from "./campaign-repository";
import { compileGeneralAnnouncementPreparation, type NormalizedCampaignPreparationInput } from "./campaign-preparation-template";
import {
  compileCampaignFinalization,
  normalizeCampaignFinalizationInput,
  type CampaignFinalizationTiming,
  type CampaignFinalizationTrustedContext,
} from "./campaign-finalization-template";
import { ExactPreviewReadError, loadExactTextPreviewInTransaction, lockExactTextPreviewInTransaction, type ExactTextPreviewSelection } from "./exact-preview-repository";
import type { ExactPreviewSnapshotV1 } from "./exact-preview-fingerprint";
import type { CampaignDraftWrite } from "./models";

/** Immutable completed result. Canonical intent is private; snapshots retain raw JSON key spelling. */
export interface StoredCampaignFinalization {
  readonly id: string;
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly preparationId: string;
  readonly campaignId: string;
  readonly planningVersionId: string;
  readonly finalizedVersionId: string;
  readonly contentDraftId: string;
  readonly contentDraftVersionId: string;
  readonly draftChannelPreviewId: string;
  readonly previewFingerprint: string;
  readonly canonicalPreviewSnapshot: ExactPreviewSnapshotV1;
  readonly compiledDefinition: Readonly<CampaignDraftWrite>;
  readonly configurationHash: string;
  readonly templateVersion: 1;
  readonly createdBy: string;
  readonly createdAt: string;
}

type FinalizationRow = Omit<StoredCampaignFinalization, "canonicalPreviewSnapshot" | "compiledDefinition" | "createdAt"> & {
  canonicalPreviewSnapshot: string;
  canonicalInput: string;
  compiledDefinitionJson: string;
  createdAtIso: string;
};
type LockedPreparation = CampaignFinalizationTrustedContext["preparation"];
type PreparationRow = Omit<LockedPreparation, "configurationSnapshot" | "preparedDrafts"> & {
  templateKey: string;
  templateVersion: number;
  configurationHash: string;
  canonicalPayload: string;
  configurationSnapshotJson: string;
  preparedDraftsJson: string;
};

export type CampaignFinalizationErrorCode = "access_denied" | "invalid_idempotency_key" | "idempotency_conflict"
  | "preparation_unavailable" | "preparation_invalid" | "already_finalized" | "campaign_changed"
  | "package_unavailable" | "package_version_mismatch" | "package_not_approved"
  | "brand_unavailable" | "audience_unavailable" | "preview_changed" | "window_expired";

export class CampaignFinalizationError extends Error {
  constructor(readonly code: CampaignFinalizationErrorCode, message: string, readonly existingFinalizationId?: string) {
    super(message);
    this.name = "CampaignFinalizationError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function attemptKey(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value.trim().toLowerCase())) {
    throw new CampaignFinalizationError("invalid_idempotency_key", "Provide a UUID finalization attempt key.");
  }
  return value.trim().toLowerCase();
}
function invalidPreparation(): never {
  throw new CampaignFinalizationError("preparation_invalid", "The original preparation lineage or immutable settings cannot be verified. Prepare a new Campaign.");
}
function publicReceipt(row: FinalizationRow): StoredCampaignFinalization {
  // Parse text explicitly: the ordinary postgres.camel JSON projection would
  // transform raw capability keys and historical compiled-definition metadata.
  return Object.freeze({
    id: row.id, workspaceId: row.workspaceId, idempotencyKey: row.idempotencyKey,
    preparationId: row.preparationId, campaignId: row.campaignId,
    planningVersionId: row.planningVersionId, finalizedVersionId: row.finalizedVersionId,
    contentDraftId: row.contentDraftId, contentDraftVersionId: row.contentDraftVersionId,
    draftChannelPreviewId: row.draftChannelPreviewId, previewFingerprint: row.previewFingerprint,
    canonicalPreviewSnapshot: JSON.parse(row.canonicalPreviewSnapshot) as ExactPreviewSnapshotV1,
    compiledDefinition: JSON.parse(row.compiledDefinitionJson) as CampaignDraftWrite,
    configurationHash: row.configurationHash, templateVersion: row.templateVersion,
    createdBy: row.createdBy, createdAt: row.createdAtIso,
  });
}

export class CampaignFinalizationRepository {
  constructor(private readonly sql: DatabaseClient, private readonly options: { readonly appBaseUrl?: string } = {}) {}

  /** Coherent authorized display selection; it grants no lease or execution authority. */
  async getPreviewSelection(workspaceId: string, preparationId: string, previewId: string, actorUserId: string): Promise<ExactTextPreviewSelection | undefined> {
    const scope = attemptKey(workspaceId);
    const selectedPreviewId = attemptKey(previewId);
    return this.sql.begin(async (transaction) => {
      const preparation = (await transaction<{
        workspaceId: string; campaignId: string; planningVersionId: string; generationId: string; preparedDraftsJson: string;
      }[]>`
        SELECT preparation.workspace_id, preparation.campaign_id, preparation.planning_version_id,
          preparation.generation_id, preparation.prepared_drafts::text AS prepared_drafts_json
        FROM campaign_preparation preparation
        JOIN workspace_membership member ON member.workspace_id = preparation.workspace_id AND member.user_id = ${actorUserId}
        WHERE preparation.workspace_id = ${scope} AND preparation.id = ${attemptKey(preparationId)}
      `)[0];
      if (!preparation) return undefined;
      let exact: ExactTextPreviewSelection;
      try {
        exact = await loadExactTextPreviewInTransaction(transaction, { workspaceId: scope, previewId: selectedPreviewId }, this.options);
      } catch (error) {
        if (error instanceof ExactPreviewReadError && error.code === "preview_unavailable") return undefined;
        throw error;
      }
      const lineage = exact.snapshot.lineage;
      const preparedDrafts: unknown = JSON.parse(preparation.preparedDraftsJson);
      if (lineage.workspaceId !== preparation.workspaceId || lineage.campaignId !== preparation.campaignId
        || lineage.sourceCampaignVersionId !== preparation.planningVersionId || lineage.generationId !== preparation.generationId
        || !Array.isArray(preparedDrafts) || preparedDrafts.filter((draft) => draft && typeof draft === "object"
          && !Array.isArray(draft) && draft.draftId === lineage.contentDraftId).length !== 1) return undefined;
      return exact;
    });
  }

  async finalize(input: unknown, idempotencyKey: unknown, actorUserId: string): Promise<{
    finalization: StoredCampaignFinalization; replayed: boolean;
  }> {
    const intent = normalizeCampaignFinalizationInput(input);
    const selected = intent.normalizedInput;
    const key = attemptKey(idempotencyKey);
    const configurationHash = createHash("sha256").update(intent.canonicalPayload, "utf8").digest("hex");
    return this.sql.begin(async (transaction) => {
      await this.lockWriter(transaction, selected.workspaceId, actorUserId);
      // Hash collisions only serialize requests; canonical intent and UNIQUE
      // constraints, not advisory-lock hashes, establish durable identity.
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`campaign-finalization:${selected.workspaceId}:${key}`}, 0))`;
      const prior = (await transaction<FinalizationRow[]>`
        SELECT receipt.*, receipt.compiled_definition::text AS compiled_definition_json,
          to_char(receipt.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso
        FROM campaign_finalization receipt WHERE workspace_id = ${selected.workspaceId} AND idempotency_key = ${key}
      `)[0];
      if (prior) {
        if (prior.canonicalInput !== intent.canonicalPayload) {
          throw new CampaignFinalizationError("idempotency_conflict", "This attempt key already belongs to different finalization settings.", prior.id);
        }
        // Successful response-loss replay remains historical even after package,
        // preview or profile changes. Current writer access was still required.
        return { finalization: publicReceipt(prior), replayed: true };
      }

      const discovered = (await transaction<{ campaignId: string }[]>`
        SELECT campaign_id FROM campaign_preparation WHERE id = ${selected.preparationId} AND workspace_id = ${selected.workspaceId}
      `)[0];
      if (!discovered) throw new CampaignFinalizationError("preparation_unavailable", "Choose a preparation in this workspace.");
      const campaign = (await transaction<{ id: string; status: string; currentVersionId: string | null }[]>`
        SELECT id, status, current_version_id FROM campaign
        WHERE id = ${discovered.campaignId} AND workspace_id = ${selected.workspaceId} FOR UPDATE
      `)[0];
      if (!campaign) throw new CampaignFinalizationError("preparation_unavailable", "The prepared Campaign is unavailable in this workspace.");
      const preparation = await this.lockPreparation(transaction, selected.workspaceId, selected.preparationId, campaign.id);
      const existing = (await transaction<{ id: string }[]>`
        SELECT id FROM campaign_finalization WHERE workspace_id = ${selected.workspaceId}
          AND (preparation_id = ${preparation.id} OR campaign_id = ${campaign.id})
      `)[0];
      if (existing) throw new CampaignFinalizationError("already_finalized", "This preparation already has an executable draft. Open its original finalization result.", existing.id);
      if (campaign.status === "archived" || campaign.currentVersionId !== selected.expectedPlanningVersionId
        || preparation.planningVersionId !== selected.expectedPlanningVersionId) {
        throw new CampaignFinalizationError("campaign_changed", "The prepared Campaign changed. Do not overwrite its current plan.");
      }
      const editable = await transaction`SELECT id FROM campaign_version WHERE campaign_id = ${campaign.id} AND status = 'draft' LIMIT 1`;
      if (editable[0]) throw new CampaignFinalizationError("campaign_changed", "This Campaign already has an editable draft. Finalization cannot overwrite it.");
      await this.lockPlanningLineage(transaction, preparation);
      await this.lockReferences(transaction, preparation.configurationSnapshot);
      // Do not lock Destination in lockReferences: publication's content lock
      // order reaches it AFTER connection -> approval -> draft/version -> preview.
      await lockExactTextPreviewInTransaction(transaction, { workspaceId: selected.workspaceId, previewId: selected.previewId });
      const exact = await loadExactTextPreviewInTransaction(transaction,
        { workspaceId: selected.workspaceId, previewId: selected.previewId }, this.options);
      if (exact.token !== selected.expectedPreviewFingerprint) {
        throw new CampaignFinalizationError("preview_changed", "The exact preview or routing context changed. Review and select it again.");
      }
      const snapshot = exact.snapshot;
      const compiled = compileCampaignFinalization(selected, { preparation, preview: {
        workspaceId: snapshot.lineage.workspaceId, campaignId: snapshot.lineage.campaignId,
        sourceCampaignVersionId: snapshot.lineage.sourceCampaignVersionId, generationId: snapshot.lineage.generationId,
        previewId: snapshot.lineage.previewId, draftId: snapshot.lineage.contentDraftId,
        draftVersionId: snapshot.lineage.contentDraftVersionId, channelConnectionId: snapshot.preview.channelConnectionId,
        destinationId: snapshot.preview.destinationId, fingerprint: exact.token,
        provider: snapshot.preview.provider, attachmentCount: snapshot.preview.assets.length,
      } });
      const created = await new CampaignRepository(this.sql).insertPreparedExecutableDraftInTransaction(transaction, {
        workspaceId: selected.workspaceId, campaignId: campaign.id, preparationId: preparation.id,
        expectedPlanningVersionId: selected.expectedPlanningVersionId, definition: compiled.campaign,
      }, actorUserId);
      const receipt = (await transaction<FinalizationRow[]>`
        INSERT INTO campaign_finalization (id, workspace_id, idempotency_key, preparation_id, campaign_id,
          planning_version_id, finalized_version_id, content_draft_id, content_draft_version_id,
          draft_channel_preview_id, preview_fingerprint, canonical_preview_snapshot, canonical_input,
          compiled_definition, configuration_hash, template_version, created_by)
        VALUES (${randomUUID()}, ${selected.workspaceId}, ${key}, ${preparation.id}, ${campaign.id},
          ${preparation.planningVersionId}, ${created.campaignVersionId}, ${selected.draftId}, ${selected.expectedDraftVersionId},
          ${selected.previewId}, ${exact.token}, ${exact.canonicalSnapshot}, ${intent.canonicalPayload},
          ${transaction.json(compiled.campaign as unknown as JSONValue)}, ${configurationHash}, ${selected.templateVersion}, ${actorUserId})
        RETURNING *, compiled_definition::text AS compiled_definition_json,
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso
      `)[0]!;
      await transaction`
        INSERT INTO audit_event (id, organization_id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
        SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, 'campaign.finalized', 'campaign_finalization', ${receipt.id},
          ${transaction.json({ preparationId: preparation.id, campaignId: campaign.id, planningVersionId: preparation.planningVersionId,
            finalizedVersionId: created.campaignVersionId, finalizedVersionNumber: created.versionNumber,
            contentDraftId: selected.draftId, contentDraftVersionId: selected.expectedDraftVersionId,
            draftChannelPreviewId: selected.previewId, previewFingerprint: exact.token,
            configurationHash, templateVersion: selected.templateVersion, published: false, activated: false })}
        FROM workspace WHERE id = ${selected.workspaceId}
      `;
      // Sample fresh DB time after all lock/constraint waits and writes, not the
      // transaction start or browser clock. Failure rolls the entire draft back.
      await this.assertWindowOpen(transaction, selected.timing);
      return { finalization: publicReceipt(receipt), replayed: false };
    });
  }

  async get(workspaceId: string, finalizationId: string, actorUserId: string): Promise<StoredCampaignFinalization | undefined> {
    const rows = await this.sql<FinalizationRow[]>`
      SELECT receipt.*, receipt.compiled_definition::text AS compiled_definition_json,
        to_char(receipt.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso
      FROM campaign_finalization receipt
      JOIN workspace_membership member ON member.workspace_id = receipt.workspace_id AND member.user_id = ${actorUserId}
      WHERE receipt.workspace_id = ${workspaceId} AND receipt.id = ${attemptKey(finalizationId)}
    `;
    return rows[0] ? publicReceipt(rows[0]) : undefined;
  }

  async getByKey(workspaceId: string, idempotencyKey: string, actorUserId: string): Promise<StoredCampaignFinalization | undefined> {
    const rows = await this.sql<FinalizationRow[]>`
      SELECT receipt.*, receipt.compiled_definition::text AS compiled_definition_json,
        to_char(receipt.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso
      FROM campaign_finalization receipt
      JOIN workspace_membership member ON member.workspace_id = receipt.workspace_id AND member.user_id = ${actorUserId}
      WHERE receipt.workspace_id = ${workspaceId} AND receipt.idempotency_key = ${attemptKey(idempotencyKey)}
    `;
    return rows[0] ? publicReceipt(rows[0]) : undefined;
  }

  async getForCampaign(workspaceId: string, campaignId: string, actorUserId: string): Promise<StoredCampaignFinalization | undefined> {
    const rows = await this.sql<FinalizationRow[]>`
      SELECT receipt.*, receipt.compiled_definition::text AS compiled_definition_json,
        to_char(receipt.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso
      FROM campaign_finalization receipt
      JOIN workspace_membership member ON member.workspace_id = receipt.workspace_id AND member.user_id = ${actorUserId}
      WHERE receipt.workspace_id = ${workspaceId} AND receipt.campaign_id = ${attemptKey(campaignId)}
    `;
    return rows[0] ? publicReceipt(rows[0]) : undefined;
  }

  private async lockWriter(transaction: TransactionSql, workspaceId: string, actorUserId: string): Promise<void> {
    await transaction`SELECT id FROM organization WHERE id = (SELECT organization_id FROM workspace WHERE id = ${workspaceId}) FOR KEY SHARE`;
    const workspace = await transaction`SELECT id FROM workspace WHERE id = ${workspaceId} FOR SHARE`;
    const actor = await transaction`SELECT id FROM app_user WHERE id = ${actorUserId} FOR KEY SHARE`;
    const membership = await transaction<{ role: string }[]>`
      SELECT role FROM workspace_membership WHERE workspace_id = ${workspaceId} AND user_id = ${actorUserId} FOR SHARE
    `;
    if (!workspace[0] || !actor[0] || !membership[0] || !["owner", "admin", "editor"].includes(membership[0].role)) {
      throw new CampaignFinalizationError("access_denied", "Current workspace writer access is required to finalize a Campaign.");
    }
  }

  private async lockPreparation(transaction: TransactionSql, workspaceId: string, preparationId: string, campaignId: string): Promise<LockedPreparation> {
    const row = (await transaction<PreparationRow[]>`
      SELECT id, workspace_id, campaign_id, planning_version_id, generation_id, content_package_id, content_package_version,
        template_key, template_version, configuration_hash, canonical_payload,
        configuration_snapshot::text AS configuration_snapshot_json, prepared_drafts::text AS prepared_drafts_json
      FROM campaign_preparation WHERE id = ${preparationId} AND workspace_id = ${workspaceId} AND campaign_id = ${campaignId} FOR SHARE
    `)[0];
    if (!row) throw new CampaignFinalizationError("preparation_unavailable", "The original preparation is no longer available in this workspace.");
    const original = compileGeneralAnnouncementPreparation(JSON.parse(row.configurationSnapshotJson));
    if (row.templateKey !== "general_announcement" || row.templateVersion !== 1 || row.canonicalPayload !== original.canonicalPayload
      || createHash("sha256").update(row.canonicalPayload, "utf8").digest("hex") !== row.configurationHash
      || original.normalizedInput.workspaceId !== workspaceId || original.normalizedInput.contentPackageId !== row.contentPackageId
      || original.normalizedInput.expectedPackageVersion !== row.contentPackageVersion) invalidPreparation();
    const preparedDrafts = JSON.parse(row.preparedDraftsJson) as unknown;
    if (!Array.isArray(preparedDrafts) || !preparedDrafts.length || preparedDrafts.length > 20
      || preparedDrafts.some((draft) => !draft || typeof draft !== "object" || Array.isArray(draft)
        || Object.keys(draft).length !== 2 || typeof draft.draftId !== "string" || !uuidPattern.test(draft.draftId)
        || typeof draft.versionId !== "string" || !uuidPattern.test(draft.versionId))
      || new Set(preparedDrafts.map((draft) => draft.draftId)).size !== preparedDrafts.length) invalidPreparation();
    return { id: row.id, workspaceId: row.workspaceId, campaignId: row.campaignId, planningVersionId: row.planningVersionId,
      generationId: row.generationId, contentPackageId: row.contentPackageId, contentPackageVersion: row.contentPackageVersion,
      configurationSnapshot: original.normalizedInput, preparedDrafts };
  }

  private async lockPlanningLineage(transaction: TransactionSql, preparation: LockedPreparation): Promise<void> {
    const version = (await transaction<{ status: string; autonomyMode: string; contentPackageIds: string[] }[]>`
      SELECT status, autonomy_mode, content_package_ids FROM campaign_version
      WHERE id = ${preparation.planningVersionId} AND campaign_id = ${preparation.campaignId} FOR SHARE
    `)[0];
    const generation = (await transaction<{ campaignVersionId: string; contentPackageId: string; contentPackageVersion: number }[]>`
      SELECT campaign_version_id, content_package_id, content_package_version FROM draft_generation
      WHERE id = ${preparation.generationId} AND workspace_id = ${preparation.workspaceId} FOR SHARE
    `)[0];
    if (!version || version.status !== "published" || version.autonomyMode !== "draft_only"
      || version.contentPackageIds.length !== 1 || version.contentPackageIds[0] !== preparation.contentPackageId
      || !generation || generation.campaignVersionId !== preparation.planningVersionId
      || generation.contentPackageId !== preparation.contentPackageId || generation.contentPackageVersion !== preparation.contentPackageVersion) invalidPreparation();
  }

  private async lockReferences(transaction: TransactionSql, configuration: NormalizedCampaignPreparationInput): Promise<void> {
    const contentPackage = (await transaction<{ version: number; status: string }[]>`
      SELECT version, status FROM content_package
      WHERE id = ${configuration.contentPackageId} AND workspace_id = ${configuration.workspaceId} FOR SHARE
    `)[0];
    if (!contentPackage) throw new CampaignFinalizationError("package_unavailable", "The original Content Package is unavailable in this workspace.");
    if (contentPackage.version !== configuration.expectedPackageVersion) {
      throw new CampaignFinalizationError("package_version_mismatch", "The original Content Package changed. Review it and prepare a new Campaign.");
    }
    if (contentPackage.status !== "approved") throw new CampaignFinalizationError("package_not_approved", "The original Content Package must still be approved.");
    if (configuration.brandProfileVersionId) await this.lockProfile(transaction, "brand", configuration.workspaceId, configuration.brandProfileVersionId);
    if (configuration.audienceProfileVersionIds.length) {
      // All roots before versions, deterministic root order regardless of the
      // authored audience order retained in immutable preparation settings.
      await transaction`SELECT id FROM audience_profile WHERE workspace_id = ${configuration.workspaceId}
        AND id IN (SELECT audience_profile_id FROM audience_profile_version WHERE id IN ${transaction([...configuration.audienceProfileVersionIds])})
        ORDER BY id FOR SHARE`;
      for (const versionId of [...configuration.audienceProfileVersionIds].sort()) {
        await this.lockProfile(transaction, "audience", configuration.workspaceId, versionId);
      }
    }
  }

  private async lockProfile(transaction: TransactionSql, kind: "brand" | "audience", workspaceId: string, versionId: string): Promise<void> {
    const rootTable = kind === "brand" ? "brand_profile" : "audience_profile";
    const versionTable = kind === "brand" ? "brand_profile_version" : "audience_profile_version";
    const rootColumn = kind === "brand" ? "brand_profile_id" : "audience_profile_id";
    const root = (await transaction.unsafe<{ id: string; status: string; currentVersionId: string | null }[]>(
      `SELECT id, status, current_version_id FROM ${rootTable} WHERE workspace_id = $1
       AND id = (SELECT ${rootColumn} FROM ${versionTable} WHERE id = $2) FOR SHARE`, [workspaceId, versionId]))[0];
    if (!root || root.status !== "published" || root.currentVersionId !== versionId) {
      throw new CampaignFinalizationError(kind === "brand" ? "brand_unavailable" : "audience_unavailable", "The original selected profile is no longer current and published. Prepare a new Campaign.");
    }
    const version = (await transaction.unsafe<{ status: string }[]>(
      `SELECT status FROM ${versionTable} WHERE id = $1 AND ${rootColumn} = $2 FOR SHARE`, [versionId, root.id]))[0];
    if (version?.status !== "published") {
      throw new CampaignFinalizationError(kind === "brand" ? "brand_unavailable" : "audience_unavailable", "The original selected profile version is no longer published.");
    }
  }

  private async assertWindowOpen(transaction: TransactionSql, timing: CampaignFinalizationTiming): Promise<void> {
    if (timing.type !== "preferred_window") return;
    const result = (await transaction<{ open: boolean }[]>`SELECT ${timing.end}::text::timestamptz > clock_timestamp() AS open`)[0];
    if (!result?.open) throw new CampaignFinalizationError("window_expired", "The preferred request-start window has ended. Choose a new window and review the plan.");
  }
}
