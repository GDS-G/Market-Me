import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AiRepository } from "./ai-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("AI budget alerts", () => {
  afterAll(async () => sql?.end());

  it("creates deduplicated threshold notices and acknowledges them tenant-safely", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const ai = new AiRepository(sql);
    const suffix = randomUUID();
    const owner = await core.bootstrapDevelopmentWorkspace({
      email: `budget-alert-owner-${suffix}@market-me.local`,
      displayName: "Budget Alert Owner",
    });
    const viewer = await core.bootstrapDevelopmentWorkspace({
      email: `budget-alert-viewer-${suffix}@market-me.local`,
      displayName: "Budget Alert Viewer",
    });
    const campaignId = randomUUID();
    const asOf = new Date("2026-08-07T12:00:00.000Z");
    const reservations: string[] = [];

    try {
      await sql`
        INSERT INTO workspace_membership (workspace_id, user_id, role)
        VALUES (${owner.workspace.workspaceId}, ${viewer.user.id}, 'viewer')
      `;
      await sql`
        INSERT INTO campaign (id, workspace_id, name, created_by)
        VALUES (${campaignId}, ${owner.workspace.workspaceId}, 'Alert test', ${owner.user.id})
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
          campaignBudgetMinor: 80,
          monthlyBudgetMinor: 200,
          alertThresholdPercentages: [50, 80, 100],
        },
        owner.user.id,
      );

      const reserve = async (estimatedCostMinor: number, campaign = true) => {
        const reservation = await ai.reserveSpend(
          {
            workspaceId: owner.workspace.workspaceId,
            ...(campaign ? { campaignId } : {}),
            idempotencyKey: randomUUID(),
            capability: "generate_text",
            feature: "alert_test_feature",
            currency: "USD",
            estimatedCostMinor,
          },
          owner.user.id,
          asOf,
        );
        expect(reservation.status).toBe("reserved");
        reservations.push(reservation.id);
        return reservation;
      };

      await reserve(40);
      await reserve(20);
      await reserve(10);
      await reserve(30, false);

      const alerts = await ai.listBudgetAlerts(owner.workspace.workspaceId, "USD");
      expect(
        alerts.map((alert) => `${alert.scope}:${alert.thresholdPercentage}`).sort(),
      ).toEqual([
        "campaign:50",
        "campaign:80",
        "daily:100",
        "daily:50",
        "daily:80",
        "monthly:50",
      ]);
      expect(alerts.every((alert) => alert.status === "open")).toBe(true);
      expect(alerts.every((alert) => alert.sourceReservationId)).toBe(true);

      await expect(
        ai.acknowledgeBudgetAlert(
          owner.workspace.workspaceId,
          alerts[0]!.id,
          viewer.user.id,
          asOf,
        ),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      await expect(
        ai.acknowledgeBudgetAlert(
          viewer.workspace.workspaceId,
          alerts[0]!.id,
          viewer.user.id,
          asOf,
        ),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      const acknowledged = await ai.acknowledgeBudgetAlert(
        owner.workspace.workspaceId,
        alerts[0]!.id,
        owner.user.id,
        asOf,
      );
      expect(acknowledged).toMatchObject({
        status: "acknowledged",
        acknowledgedBy: owner.user.id,
        acknowledgedAt: asOf.toISOString(),
      });
      expect(
        await ai.acknowledgeBudgetAlert(
          owner.workspace.workspaceId,
          alerts[0]!.id,
          owner.user.id,
          new Date("2026-08-07T12:01:00.000Z"),
        ),
      ).toEqual(acknowledged);

      for (const reservationId of reservations)
        await ai.releaseSpend(
          owner.workspace.workspaceId,
          reservationId,
          owner.user.id,
          new Date("2026-08-07T12:02:00.000Z"),
        );
      await reserve(60, false);
      expect(
        await ai.listBudgetAlerts(owner.workspace.workspaceId, "USD"),
      ).toHaveLength(6);

      const audits = await sql<
        { eventType: string; data: Record<string, unknown> }[]
      >`
        SELECT event_type, data FROM audit_event
        WHERE workspace_id = ${owner.workspace.workspaceId}
          AND event_type LIKE 'ai.budget_alert_%'
        ORDER BY created_at, id
      `;
      expect(
        audits.filter((item) => item.eventType === "ai.budget_alert_created"),
      ).toHaveLength(6);
      expect(
        audits.filter(
          (item) => item.eventType === "ai.budget_alert_acknowledged",
        ),
      ).toHaveLength(1);
      expect(JSON.stringify(audits)).not.toContain("alert_test_feature");
    } finally {
      await sql`
        DELETE FROM organization
        WHERE id IN (${owner.workspace.organizationId}, ${viewer.workspace.organizationId})
      `;
      await sql`DELETE FROM app_user WHERE id IN (${owner.user.id}, ${viewer.user.id})`;
    }
  });
});
