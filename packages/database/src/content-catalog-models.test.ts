import { describe, expect, it, vi } from "vitest";
import { PACKAGE_STATUSES } from "@market-me/domain";
import type { DatabaseClient } from "./client";
import { CONTENT_CATALOG_LIMITS, contentCatalogUuid, encodeContentCatalogCursor, normalizeContentCatalogQuery } from "./content-catalog-models";
import { ContentCatalogRepository } from "./content-catalog-repository";
const workspace = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", at = "2026-10-02T05:00:00.123456Z";
describe("content catalog filters and keyset cursors", () => {
  it("normalizes outer search whitespace and UUID case without changing literal search characters", () => {
    expect(contentCatalogUuid(workspace)).toBe(workspace.toLowerCase()); expect(normalizeContentCatalogQuery(workspace, { query: "  café_%\\'  ", status: "all" })).toEqual({ query: "café_%\\'", status: null });
    expect(Object.isFrozen(CONTENT_CATALOG_LIMITS)).toBe(true);
  });
  it.each(PACKAGE_STATUSES)("admits the existing %s status", status => { expect(normalizeContentCatalogQuery(workspace, { status }).status).toBe(status); });
  it.each([null, [], "query", { query: [] }, { query: null }, { query: "x".repeat(121) }, { query: "line\nbreak" }, { query: "in\u200bvisible" }, { status: "__proto__" }, { status: [] }, { actorUserId: id }, { pageSize: 1000 }, { cursor: "" }])("rejects malformed or expanded selection %j", input => {
    expect(() => normalizeContentCatalogQuery(workspace, input)).toThrow();
  });
  it("preserves exact microseconds and binds a cursor to workspace and normalized query/status", () => {
    const filters = { query: "café", status: "ready" as const }, cursor = encodeContentCatalogCursor(workspace, filters, { at, id });
    expect(normalizeContentCatalogQuery(workspace.toLowerCase(), { ...filters, cursor })).toEqual({ ...filters, cursor: { at, id } });
    expect(() => normalizeContentCatalogQuery(id, { ...filters, cursor })).toThrow("another selection");
    expect(() => normalizeContentCatalogQuery(workspace, { query: "other", status: "ready", cursor })).toThrow("another selection");
    expect(() => normalizeContentCatalogQuery(workspace, { query: "café", status: "approved", cursor })).toThrow("another selection");
  });
  it.each(["2026-02-30T00:00:00.000000Z", "2026-10-02T24:00:00.000000Z", "2026-10-02T05:00:00.123Z", "2026-10-02T05:00:00.123456+00:00", "not-a-date"])("rejects noncanonical cursor time %s", value => {
    expect(() => encodeContentCatalogCursor(workspace, { query: "", status: null }, { at: value, id })).toThrow();
  });
  it.each(["x".repeat(513), "=", "[]", Buffer.from("null").toString("base64url"), Buffer.from("{}").toString("base64url"), Buffer.from("false").toString("base64url")])("rejects corrupt cursor %s", cursor => {
    expect(() => normalizeContentCatalogQuery(workspace, { cursor })).toThrow();
  });
  it("rejects changed cursor shape/version/timestamp/ID and padded encoding", () => {
    const encoded = encodeContentCatalogCursor(workspace, { query: "", status: null }, { at, id }), value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    for (const patch of [{ v: 2 }, { at: "2026-02-30T00:00:00.000000Z" }, { id: "bad" }, { extra: true }]) expect(() => normalizeContentCatalogQuery(workspace, { cursor: Buffer.from(JSON.stringify({ ...value, ...patch })).toString("base64url") })).toThrow();
    expect(() => normalizeContentCatalogQuery(workspace, { cursor: encoded + "=" })).toThrow();
  });
  it.each(["workspace", "actor", "filter"])("rejects invalid %s before querying", async field => {
    const sql = vi.fn(), repository = new ContentCatalogRepository(sql as unknown as DatabaseClient);
    await expect(repository.getPage(field === "workspace" ? "bad" : workspace, field === "actor" ? "bad" : id, field === "filter" ? { status: "unknown" } : {})).rejects.toThrow(); expect(sql).not.toHaveBeenCalled();
  });
  it("returns undefined for missing scope, propagates database errors and bounds UTF-8 before decoding", async () => {
    const sql = vi.fn().mockResolvedValue([]), repo = new ContentCatalogRepository(sql as unknown as DatabaseClient); expect(await repo.getPage(workspace, id)).toBeUndefined();
    sql.mockRejectedValueOnce(new Error("synthetic error")); await expect(repo.getPage(workspace, id)).rejects.toThrow("synthetic error");
    sql.mockResolvedValue([{ snapshot: JSON.stringify({ title: "😀".repeat(CONTENT_CATALOG_LIMITS.responseBytes / 4) }) }]); await expect(repo.getPage(workspace, id)).rejects.toThrow("safe display limit");
  });
});
