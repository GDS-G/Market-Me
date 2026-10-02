import { contentCatalogUuid, normalizeContentCatalogQuery } from "@market-me/database";
import type { ContentPackageStatus } from "@market-me/domain";

export interface ContentCatalogSelection { query: string; status?: ContentPackageStatus; cursor?: string }
export const CONTENT_CATALOG_STATUS_LABELS: Readonly<Record<ContentPackageStatus, string>> = Object.freeze({
  detecting: "Detected", stabilizing: "Waiting for stable files", analyzing: "Analyzing", needs_review: "Needs review", ready: "Ready for review", approved: "Approved record", executing: "In progress", completed: "Marked completed", failed: "Could not complete",
});
export function contentCatalogSelection(query: Record<string, string | string[] | undefined>, workspaceId: string): ContentCatalogSelection {
  const workspace = contentCatalogUuid(workspaceId);
  if (Object.keys(query).some(key => !["workspaceId", "q", "status", "cursor"].includes(key))) throw new Error("Unsupported catalog query.");
  if (query.workspaceId !== undefined && contentCatalogUuid(query.workspaceId) !== workspace) throw new Error("Different workspace.");
  const normalized = normalizeContentCatalogQuery(workspace, { query: query.q, status: query.status, cursor: query.cursor });
  return { query: normalized.query, ...(normalized.status ? { status: normalized.status } : {}), ...(normalized.cursor ? { cursor: query.cursor as string } : {}) };
}
export function contentCatalogPath(workspaceId: string, selection: ContentCatalogSelection = { query: "" }): string {
  const workspace = contentCatalogUuid(workspaceId), normalized = normalizeContentCatalogQuery(workspace, selection), query = new URLSearchParams({ workspaceId: workspace });
  if (normalized.query) query.set("q", normalized.query);
  if (normalized.status) query.set("status", normalized.status);
  if (normalized.cursor) query.set("cursor", selection.cursor!);
  return `/content-packages?${query.toString()}`;
}
export function catalogCount(value: string): string {
  if (typeof value !== "string" || value.length > 128 || !/^(?:0|[1-9]\d*)$/.test(value)) throw new Error("Invalid catalog count.");
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
export function hiddenCatalogFiles(count: string, shown: number): string {
  catalogCount(count); if (!Number.isInteger(shown) || shown < 0 || BigInt(count) < BigInt(shown)) throw new Error("Invalid filename coverage.");
  return (BigInt(count) - BigInt(shown)).toString();
}
