import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "@market-me/database";

vi.mock("server-only", () => ({}));
const url = process.env.DATABASE_URL;
if (url && new URL(url).pathname !== "/market_me_ci" && !new URL(url).pathname.startsWith("/market_me_qa_136_")) {
  throw new Error("Database lifecycle tests require isolated market_me_ci or market_me_qa_136_*.");
}
const clients = new Set<DatabaseClient>();
beforeEach(() => {
  vi.resetModules(); vi.stubGlobal("marketMeDatabase", undefined); vi.stubEnv("NODE_ENV", "production");
});
afterEach(async () => {
  await Promise.all([...clients].map(sql => sql.end({ timeout: 5 })));
  clients.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe.skipIf(!url)("live production database pool reuse", () => {
  it("reuses connections without retaining membership, workspace labels or other-actor authority", async () => {
    const databaseModule = await import("./database"), core = databaseModule.getRepository();
    const sql = (core as unknown as { sql: DatabaseClient }).sql; clients.add(sql);
    const { user, workspace } = await core.bootstrapDevelopmentWorkspace({
      email: `pool-lifecycle-${randomUUID()}@market-me.local`, displayName: "Synthetic pool lifecycle user",
    });
    try {
      const start = databaseModule.getWorkspaceStartRepository();
      expect((await start.getSnapshot(workspace.workspaceId, user.id))?.role).toBe("owner");
      await sql`UPDATE workspace_membership SET role='viewer' WHERE workspace_id=${workspace.workspaceId} AND user_id=${user.id}`;
      await sql`UPDATE workspace SET name='Changed synthetic workspace',settings_revision=settings_revision+1 WHERE id=${workspace.workspaceId}`;
      expect(databaseModule.getRepository()).toBe(core); expect(databaseModule.getWorkspaceStartRepository()).toBe(start);
      expect((await start.getSnapshot(workspace.workspaceId, user.id))?.role).toBe("viewer");
      expect(await core.getWorkspaceAccess(user.id, workspace.workspaceId)).toMatchObject({ role: "viewer", workspaceName: "Changed synthetic workspace" });
      expect(await start.getSnapshot(workspace.workspaceId, randomUUID())).toBeUndefined();
      await sql`DELETE FROM workspace_membership WHERE workspace_id=${workspace.workspaceId} AND user_id=${user.id}`;
      expect(await start.getSnapshot(workspace.workspaceId, user.id)).toBeUndefined();
      expect(await databaseModule.getRepository().listWorkspaceAccess(user.id)).toEqual([]);
    } finally {
      await sql`DELETE FROM organization WHERE id=${workspace.organizationId}`;
      await sql`DELETE FROM app_user WHERE id=${user.id}`;
    }
  });
  it("uses one client for repeated accessors and at most ten backends under bounded concurrency", async () => {
    const databaseModule = await import("./database");
    function client() {
      // Test-only inspection of the existing private SQL handle; no runtime export is added.
      const sql = (databaseModule.getRepository() as unknown as { sql: DatabaseClient }).sql;
      clients.add(sql); return sql;
    }
    const sequential = new Set<number>();
    for (let index = 0; index < 12; index++) {
      const rows = await client()`SELECT pg_backend_pid() AS pid`;
      sequential.add(rows[0]!.pid);
    }
    const concurrent = await Promise.all(Array.from({ length: 16 }, async () => {
      const rows = await client()`SELECT pg_backend_pid() AS pid, pg_sleep(0.025)`;
      return rows[0]!.pid as number;
    }));
    expect(clients.size).toBe(1); expect(sequential.size).toBe(1);
    expect(concurrent).toHaveLength(16); expect(new Set(concurrent).size).toBeLessThanOrEqual(10);
    vi.resetModules(); const reimported = await import("./database");
    expect(reimported.getRepository()).toBe(databaseModule.getRepository());
    expect(reimported.getPackageWorkRepository()).toBe(databaseModule.getPackageWorkRepository());
    expect(reimported.getWorkspaceAnalyticsRepository()).toBe(databaseModule.getWorkspaceAnalyticsRepository());
    expect(reimported.getContentCatalogRepository()).toBe(databaseModule.getContentCatalogRepository());
    expect(reimported.getDraftCatalogRepository()).toBe(databaseModule.getDraftCatalogRepository());
    expect(reimported.getAssetCatalogRepository()).toBe(databaseModule.getAssetCatalogRepository());
    expect(reimported.getAccountProfileRepository()).toBe(databaseModule.getAccountProfileRepository());
    expect(reimported.getAccountSessionRepository()).toBe(databaseModule.getAccountSessionRepository());
  });
});
