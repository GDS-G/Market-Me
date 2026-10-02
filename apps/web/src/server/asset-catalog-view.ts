import { assetCatalogUuid, normalizeAssetCatalogQuery, type AssetCatalogItem, type AssetCatalogRole } from "@market-me/database";
import { catalogCount } from "./content-catalog-view";

export interface AssetCatalogSelection { query: string; role?: AssetCatalogRole; cursor?: string }
export const ASSET_ROLE_LABELS: Readonly<Record<AssetCatalogRole, string>> = Object.freeze({ original: "Original", supporting: "Supporting", derivative: "Derivative" });
export const ASSET_EXTRACTION_LABELS: Readonly<Record<AssetCatalogItem["extractionStatus"], string>> = Object.freeze({ pending: "Pending", completed: "Completed", skipped: "Skipped", failed: "Failed" });
export const ASSET_MEDIA_LABELS: Readonly<Record<AssetCatalogItem["mediaStatus"], string>> = Object.freeze({ stored: "Stored", processed: "Processed", unsupported: "Unsupported", failed: "Failed" });
export const ASSET_SCAN_LABELS: Readonly<Record<AssetCatalogItem["scanStatus"], string>> = Object.freeze({ clean: "Clean record", infected: "Infected record", not_configured: "Not configured", failed: "Failed" });
export const ASSET_RIGHTS_LABELS: Readonly<Record<AssetCatalogItem["rightsStatus"], string>> = Object.freeze({ unchecked: "Unchecked", cleared: "Cleared record", restricted: "Restricted", expired: "Expired record" });
export function assetCatalogBytes(value: string | null): string { return value === null ? "Unavailable" : `${catalogCount(value)} bytes`; }
export function assetCatalogSelection(query: Record<string, string | string[] | undefined>, workspaceId: string): AssetCatalogSelection {
  const workspace = assetCatalogUuid(workspaceId);
  if (Object.keys(query).some(key => !["workspaceId", "q", "role", "cursor"].includes(key))) throw new Error("Unsupported asset query.");
  if (query.workspaceId !== undefined && assetCatalogUuid(query.workspaceId) !== workspace) throw new Error("Different workspace.");
  const normalized = normalizeAssetCatalogQuery(workspace, { query: query.q, role: query.role, cursor: query.cursor });
  return { query: normalized.query, ...(normalized.role ? { role: normalized.role } : {}), ...(normalized.cursor ? { cursor: query.cursor as string } : {}) };
}
export function assetCatalogPath(workspaceId: string, selection: AssetCatalogSelection = { query: "" }): string {
  const workspace = assetCatalogUuid(workspaceId), normalized = normalizeAssetCatalogQuery(workspace, selection), query = new URLSearchParams({ workspaceId: workspace });
  if (normalized.query) query.set("q", normalized.query);
  if (normalized.role) query.set("role", normalized.role);
  if (normalized.cursor) query.set("cursor", selection.cursor!);
  return `/assets?${query.toString()}`;
}
