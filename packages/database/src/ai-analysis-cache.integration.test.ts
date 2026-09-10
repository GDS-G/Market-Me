import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AiRepository } from "./ai-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("AI analysis cache", () => {
  afterAll(async () => sql?.end());

  it("reuses only exact unexpired keys and keeps payloads server-side", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const ai = new AiRepository(sql);
    const suffix = randomUUID();
    const owner = await core.bootstrapDevelopmentWorkspace({
      email: `cache-owner-${suffix}@market-me.local`,
      displayName: "Cache Owner",
    });
    const viewer = await core.bootstrapDevelopmentWorkspace({
      email: `cache-viewer-${suffix}@market-me.local`,
      displayName: "Cache Viewer",
    });
    const started = new Date("2026-08-07T12:00:00.000Z");
    const key = {
      workspaceId: owner.workspace.workspaceId,
      capability: "generate_structured_output" as const,
      feature: "content_understanding",
      contentHash: "a".repeat(64),
      modelFamily: "market-me-grounded",
      promptVersion: "content-analysis-v1",
      contextRevision: "context-pack-v3",
    };

    try {
      await sql`
        INSERT INTO workspace_membership (workspace_id, user_id, role)
        VALUES (${owner.workspace.workspaceId}, ${viewer.user.id}, 'viewer')
      `;
      await expect(
        ai.storeCachedAnalysis(
          { ...key, result: { claims: ["one"] }, ttlSeconds: 60 },
          viewer.user.id,
          started,
        ),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });

      const stored = await ai.storeCachedAnalysis(
        {
          ...key,
          result: { z: 1, claims: ["one"], nested: { b: true, a: null } },
          ttlSeconds: 60,
        },
        owner.user.id,
        started,
      );
      expect(stored).toMatchObject({
        result: { claims: ["one"], nested: { a: null, b: true }, z: 1 },
        hitCount: 0,
        resultBytes: expect.any(Number),
        resultHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      });

      const firstWins = await ai.storeCachedAnalysis(
        { ...key, result: { claims: ["replacement"] }, ttlSeconds: 120 },
        owner.user.id,
        new Date("2026-08-07T12:00:30.000Z"),
      );
      expect(firstWins.result).toMatchObject({ claims: ["one"] });
      expect(
        await ai.getCachedAnalysis(
          key,
          new Date("2026-08-07T12:00:40.000Z"),
        ),
      ).toMatchObject({ hitCount: 1, result: { claims: ["one"] } });
      expect(
        await ai.getCachedAnalysis(
          { ...key, contextRevision: "context-pack-v4" },
          new Date("2026-08-07T12:00:40.000Z"),
        ),
      ).toBeUndefined();

      expect(
        await ai.getAnalysisCacheSummary(
          owner.workspace.workspaceId,
          new Date("2026-08-07T12:00:45.000Z"),
        ),
      ).toMatchObject({
        activeEntryCount: 1,
        totalHitCount: 1,
        totalResultBytes: stored.resultBytes,
        lastHitAt: "2026-08-07T12:00:40.000Z",
      });
      expect(
        await ai.getCachedAnalysis(
          key,
          new Date("2026-08-07T12:01:01.000Z"),
        ),
      ).toBeUndefined();
      const refreshed = await ai.storeCachedAnalysis(
        { ...key, result: { claims: ["replacement"] }, ttlSeconds: 60 },
        owner.user.id,
        new Date("2026-08-07T12:01:01.000Z"),
      );
      expect(refreshed).toMatchObject({
        result: { claims: ["replacement"] },
        hitCount: 0,
      });

      await expect(
        ai.storeCachedAnalysis(
          { ...key, contentHash: "bad", result: {}, ttlSeconds: 60 },
          owner.user.id,
          started,
        ),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      await expect(
        ai.storeCachedAnalysis(
          { ...key, result: { invalid: Number.NaN }, ttlSeconds: 60 },
          owner.user.id,
          started,
        ),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });
    } finally {
      await sql`
        DELETE FROM organization
        WHERE id IN (${owner.workspace.organizationId}, ${viewer.workspace.organizationId})
      `;
      await sql`DELETE FROM app_user WHERE id IN (${owner.user.id}, ${viewer.user.id})`;
    }
  });
});
