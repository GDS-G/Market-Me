import { describe, expect, it } from "vitest";
import { encodeAssetCatalogCursor } from "@market-me/database";
import { ASSET_ROLE_LABELS, ASSET_EXTRACTION_LABELS, ASSET_MEDIA_LABELS, ASSET_SCAN_LABELS, ASSET_RIGHTS_LABELS, assetCatalogBytes, assetCatalogPath, assetCatalogSelection } from "./asset-catalog-view";
const workspace = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", at = "2026-10-02T05:00:00.123456Z";
describe("asset inventory browser selection", () => {
  it("normalizes and URL-encodes literal metadata search with explicit scope", () => {
    expect(assetCatalogSelection({ q: " café & ", role: "original", workspaceId: workspace.toLowerCase() }, workspace)).toEqual({ query: "café &", role: "original" });
    expect(assetCatalogPath(workspace, { query: "café &", role: "original" })).toBe(`/assets?workspaceId=${workspace.toLowerCase()}&q=caf%C3%A9+%26&role=original`);
    expect(assetCatalogPath(workspace)).toBe(`/assets?workspaceId=${workspace.toLowerCase()}`);
  });
  it.each([{ workspaceId: id }, { workspaceId: [workspace] }, { q: ["one", "two"] }, { role: ["original"] }, { cursor: ["cursor"] }, { status: "clean" }, { q: "x".repeat(121) }, { role: "unknown" }])("rejects invalid browser selection %j", input => expect(() => assetCatalogSelection(input, workspace)).toThrow());
  it("preserves only validated matching cursor context", () => {
    const filters = { query: "café", role: "derivative" as const }, cursor = encodeAssetCatalogCursor(workspace, filters, { at, id });
    expect(assetCatalogSelection({ q: filters.query, role: filters.role, cursor }, workspace)).toEqual({ ...filters, cursor });
    expect(assetCatalogPath(workspace, { ...filters, cursor })).toContain("&cursor=" + cursor);
    expect(() => assetCatalogSelection({ q: "other", role: filters.role, cursor }, workspace)).toThrow();
  });
  it("keeps unknown size distinct from zero and large exact decimal bytes", () => {
    expect(assetCatalogBytes(null)).toBe("Unavailable"); expect(assetCatalogBytes("0")).toBe("0 bytes"); expect(assetCatalogBytes("9007199254740995")).toBe("9,007,199,254,740,995 bytes");
    for (const invalid of ["-1", "01", "1e4", "1.5", "NaN"]) expect(() => assetCatalogBytes(invalid)).toThrow();
  });
  it("keeps every recorded-state dictionary frozen and distinguishes recorded clearance", () => {
    for (const labels of [ASSET_ROLE_LABELS,ASSET_EXTRACTION_LABELS,ASSET_MEDIA_LABELS,ASSET_SCAN_LABELS,ASSET_RIGHTS_LABELS]) expect(Object.isFrozen(labels)).toBe(true);
    expect(ASSET_SCAN_LABELS.clean).toBe("Clean record"); expect(ASSET_RIGHTS_LABELS.cleared).toBe("Cleared record");
  });
});
