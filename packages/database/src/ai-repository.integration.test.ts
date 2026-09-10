import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AiRepository } from "./ai-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("AI gateway policy and usage", () => {
  afterAll(async () => sql?.end());

  it("persists governed routing policy and summarizes metadata-only usage", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const ai = new AiRepository(sql);
    const suffix = randomUUID();
    const owner = await core.bootstrapDevelopmentWorkspace({
      email: `ai-owner-${suffix}@market-me.local`,
      displayName: "AI Owner",
    });
    const viewer = await core.bootstrapDevelopmentWorkspace({
      email: `ai-viewer-${suffix}@market-me.local`,
      displayName: "AI Viewer",
    });

    try {
      await sql`
        INSERT INTO workspace_membership (workspace_id, user_id, role)
        VALUES (${owner.workspace.workspaceId}, ${viewer.user.id}, 'viewer')
      `;
      const input = {
        workspaceId: owner.workspace.workspaceId,
        mode: "private_local" as const,
        maximumPrivacyClass: "local" as const,
        failoverMode: "no_external_fallback" as const,
        capBehavior: "require_approval" as const,
        currency: "USD",
        dailyBudgetMinor: 500,
        campaignBudgetMinor: 2_500,
        monthlyBudgetMinor: 10_000,
        alertThresholdPercentages: [50, 80, 100],
      };
      await expect(ai.savePolicy(input, viewer.user.id)).rejects.toMatchObject({
        name: "AiPolicyValidationError",
      });
      expect(await ai.savePolicy(input, owner.user.id)).toMatchObject(input);

      await expect(
        ai.savePolicy(
          { ...input, alertThresholdPercentages: [80, 50] },
          owner.user.id,
        ),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });

      const first = await ai.recordUsage({
        workspaceId: owner.workspace.workspaceId,
        capability: "generate_text",
        feature: "content_writing",
        provider: "market-me",
        model: "grounded-template",
        privacyClass: "local",
        inputUnits: 120,
        outputUnits: 40,
        cachedInputUnits: 20,
        latencyMs: 12,
        estimatedCostMinor: 0,
        currency: "USD",
        promptVersion: "grounded-draft-v1",
        contentHash: "sha256:test",
        occurredAt: "2026-08-05T12:00:00.000Z",
      });
      await ai.recordUsage({
        workspaceId: owner.workspace.workspaceId,
        capability: "generate_structured_output",
        feature: "content_understanding",
        provider: "market-me",
        model: "grounded-template",
        privacyClass: "local",
        inputUnits: 80,
        outputUnits: 25,
        cachedInputUnits: 0,
        requestCount: 2,
        latencyMs: 20,
        estimatedCostMinor: 0,
        currency: "USD",
        occurredAt: "2026-08-06T12:00:00.000Z",
      });
      await ai.recordUsage({
        workspaceId: owner.workspace.workspaceId,
        capability: "generate_text",
        feature: "content_writing",
        provider: "market-me",
        model: "grounded-template",
        privacyClass: "local",
        inputUnits: 500,
        outputUnits: 50,
        cachedInputUnits: 0,
        latencyMs: 10,
        estimatedCostMinor: 0,
        currency: "USD",
        occurredAt: "2026-07-31T23:59:59.000Z",
      });
      expect(first).toMatchObject({
        feature: "content_writing",
        contentHash: "sha256:test",
      });
      expect(
        await ai.getCurrentMonthUsage(
          owner.workspace.workspaceId,
          "USD",
          new Date("2026-08-06T12:00:00.000Z"),
        ),
      ).toEqual({
        currency: "USD",
        currentMonthCostMinor: 0,
        requestCount: 3,
        inputUnits: 200,
        outputUnits: 65,
        cachedInputUnits: 20,
        averageLatencyMs: 16,
        byFeature: [
          { feature: "content_understanding", costMinor: 0, requestCount: 2 },
          { feature: "content_writing", costMinor: 0, requestCount: 1 },
        ],
      });
      await expect(
        ai.recordUsage({
          workspaceId: owner.workspace.workspaceId,
          capability: "generate_text",
          feature: "paid_bypass",
          provider: "external",
          model: "paid",
          privacyClass: "cloud",
          inputUnits: 1,
          outputUnits: 1,
          cachedInputUnits: 0,
          latencyMs: 1,
          estimatedCostMinor: 1,
          currency: "USD",
        }),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      const audits = await sql<{ data: Record<string, unknown> }[]>`
        SELECT data FROM audit_event
        WHERE workspace_id = ${owner.workspace.workspaceId}
          AND event_type = 'ai.policy_saved'
      `;
      expect(audits).toHaveLength(1);
      expect(JSON.stringify(audits)).not.toContain("sha256:test");
    } finally {
      await sql`
        DELETE FROM organization
        WHERE id IN (${owner.workspace.organizationId}, ${viewer.workspace.organizationId})
      `;
      await sql`DELETE FROM app_user WHERE id IN (${owner.user.id}, ${viewer.user.id})`;
    }
  });
});
