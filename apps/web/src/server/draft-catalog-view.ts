import { draftCatalogUuid, normalizeDraftCatalogQuery } from "@market-me/database";
import type { DraftStatus } from "@market-me/domain";

export interface DraftCatalogSelection { query: string; status?: DraftStatus; cursor?: string }
export const DRAFT_CATALOG_STATUS_LABELS: Readonly<Record<DraftStatus, string>> = Object.freeze({
  working: "Working copy", pending_review: "Awaiting review", approved: "Approved record", rejected: "Rejected record", changes_requested: "Changes requested", archived: "Archived record",
});
export function draftCatalogSelection(query: Record<string, string | string[] | undefined>, workspaceId: string): DraftCatalogSelection {
  const workspace = draftCatalogUuid(workspaceId);
  if (Object.keys(query).some(key => !["workspaceId", "q", "status", "cursor"].includes(key))) throw new Error("Unsupported draft query.");
  if (query.workspaceId !== undefined && draftCatalogUuid(query.workspaceId) !== workspace) throw new Error("Different workspace.");
  const normalized = normalizeDraftCatalogQuery(workspace, { query: query.q, status: query.status, cursor: query.cursor });
  return { query: normalized.query, ...(normalized.status ? { status: normalized.status } : {}), ...(normalized.cursor ? { cursor: query.cursor as string } : {}) };
}
export function draftCatalogPath(workspaceId: string, selection: DraftCatalogSelection = { query: "" }): string {
  const workspace = draftCatalogUuid(workspaceId), normalized = normalizeDraftCatalogQuery(workspace, selection), query = new URLSearchParams({ workspaceId: workspace });
  if (normalized.query) query.set("q", normalized.query);
  if (normalized.status) query.set("status", normalized.status);
  if (normalized.cursor) query.set("cursor", selection.cursor!);
  return `/drafts?${query.toString()}`;
}
