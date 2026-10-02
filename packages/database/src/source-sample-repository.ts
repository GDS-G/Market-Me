import { createHash } from "node:crypto";
import { resolveContextFacts, SOURCE_SAMPLE_LIMIT, sourceSetupUuid, type ContextAuthorityRule, type ContextPackFact,
  type SmartSource, type SourceSampleItem } from "@market-me/domain";
import type { TransactionSql } from "postgres";
import type { DatabaseClient } from "./client";

const SOURCE_SAMPLE_ERROR_BRAND = Symbol.for("@market-me/database/SourceSampleError/v1");
export class SourceSampleError extends Error {
  readonly [SOURCE_SAMPLE_ERROR_BRAND] = true;
  constructor(readonly code: "invalid_input" | "access_denied" | "source_unavailable" | "source_changed" | "reference_unavailable" | "sample_unsupported", message: string) {
    super(message); this.name = "SourceSampleError";
  }
}
/** Dev hot reload can retain repository instances from an earlier module copy. */
export function isSourceSampleError(value: unknown): value is SourceSampleError {
  return value instanceof Error && Reflect.get(value, SOURCE_SAMPLE_ERROR_BRAND) === true;
}
export interface SourceSampleRequest { workspaceId: string; smartSourceId: string; expectedSourceVersion: number; locationIndex: number }
type CapturedSource = Omit<SmartSource, "locations" | "lastScanAt"> & { version: number; storageConnectionId: string | null };
export interface SourceSampleContextSummary {
  packs: readonly { name: string; versionNumber: number }[];
  facts: readonly { factKey: string; status: "resolved" | "conflicted" | "unresolved"; reason: string }[];
  unresolvedRecordedFacts: number;
}
export interface SourceSampleCapture {
  source: CapturedSource;
  location: { providerLocationId: string; displayPath: string };
  context: SourceSampleContextSummary;
  preparation: { enabled: boolean; revision: number } | null;
  localItems: readonly SourceSampleItem[];
  localTruncated: boolean;
  /** Internal comparison only; never a browser capability or persisted receipt. */
  fingerprint: string;
}
const CONTEXT_FACT_LIMIT = 1_000;
const CONTEXT_BYTES_LIMIT = 262_144;
function unsupported(message: string): never { throw new SourceSampleError("sample_unsupported", message); }
function instant(value: string | Date | null): string | undefined { return value === null ? undefined : new Date(value).toISOString(); }

