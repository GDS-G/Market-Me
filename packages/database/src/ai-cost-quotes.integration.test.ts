import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AiRepository } from "./ai-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("AI cost quote reservation binding", () => {
  afterAll(async () => sql?.end());

  it("persists exact quote evidence and binds it to one derived reservation", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const ai = new AiRepository(sql);
    const suffix = randomUUID();
    const owner = await core.bootstrapDevelopmentWorkspace({
      email: `quote-owner-${suffix}@market-me.local`,
      displayName: "Quote Owner",
    });
    const viewer = await core.bootstrapDevelopmentWorkspace({
      email: `quote-viewer-${suffix}@market-me.local`,
      displayName: "Quote Viewer",
    });
    const rateCardId = randomUUID();
    const provider = `quote-test-${suffix}`;
    const quotedAt = new Date("2031-01-10T12:00:00.000Z");

    try {
      await sql`
        INSERT INTO workspace_membership (workspace_id, user_id, role)
        VALUES (${owner.workspace.workspaceId}, ${viewer.user.id}, 'viewer')
      `;
      await sql`
        INSERT INTO ai_provider_rate_card (
          id, provider, model_family, model_version, currency,
          minor_unit_exponent, status, effective_from, source_reference,
          source_hash, verified_at, approved_at, created_at
        ) VALUES (
          ${rateCardId}, ${provider}, 'paid-example', '2031-01', 'USD', 2,
          'approved', '2031-01-01T00:00:00.000Z',
          'https://example.invalid/paid-example', ${"c".repeat(64)},
          '2030-12-20T00:00:00.000Z', '2030-12-21T00:00:00.000Z',
          '2030-12-21T00:00:00.000Z'
        )
      `;
      await sql`
        INSERT INTO ai_provider_rate_component (
          rate_card_id, kind, unit, unit_quantity, price_micros
        ) VALUES
          (${rateCardId}, 'input', 'token', 1000000, 1000000),
          (${rateCardId}, 'request', 'request', 1, 10000)
      `;
      const write = {
        workspaceId: owner.workspace.workspaceId,
        rateCardId,
        capability: "generate_text" as const,
        feature: "paid_copy_preview",
        forecasts: [
          { kind: "input" as const, unit: "token" as const, minimumUnits: 500_000, maximumUnits: 1_000_000 },
        ],
      };
      await expect(
        ai.createCostQuote(write, viewer.user.id, quotedAt),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });

      const quote = await ai.createCostQuote(write, owner.user.id, quotedAt);
      expect(quote).toMatchObject({
        status: "active",
        minimumCostMinor: 51,
        maximumCostMinor: 101,
        reservationRequired: true,
        reservationAuthorized: false,
        execution: false,
        quoteHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(
        await ai.listCostQuotes(
          owner.workspace.workspaceId,
          viewer.user.id,
          10,
          quotedAt,
        ),
      ).toEqual(expect.arrayContaining([expect.objectContaining({ id: quote.id })]));
      await expect(
        ai.listCostQuotes(
          viewer.workspace.workspaceId,
          owner.user.id,
          10,
          quotedAt,
        ),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      await expect(
        ai.listCostQuotes(owner.workspace.workspaceId, owner.user.id, 101, quotedAt),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });

      const idempotencyKey = randomUUID();
      const reservation = await ai.reserveQuotedSpend(
        { workspaceId: owner.workspace.workspaceId, quoteId: quote.id, idempotencyKey },
        owner.user.id,
        new Date("2031-01-10T12:00:01.000Z"),
      );
      expect(reservation).toMatchObject({
        costQuoteId: quote.id,
        capability: "generate_text",
        feature: "paid_copy_preview",
        currency: "USD",
        estimatedCostMinor: 101,
        status: "reserved",
      });
      expect(await ai.reserveQuotedSpend(
        { workspaceId: owner.workspace.workspaceId, quoteId: quote.id, idempotencyKey },
        owner.user.id,
        new Date("2031-01-10T12:00:02.000Z"),
      )).toMatchObject({ id: reservation.id });
      await expect(ai.reserveQuotedSpend(
        { workspaceId: owner.workspace.workspaceId, quoteId: quote.id, idempotencyKey: randomUUID() },
        owner.user.id,
        new Date("2031-01-10T12:00:03.000Z"),
      )).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      expect(await ai.getCostQuote(
        owner.workspace.workspaceId,
        quote.id,
        new Date("2031-01-10T12:00:03.000Z"),
      )).toMatchObject({ status: "consumed", reservationId: reservation.id });

      const expired = await ai.createCostQuote(
        { ...write, feature: "expired_copy_preview" },
        owner.user.id,
        new Date("2031-01-10T13:00:00.000Z"),
      );
      await expect(ai.reserveQuotedSpend(
        { workspaceId: owner.workspace.workspaceId, quoteId: expired.id, idempotencyKey: randomUUID() },
        owner.user.id,
        new Date("2031-01-10T13:05:01.000Z"),
      )).rejects.toMatchObject({ name: "AiPolicyValidationError" });

      const tampered = await ai.createCostQuote(
        { ...write, feature: "tampered_copy_preview" },
        owner.user.id,
        new Date("2031-01-10T14:00:00.000Z"),
      );
      await sql`
        UPDATE ai_cost_quote SET maximum_cost_minor = maximum_cost_minor + 1
        WHERE id = ${tampered.id}
      `;
      await expect(ai.reserveQuotedSpend(
        { workspaceId: owner.workspace.workspaceId, quoteId: tampered.id, idempotencyKey: randomUUID() },
        owner.user.id,
        new Date("2031-01-10T14:00:01.000Z"),
      )).rejects.toMatchObject({ name: "AiPolicyValidationError" });

      const free = await ai.createCostQuote(
        {
          workspaceId: owner.workspace.workspaceId,
          rateCardId: "00000000-0000-4000-8000-000000000054",
          capability: "generate_text",
          feature: "local_reference",
          forecasts: [],
        },
        owner.user.id,
        quotedAt,
      );
      await expect(ai.reserveQuotedSpend(
        { workspaceId: owner.workspace.workspaceId, quoteId: free.id, idempotencyKey: randomUUID() },
        owner.user.id,
        new Date("2031-01-10T12:00:01.000Z"),
      )).rejects.toMatchObject({ name: "AiPolicyValidationError" });
    } finally {
      await sql`DELETE FROM organization WHERE id IN (${owner.workspace.organizationId}, ${viewer.workspace.organizationId})`;
      await sql`DELETE FROM app_user WHERE id IN (${owner.user.id}, ${viewer.user.id})`;
      await sql`DELETE FROM ai_provider_rate_card WHERE id = ${rateCardId}`;
    }
  });
});
