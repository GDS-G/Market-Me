import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "./client";
import { encodeContentCatalogCursor } from "./content-catalog-models";
import { encodeDraftCatalogCursor } from "./draft-catalog-models";
import { ASSET_CATALOG_LIMITS, ASSET_CATALOG_ROLES, assetCatalogUuid, encodeAssetCatalogCursor, normalizeAssetCatalogQuery } from "./asset-catalog-models";
import { AssetCatalogRepository } from "./asset-catalog-repository";
const workspace = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", at = "2026-10-02T05:00:00.123456Z";
describe("asset inventory selection and cursor contract", () => {
  it("preserves literal Unicode syntax and normalizes outer spaces and workspace case", () => {
    expect(assetCatalogUuid(workspace)).toBe(workspace.toLowerCase());
    expect(normalizeAssetCatalogQuery(workspace, { query: "  café_%\\'  ", role: "all" })).toEqual({ query: "café_%\\'", role: null });
    expect(Object.isFrozen(ASSET_CATALOG_LIMITS)).toBe(true); expect(Object.isFrozen(ASSET_CATALOG_ROLES)).toBe(true);
  });
  it.each(ASSET_CATALOG_ROLES)("admits existing stored role %s", role => expect(normalizeAssetCatalogQuery(workspace, { role }).role).toBe(role));
  it.each([null, [], "query", { query: [] }, { query: null }, { query: "x".repeat(121) }, { query: "a\nb" }, { query: "a\u200bb" }, { role: "__proto__" }, { role: [] }, { status: "clean" }, { actorUserId: id }, { pageSize: 1000 }, { cursor: "" }])("rejects malformed or expanded selection %j", input => expect(() => normalizeAssetCatalogQuery(workspace, input)).toThrow());
  it("binds exact added-time microseconds to workspace, filters and the asset domain", () => {
    const filters = { query: "café", role: "original" as const }, cursor = encodeAssetCatalogCursor(workspace, filters, { at, id });
    expect(normalizeAssetCatalogQuery(workspace.toLowerCase(), { ...filters, cursor })).toEqual({ ...filters, cursor: { at, id } });
    for (const [scope, selection] of [[id, filters], [workspace, { query: "other", role: "original" }], [workspace, { query: "café", role: "derivative" }]] as const) expect(() => normalizeAssetCatalogQuery(scope, { ...selection, cursor })).toThrow("another selection");
    for (const other of [encodeContentCatalogCursor(workspace, { query: "", status: null }, { at, id }), encodeDraftCatalogCursor(workspace, { query: "", status: null }, { at, id })]) expect(() => normalizeAssetCatalogQuery(workspace, { cursor: other })).toThrow("another selection");
  });
  it.each(["2026-02-30T00:00:00.000000Z", "2026-10-02T24:00:00.000000Z", "2026-10-02T05:00:00.123Z", "2026-10-02T05:00:00.123456+00:00", "not-a-date"])("rejects noncanonical timestamp %s", value => expect(() => encodeAssetCatalogCursor(workspace, { query: "", role: null }, { at: value, id })).toThrow());
  it.each(["x".repeat(513), "=", "[]", Buffer.from("null").toString("base64url"), Buffer.from("{}").toString("base64url"), Buffer.from("false").toString("base64url")])("rejects corrupt cursor %s", cursor => expect(() => normalizeAssetCatalogQuery(workspace, { cursor })).toThrow());
  it("rejects changed shape/version/time/ID and padded encoding", () => {
    const cursor = encodeAssetCatalogCursor(workspace, { query: "", role: null }, { at, id }), value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    for (const patch of [{ v: 2 }, { at: "2026-02-30T00:00:00.000000Z" }, { id: "bad" }, { extra: true }]) expect(() => normalizeAssetCatalogQuery(workspace, { cursor: Buffer.from(JSON.stringify({ ...value, ...patch })).toString("base64url") })).toThrow();
    expect(() => normalizeAssetCatalogQuery(workspace, { cursor: cursor + "=" })).toThrow();
  });
  it.each(["workspace", "actor", "filter"])("rejects invalid %s before SQL", async field => {
    const sql = vi.fn(), repo = new AssetCatalogRepository(sql as unknown as DatabaseClient);
    await expect(repo.getPage(field === "workspace" ? "bad" : workspace, field === "actor" ? "bad" : id, field === "filter" ? { role: "unknown" } : {})).rejects.toThrow(); expect(sql).not.toHaveBeenCalled();
  });
  it("returns missing scope, preserves infrastructure errors and bounds UTF-8 before decoding", async () => {
    const sql = vi.fn().mockResolvedValue([]), repo = new AssetCatalogRepository(sql as unknown as DatabaseClient);
    expect(await repo.getPage(workspace, id)).toBeUndefined(); sql.mockRejectedValueOnce(new Error("synthetic failure")); await expect(repo.getPage(workspace, id)).rejects.toThrow("synthetic failure");
    sql.mockResolvedValue([{ snapshot: JSON.stringify({ fileName: "😀".repeat(ASSET_CATALOG_LIMITS.responseBytes / 4) }) }]); await expect(repo.getPage(workspace, id)).rejects.toThrow("safe display limit");
  });
});
