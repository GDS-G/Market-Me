import { describe, expect, it } from "vitest";
import { encodeContentCatalogCursor } from "@market-me/database";
import { PACKAGE_STATUSES } from "@market-me/domain";
import { CONTENT_CATALOG_STATUS_LABELS, catalogCount, contentCatalogPath, contentCatalogSelection, hiddenCatalogFiles } from "./content-catalog-view";
const workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
describe("Content Package catalog presentation contracts", () => {
  it("provides an immutable honest label for every stored status", () => {
    expect(Object.keys(CONTENT_CATALOG_STATUS_LABELS)).toEqual(PACKAGE_STATUSES); expect(Object.isFrozen(CONTENT_CATALOG_STATUS_LABELS)).toBe(true);
    expect(CONTENT_CATALOG_STATUS_LABELS.ready).toBe("Ready for review"); expect(CONTENT_CATALOG_STATUS_LABELS.completed).toBe("Marked completed");
  });
  it("normalizes a default/empty/all selection without adding cursor or extra authority", () => {
    expect(contentCatalogSelection({}, workspace)).toEqual({ query: "" }); expect(contentCatalogSelection({ q: "  ", status: "all", workspaceId: workspace }, workspace)).toEqual({ query: "" });
    expect(contentCatalogPath(workspace)).toBe(`/content-packages?workspaceId=${workspace}`);
  });
  it("constructs safely encoded scoped links and round-trips the exact cursor", () => {
    const query = "café & ' _%", status = "needs_review", cursor = encodeContentCatalogCursor(workspace, { query, status }, { at: "2026-10-02T05:00:00.123456Z", id });
    const path = contentCatalogPath(workspace.toUpperCase(), { query, status, cursor }), decoded = Object.fromEntries(new URL(path, "https://example.invalid").searchParams);
    expect(contentCatalogSelection(decoded, workspace)).toEqual({ query, status, cursor }); expect(path).toContain("q=caf%C3%A9"); expect(path).not.toContain(" ");
  });
  it.each([{ workspaceId: id }, { q: ["a", "b"] }, { workspaceId: [workspace] }, { status: "unknown" }, { query: "not-q" }, { actor: id }, { cursor: "bad" }])("rejects invalid query %j", query => {
    expect(() => contentCatalogSelection(query, workspace)).toThrow();
  });
  it("rejects stale cursor context when a filter or workspace changes", () => {
    const cursor = encodeContentCatalogCursor(workspace, { query: "café", status: null }, { at: "2026-10-02T05:00:00.123456Z", id });
    expect(() => contentCatalogPath(workspace, { query: "other", cursor })).toThrow(); expect(() => contentCatalogSelection({ q: "café", cursor }, id)).toThrow();
  });
  it("renders and subtracts exact counts beyond safe integer precision", () => {
    expect(catalogCount("9007199254740995")).toBe("9,007,199,254,740,995"); expect(hiddenCatalogFiles("9007199254740995", 3)).toBe("9007199254740992"); expect(hiddenCatalogFiles("0", 0)).toBe("0");
  });
  it.each(["-1", "01", "1.1", "1e2", "NaN", " 1", "1".repeat(129)])("rejects incompatible count %s", value => { expect(() => catalogCount(value)).toThrow(); });
  it.each([-1, 0.5, NaN, Infinity, 4])("rejects invalid filename preview count %s", shown => { expect(() => hiddenCatalogFiles("3", shown)).toThrow(); });
});
