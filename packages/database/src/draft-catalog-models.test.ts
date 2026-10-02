import { describe, expect, it, vi } from "vitest";
import { DRAFT_STATUSES } from "@market-me/domain";
import type { DatabaseClient } from "./client";
import { encodeContentCatalogCursor } from "./content-catalog-models";
import { DRAFT_CATALOG_LIMITS, draftCatalogUuid, encodeDraftCatalogCursor, normalizeDraftCatalogQuery } from "./draft-catalog-models";
import { DraftCatalogRepository } from "./draft-catalog-repository";
const workspace = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", at = "2026-10-02T05:00:00.123456Z";
describe("draft catalog selection and cursor contract", () => {
  it("preserves literal Unicode/query syntax while normalizing outer spaces and UUID case", () => {
    expect(draftCatalogUuid(workspace)).toBe(workspace.toLowerCase());
    expect(normalizeDraftCatalogQuery(workspace, { query: "  café_%\\'  ", status: "all" })).toEqual({ query: "café_%\\'", status: null });
    expect(Object.isFrozen(DRAFT_CATALOG_LIMITS)).toBe(true);
  });
  it.each(DRAFT_STATUSES)("admits recorded status %s", status => expect(normalizeDraftCatalogQuery(workspace, { status }).status).toBe(status));
  it.each([null, [], "query", { query: [] }, { query: null }, { query: "x".repeat(121) }, { query: "a\nb" }, { query: "a\u200bb" }, { status: "__proto__" }, { status: [] }, { actorUserId: id }, { pageSize: 1000 }, { cursor: "" }])("rejects malformed or expanded selection %j", input => expect(() => normalizeDraftCatalogQuery(workspace, input)).toThrow());
  it("binds exact microseconds to the workspace, normalized selection and draft domain", () => {
    const filters = { query: "café", status: "approved" as const }, cursor = encodeDraftCatalogCursor(workspace, filters, { at, id });
    expect(normalizeDraftCatalogQuery(workspace.toLowerCase(), { ...filters, cursor })).toEqual({ ...filters, cursor: { at, id } });
    for (const [scope, selection] of [[id, filters], [workspace, { query: "other", status: "approved" }], [workspace, { query: "café", status: "working" }]] as const) expect(() => normalizeDraftCatalogQuery(scope, { ...selection, cursor })).toThrow("another selection");
    expect(() => normalizeDraftCatalogQuery(workspace, { ...filters, cursor: encodeContentCatalogCursor(workspace, filters, { at, id }) })).toThrow("another selection");
  });
  it.each(["2026-02-30T00:00:00.000000Z", "2026-10-02T24:00:00.000000Z", "2026-10-02T05:00:00.123Z", "2026-10-02T05:00:00.123456+00:00", "not-a-date"])("rejects noncanonical timestamp %s", value => expect(() => encodeDraftCatalogCursor(workspace, { query: "", status: null }, { at: value, id })).toThrow());
  it.each(["x".repeat(513), "=", "[]", Buffer.from("null").toString("base64url"), Buffer.from("{}").toString("base64url"), Buffer.from("false").toString("base64url")])("rejects corrupt cursor %s", cursor => expect(() => normalizeDraftCatalogQuery(workspace, { cursor })).toThrow());
  it("rejects changed shape/version/timestamp/ID and padded encoding", () => {
    const cursor = encodeDraftCatalogCursor(workspace, { query: "", status: null }, { at, id }), value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    for (const patch of [{ v: 2 }, { at: "2026-02-30T00:00:00.000000Z" }, { id: "bad" }, { extra: true }]) expect(() => normalizeDraftCatalogQuery(workspace, { cursor: Buffer.from(JSON.stringify({ ...value, ...patch })).toString("base64url") })).toThrow();
    expect(() => normalizeDraftCatalogQuery(workspace, { cursor: cursor + "=" })).toThrow();
  });
  it.each(["workspace", "actor", "filter"])("rejects invalid %s before SQL", async field => {
    const sql = vi.fn(), repo = new DraftCatalogRepository(sql as unknown as DatabaseClient);
    await expect(repo.getPage(field === "workspace" ? "bad" : workspace, field === "actor" ? "bad" : id, field === "filter" ? { status: "unknown" } : {})).rejects.toThrow(); expect(sql).not.toHaveBeenCalled();
  });
  it("returns missing scope, preserves infrastructure errors and bounds UTF-8 before decoding", async () => {
    const sql = vi.fn().mockResolvedValue([]), repo = new DraftCatalogRepository(sql as unknown as DatabaseClient);
    expect(await repo.getPage(workspace, id)).toBeUndefined();
    sql.mockRejectedValueOnce(new Error("synthetic failure")); await expect(repo.getPage(workspace, id)).rejects.toThrow("synthetic failure");
    sql.mockResolvedValue([{ snapshot: JSON.stringify({ body: "😀".repeat(DRAFT_CATALOG_LIMITS.responseBytes / 4) }) }]); await expect(repo.getPage(workspace, id)).rejects.toThrow("safe display limit");
  });
});
