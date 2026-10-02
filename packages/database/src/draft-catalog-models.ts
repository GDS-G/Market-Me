import { createHash } from "node:crypto";
import { DRAFT_STATUSES, type DraftStatus } from "@market-me/domain";
import { contentCatalogUuid } from "./content-catalog-models";

export const DRAFT_CATALOG_LIMITS = Object.freeze({ pageSize: 30, bodyCharacters: 320, queryLength: 120, cursorLength: 512, responseBytes: 1_048_576 });
export interface DraftCatalogFilters { query: string; status: DraftStatus | null }
export interface DraftCatalogCursor { at: string; id: string }
export interface DraftCatalogItem {
  id: string; currentVersionId: string; versionNumber: number; headline: string; bodyPreview: string; bodyCharacters: string; bodyTruncated: boolean;
  status: DraftStatus; updatedAt: string; campaignId: string; campaignName: string; packageId: string; packageTitle: string; audienceName: string | null;
}
export interface DraftCatalogSnapshot {
  schemaVersion: 1; workspaceId: string; observedAt: string; filters: DraftCatalogFilters;
  totalDrafts: string; totalMatches: string; items: readonly DraftCatalogItem[]; nextCursor: string | null;
}
export const draftCatalogUuid = contentCatalogUuid;
/** Validate with Date, but never use its rounded value as the PostgreSQL boundary. */
function cursorTime(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/.test(value)) throw new Error("Invalid draft cursor timestamp.");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error("Invalid draft cursor date.");
  return value;
}
function context(workspaceId: string, filters: DraftCatalogFilters): string {
  return createHash("sha256").update(JSON.stringify(["market-me.draft-catalog", 1, draftCatalogUuid(workspaceId), filters.query, filters.status])).digest("hex");
}
export function encodeDraftCatalogCursor(workspaceId: string, filters: DraftCatalogFilters, item: DraftCatalogCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, at: cursorTime(item.at), id: draftCatalogUuid(item.id), context: context(workspaceId, filters) }), "utf8").toString("base64url");
}
export function normalizeDraftCatalogQuery(workspaceId: string, input: unknown = {}): DraftCatalogFilters & { cursor?: DraftCatalogCursor } {
  draftCatalogUuid(workspaceId);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid draft selection.");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !["query", "status", "cursor"].includes(key))) throw new Error("Unsupported draft filter.");
  if (value.query !== undefined && (typeof value.query !== "string" || value.query.length > DRAFT_CATALOG_LIMITS.queryLength || /[\p{Cc}\p{Cf}]/u.test(value.query))) throw new Error("Use a short, plain-text search.");
  const query = typeof value.query === "string" ? value.query.trim() : "";
  const status = value.status === undefined || value.status === "" || value.status === "all" ? null : value.status;
  if (status !== null && (typeof status !== "string" || !DRAFT_STATUSES.includes(status as DraftStatus))) throw new Error("Choose a recorded draft status.");
  const filters: DraftCatalogFilters = { query, status: status as DraftStatus | null };
  if (value.cursor === undefined) return filters;
  if (typeof value.cursor !== "string" || !value.cursor || value.cursor.length > DRAFT_CATALOG_LIMITS.cursorLength || !/^[A-Za-z0-9_-]+$/.test(value.cursor)) throw new Error("Invalid draft cursor.");
  const bytes = Buffer.from(value.cursor, "base64url");
  if (bytes.toString("base64url") !== value.cursor) throw new Error("Invalid draft cursor encoding.");
  const decoded = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded) || Object.keys(decoded).sort().join(",") !== "at,context,id,v" || decoded.v !== 1 || decoded.context !== context(workspaceId, filters)) throw new Error("Draft cursor belongs to another selection.");
  return { ...filters, cursor: { at: cursorTime(decoded.at), id: draftCatalogUuid(decoded.id) } };
}
