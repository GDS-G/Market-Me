import { describe, expect, it } from "vitest";
import type { AiProviderRateCard } from "@market-me/domain";
import { quoteAiCost } from "./rate-card";

const base: AiProviderRateCard = {
  id: "00000000-0000-4000-8000-000000000099",
  provider: "example",
  modelFamily: "example-model",
  modelVersion: "2026-08",
  currency: "USD",
  minorUnitExponent: 2,
  status: "approved",
  components: [
    { kind: "input", unit: "token", unitQuantity: 1_000_000, priceMicros: 1_000_000 },
    { kind: "output", unit: "token", unitQuantity: 1_000_000, priceMicros: 2_000_000 },
    { kind: "request", unit: "request", unitQuantity: 1, priceMicros: 10_000 },
  ],
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  effectiveTo: "2026-09-01T00:00:00.000Z",
  sourceReference: "https://example.invalid/rates",
  sourceHash: "a".repeat(64),
  verifiedAt: "2026-07-25T00:00:00.000Z",
  approvedAt: "2026-07-26T00:00:00.000Z",
  createdAt: "2026-07-26T00:00:00.000Z",
};

describe("AI cost quotation", () => {
  it("rounds a bounded component range conservatively to currency minor units", () => {
    const quote = quoteAiCost(
      base,
      [
        { kind: "input", unit: "token", minimumUnits: 500_000, maximumUnits: 1_000_000 },
        { kind: "output", unit: "token", minimumUnits: 100_000, maximumUnits: 500_000 },
      ],
      new Date("2026-08-10T12:00:00.000Z"),
    );
    expect(quote).toMatchObject({
      minimumCostMinor: 71,
      maximumCostMinor: 201,
      expiresAt: "2026-08-10T12:05:00.000Z",
      rounding: "ceil_to_minor_unit",
      reservationRequired: true,
      reservationAuthorized: false,
      execution: false,
    });
  });

  it("quotes an approved zero-price request card without claiming a reservation", () => {
    const quote = quoteAiCost(
      { ...base, components: [{ kind: "request", unit: "request", unitQuantity: 1, priceMicros: 0 }] },
      [],
      new Date("2026-08-10T12:00:00.000Z"),
    );
    expect(quote).toMatchObject({
      minimumCostMinor: 0,
      maximumCostMinor: 0,
      reservationRequired: false,
      reservationAuthorized: false,
      execution: false,
    });
  });

  it("expires at an earlier rate-card boundary", () => {
    const quote = quoteAiCost(
      { ...base, effectiveTo: "2026-08-10T12:02:00.000Z" },
      [
        { kind: "input", unit: "token", minimumUnits: 1, maximumUnits: 1 },
        { kind: "output", unit: "token", minimumUnits: 1, maximumUnits: 1 },
      ],
      new Date("2026-08-10T12:00:00.000Z"),
    );
    expect(quote.expiresAt).toBe("2026-08-10T12:02:00.000Z");
  });

  it("rejects missing, unused, duplicate, and out-of-window forecasts", () => {
    expect(() => quoteAiCost(base, [], new Date("2026-08-10T12:00:00.000Z"))).toThrowError(/could not be created/);
    expect(() => quoteAiCost(base, [
      { kind: "input", unit: "token", minimumUnits: 1, maximumUnits: 1 },
      { kind: "input", unit: "token", minimumUnits: 1, maximumUnits: 1 },
      { kind: "output", unit: "character", minimumUnits: 1, maximumUnits: 1 },
    ], new Date("2026-10-01T00:00:00.000Z"))).toThrowError(/could not be created/);
  });
});
