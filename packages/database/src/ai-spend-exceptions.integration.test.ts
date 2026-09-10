import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AiRepository } from "./ai-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("AI spend exception approvals", () => {
  afterAll(async () => sql?.end());

  it("approves and consumes one denied estimate with tenant and role controls", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const ai = new AiRepository(sql);
    const suffix = randomUUID();
    const owner = await core.bootstrapDevelopmentWorkspace({
      email: `spend-exception-owner-${suffix}@market-me.local`,
      displayName: "Spend Exception Owner",
    });
    const reviewer = await core.bootstrapDevelopmentWorkspace({
      email: `spend-exception-reviewer-${suffix}@market-me.local`,
      displayName: "Spend Exception Reviewer",
    });
    const asOf = new Date("2026-08-08T10:00:00.000Z");

    try {
      await sql`
        INSERT INTO workspace_membership (workspace_id, user_id, role)
        VALUES (${owner.workspace.workspaceId}, ${reviewer.user.id}, 'viewer')
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
          monthlyBudgetMinor: 200,
          alertThresholdPercentages: [50, 80, 100],
        },
        owner.user.id,
      );
      const initial = await ai.reserveSpend(
        {
          workspaceId: owner.workspace.workspaceId,
          idempotencyKey: randomUUID(),
          capability: "generate_text",
          feature: "approved_exception_feature",
          currency: "USD",
          estimatedCostMinor: 80,
        },
        owner.user.id,
        asOf,
      );
      expect(initial.status).toBe("reserved");
      const denied = await ai.reserveSpend(
        {
          workspaceId: owner.workspace.workspaceId,
          idempotencyKey: randomUUID(),
          capability: "generate_text",
          feature: "approved_exception_feature",
          currency: "USD",
          estimatedCostMinor: 30,
        },
        owner.user.id,
        new Date("2026-08-08T10:01:00.000Z"),
      );
      expect(denied).toMatchObject({
        status: "denied",
        exceededScopes: ["daily"],
        capBehavior: "require_approval",
      });
      const requestInput = {
        workspaceId: owner.workspace.workspaceId,
        deniedReservationId: denied.id,
        justification: "Customer launch requires one reviewed premium draft.",
      };
      await expect(
        ai.requestSpendException(requestInput, reviewer.user.id, asOf),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      await expect(
        ai.requestSpendException(
          { ...requestInput, workspaceId: reviewer.workspace.workspaceId },
          reviewer.user.id,
          asOf,
        ),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      const request = await ai.requestSpendException(
        requestInput,
        owner.user.id,
        new Date("2026-08-08T10:02:00.000Z"),
      );
      expect(request).toMatchObject({
        status: "pending",
        deniedReservationId: denied.id,
        estimatedCostMinor: 30,
        exceededScopes: ["daily"],
      });
      expect(
        (await ai.requestSpendException(
          { ...requestInput, justification: "A different retry text is ignored." },
          owner.user.id,
          new Date("2026-08-08T10:03:00.000Z"),
        )).id,
      ).toBe(request.id);
      await expect(
        ai.decideSpendException(
          owner.workspace.workspaceId,
          request.id,
          "approved",
          reviewer.user.id,
          undefined,
          new Date("2026-08-08T10:04:00.000Z"),
        ),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      await sql`
        UPDATE workspace_membership SET role = 'approver'
        WHERE workspace_id = ${owner.workspace.workspaceId}
          AND user_id = ${reviewer.user.id}
      `;
      const approved = await ai.decideSpendException(
        owner.workspace.workspaceId,
        request.id,
        "approved",
        reviewer.user.id,
        "Reviewed against the exact estimate.",
        new Date("2026-08-08T10:05:00.000Z"),
      );
      expect(approved).toMatchObject({
        status: "approved",
        resolvedBy: reviewer.user.id,
      });
      expect(
        await ai.decideSpendException(
          owner.workspace.workspaceId,
          request.id,
          "approved",
          reviewer.user.id,
          undefined,
          new Date("2026-08-08T10:06:00.000Z"),
        ),
      ).toEqual(approved);
      await expect(
        ai.decideSpendException(
          owner.workspace.workspaceId,
          request.id,
          "rejected",
          reviewer.user.id,
          undefined,
          new Date("2026-08-08T10:06:00.000Z"),
        ),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });

      const override = await ai.authorizeApprovedSpend(
        owner.workspace.workspaceId,
        request.id,
        owner.user.id,
        new Date("2026-08-08T10:07:00.000Z"),
      );
      expect(override).toMatchObject({
        status: "reserved",
        estimatedCostMinor: 30,
        spendExceptionRequestId: request.id,
      });
      expect(
        (await ai.authorizeApprovedSpend(
          owner.workspace.workspaceId,
          request.id,
          owner.user.id,
          new Date("2026-08-08T10:08:00.000Z"),
        )).id,
      ).toBe(override.id);
      await ai.settleSpend(
        {
          workspaceId: owner.workspace.workspaceId,
          reservationId: override.id,
          actualCostMinor: 25,
          usage: {
            provider: "approved-provider",
            model: "approved-model",
            privacyClass: "cloud",
            inputUnits: 20,
            outputUnits: 5,
            cachedInputUnits: 0,
            latencyMs: 120,
          },
        },
        owner.user.id,
        new Date("2026-08-08T10:09:00.000Z"),
      );
      const consumed = (
        await ai.listSpendExceptions(owner.workspace.workspaceId, "USD", asOf)
      )[0]!;
      expect(consumed).toMatchObject({
        id: request.id,
        status: "approved",
        consumedAt: "2026-08-08T10:07:00.000Z",
      });

      const expiredDenied = await ai.reserveSpend(
        {
          workspaceId: owner.workspace.workspaceId,
          idempotencyKey: randomUUID(),
          capability: "generate_text",
          feature: "expired_exception_feature",
          currency: "USD",
          estimatedCostMinor: 10,
        },
        owner.user.id,
        new Date("2026-08-08T10:10:00.000Z"),
      );
      expect(expiredDenied.status).toBe("denied");
      const expiring = await ai.requestSpendException(
        {
          workspaceId: owner.workspace.workspaceId,
          deniedReservationId: expiredDenied.id,
          justification: "This request should expire without execution.",
        },
        owner.user.id,
        new Date("2026-08-08T10:11:00.000Z"),
      );
      expect(
        await ai.decideSpendException(
          owner.workspace.workspaceId,
          expiring.id,
          "approved",
          reviewer.user.id,
          undefined,
          new Date("2026-08-09T10:12:00.000Z"),
        ),
      ).toMatchObject({ status: "expired" });
      await expect(
        ai.authorizeApprovedSpend(
          owner.workspace.workspaceId,
          expiring.id,
          owner.user.id,
          new Date("2026-08-09T10:13:00.000Z"),
        ),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });

      const alerts = await ai.listBudgetAlerts(owner.workspace.workspaceId, "USD");
      expect(
        alerts.map((alert) => alert.thresholdPercentage),
      ).toEqual(expect.arrayContaining([50, 80, 100]));
      const audits = await sql<{ eventType: string; data: unknown }[]>`
        SELECT event_type, data FROM audit_event
        WHERE workspace_id = ${owner.workspace.workspaceId}
          AND event_type LIKE 'ai.spend_exception_%'
        ORDER BY created_at, id
      `;
      expect(audits.map((item) => item.eventType)).toEqual(
        expect.arrayContaining([
          "ai.spend_exception_requested",
          "ai.spend_exception_approved",
          "ai.spend_exception_consumed",
          "ai.spend_exception_expired",
        ]),
      );
      expect(JSON.stringify(audits)).not.toContain("Customer launch");
      expect(JSON.stringify(audits)).not.toContain("Reviewed against");
      expect(JSON.stringify(audits)).not.toContain("approved_exception_feature");
    } finally {
      await sql`
        DELETE FROM organization
        WHERE id IN (${owner.workspace.organizationId}, ${reviewer.workspace.organizationId})
      `;
      await sql`DELETE FROM app_user WHERE id IN (${owner.user.id}, ${reviewer.user.id})`;
    }
  });
});
