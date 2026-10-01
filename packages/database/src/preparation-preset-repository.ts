import { createHash, randomUUID } from "node:crypto";
import { resolveCommunicationPolicy, type CommunicationPolicyInput } from "@market-me/domain";
import type { JSONValue, TransactionSql } from "postgres";
import type { DatabaseClient } from "./client";
import { normalizeCampaignPreparationSettings, type CampaignPreparationSettings } from "./campaign-preparation-template";
import { normalizePreparationPresetRequest, preparationPresetInteger, preparationPresetUuid, PreparationPresetError,
  PREPARATION_PRESET_LIMITS, type PreparationPresetReceipt, type PreparationPresetSummary, type PreparationPresetVersion } from "./preparation-preset-models";

type Root = { id: string; workspaceId: string; revision: number; latestVersionNumber: number; archived: boolean };
type VersionRow = Omit<PreparationPresetVersion, "copiedFrom" | "createdAt"> & { copiedFromPresetId: string | null;
  copiedFromVersionNumber: number | null; createdAt: string | Date };
type ReceiptRow = Omit<PreparationPresetReceipt, "createdAt"> & { createdBy: string; canonicalRequest: string; createdAt: string | Date };
function receipt(row: ReceiptRow): PreparationPresetReceipt {
  return { workspaceId: row.workspaceId, requestId: row.requestId, operation: row.operation, presetId: row.presetId,
    versionNumber: row.versionNumber, revision: row.revision, archived: row.archived, title: row.title, createdAt: new Date(row.createdAt).toISOString() };
}
function version(row: VersionRow): PreparationPresetVersion {
  return { workspaceId: row.workspaceId, presetId: row.presetId, versionNumber: row.versionNumber, title: row.title, notes: row.notes,
    configuration: row.configuration, configurationHash: row.configurationHash, createdAt: new Date(row.createdAt).toISOString(),
    copiedFrom: row.copiedFromPresetId ? { presetId: row.copiedFromPresetId, versionNumber: row.copiedFromVersionNumber! } : null };
}

