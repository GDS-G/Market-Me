import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AiRepository } from "./ai-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("AI spend reservations", () => {
  afterAll(async () => sql?.end());

  it("authorizes, settles, releases, expires, and denies spend transactionally", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const ai = new AiRepository(sql);
    const suffix = randomUUID();
    const owner = await core.bootstrapDevelopmentWorkspace({
      email: `spend-owner-${suffix}@market-me.local`,
      displayName: "Spend Owner",
    });
    const viewer = await core.bootstrapDevelopmentWorkspace({
      email: `spend-viewer-${suffix}@market-me.local`,
      displayName: "Spend Viewer",
    });
    const campaignId = randomUUID();
    const asOf = new Date("2026-08-06T12:00:00.000Z");

    try {
      await sql`
        INSERT INTO workspace_membership (workspace_id, user_id, role)
        VALUES (${owner.workspace.workspaceId}, ${viewer.user.id}, 'viewer')
      `;
      await sql`
        INSERT INTO campaign (id, workspace_id, name, created_by)
        VALUES (${campaignId}, ${owner.workspace.workspaceId}, 'Spend test', ${owner.user.id})
      `;
      await ai.savePolicy(
        {
          workspaceId: owner.workspace.workspaceId,
          mode: "recommended",
          maximumPrivacyClass: "cloud",
          failoverMode: "ask_before_switching",
          capBehavior: "require_approval",
          currency: "USD",
          dailyBudgetMinor: 100,
          campaignBudgetMinor: 60,
          monthlyBudgetMinor: 120,
          alertThresholdPercentages: [50, 80, 100],
        },
        owner.user.id,
      );
      const crossBoundary = await ai.reserveSpend(
        {
          workspaceId: owner.workspace.workspaceId,
          idempotencyKey: randomUUID(),
          capability: "generate_text",
          feature: "boundary_preflight",
          currency: "USD",
          estimatedCostMinor: 20,
        },
        owner.user.id,
        new Date("2026-07-31T23:55:00.000Z"),
      );
      expect(
        await ai.getBudgetStatus(
          owner.workspace.workspaceId,
          "USD",
          new Date("2026-08-01T00:01:00.000Z"),
        ),
      ).toMatchObject({
        daily: { reservedMinor: 20 },
        monthly: { reservedMinor: 20 },
      });
      await ai.releaseSpend(
        owner.workspace.workspaceId,
        crossBoundary.id,
        owner.user.id,
        new Date("2026-08-01T00:02:00.000Z"),
      );
      const firstInput = {
        workspaceId: owner.workspace.workspaceId,
        campaignId,
        idempotencyKey: randomUUID(),
        capability: "generate_text" as const,
        feature: "private_launch_copy",
        currency: "USD",
        estimatedCostMinor: 40,
      };
      await expect(
        ai.reserveSpend(firstInput, viewer.user.id, asOf),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      const first = await ai.reserveSpend(firstInput, owner.user.id, asOf);
      expect(first).toMatchObject({ status: "reserved", estimatedCostMinor: 40 });
      expect(
        (await ai.reserveSpend(firstInput, owner.user.id, asOf)).id,
      ).toBe(first.id);
      await expect(
        ai.reserveSpend(
          { ...firstInput, estimatedCostMinor: 41 },
          owner.user.id,
          asOf,
        ),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });

      const campaignDenied = await ai.reserveSpend(
        { ...firstInput, idempotencyKey: randomUUID(), estimatedCostMinor: 30 },
        owner.user.id,
        asOf,
      );
      expect(campaignDenied).toMatchObject({
        status: "denied",
        exceededScopes: ["campaign"],
        capBehavior: "require_approval",
      });

      const settled = await ai.settleSpend(
        {
          workspaceId: owner.workspace.workspaceId,
          reservationId: first.id,
          actualCostMinor: 35,
          usage: {
            provider: "approved-cloud",
            model: "quality-model",
            privacyClass: "cloud",
            inputUnits: 100,
            outputUnits: 25,
            cachedInputUnits: 10,
            latencyMs: 250,
            promptVersion: "copy-v1",
          },
        },
        owner.user.id,
        new Date("2026-08-06T12:01:00.000Z"),
      );
      expect(settled).toMatchObject({ status: "settled", actualCostMinor: 35 });
      expect(
        await ai.settleSpend(
          {
            workspaceId: owner.workspace.workspaceId,
            reservationId: first.id,
            actualCostMinor: 35,
            usage: {
              provider: "ignored-on-idempotent-retry",
              model: "ignored",
              privacyClass: "cloud",
              inputUnits: 0,
              outputUnits: 0,
              cachedInputUnits: 0,
              latencyMs: 0,
            },
          },
          owner.user.id,
          new Date("2026-08-06T12:02:00.000Z"),
        ),
      ).toMatchObject({ status: "settled", actualCostMinor: 35 });

      const dailyDenied = await ai.reserveSpend(
        {
          ...firstInput,
          campaignId: undefined,
          idempotencyKey: randomUUID(),
          estimatedCostMinor: 70,
        },
        owner.user.id,
        new Date("2026-08-06T12:03:00.000Z"),
      );
      expect(dailyDenied).toMatchObject({
        status: "denied",
        exceededScopes: ["daily"],
      });

      const releasable = await ai.reserveSpend(
        {
          ...firstInput,
          campaignId: undefined,
          idempotencyKey: randomUUID(),
          estimatedCostMinor: 20,
        },
        owner.user.id,
        new Date("2026-08-06T12:04:00.000Z"),
      );
      expect(
        await ai.releaseSpend(
          owner.workspace.workspaceId,
          releasable.id,
          owner.user.id,
          new Date("2026-08-06T12:05:00.000Z"),
        ),
      ).toMatchObject({ status: "released" });

      const expiring = await ai.reserveSpend(
        {
          ...firstInput,
          campaignId: undefined,
          idempotencyKey: randomUUID(),
          estimatedCostMinor: 10,
        },
        owner.user.id,
        new Date("2026-08-06T12:06:00.000Z"),
      );
      expect(
        await ai.settleSpend(
          {
            workspaceId: owner.workspace.workspaceId,
            reservationId: expiring.id,
            actualCostMinor: 8,
            usage: {
              provider: "late",
              model: "late",
              privacyClass: "cloud",
              inputUnits: 1,
              outputUnits: 1,
              cachedInputUnits: 0,
              latencyMs: 1,
            },
          },
          owner.user.id,
          new Date("2026-08-06T12:22:00.000Z"),
        ),
      ).toMatchObject({ status: "expired" });

      const status = await ai.getBudgetStatus(
        owner.workspace.workspaceId,
        "USD",
        new Date("2026-08-06T12:23:00.000Z"),
      );
      expect(status).toMatchObject({
        activeReservationCount: 0,
        daily: { spentMinor: 35, reservedMinor: 0, capMinor: 100, availableMinor: 65 },
        monthly: { spentMinor: 35, reservedMinor: 0, capMinor: 120, availableMinor: 85 },
      });
      const usage = await ai.getCurrentMonthUsage(
        owner.workspace.workspaceId,
        "USD",
        new Date("2026-08-06T12:23:00.000Z"),
      );
      expect(usage).toMatchObject({ currentMonthCostMinor: 35, requestCount: 1 });
      const paidRows = await sql<{ count: number }[]>`
        SELECT count(*)::integer AS count FROM ai_usage_event
        WHERE workspace_id = ${owner.workspace.workspaceId}
          AND spend_reservation_id IS NOT NULL
      `;
      expect(paidRows[0]?.count).toBe(1);
      const audits = await sql<{ eventType: string; data: Record<string, unknown> }[]>`
        SELECT event_type, data FROM audit_event
        WHERE workspace_id = ${owner.workspace.workspaceId}
          AND event_type LIKE 'ai.spend_%'
        ORDER BY created_at, id
      `;
      expect(audits.map((item) => item.eventType)).toEqual(
        expect.arrayContaining([
          "ai.spend_reserved",
          "ai.spend_denied",
          "ai.spend_settled",
          "ai.spend_released",
        ]),
      );
      expect(JSON.stringify(audits)).not.toContain("private_launch_copy");
    } finally {
      await sql`
        DELETE FROM organization
        WHERE id IN (${owner.workspace.organizationId}, ${viewer.workspace.organizationId})
      `;
      await sql`DELETE FROM app_user WHERE id IN (${owner.user.id}, ${viewer.user.id})`;
    }
  });
});