/** Read-only captures. Row locks last only for each short transaction, never provider I/O. */
export class SourceSampleRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async capture(input: SourceSampleRequest, actorUserId: string): Promise<SourceSampleCapture> {
    let workspaceId: string, smartSourceId: string, actor: string;
    try { workspaceId = sourceSetupUuid(input.workspaceId); smartSourceId = sourceSetupUuid(input.smartSourceId); actor = sourceSetupUuid(actorUserId); }
    catch { throw new SourceSampleError("invalid_input", "Choose a valid workspace and Smart Source."); }
    if (!Number.isInteger(input.expectedSourceVersion) || input.expectedSourceVersion < 1 || input.expectedSourceVersion > 2_147_483_647
      || !Number.isInteger(input.locationIndex) || input.locationIndex < 0 || input.locationIndex > 19) {
      throw new SourceSampleError("invalid_input", "Choose a saved source version and location.");
    }
    return this.sql.begin("isolation level repeatable read", async (tx) => {
      await this.lockWriter(tx, workspaceId, actor);
      const source = (await tx<CapturedSource[]>`SELECT id,workspace_id,name,provider,storage_connection_id,version,recursive,
        readiness_mode,stabilization_window_seconds,related_file_minimum,ready_marker,ai_confidence_threshold,
        allowed_mime_types,ignore_patterns,context_pack_ids,autonomy_mode,enabled
        FROM smart_source WHERE id=${smartSourceId} AND workspace_id=${workspaceId} FOR SHARE`)[0];
      if (!source) throw new SourceSampleError("source_unavailable", "Choose a Smart Source in this workspace.");
      if (source.version !== input.expectedSourceVersion) throw new SourceSampleError("source_changed", "The saved source changed. Reload and review it before testing.");
      const locations = await tx<{ providerLocationId: string; displayPath: string }[]>`SELECT provider_location_id,display_path
        FROM smart_source_location WHERE smart_source_id=${smartSourceId} ORDER BY created_at,id LIMIT 21 FOR SHARE`;
      const location = locations[input.locationIndex];
      if (!location || locations.length > 20) throw new SourceSampleError("source_changed", "The saved location changed. Reload and choose it again.");
      if (source.name.length > 200 || location.displayPath.length > 2_048 || location.providerLocationId.length > 500
        || source.allowedMimeTypes.length > 100 || source.allowedMimeTypes.some((value) => value.length > 200)
        || source.ignorePatterns.length > 100 || source.ignorePatterns.some((value) => value.length > 512)
        || source.contextPackIds.length > 100) unsupported("This legacy source exceeds the bounded dry-test limits. Simplify its saved configuration before testing.");
      if (source.provider === "local") {
        if (locations.length !== 1) unsupported("The local index does not record which location supplied each item. Dry tests currently require one saved local location.");
        // Do not interpret a saved local label as a filesystem path or dispatch a scan.
        const workers = await tx`SELECT id FROM browser_worker WHERE id::text=${location.providerLocationId}
          AND workspace_id=${workspaceId} AND status IN ('active','paused') FOR SHARE`;
        if (!workers[0]) throw new SourceSampleError("reference_unavailable", "The saved desktop pairing is unavailable. Review the source connection.");
      } else {
        const validLocation = source.provider === "sharepoint" ? /^[^:\s\u0000-\u001f]+:[^:\s\u0000-\u001f]+$/u : /^[A-Za-z0-9_!-]+$/u;
        if (!validLocation.test(location.providerLocationId)) unsupported("The saved cloud location is not a supported folder identifier.");
        const connections = await tx`SELECT id FROM storage_connection WHERE id=${source.storageConnectionId}
          AND workspace_id=${workspaceId} AND provider=${source.provider} AND status='active' FOR SHARE`;
        if (!connections[0]) throw new SourceSampleError("reference_unavailable", "The saved storage connection is unavailable. Reconnect before testing.");
      }
      const roots = source.contextPackIds.length ? await tx<{ id: string; name: string; currentVersionId: string | null; status: string }[]>`
        SELECT id,name,current_version_id,status FROM context_pack WHERE workspace_id=${workspaceId}
        AND id IN ${tx([...source.contextPackIds])} ORDER BY updated_at DESC,name FOR SHARE` : [];
      if (roots.length !== new Set(source.contextPackIds).size || roots.some((root) => root.status !== "published" || !root.currentVersionId)) {
        throw new SourceSampleError("reference_unavailable", "A selected Context Pack is no longer published. Review the saved context selections.");
      }
      const versionIds = roots.map((root) => root.currentVersionId!);
      const contextBytes = versionIds.length ? (await tx<{ bytes: number }[]>`SELECT (
        COALESCE((SELECT sum(octet_length(authority_rules::text)) FROM context_pack_version WHERE id IN ${tx(versionIds)}),0)
        + COALESCE((SELECT sum(octet_length(fact_key)+octet_length(value_json::text)) FROM context_pack_fact WHERE context_pack_version_id IN ${tx(versionIds)}),0)
        )::double precision AS bytes`)[0]!.bytes : 0;
      if (contextBytes > CONTEXT_BYTES_LIMIT) unsupported("The selected context is too large for this metadata dry test. No partial context interpretation was returned.");
      const versionRows = versionIds.length ? await tx<{ id: string; contextPackId: string; versionNumber: number; status: string; authorityRules: readonly ContextAuthorityRule[]; instructionsHash: string }[]>`
        SELECT id,context_pack_id,version_number,status,authority_rules,encode(sha256(convert_to(instructions,'UTF8')),'hex') AS instructions_hash FROM context_pack_version
        WHERE id IN ${tx(versionIds)} ORDER BY version_number DESC,id FOR SHARE` : [];
      if (versionRows.length !== roots.length || versionRows.some((version) => version.status !== "published"
        || !roots.some((root) => root.id === version.contextPackId && root.currentVersionId === version.id))) {
        throw new SourceSampleError("reference_unavailable", "A published Context Pack version is unavailable. Refresh its selections.");
      }
      // Match listContextPacks/runtime order. The first authored rule for a fact
      // wins in resolveContextFacts; sorting by version number would change it.
      const versions = roots.map((root) => versionRows.find((version) => version.id === root.currentVersionId)!);
      const facts = versionIds.length ? await tx<(ContextPackFact & { contextPackVersionId: string })[]>`
        SELECT id,context_pack_version_id,fact_key,value_json AS value,source_id,status FROM context_pack_fact
        WHERE context_pack_version_id IN ${tx(versionIds)} ORDER BY fact_key,created_at,id LIMIT ${CONTEXT_FACT_LIMIT + 1} FOR SHARE` : [];
      if (facts.length > CONTEXT_FACT_LIMIT || Buffer.byteLength(JSON.stringify({ roots, versions, facts }), "utf8") > CONTEXT_BYTES_LIMIT) {
        unsupported("The selected context is too large for this metadata dry test. No partial context interpretation was returned.");
      }
      const candidates = versions.flatMap((version) => facts.filter((fact) => fact.contextPackVersionId === version.id && fact.status !== "unresolved" && fact.sourceId)
        .map((fact) => ({ id: fact.id, factKey: fact.factKey, value: fact.value, sourceId: fact.sourceId! })));
      const rules = versions.flatMap((version) => version.authorityRules);
      const resolutions = resolveContextFacts([...candidates.map((fact) => fact.factKey), ...rules.map((rule) => rule.factKey)], candidates, rules);
      const context: SourceSampleContextSummary = {
        packs: versions.map((version) => ({ name: roots.find((root) => root.id === version.contextPackId)!.name, versionNumber: version.versionNumber })),
        facts: resolutions.map(({ factKey, status, reason }) => ({ factKey, status, reason })),
        unresolvedRecordedFacts: facts.filter((fact) => fact.status === "unresolved" || !fact.sourceId).length,
      };
      const binding = (await tx<{ enabled: boolean; revision: number }[]>`SELECT enabled,revision FROM smart_source_preparation_binding
        WHERE workspace_id=${workspaceId} AND smart_source_id=${smartSourceId} FOR SHARE`)[0] ?? null;
      const indexed = source.provider === "local" ? await tx<{ key: string; parentKey: string | null; name: string; displayPath: string;
        mimeType: string; isFolder: boolean; modifiedAt: string | Date | null; lastSeenAt: string | Date | null }[]>`
        SELECT provider_item_id AS key,provider_parent_id AS parent_key,name,display_path,mime_type,is_folder,modified_at,last_seen_at
        FROM source_item WHERE workspace_id=${workspaceId} AND smart_source_id=${smartSourceId} AND deleted_at IS NULL
        ORDER BY display_path,id LIMIT ${SOURCE_SAMPLE_LIMIT + 1}` : [];
      const localItems = indexed.slice(0, SOURCE_SAMPLE_LIMIT).map((item): SourceSampleItem => ({ key: item.key,
        ...(item.parentKey === null ? {} : { parentKey: item.parentKey }), name: item.name, displayPath: item.displayPath,
        mimeType: item.mimeType, isFolder: item.isFolder, ...(item.modifiedAt === null ? {} : { modifiedAt: instant(item.modifiedAt)! }),
        ...(item.lastSeenAt === null ? {} : { lastSeenAt: instant(item.lastSeenAt)! }) }));
      return { source, location, context, preparation: binding, localItems, localTruncated: indexed.length > SOURCE_SAMPLE_LIMIT,
        fingerprint: createHash("sha256").update(JSON.stringify({ source, locations, roots, versions, facts, binding })).digest("hex") };
    }).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "40001") {
        throw new SourceSampleError("source_changed", "Saved settings or access changed while the test was captured. Reload and review before testing again.");
      }
      throw error;
    });
  }

  async assertUnchanged(input: SourceSampleRequest, actorUserId: string, fingerprint: string): Promise<void> {
    const latest = await this.capture(input, actorUserId);
    if (latest.fingerprint !== fingerprint) throw new SourceSampleError("source_changed", "The source, context or preparation settings changed during this test. Reload and test the current settings.");
  }

  private async lockWriter(tx: TransactionSql, workspaceId: string, actor: string) {
    const organization = await tx`SELECT id FROM organization WHERE id=(SELECT organization_id FROM workspace WHERE id=${workspaceId}) FOR KEY SHARE`;
    const workspace = await tx`SELECT id FROM workspace WHERE id=${workspaceId} FOR SHARE`;
    const user = await tx`SELECT id FROM app_user WHERE id=${actor} FOR KEY SHARE`;
    const membership = await tx<{ role: string }[]>`SELECT role FROM active_workspace_membership WHERE workspace_id=${workspaceId} AND user_id=${actor} FOR SHARE`;
    if (!organization[0] || !workspace[0] || !user[0] || !["owner", "admin", "editor"].includes(membership[0]?.role ?? "")) {
      throw new SourceSampleError("access_denied", "Current workspace writer access is required.");
    }
  }
}
