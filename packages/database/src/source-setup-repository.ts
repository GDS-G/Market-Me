import { randomUUID } from "node:crypto";
import { compileSourceSetup, normalizeSourceSetup, sourceSetupUuid, type SourceSetupInput } from "@market-me/domain";
import type { TransactionSql } from "postgres";
import type { DatabaseClient } from "./client";

export class SourceSetupError extends Error {
  constructor(readonly code: "access_denied" | "request_conflict" | "connection_unavailable" | "companion_unavailable" | "context_changed", message: string) {
    super(message); this.name = "SourceSetupError";
  }
}
export interface SourceSetupReceipt {
  workspaceId: string;
  requestId: string;
  smartSourceId: string;
  name: string;
  createdAt: string;
  initialState: "paused";
}
type ReceiptRow = Omit<SourceSetupReceipt, "initialState"> & { createdBy: string; canonicalRequest: string };
function receipt(row: ReceiptRow): SourceSetupReceipt {
  return { workspaceId: row.workspaceId, requestId: row.requestId, smartSourceId: row.smartSourceId,
    name: row.name, createdAt: new Date(row.createdAt).toISOString(), initialState: "paused" };
}

export class SourceSetupRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async getReceipt(workspaceId: string, requestId: string, actorUserId: string): Promise<SourceSetupReceipt | undefined> {
    const scope = sourceSetupUuid(workspaceId), key = sourceSetupUuid(requestId), actor = sourceSetupUuid(actorUserId);
    return this.sql.begin(async (tx) => {
      await this.lockWriter(tx, scope, actor);
      const rows = await tx<ReceiptRow[]>`SELECT * FROM smart_source_setup_receipt
        WHERE workspace_id = ${scope} AND request_id = ${key} AND created_by = ${actor}`;
      return rows[0] ? receipt(rows[0]) : undefined;
    });
  }

  async create(input: SourceSetupInput, actorUserId: string): Promise<{ receipt: SourceSetupReceipt; replayed: boolean }> {
    const normalized = normalizeSourceSetup(input), actor = sourceSetupUuid(actorUserId);
    const canonical = JSON.stringify(normalized);
    const source = compileSourceSetup(normalized);
    return this.sql.begin(async (tx) => {
      await this.lockWriter(tx, normalized.workspaceId, actor);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`source-setup:${normalized.workspaceId}:${normalized.requestId}`}, 0))`;
      const existing = (await tx<ReceiptRow[]>`SELECT * FROM smart_source_setup_receipt
        WHERE workspace_id = ${normalized.workspaceId} AND request_id = ${normalized.requestId}`)[0];
      if (existing) {
        if (existing.createdBy !== actor || existing.canonicalRequest !== canonical) {
          throw new SourceSetupError("request_conflict", "This setup request already belongs to a different reviewed configuration. Check the original result before starting another.");
        }
        return { receipt: receipt(existing), replayed: true };
      }
      await this.lockReferences(tx, normalized);
      const id = randomUUID();
      await tx`INSERT INTO smart_source (id, workspace_id, storage_connection_id, name, provider, recursive,
        readiness_mode, stabilization_window_seconds, related_file_minimum, ready_marker, allowed_mime_types,
        ignore_patterns, context_pack_ids, autonomy_mode, enabled, created_by)
        VALUES (${id}, ${source.workspaceId}, ${source.storageConnectionId ?? null}, ${source.name}, ${source.provider}, ${source.recursive},
          ${source.readinessMode}, ${source.stabilizationWindowSeconds}, ${source.relatedFileMinimum ?? null}, ${source.readyMarker ?? null},
          ${source.allowedMimeTypes}, ${source.ignorePatterns}, ${source.contextPackIds}, ${source.autonomyMode}, false, ${actor})`;
      await tx`INSERT INTO smart_source_location (id, smart_source_id, provider_location_id, display_path)
        VALUES (${randomUUID()}, ${id}, ${normalized.location.providerLocationId}, ${normalized.location.displayPath})`;
      const rows = await tx<ReceiptRow[]>`INSERT INTO smart_source_setup_receipt
        (workspace_id, request_id, smart_source_id, created_by, name, canonical_request)
        VALUES (${source.workspaceId}, ${normalized.requestId}, ${id}, ${actor}, ${source.name}, ${canonical}) RETURNING *`;
      await tx`INSERT INTO audit_event (id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
        VALUES (${randomUUID()}, ${source.workspaceId}, ${actor}, 'smart_source.created', 'smart_source', ${id},
          ${tx.json({ setup: "guided", initialState: "paused" })})`;
      return { receipt: receipt(rows[0]!), replayed: false };
    });
  }

  private async lockWriter(tx: TransactionSql, workspaceId: string, actor: string) {
    const organization = await tx`SELECT id FROM organization WHERE id =
      (SELECT organization_id FROM workspace WHERE id = ${workspaceId}) FOR KEY SHARE`;
    const workspace = await tx`SELECT id FROM workspace WHERE id = ${workspaceId} FOR SHARE`;
    const user = await tx`SELECT id FROM app_user WHERE id = ${actor} FOR KEY SHARE`;
    const membership = await tx<{ role: string }[]>`SELECT role FROM active_workspace_membership
      WHERE workspace_id = ${workspaceId} AND user_id = ${actor} FOR SHARE`;
    if (!organization[0] || !workspace[0] || !user[0] || !["owner", "admin", "editor"].includes(membership[0]?.role ?? "")) {
      throw new SourceSetupError("access_denied", "Current workspace writer access is required.");
    }
  }

  private async lockReferences(tx: TransactionSql, input: SourceSetupInput) {
    if (input.provider === "local") {
      const worker = await tx`SELECT id FROM browser_worker WHERE id = ${input.location.providerLocationId}
        AND workspace_id = ${input.workspaceId} AND status IN ('active', 'paused') FOR SHARE`;
      if (!worker[0]) throw new SourceSetupError("companion_unavailable", "Choose a currently paired desktop in this workspace.");
    } else {
      const connection = await tx`SELECT id FROM storage_connection WHERE id = ${input.storageConnectionId!}
        AND workspace_id = ${input.workspaceId} AND provider = ${input.provider} AND status = 'active' FOR SHARE`;
      if (!connection[0]) throw new SourceSetupError("connection_unavailable", "Reconnect or choose an active storage connection in this workspace.");
    }
    for (const pack of input.contextPacks) {
      const root = await tx`SELECT id FROM context_pack WHERE id = ${pack.id} AND workspace_id = ${input.workspaceId}
        AND status = 'published' AND current_version_id = ${pack.expectedVersionId} FOR SHARE`;
      const version = root[0] && await tx`SELECT id FROM context_pack_version WHERE id = ${pack.expectedVersionId}
        AND context_pack_id = ${pack.id} AND status = 'published' FOR SHARE`;
      if (!root[0] || !version || !version[0]) throw new SourceSetupError("context_changed", "A selected Context Pack changed. Refresh and review its current published version.");
    }
  }
}
