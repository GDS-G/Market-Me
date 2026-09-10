import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AiRepository } from "./ai-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("AI provider rate cards", () => {
  afterAll(async () => sql?.end());

  it("selects one approved effective-dated version and keeps pricing server-owned", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const repository = new AiRepository(sql);
    const provider = `rate-test-${randomUUID()}`;
    const firstId = randomUUID();
    const secondId = randomUUID();
    const draftId = randomUUID();
    const sourceHash = "b".repeat(64);

    try {
      await sql`
        INSERT INTO ai_provider_rate_card (
          id, provider, model_family, model_version, currency,
          minor_unit_exponent, status,
          effective_from, effective_to, source_reference, source_hash,
          verified_at, approved_at, created_at
        ) VALUES
          (
            ${firstId}, ${provider}, 'example-model', '2029-01', 'ZZZ', 2,
            'approved', '2030-01-01T00:00:00.000Z',
            '2030-02-01T00:00:00.000Z', 'https://example.invalid/rates/2029-01',
            ${sourceHash}, '2029-12-20T00:00:00.000Z',
            '2029-12-21T00:00:00.000Z', '2029-12-21T00:00:00.000Z'
          ),
          (
            ${secondId}, ${provider}, 'example-model', '2030-02', 'ZZZ', 2,
            'approved', '2030-02-01T00:00:00.000Z', NULL,
            'https://example.invalid/rates/2030-02', ${sourceHash},
            '2030-01-20T00:00:00.000Z', '2030-01-21T00:00:00.000Z',
            '2030-01-21T00:00:00.000Z'
          ),
          (
            ${draftId}, ${provider}, 'example-model', 'draft', 'ZZZ', 2,
            'draft', '2030-01-15T00:00:00.000Z', NULL,
            'https://example.invalid/rates/draft', ${sourceHash},
            '2030-01-10T00:00:00.000Z', NULL, '2030-01-10T00:00:00.000Z'
          )
      `;
      await sql`
        INSERT INTO ai_provider_rate_component (
          rate_card_id, kind, unit, unit_quantity, price_micros
        ) VALUES
          (${firstId}, 'input', 'token', 1000000, 1000000),
          (${secondId}, 'input', 'token', 1000000, 2000000),
          (${secondId}, 'output', 'token', 1000000, 4000000),
          (${draftId}, 'request', 'request', 1, 999999)
      `;

      const beforeBoundary = await repository.listEffectiveProviderRateCards(
        new Date("2030-01-31T23:59:59.999Z"),
        "ZZZ",
      );
      expect(beforeBoundary).toHaveLength(1);
      expect(beforeBoundary[0]).toMatchObject({
        id: firstId,
        modelVersion: "2029-01",
        components: [
          { kind: "input", unit: "token", unitQuantity: 1_000_000, priceMicros: 1_000_000 },
        ],
      });

      const atBoundary = await repository.listEffectiveProviderRateCards(
        new Date("2030-02-01T00:00:00.000Z"),
        "ZZZ",
      );
      expect(atBoundary).toHaveLength(1);
      expect(atBoundary[0]).toMatchObject({
        id: secondId,
        status: "approved",
        effectiveFrom: "2030-02-01T00:00:00.000Z",
        components: [
          { kind: "input", priceMicros: 2_000_000 },
          { kind: "output", priceMicros: 4_000_000 },
        ],
      });

      const summary = await repository.getProviderRateCardSummary(
        new Date("2030-02-01T00:00:00.000Z"),
      );
      expect(summary).toMatchObject({
        monetaryEstimateAvailable: false,
        currencies: expect.arrayContaining(["USD", "ZZZ"]),
        latestVerifiedAt: "2030-01-20T00:00:00.000Z",
      });
      expect(summary.activeCardCount).toBeGreaterThanOrEqual(2);

      await expect(
        repository.listEffectiveProviderRateCards(
          new Date("2030-02-01T00:00:00.000Z"),
          "usd",
        ),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });

      await expect(sql`
        INSERT INTO ai_provider_rate_card (
          id, provider, model_family, model_version, currency,
          minor_unit_exponent, status,
          effective_from, source_reference, source_hash, verified_at,
          approved_at
        ) VALUES (
          ${randomUUID()}, ${provider}, 'example-model', 'overlap', 'ZZZ', 2,
          'approved', '2030-03-01T00:00:00.000Z',
          'https://example.invalid/rates/overlap', ${sourceHash},
          '2030-02-01T00:00:00.000Z', '2030-02-02T00:00:00.000Z'
        )
      `).rejects.toMatchObject({ code: "23P01" });
    } finally {
      await sql`DELETE FROM ai_provider_rate_card WHERE provider = ${provider}`;
    }
  });
});
