import { randomUUID } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";
import type { AudienceProfileVersion, BrandProfileVersion } from "@market-me/domain";
import type { DatabaseClient } from "./client";
import type { AudienceProfileDraftWrite, BrandProfileDraftWrite, StoredAudienceProfile, StoredBrandProfile } from "./models";

type BrandRow = Omit<StoredBrandProfile, "currentVersion" | "draftVersion"> & { currentVersionId?: string };
type AudienceRow = Omit<StoredAudienceProfile, "currentVersion" | "draftVersion"> & { currentVersionId?: string };

export class ProfileRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async listBrandProfiles(workspaceId: string): Promise<StoredBrandProfile[]> {
    return this.attachBrandVersions(await this.sql<BrandRow[]>`SELECT id, workspace_id, name, description, status, current_version_id, created_by, created_at, updated_at FROM brand_profile WHERE workspace_id = ${workspaceId} ORDER BY updated_at DESC`);
  }

  async getBrandProfile(workspaceId: string, id: string): Promise<StoredBrandProfile | undefined> {
    return (await this.attachBrandVersions(await this.sql<BrandRow[]>`SELECT id, workspace_id, name, description, status, current_version_id, created_by, created_at, updated_at FROM brand_profile WHERE workspace_id = ${workspaceId} AND id = ${id}`))[0];
  }

  async createBrandProfile(input: BrandProfileDraftWrite, actorUserId: string): Promise<StoredBrandProfile> {
    const id = randomUUID();
    await this.sql.begin(async (transaction) => {
      await transaction`INSERT INTO brand_profile (id, workspace_id, name, description, created_by) VALUES (${id}, ${input.workspaceId}, ${input.name}, ${input.description}, ${actorUserId})`;
      await this.insertBrandVersion(transaction, id, randomUUID(), 1, input, actorUserId);
      await this.audit(transaction, input.workspaceId, actorUserId, "brand_profile.created", id, { versionNumber: 1 });
    });
    return (await this.getBrandProfile(input.workspaceId, id))!;
  }

  async saveBrandProfileDraft(id: string, input: BrandProfileDraftWrite, actorUserId: string): Promise<StoredBrandProfile | undefined> {
    const saved = await this.sql.begin(async (transaction) => {
      const roots = await transaction<{ id: string }[]>`SELECT id FROM brand_profile WHERE id = ${id} AND workspace_id = ${input.workspaceId} AND status <> 'archived' FOR UPDATE`;
      if (!roots[0]) return false;
      const drafts = await transaction<{ id: string; versionNumber: number }[]>`SELECT id, version_number FROM brand_profile_version WHERE brand_profile_id = ${id} AND status = 'draft' FOR UPDATE`;
      const draft = drafts[0];
      if (draft) await transaction`UPDATE brand_profile_version SET profile = ${transaction.json(input.profile as unknown as JSONValue)}, information_depth_default = ${input.informationDepthDefault ?? null}, information_depth_ceiling = ${input.informationDepthCeiling ?? null}, promotional_strength_default = ${input.promotionalStrengthDefault ?? null}, promotional_strength_ceiling = ${input.promotionalStrengthCeiling ?? null} WHERE id = ${draft.id}`;
      else {
        const numbers = await transaction<{ next: number }[]>`SELECT COALESCE(max(version_number), 0)::integer + 1 AS next FROM brand_profile_version WHERE brand_profile_id = ${id}`;
        await this.insertBrandVersion(transaction, id, randomUUID(), numbers[0].next, input, actorUserId);
      }
      await transaction`UPDATE brand_profile SET name = ${input.name}, description = ${input.description}, updated_at = now() WHERE id = ${id}`;
      await this.audit(transaction, input.workspaceId, actorUserId, "brand_profile.draft_saved", id, { versionNumber: draft?.versionNumber ?? "next" });
      return true;
    });
    return saved ? this.getBrandProfile(input.workspaceId, id) : undefined;
  }

  async publishBrandProfile(workspaceId: string, id: string, actorUserId: string): Promise<StoredBrandProfile | undefined> {
    const published = await this.publishProfile("brand", workspaceId, id, actorUserId);
    return published ? this.getBrandProfile(workspaceId, id) : undefined;
  }

  async listAudienceProfiles(workspaceId: string): Promise<StoredAudienceProfile[]> {
    return this.attachAudienceVersions(await this.sql<AudienceRow[]>`SELECT id, workspace_id, name, description, status, current_version_id, created_by, created_at, updated_at FROM audience_profile WHERE workspace_id = ${workspaceId} ORDER BY updated_at DESC`);
  }

  async getAudienceProfile(workspaceId: string, id: string): Promise<StoredAudienceProfile | undefined> {
    return (await this.attachAudienceVersions(await this.sql<AudienceRow[]>`SELECT id, workspace_id, name, description, status, current_version_id, created_by, created_at, updated_at FROM audience_profile WHERE workspace_id = ${workspaceId} AND id = ${id}`))[0];
  }

  async createAudienceProfile(input: AudienceProfileDraftWrite, actorUserId: string): Promise<StoredAudienceProfile> {
    const id = randomUUID();
    await this.sql.begin(async (transaction) => {
      await transaction`INSERT INTO audience_profile (id, workspace_id, name, description, created_by) VALUES (${id}, ${input.workspaceId}, ${input.name}, ${input.description}, ${actorUserId})`;
      await this.insertAudienceVersion(transaction, id, randomUUID(), 1, input, actorUserId);
      await this.audit(transaction, input.workspaceId, actorUserId, "audience_profile.created", id, { versionNumber: 1 });
    });
    return (await this.getAudienceProfile(input.workspaceId, id))!;
  }

  async saveAudienceProfileDraft(id: string, input: AudienceProfileDraftWrite, actorUserId: string): Promise<StoredAudienceProfile | undefined> {
    const saved = await this.sql.begin(async (transaction) => {
      const roots = await transaction<{ id: string }[]>`SELECT id FROM audience_profile WHERE id = ${id} AND workspace_id = ${input.workspaceId} AND status <> 'archived' FOR UPDATE`;
      if (!roots[0]) return false;
      const drafts = await transaction<{ id: string; versionNumber: number }[]>`SELECT id, version_number FROM audience_profile_version WHERE audience_profile_id = ${id} AND status = 'draft' FOR UPDATE`;
      const draft = drafts[0];
      if (draft) await transaction`UPDATE audience_profile_version SET audience_type = ${input.audienceType}, profile = ${transaction.json(input.profile as unknown as JSONValue)}, information_depth_default = ${input.informationDepthDefault ?? null}, information_depth_ceiling = ${input.informationDepthCeiling ?? null}, promotional_strength_default = ${input.promotionalStrengthDefault ?? null}, promotional_strength_ceiling = ${input.promotionalStrengthCeiling ?? null} WHERE id = ${draft.id}`;
      else {
        const numbers = await transaction<{ next: number }[]>`SELECT COALESCE(max(version_number), 0)::integer + 1 AS next FROM audience_profile_version WHERE audience_profile_id = ${id}`;
        await this.insertAudienceVersion(transaction, id, randomUUID(), numbers[0].next, input, actorUserId);
      }
      await transaction`UPDATE audience_profile SET name = ${input.name}, description = ${input.description}, updated_at = now() WHERE id = ${id}`;
      await this.audit(transaction, input.workspaceId, actorUserId, "audience_profile.draft_saved", id, { versionNumber: draft?.versionNumber ?? "next" });
      return true;
    });
    return saved ? this.getAudienceProfile(input.workspaceId, id) : undefined;
  }

  async publishAudienceProfile(workspaceId: string, id: string, actorUserId: string): Promise<StoredAudienceProfile | undefined> {
    const published = await this.publishProfile("audience", workspaceId, id, actorUserId);
    return published ? this.getAudienceProfile(workspaceId, id) : undefined;
  }

  private async publishProfile(kind: "brand" | "audience", workspaceId: string, id: string, actorUserId: string): Promise<boolean> {
    return this.sql.begin(async (transaction) => {
      const rootTable = kind === "brand" ? "brand_profile" : "audience_profile";
      const versionTable = kind === "brand" ? "brand_profile_version" : "audience_profile_version";
      const foreignKey = kind === "brand" ? "brand_profile_id" : "audience_profile_id";
      const roots = await transaction.unsafe<{ id: string }[]>(`SELECT id FROM ${rootTable} WHERE id = $1 AND workspace_id = $2 AND status <> 'archived' FOR UPDATE`, [id, workspaceId]);
      if (!roots[0]) return false;
      const drafts = await transaction.unsafe<{ id: string; versionNumber: number }[]>(`SELECT id, version_number FROM ${versionTable} WHERE ${foreignKey} = $1 AND status = 'draft' FOR UPDATE`, [id]);
      if (!drafts[0]) throw new Error(`${kind === "brand" ? "Brand" : "Audience"} Profile does not have a draft to publish`);
      await transaction.unsafe(`UPDATE ${versionTable} SET status = 'superseded' WHERE ${foreignKey} = $1 AND status = 'published'`, [id]);
      await transaction.unsafe(`UPDATE ${versionTable} SET status = 'published', published_at = now() WHERE id = $1`, [drafts[0].id]);
      await transaction.unsafe(`UPDATE ${rootTable} SET current_version_id = $1, status = 'published', updated_at = now() WHERE id = $2`, [drafts[0].id, id]);
      await this.audit(transaction, workspaceId, actorUserId, `${kind}_profile.published`, id, { versionNumber: drafts[0].versionNumber });
      return true;
    });
  }

  private async insertBrandVersion(transaction: TransactionSql, rootId: string, id: string, versionNumber: number, input: BrandProfileDraftWrite, actorUserId: string) {
    await transaction`INSERT INTO brand_profile_version (id, brand_profile_id, version_number, profile, information_depth_default, information_depth_ceiling, promotional_strength_default, promotional_strength_ceiling, created_by) VALUES (${id}, ${rootId}, ${versionNumber}, ${transaction.json(input.profile as unknown as JSONValue)}, ${input.informationDepthDefault ?? null}, ${input.informationDepthCeiling ?? null}, ${input.promotionalStrengthDefault ?? null}, ${input.promotionalStrengthCeiling ?? null}, ${actorUserId})`;
  }

  private async insertAudienceVersion(transaction: TransactionSql, rootId: string, id: string, versionNumber: number, input: AudienceProfileDraftWrite, actorUserId: string) {
    await transaction`INSERT INTO audience_profile_version (id, audience_profile_id, version_number, audience_type, profile, information_depth_default, information_depth_ceiling, promotional_strength_default, promotional_strength_ceiling, created_by) VALUES (${id}, ${rootId}, ${versionNumber}, ${input.audienceType}, ${transaction.json(input.profile as unknown as JSONValue)}, ${input.informationDepthDefault ?? null}, ${input.informationDepthCeiling ?? null}, ${input.promotionalStrengthDefault ?? null}, ${input.promotionalStrengthCeiling ?? null}, ${actorUserId})`;
  }

  private async attachBrandVersions(rows: readonly BrandRow[]): Promise<StoredBrandProfile[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const versions = await this.sql<BrandProfileVersion[]>`SELECT id, brand_profile_id, version_number, status, profile, information_depth_default, information_depth_ceiling, promotional_strength_default, promotional_strength_ceiling, created_at, published_at FROM brand_profile_version WHERE brand_profile_id IN ${this.sql(ids)} AND status IN ('draft', 'published') ORDER BY version_number`;
    return rows.map(({ currentVersionId, ...row }) => ({ ...row, currentVersion: versions.find((version) => version.id === currentVersionId), draftVersion: versions.find((version) => version.brandProfileId === row.id && version.status === "draft") }));
  }

  private async attachAudienceVersions(rows: readonly AudienceRow[]): Promise<StoredAudienceProfile[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const versions = await this.sql<AudienceProfileVersion[]>`SELECT id, audience_profile_id, version_number, status, audience_type, profile, information_depth_default, information_depth_ceiling, promotional_strength_default, promotional_strength_ceiling, created_at, published_at FROM audience_profile_version WHERE audience_profile_id IN ${this.sql(ids)} AND status IN ('draft', 'published') ORDER BY version_number`;
    return rows.map(({ currentVersionId, ...row }) => ({ ...row, currentVersion: versions.find((version) => version.id === currentVersionId), draftVersion: versions.find((version) => version.audienceProfileId === row.id && version.status === "draft") }));
  }

  private async audit(transaction: TransactionSql, workspaceId: string, actorUserId: string, eventType: string, subjectId: string, data: Record<string, unknown>) {
    await transaction`INSERT INTO audit_event (id, organization_id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data) SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, ${eventType}, ${eventType.startsWith("brand") ? "brand_profile" : "audience_profile"}, ${subjectId}, ${transaction.json(data as JSONValue)} FROM workspace WHERE id = ${workspaceId}`;
  }
}
