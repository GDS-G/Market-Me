import { createHash } from "node:crypto";
import { PACKAGE_STATUSES, type ContentPackageStatus } from "@market-me/domain";

export const CONTENT_CATALOG_LIMITS = Object.freeze({ pageSize: 30, fileNames: 3, queryLength: 120, cursorLength: 512, responseBytes: 1_048_576 });
export interface ContentCatalogFilters { query: string; status: ContentPackageStatus | null }
export interface ContentCatalogCursor { at: string; id: string }
export interface ContentCatalogItem {
  id: string; title: string; status: ContentPackageStatus; confidence: number | null; updatedAt: string;
  assetCount: string; evidenceCount: string; fileNames: readonly string[];
}
export interface ContentCatalogSnapshot {
  schemaVersion: 1; workspaceId: string; observedAt: string; filters: ContentCatalogFilters;
  totalPackages: string; totalMatches: string; items: readonly ContentCatalogItem[]; nextCursor: string | null;
}
export function contentCatalogUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error("Choose a valid catalog scope.");
  return value.toLowerCase();
}
/** Timestamp validation never rounds the string used for PostgreSQL's microsecond keyset comparison. */
function cursorTime(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/.test(value)) throw new Error("Invalid catalog cursor timestamp.");
  const date = new Date(value); if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error("Invalid catalog cursor date.");
  return value;
}
function context(workspaceId: string, filters: ContentCatalogFilters): string {
  return createHash("sha256").update(JSON.stringify([1, contentCatalogUuid(workspaceId), filters.query, filters.status])).digest("hex");
}
export function encodeContentCatalogCursor(workspaceId: string, filters: ContentCatalogFilters, item: ContentCatalogCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, at: cursorTime(item.at), id: contentCatalogUuid(item.id), context: context(workspaceId, filters) }), "utf8").toString("base64url");
}
export function normalizeContentCatalogQuery(workspaceId: string, input: unknown = {}): ContentCatalogFilters & { cursor?: ContentCatalogCursor } {
  contentCatalogUuid(workspaceId);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid catalog selection.");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !["query", "status", "cursor"].includes(key))) throw new Error("Unsupported catalog filter.");
  if (value.query !== undefined && (typeof value.query !== "string" || value.query.length > CONTENT_CATALOG_LIMITS.queryLength || /[\p{Cc}\p{Cf}]/u.test(value.query))) throw new Error("Use a short, plain-text search.");
  const query = typeof value.query === "string" ? value.query.trim() : "";
  const status = value.status === undefined || value.status === "" || value.status === "all" ? null : value.status;
  if (status !== null && (typeof status !== "string" || !PACKAGE_STATUSES.includes(status as ContentPackageStatus))) throw new Error("Choose a recorded package status.");
  const filters: ContentCatalogFilters = { query, status: status as ContentPackageStatus | null };
  if (value.cursor === undefined) return filters;
  if (typeof value.cursor !== "string" || !value.cursor || value.cursor.length > CONTENT_CATALOG_LIMITS.cursorLength || !/^[A-Za-z0-9_-]+$/.test(value.cursor)) throw new Error("Invalid catalog cursor.");
  const bytes = Buffer.from(value.cursor, "base64url"); if (bytes.toString("base64url") !== value.cursor) throw new Error("Invalid catalog cursor encoding.");
  const decoded = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded) || Object.keys(decoded).sort().join(",") !== "at,context,id,v" || decoded.v !== 1 || decoded.context !== context(workspaceId, filters)) throw new Error("Catalog cursor belongs to another selection.");
  return { ...filters, cursor: { at: cursorTime(decoded.at), id: contentCatalogUuid(decoded.id) } };
}
