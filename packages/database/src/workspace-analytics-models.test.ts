import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "./client";
import { WORKSPACE_ANALYTICS_LIMITS, workspaceAnalyticsUuid } from "./workspace-analytics-models";
import { WorkspaceAnalyticsRepository } from "./workspace-analytics-repository";
const id = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
describe("analytics scope and exact response bounds", () => {
  it("normalizes UUID case without trimming or accepting arbitrary identifiers", () => {
    expect(workspaceAnalyticsUuid(id)).toBe(id.toLowerCase());
    expect(Object.isFrozen(WORKSPACE_ANALYTICS_LIMITS)).toBe(true);
  });
  it.each([undefined, null, 2, {}, [], "", "id", ` ${id}`, `${id} `, "00000000-0000-0000-0000-000000000000"])("rejects invalid identifiers %j", value => {
    expect(() => workspaceAnalyticsUuid(value)).toThrow("Choose a valid");
  });
  it.each(["workspace", "actor", "campaign"])("rejects invalid %s before SQL", async invalid => {
    const sql = vi.fn(), repo = new WorkspaceAnalyticsRepository(sql as unknown as DatabaseClient);
    await expect(repo.getSnapshot(invalid === "workspace" ? "bad" : id, invalid === "actor" ? "bad" : id, invalid === "campaign" ? "bad" : undefined)).rejects.toThrow("Choose a valid");
    expect(sql).not.toHaveBeenCalled();
  });
  it("fails closed for a byte-oversized response without truncation or numeric coercion", async () => {
    const sql = vi.fn().mockResolvedValue([{ snapshot: JSON.stringify({ value: "🚀".repeat(WORKSPACE_ANALYTICS_LIMITS.responseBytes / 4) }) }]);
    await expect(new WorkspaceAnalyticsRepository(sql as unknown as DatabaseClient).getSnapshot(id, id)).rejects.toThrow("safe display limit");
  });
  it("propagates database errors instead of manufacturing an empty workspace", async () => {
    const sql = vi.fn().mockRejectedValue(new Error("synthetic database failure"));
    await expect(new WorkspaceAnalyticsRepository(sql as unknown as DatabaseClient).getSnapshot(id, id)).rejects.toThrow("synthetic database failure");
  });
});
