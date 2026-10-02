import { createHash } from "node:crypto";
import type { ContentAsset } from "@market-me/domain";
import { contentCatalogUuid } from "./content-catalog-models";

export const ASSET_CATALOG_ROLES = Object.freeze(["original", "supporting", "derivative"] as const);
export type AssetCatalogRole = typeof ASSET_CATALOG_ROLES[number];
export const ASSET_CATALOG_LIMITS = Object.freeze({ pageSize: 30, queryLength: 120, cursorLength: 512, responseBytes: 1_048_576 });
export interface AssetCatalogFilters { query: string; role: AssetCatalogRole | null }
export interface AssetCatalogCursor { at: string; id: string }
export interface AssetCatalogItem {
  id: string; packageId: string; packageTitle: string; fileName: string; mimeType: string; role: AssetCatalogRole;
  byteSize: string | null; createdAt: string; extractionStatus: "pending" | "completed" | "skipped" | "failed";
  mediaStatus: NonNullable<ContentAsset["mediaStatus"]>; scanStatus: NonNullable<ContentAsset["scanStatus"]>;
  rightsStatus: NonNullable<ContentAsset["rightsStatus"]>;
}
export interface AssetCatalogSnapshot {
  schemaVersion: 1; workspaceId: string; observedAt: string; filters: AssetCatalogFilters;
  totalAssets: string; totalMatches: string; items: readonly AssetCatalogItem[]; nextCursor: string | null;
}
export const assetCatalogUuid = contentCatalogUuid;
/** Preserve the original six fractional digits after calendar validation. */
function cursorTime(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/.test(value)) throw new Error("Invalid asset cursor timestamp.");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error("Invalid asset cursor date.");
  return value;
}
function context(workspaceId: string, filters: AssetCatalogFilters): string {
  return createHash("sha256").update(JSON.stringify(["market-me.asset-catalog", 1, assetCatalogUuid(workspaceId), filters.query, filters.role])).digest("hex");
}
export function encodeAssetCatalogCursor(workspaceId: string, filters: AssetCatalogFilters, item: AssetCatalogCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, at: cursorTime(item.at), id: assetCatalogUuid(item.id), context: context(workspaceId, filters) }), "utf8").toString("base64url");
}
export function normalizeAssetCatalogQuery(workspaceId: string, input: unknown = {}): AssetCatalogFilters & { cursor?: AssetCatalogCursor } {
  assetCatalogUuid(workspaceId);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid asset selection.");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !["query", "role", "cursor"].includes(key))) throw new Error("Unsupported asset filter.");
  if (value.query !== undefined && (typeof value.query !== "string" || value.query.length > ASSET_CATALOG_LIMITS.queryLength || /[\p{Cc}\p{Cf}]/u.test(value.query))) throw new Error("Use a short, plain-text search.");
  const query = typeof value.query === "string" ? value.query.trim() : "";
  const role = value.role === undefined || value.role === "" || value.role === "all" ? null : value.role;
  if (role !== null && (typeof role !== "string" || !ASSET_CATALOG_ROLES.includes(role as AssetCatalogRole))) throw new Error("Choose a recorded asset role.");
  const filters: AssetCatalogFilters = { query, role: role as AssetCatalogRole | null };
  if (value.cursor === undefined) return filters;
  if (typeof value.cursor !== "string" || !value.cursor || value.cursor.length > ASSET_CATALOG_LIMITS.cursorLength || !/^[A-Za-z0-9_-]+$/.test(value.cursor)) throw new Error("Invalid asset cursor.");
  const bytes = Buffer.from(value.cursor, "base64url");
  if (bytes.toString("base64url") !== value.cursor) throw new Error("Invalid asset cursor encoding.");
  const decoded = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded) || Object.keys(decoded).sort().join(",") !== "at,context,id,v" || decoded.v !== 1 || decoded.context !== context(workspaceId, filters)) throw new Error("Asset cursor belongs to another selection.");
  return { ...filters, cursor: { at: cursorTime(decoded.at), id: assetCatalogUuid(decoded.id) } };
}