/** A library write never calls Campaign, generation, source-preparation or provider services. */
export class PreparationPresetRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async mutate(input: unknown, actorUserId: string): Promise<{ receipt: PreparationPresetReceipt; replayed: boolean }> {
    const request = normalizePreparationPresetRequest(input), actor = preparationPresetUuid(actorUserId);
    const canonical = JSON.stringify(request);
    return this.sql.begin(async (tx) => {
      await this.lockWriter(tx, request.workspaceId, actor);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`preparation-preset:${request.workspaceId}:${request.requestId}`},0))`;
      const prior = (await tx<ReceiptRow[]>`SELECT * FROM preparation_preset_receipt
        WHERE workspace_id=${request.workspaceId} AND request_id=${request.requestId}`)[0];
      if (prior) {
        if (prior.createdBy !== actor || prior.canonicalRequest !== canonical) throw new PreparationPresetError("request_conflict", "This request already belongs to different preset settings. Check the original result before starting another.");
        return { receipt: receipt(prior), replayed: true };
      }
      let root: Root;
      if (request.operation === "create") {
        root = { id: randomUUID(), workspaceId: request.workspaceId, revision: 1, latestVersionNumber: 1, archived: false };
      } else {
        const current = (await tx<Root[]>`SELECT id,workspace_id,revision,latest_version_number,archived FROM preparation_preset
          WHERE id=${request.presetId} AND workspace_id=${request.workspaceId} FOR UPDATE`)[0];
        if (!current) throw new PreparationPresetError("not_found", "Choose a preset in this workspace.");
        if (current.revision !== request.expectedRevision) throw new PreparationPresetError("revision_conflict", "This preset changed. Reload and review it before saving another request.");
        if (current.archived && request.operation !== "restore") throw new PreparationPresetError("archived", "Restore this preset before making a new version or copy.");
        if (!current.archived && request.operation === "restore") throw new PreparationPresetError("revision_conflict", "This preset is already available. Reload its current state.");
        root = current;
      }
      const existing = request.operation !== "create" ? (await tx<VersionRow[]>`SELECT * FROM preparation_preset_version
        WHERE preset_id=${root.id} AND workspace_id=${request.workspaceId}
        AND version_number=${request.operation === "clone" ? request.versionNumber : root.latestVersionNumber}`)[0] : undefined;
      if (request.operation !== "create" && !existing) throw new PreparationPresetError("not_found", "Choose an existing saved preset version.");
      let title: string;
      if (request.operation === "archive" || request.operation === "restore") {
        if (root.revision === 2_147_483_647) throw new PreparationPresetError("revision_conflict", "This preset has reached its revision limit. Create a separate preset.");
        root = { ...root, revision: root.revision + 1, archived: request.operation === "archive" };
        await tx`UPDATE preparation_preset SET revision=${root.revision},archived=${root.archived},updated_at=clock_timestamp() WHERE id=${root.id}`;
        title = existing!.title;
      } else {
        const configuration = request.operation === "clone" ? normalizeCampaignPreparationSettings(existing!.configuration) : request.configuration;
        title = request.title;
        const notes = request.operation === "clone" ? existing!.notes : request.notes;
        await this.lockReferences(tx, request.workspaceId, configuration);
        const origin = request.operation === "clone" ? { presetId: root.id, versionNumber: request.versionNumber } : null;
        if (request.operation === "clone") root = { id: randomUUID(), workspaceId: request.workspaceId, revision: 1, latestVersionNumber: 1, archived: false };
        if (request.operation === "revise") {
          if (root.revision === 2_147_483_647 || root.latestVersionNumber === 2_147_483_647) throw new PreparationPresetError("revision_conflict", "This preset has reached its version limit. Clone it into a separate preset.");
          root = { ...root, revision: root.revision + 1, latestVersionNumber: root.latestVersionNumber + 1 };
          await tx`UPDATE preparation_preset SET revision=${root.revision},latest_version_number=${root.latestVersionNumber},updated_at=clock_timestamp() WHERE id=${root.id}`;
        } else {
          await tx`INSERT INTO preparation_preset(id,workspace_id,created_by) VALUES (${root.id},${request.workspaceId},${actor})`;
        }
        const configurationText = JSON.stringify(configuration), configurationHash = createHash("sha256").update(configurationText).digest("hex");
        await tx`INSERT INTO preparation_preset_version(preset_id,workspace_id,version_number,title,notes,configuration,
          canonical_configuration,configuration_hash,copied_from_preset_id,copied_from_version_number,created_by)
          VALUES (${root.id},${request.workspaceId},${root.latestVersionNumber},${title},${notes},${tx.json(configuration as unknown as JSONValue)},
            ${configurationText},${configurationHash},${origin?.presetId ?? null},${origin?.versionNumber ?? null},${actor})`;
      }
      const saved = (await tx<ReceiptRow[]>`INSERT INTO preparation_preset_receipt
        (workspace_id,request_id,created_by,operation,preset_id,version_number,revision,archived,title,canonical_request)
        VALUES (${request.workspaceId},${request.requestId},${actor},${request.operation},${root.id},${root.latestVersionNumber},
          ${root.revision},${root.archived},${title},${canonical}) RETURNING *`)[0]!;
      await tx`INSERT INTO audit_event(id,workspace_id,actor_user_id,event_type,subject_type,subject_id,data)
        VALUES (${randomUUID()},${request.workspaceId},${actor},${`preparation_preset.${request.operation}`},'preparation_preset',${root.id},
          ${tx.json({ versionNumber: root.latestVersionNumber, revision: root.revision, archived: root.archived })})`;
      return { receipt: receipt(saved), replayed: false };
    });
  }

  async getReceipt(workspaceId: string, requestId: string, actorUserId: string): Promise<PreparationPresetReceipt | undefined> {
    const scope = preparationPresetUuid(workspaceId), key = preparationPresetUuid(requestId), actor = preparationPresetUuid(actorUserId);
    return this.sql.begin(async (tx) => {
      await this.lockWriter(tx, scope, actor);
      const row = (await tx<ReceiptRow[]>`SELECT * FROM preparation_preset_receipt WHERE workspace_id=${scope} AND request_id=${key} AND created_by=${actor}`)[0];
      return row ? receipt(row) : undefined;
    });
  }

  /** Explicit values-only copy. No receipt, audit, Campaign or request is created. */
  async copySettings(workspaceId: string, presetId: string, expectedRevision: number, versionNumber: number, actorUserId: string): Promise<PreparationPresetVersion> {
    const scope=preparationPresetUuid(workspaceId),id=preparationPresetUuid(presetId),actor=preparationPresetUuid(actorUserId);
    preparationPresetInteger(expectedRevision);preparationPresetInteger(versionNumber);
    return this.sql.begin(async tx=>{
      await this.lockWriter(tx,scope,actor);
      const root=(await tx<Root[]>`SELECT id,workspace_id,revision,latest_version_number,archived FROM preparation_preset
        WHERE id=${id} AND workspace_id=${scope} FOR SHARE`)[0];
      if(!root)throw new PreparationPresetError("not_found","Choose a preset in this workspace.");
      if(root.revision!==expectedRevision)throw new PreparationPresetError("revision_conflict","This preset changed. Reload before copying its settings.");
      if(root.archived)throw new PreparationPresetError("archived","Restore this preset before copying its settings.");
      const row=(await tx<VersionRow[]>`SELECT * FROM preparation_preset_version WHERE preset_id=${id} AND workspace_id=${scope}
        AND version_number=${versionNumber} FOR SHARE`)[0];
      if(!row)throw new PreparationPresetError("not_found","Choose an existing saved preset version.");
      await this.lockReferences(tx,scope,row.configuration);
      return version(row);
    });
  }

  /** Bounded numbered pages. Results are observations, not a stable multi-page snapshot. */
  async list(workspaceId: string, actorUserId: string, page = 1): Promise<{ items: readonly PreparationPresetSummary[]; more: boolean }> {
    const scope = preparationPresetUuid(workspaceId), actor = preparationPresetUuid(actorUserId);
    if (!Number.isInteger(page) || page < 1 || page > 2_000) throw new PreparationPresetError("invalid_input", "Choose a preset list page from 1 to 2000.");
    const rows = await this.sql<(Omit<PreparationPresetSummary,"updatedAt"> & { updatedAt: string | Date })[]>`
      SELECT p.id,p.workspace_id,p.revision,p.latest_version_number,p.archived,p.updated_at,v.title,v.notes
      FROM preparation_preset p JOIN preparation_preset_version v ON v.preset_id=p.id AND v.version_number=p.latest_version_number
      JOIN workspace_membership m ON m.workspace_id=p.workspace_id AND m.user_id=${actor}
      WHERE p.workspace_id=${scope} ORDER BY p.updated_at DESC,p.id
      LIMIT ${PREPARATION_PRESET_LIMITS.list + 1} OFFSET ${(page - 1) * PREPARATION_PRESET_LIMITS.list}`;
    return { items: rows.slice(0,PREPARATION_PRESET_LIMITS.list).map(row=>({ ...row,updatedAt:new Date(row.updatedAt).toISOString() })), more: rows.length>PREPARATION_PRESET_LIMITS.list };
  }

  async get(workspaceId: string, presetId: string, actorUserId: string, versionNumber?: number): Promise<{
    root: Root; version: PreparationPresetVersion;
  } | undefined> {
    const scope=preparationPresetUuid(workspaceId), id=preparationPresetUuid(presetId), actor=preparationPresetUuid(actorUserId);
    if (versionNumber !== undefined) preparationPresetInteger(versionNumber);
    const rows=await this.sql<(VersionRow & { revision: number; latestVersionNumber: number; archived: boolean })[]>`
      SELECT v.*,p.revision,p.latest_version_number,p.archived FROM preparation_preset p
      JOIN preparation_preset_version v ON v.preset_id=p.id AND v.version_number=COALESCE(${versionNumber ?? null}::integer,p.latest_version_number)
      JOIN workspace_membership m ON m.workspace_id=p.workspace_id AND m.user_id=${actor}
      WHERE p.workspace_id=${scope} AND p.id=${id}`;
    const row=rows[0];
    return row ? { root:{id,workspaceId:scope,revision:row.revision,latestVersionNumber:row.latestVersionNumber,archived:row.archived},version:version(row) } : undefined;
  }

  async history(workspaceId: string, presetId: string, actorUserId: string, beforeVersion?: number): Promise<{
    items: readonly { versionNumber: number; title: string; createdAt: string }[]; more: boolean;
  }> {
    const scope=preparationPresetUuid(workspaceId), id=preparationPresetUuid(presetId), actor=preparationPresetUuid(actorUserId);
    if(beforeVersion!==undefined) preparationPresetInteger(beforeVersion);
    const rows=await this.sql<{versionNumber:number;title:string;createdAt:string|Date}[]>`
      SELECT v.version_number,v.title,v.created_at FROM preparation_preset_version v
      JOIN workspace_membership m ON m.workspace_id=v.workspace_id AND m.user_id=${actor}
      WHERE v.workspace_id=${scope} AND v.preset_id=${id} AND (${beforeVersion??null}::integer IS NULL OR v.version_number<${beforeVersion??null})
      ORDER BY v.version_number DESC LIMIT ${PREPARATION_PRESET_LIMITS.history+1}`;
    return {items:rows.slice(0,PREPARATION_PRESET_LIMITS.history).map(row=>({...row,createdAt:new Date(row.createdAt).toISOString()})),more:rows.length>PREPARATION_PRESET_LIMITS.history};
  }

  private async lockWriter(tx: TransactionSql, workspaceId: string, actor: string) {
    const organization=await tx`SELECT id FROM organization WHERE id=(SELECT organization_id FROM workspace WHERE id=${workspaceId}) FOR KEY SHARE`;
    const workspace=await tx`SELECT id FROM workspace WHERE id=${workspaceId} FOR SHARE`;
    const user=await tx`SELECT id FROM app_user WHERE id=${actor} FOR KEY SHARE`;
    const membership=await tx<{role:string}[]>`SELECT role FROM workspace_membership WHERE workspace_id=${workspaceId} AND user_id=${actor} FOR SHARE`;
    if(!organization[0]||!workspace[0]||!user[0]||!["owner","admin","editor"].includes(membership[0]?.role??"")) throw new PreparationPresetError("access_denied","Current workspace writer access is required.");
  }

  private async lockReferences(tx: TransactionSql, workspaceId: string, settings: CampaignPreparationSettings) {
    const policies:CommunicationPolicyInput[]=[];
    for(const kind of ["brand","audience"] as const) {
      const ids=kind==="brand"?(settings.brandProfileVersionId?[settings.brandProfileVersionId]:[]):[...settings.audienceProfileVersionIds];
      if(!ids.length)continue;
      // Only this closed internal discriminant selects SQL identifiers. Roots
      // precede versions; deterministic order agrees with profile publication.
      const rootTable=`${kind}_profile`, versionTable=`${kind}_profile_version`, rootColumn=`${kind}_profile_id`;
      const roots=await tx.unsafe<{id:string;currentVersionId:string|null;status:string}[]>(
        `SELECT id,current_version_id,status FROM ${rootTable} WHERE workspace_id=$1 AND id IN
        (SELECT ${rootColumn} FROM ${versionTable} WHERE id=ANY($2::uuid[])) ORDER BY id FOR SHARE`,[workspaceId,ids]);
      if(roots.length!==ids.length||roots.some(root=>root.status!=="published"||!root.currentVersionId||!ids.includes(root.currentVersionId))) {
        throw new PreparationPresetError("reference_unavailable",`Choose current published ${kind==="brand"?"Brand":"Audience"} Profile versions in this workspace.`);
      }
      const versions=await tx.unsafe<(CommunicationPolicyInput & {id:string;status:string})[]>(
        `SELECT id,status,information_depth_default AS information_depth,information_depth_ceiling,
        promotional_strength_default AS promotional_strength,promotional_strength_ceiling
        FROM ${versionTable} WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE`,[ids]);
      if(versions.length!==ids.length||versions.some(item=>item.status!=="published")) throw new PreparationPresetError("reference_unavailable","A selected published profile is unavailable.");
      policies.push(...versions.map(item=>({...item,source:kind==="brand"?"Selected Brand Profile":"Selected Audience Profile",level:kind})));
    }
    if(settings.destinationId) {
      const rows=await tx`SELECT id FROM destination WHERE id=${settings.destinationId} AND workspace_id=${workspaceId} AND status='published' FOR SHARE`;
      if(!rows[0])throw new PreparationPresetError("reference_unavailable","Choose a published Destination in this workspace.");
    }
    const policy=resolveCommunicationPolicy([...policies,{source:"Preparation preset",level:"campaign",informationDepth:settings.informationDepth,promotionalStrength:settings.promotionalStrength}]);
    if(policy.issues.length)throw new PreparationPresetError("policy_conflict","These copy controls exceed a selected profile's published limits. Review the depth and promotional strength.");
  }
}
