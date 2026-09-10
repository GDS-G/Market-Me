import { createHash, randomUUID } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";
import type { DatabaseClient } from "./client";
import { CampaignRepository } from "./campaign-repository";
import { DraftRepository } from "./draft-repository";
import { compileGeneralAnnouncementPreparation, type NormalizedCampaignPreparationInput } from "./campaign-preparation-template";

export interface PreparationProfileSnapshot {
  id: string;
  rootId: string;
  name: string;
  versionNumber: number;
  profile: JSONValue;
  informationDepthDefault: string | null;
  informationDepthCeiling: string | null;
  promotionalStrengthDefault: string | null;
  promotionalStrengthCeiling: string | null;
}

export interface PreparationReferenceSnapshot {
  contentPackage: { id: string; title: string; version: number };
  brand?: PreparationProfileSnapshot;
  audiences: readonly PreparationProfileSnapshot[];
  /** Destination is mutable and unversioned. This is historical context, not send authority. */
  destination?: Record<string, JSONValue>;
}

/** Completed immutable receipt; these IDs never follow later current-version pointers. */
export interface StoredCampaignPreparation {
  id: string;
  workspaceId: string;
  idempotencyKey: string;
  templateKey: "general_announcement";
  templateVersion: 1;
  contentPackageId: string;
  contentPackageVersion: number;
  configurationHash: string;
  configurationSnapshot: NormalizedCampaignPreparationInput;
  referenceSnapshot: PreparationReferenceSnapshot;
  campaignId: string;
  planningVersionId: string;
  generationId: string;
  preparedDrafts: readonly { draftId: string; versionId: string }[];
  createdBy: string;
  createdAt: string;
}

type ReceiptRow = Omit<StoredCampaignPreparation, "createdAt"> & { canonicalPayload: string; createdAt: string | Date };
export type CampaignPreparationErrorCode = "access_denied" | "invalid_idempotency_key" | "idempotency_conflict"
  | "package_unavailable" | "package_version_mismatch" | "package_not_approved"
  | "brand_unavailable" | "audience_unavailable" | "destination_unavailable" | "planning_version_conflict";

export class CampaignPreparationError extends Error {
  constructor(readonly code: CampaignPreparationErrorCode, message: string, readonly existingPreparationId?: string) {
    super(message);
    this.name = "CampaignPreparationError";
  }
}

function key(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())) {
    throw new CampaignPreparationError("invalid_idempotency_key", "Provide a UUID preparation attempt key.");
  }
  return value.trim().toLowerCase();
}

function publicReceipt({ canonicalPayload: _canonicalPayload, ...receipt }: ReceiptRow): StoredCampaignPreparation {
  // postgres parses timestamptz as Date; expose the same serializable DTO to
  // server-rendered React and JSON clients, not a Date masquerading as a string.
  return { ...receipt, createdAt: receipt.createdAt instanceof Date ? receipt.createdAt.toISOString() : receipt.createdAt };
}

