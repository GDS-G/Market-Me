import { describe, expect, it } from "vitest";
import { encodeDraftCatalogCursor } from "@market-me/database";
import { DRAFT_STATUSES } from "@market-me/domain";
import { DRAFT_CATALOG_STATUS_LABELS, draftCatalogPath, draftCatalogSelection } from "./draft-catalog-view";
const workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
describe("draft catalog presentation contracts", () => {
  it("has an immutable honest label for every recorded draft status", () => {
    expect(Object.keys(DRAFT_CATALOG_STATUS_LABELS)).toEqual(DRAFT_STATUSES); expect(Object.isFrozen(DRAFT_CATALOG_STATUS_LABELS)).toBe(true);
    expect(DRAFT_CATALOG_STATUS_LABELS.approved).toBe("Approved record"); expect(DRAFT_CATALOG_STATUS_LABELS.archived).toBe("Archived record");
  });
  it("normalizes default/empty/all selections without extra authority", () => {
    expect(draftCatalogSelection({}, workspace)).toEqual({ query: "" }); expect(draftCatalogSelection({ q: "  ", status: "all", workspaceId: workspace }, workspace)).toEqual({ query: "" });
    expect(draftCatalogPath(workspace)).toBe(`/drafts?workspaceId=${workspace}`);
  });
  it("encodes labels and round trips the exact microsecond cursor", () => {
    const query = "café & ' _%", status = "pending_review", cursor = encodeDraftCatalogCursor(workspace, { query, status }, { at: "2026-10-02T05:00:00.123456Z", id });
    const path = draftCatalogPath(workspace.toUpperCase(), { query, status, cursor });
    expect(draftCatalogSelection(Object.fromEntries(new URL(path, "https://example.invalid").searchParams), workspace)).toEqual({ query, status, cursor }); expect(path).toContain("q=caf%C3%A9"); expect(path).not.toContain(" ");
  });
  it.each([{ workspaceId: id }, { q: ["a", "b"] }, { workspaceId: [workspace] }, { status: ["working"] }, { status: "unknown" }, { query: "not-q" }, { actor: id }, { cursor: "bad" }])("rejects invalid browser selection %j", query => expect(() => draftCatalogSelection(query, workspace)).toThrow());
  it("rejects a stale cursor after filter or workspace changes", () => {
    const cursor = encodeDraftCatalogCursor(workspace, { query: "café", status: null }, { at: "2026-10-02T05:00:00.123456Z", id });
    expect(() => draftCatalogPath(workspace, { query: "other", cursor })).toThrow(); expect(() => draftCatalogSelection({ q: "café", cursor }, id)).toThrow();
  });
});