export class CampaignPreparationRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async prepare(input: unknown, idempotencyKey: unknown, actorUserId: string): Promise<{
    preparation: StoredCampaignPreparation; replayed: boolean;
  }> {
    const compiled = compileGeneralAnnouncementPreparation(input);
    const configuration = compiled.normalizedInput;
    const attemptKey = key(idempotencyKey);
    const configurationHash = createHash("sha256").update(compiled.canonicalPayload).digest("hex");
    return this.sql.begin(async (transaction) => {
      await this.lockWriter(transaction, configuration.workspaceId, actorUserId);
      // Transaction-scoped serialization complements the database UNIQUE constraint.
      // Hash collisions only serialize unrelated requests; equality uses full canonical bytes.
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`campaign-preparation:${configuration.workspaceId}:${attemptKey}`}, 0))`;
      const prior = (await transaction<ReceiptRow[]>`
        SELECT * FROM campaign_preparation
        WHERE workspace_id = ${configuration.workspaceId} AND idempotency_key = ${attemptKey}
      `)[0];
      if (prior) {
        if (prior.canonicalPayload !== compiled.canonicalPayload) {
          throw new CampaignPreparationError("idempotency_conflict", "This attempt key already belongs to different preparation settings.", prior.id);
        }
        // A successful retry remains successful after source/profile changes. Current
        // writer authority is still required, but mutable eligibility is not rerun.
        return { preparation: publicReceipt(prior), replayed: true };
      }
      const referenceSnapshot = await this.lockReferences(transaction, configuration);
      const campaigns = new CampaignRepository(this.sql);
      // Existing graph/reference/communication-policy validation remains authoritative;
      // all stricter preparation references are now locked through receipt insertion.
      const created = await campaigns.createCampaignDraftInTransaction(transaction, compiled.campaign, actorUserId);
      if (!await campaigns.publishExactCampaignDraftInTransaction(transaction, configuration.workspaceId, created.campaignId, created.campaignVersionId)) {
        throw new CampaignPreparationError("planning_version_conflict", "The exact planning version could not be prepared.");
      }
      const generated = await new DraftRepository(this.sql).generateDraftsInTransaction(transaction, {
        workspaceId: configuration.workspaceId, campaignId: created.campaignId,
        campaignVersionId: created.campaignVersionId, contentPackageId: configuration.contentPackageId,
        expectedContentPackageVersion: configuration.expectedPackageVersion, draftFormat: "channel_neutral",
      }, actorUserId);
      const receipt = (await transaction<ReceiptRow[]>`
        INSERT INTO campaign_preparation (
          id, workspace_id, idempotency_key, template_key, template_version,
          content_package_id, content_package_version, canonical_payload, configuration_hash,
          configuration_snapshot, reference_snapshot, campaign_id, planning_version_id,
          generation_id, prepared_drafts, created_by
        ) VALUES (
          ${randomUUID()}, ${configuration.workspaceId}, ${attemptKey}, ${configuration.templateKey}, ${configuration.templateVersion},
          ${configuration.contentPackageId}, ${configuration.expectedPackageVersion}, ${compiled.canonicalPayload}, ${configurationHash},
          ${transaction.json(configuration as unknown as JSONValue)}, ${transaction.json(referenceSnapshot as unknown as JSONValue)},
          ${created.campaignId}, ${created.campaignVersionId}, ${generated.generationId},
          ${transaction.json(generated.drafts as unknown as JSONValue)}, ${actorUserId}
        ) RETURNING *
      `)[0]!;
      await transaction`
        INSERT INTO audit_event (id, organization_id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
        SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, 'campaign.prepared', 'campaign_preparation', ${receipt.id},
          ${transaction.json({ campaignId: receipt.campaignId, planningVersionId: receipt.planningVersionId,
            generationId: receipt.generationId, templateKey: receipt.templateKey, templateVersion: receipt.templateVersion,
            configurationHash, draftIds: generated.drafts.map((draft) => draft.draftId), activated: false })}
        FROM workspace WHERE id = ${configuration.workspaceId}
      `;
      return { preparation: publicReceipt(receipt), replayed: false };
    });
  }

  async get(workspaceId: string, preparationId: string, actorUserId: string): Promise<StoredCampaignPreparation | undefined> {
    const rows = await this.sql<ReceiptRow[]>`
      SELECT receipt.* FROM campaign_preparation receipt
      JOIN workspace_membership member ON member.workspace_id = receipt.workspace_id AND member.user_id = ${actorUserId}
      WHERE receipt.workspace_id = ${workspaceId} AND receipt.id = ${key(preparationId)}
    `;
    return rows[0] ? publicReceipt(rows[0]) : undefined;
  }

  /** Receipt discovery survives browser-tab loss; expose only IDs needed by Campaign cards. */
  async listForWorkspace(workspaceId: string, actorUserId: string): Promise<readonly Pick<StoredCampaignPreparation, "id" | "campaignId">[]> {
    return this.sql<Pick<StoredCampaignPreparation, "id" | "campaignId">[]>`
      SELECT receipt.id, receipt.campaign_id FROM campaign_preparation receipt
      JOIN workspace_membership member ON member.workspace_id = receipt.workspace_id AND member.user_id = ${actorUserId}
      WHERE receipt.workspace_id = ${workspaceId} ORDER BY receipt.created_at DESC, receipt.id
    `;
  }

  async getByKey(workspaceId: string, idempotencyKey: string, actorUserId: string): Promise<StoredCampaignPreparation | undefined> {
    const rows = await this.sql<ReceiptRow[]>`
      SELECT receipt.* FROM campaign_preparation receipt
      JOIN workspace_membership member ON member.workspace_id = receipt.workspace_id AND member.user_id = ${actorUserId}
      WHERE receipt.workspace_id = ${workspaceId} AND receipt.idempotency_key = ${key(idempotencyKey)}
    `;
    return rows[0] ? publicReceipt(rows[0]) : undefined;
  }

  private async lockWriter(transaction: TransactionSql, workspaceId: string, actorUserId: string): Promise<void> {
    // Ancestors first avoid holding a child while its deleting parent waits to
    // cascade, then waiting back on that parent when writing a foreign key.
    await transaction`SELECT id FROM organization WHERE id = (SELECT organization_id FROM workspace WHERE id = ${workspaceId}) FOR KEY SHARE`;
    const workspace = await transaction`SELECT id FROM workspace WHERE id = ${workspaceId} FOR SHARE`;
    const actor = await transaction`SELECT id FROM app_user WHERE id = ${actorUserId} FOR KEY SHARE`;
    const membership = await transaction<{ role: string }[]>`
      SELECT role FROM workspace_membership WHERE workspace_id = ${workspaceId} AND user_id = ${actorUserId} FOR SHARE
    `;
    if (!workspace[0] || !actor[0] || !membership[0] || !["owner", "admin", "editor"].includes(membership[0].role)) {
      throw new CampaignPreparationError("access_denied", "Current workspace writer access is required to prepare a campaign.");
    }
  }

  private async lockReferences(transaction: TransactionSql, configuration: NormalizedCampaignPreparationInput): Promise<PreparationReferenceSnapshot> {
    const contentPackage = (await transaction<{ id: string; title: string; version: number; status: string }[]>`
      SELECT id, title, version, status FROM content_package
      WHERE id = ${configuration.contentPackageId} AND workspace_id = ${configuration.workspaceId} FOR SHARE
    `)[0];
    if (!contentPackage) throw new CampaignPreparationError("package_unavailable", "Choose a Content Package in this workspace.");
    if (contentPackage.version !== configuration.expectedPackageVersion) {
      throw new CampaignPreparationError("package_version_mismatch", "The Content Package changed. Review its current revision before preparing another campaign.");
    }
    if (contentPackage.status !== "approved") throw new CampaignPreparationError("package_not_approved", "Approve the Content Package before preparing a campaign.");
    const snapshot: PreparationReferenceSnapshot = {
      contentPackage: { id: contentPackage.id, title: contentPackage.title, version: contentPackage.version }, audiences: [],
    };
    if (configuration.brandProfileVersionId) {
      snapshot.brand = await this.lockProfile(transaction, "brand", configuration.workspaceId, configuration.brandProfileVersionId);
    }
    if (configuration.audienceProfileVersionIds.length) {
      // Lock roots in database ID order; keep authored audience order for generation.
      const roots = await transaction<{ id: string }[]>`
        SELECT p.id FROM audience_profile p WHERE p.workspace_id = ${configuration.workspaceId}
          AND p.id IN (SELECT audience_profile_id FROM audience_profile_version WHERE id IN ${transaction([...configuration.audienceProfileVersionIds])})
        ORDER BY p.id FOR SHARE
      `;
      if (!roots.length) throw new CampaignPreparationError("audience_unavailable", "Choose current published Audience Profile versions in this workspace.");
      const audiences = new Map<string, PreparationProfileSnapshot>();
      for (const versionId of [...configuration.audienceProfileVersionIds].sort()) {
        audiences.set(versionId, await this.lockProfile(transaction, "audience", configuration.workspaceId, versionId));
      }
      snapshot.audiences = configuration.audienceProfileVersionIds.map((id) => audiences.get(id)!);
    }
    if (configuration.destinationId) {
      const destination = (await transaction<(Record<string, JSONValue> & { status: string })[]>`
        SELECT id, workspace_id, provider, external_id, canonical_url, known_redirects, title, description,
          content_type, identifiers, topics, audiences, geography, language, status, available_at, expires_at,
          replacement_destination_id, tracking, updated_at
        FROM destination WHERE id = ${configuration.destinationId} AND workspace_id = ${configuration.workspaceId} FOR SHARE
      `)[0];
      if (destination?.status !== "published") throw new CampaignPreparationError("destination_unavailable", "Choose a published Destination in this workspace.");
      snapshot.destination = destination;
    }
    return snapshot;
  }

  private async lockProfile(transaction: TransactionSql, kind: "brand" | "audience", workspaceId: string, versionId: string): Promise<PreparationProfileSnapshot> {
    // Only internal discriminants form SQL identifiers. Root-before-version agrees
    // with ProfileRepository's publication lock order; never lock both via a join.
    const rootTable = kind === "brand" ? "brand_profile" : "audience_profile";
    const versionTable = kind === "brand" ? "brand_profile_version" : "audience_profile_version";
    const rootColumn = kind === "brand" ? "brand_profile_id" : "audience_profile_id";
    const roots = await transaction.unsafe<{ id: string; name: string; status: string; currentVersionId: string | null }[]>(
      `SELECT id, name, status, current_version_id FROM ${rootTable}
       WHERE workspace_id = $1 AND id = (SELECT ${rootColumn} FROM ${versionTable} WHERE id = $2) FOR SHARE`, [workspaceId, versionId]);
    const root = roots[0];
    if (!root || root.status !== "published" || root.currentVersionId !== versionId) {
      throw new CampaignPreparationError(kind === "brand" ? "brand_unavailable" : "audience_unavailable", `Choose a current published ${kind === "brand" ? "Brand" : "Audience"} Profile version in this workspace.`);
    }
    const versions = await transaction.unsafe<(Omit<PreparationProfileSnapshot, "rootId" | "name"> & { status: string })[]>(
      `SELECT id, version_number, status, profile, information_depth_default, information_depth_ceiling,
         promotional_strength_default, promotional_strength_ceiling FROM ${versionTable}
       WHERE id = $1 AND ${rootColumn} = $2 FOR SHARE`, [versionId, root.id]);
    const version = versions[0];
    if (version?.status !== "published") {
      throw new CampaignPreparationError(kind === "brand" ? "brand_unavailable" : "audience_unavailable", "The selected profile version is no longer published.");
    }
    const { status: _status, ...profile } = version;
    return { ...profile, rootId: root.id, name: root.name };
  }
}
