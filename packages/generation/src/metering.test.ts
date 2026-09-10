import { describe, expect, it } from "vitest";
import type {
  AiProviderAdapterDescriptor,
  AiProviderRateCard,
} from "@market-me/domain";
import {
  AI_ASSISTANT_METERING_PROFILES,
  planAiAssistantCost,
} from "./metering";

const quotedAt = new Date("2026-08-10T12:00:00.000Z");
const localCard: AiProviderRateCard = {
  id: "10000000-0000-4000-8000-000000000001",
  provider: "market-me",
  modelFamily: "grounded-template",
  modelVersion: "1.0.0",
  currency: "USD",
  minorUnitExponent: 2,
  status: "approved",
  components: [
    { kind: "request", unit: "request", unitQuantity: 1, priceMicros: 0 },
  ],
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  sourceReference: "market-me://rates/grounded-template/1",
  sourceHash: "a".repeat(64),
  verifiedAt: "2026-08-01T00:00:00.000Z",
  approvedAt: "2026-08-01T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const hostedAdapter: AiProviderAdapterDescriptor = {
  provider: "example",
  model: "text-model",
  displayName: "Example text model",
  capabilities: ["generate_text", "generate_structured_output"],
  privacyClass: "cloud",
  quality: "enhanced",
  speed: "balanced",
  cost: "medium",
  contextLimit: 100_000,
  available: true,
  approved: true,
  requiresPaidReservation: true,
};

function hostedCard(
  components: AiProviderRateCard["components"],
): AiProviderRateCard {
  return {
    ...localCard,
    id: "20000000-0000-4000-8000-000000000002",
    provider: "example",
    modelFamily: "text-model",
    modelVersion: "2026-08",
    components,
    sourceReference: "https://example.invalid/rates",
  };
}

describe("assistant metering profiles", () => {
  it("defines one closed non-executing profile for every assistant action", () => {
    expect(Object.keys(AI_ASSISTANT_METERING_PROFILES)).toHaveLength(7);
    expect(
      Object.values(AI_ASSISTANT_METERING_PROFILES).every(
        (profile) =>
          profile.execution === false &&
          profile.inputTokens.maximum >= profile.inputTokens.minimum &&
          profile.outputTokens.maximum >= profile.outputTokens.minimum,
      ),
    ).toBe(true);
  });

  it("quotes a ready request-only action without fabricating usage forecasts", () => {
    expect(
      planAiAssistantCost({
        action: "prepare_copy",
        mode: "private_local",
        maximumPrivacyClass: "local",
        rateCards: [localCard],
        quotedAt,
      }),
    ).toMatchObject({
      status: "quoted",
      feature: "assistant.prepare_copy",
      forecasts: [],
      minimumCostMinor: 0,
      maximumCostMinor: 0,
      durableQuoteAvailable: true,
      reservationRequired: false,
      reservationAuthorized: false,
      execution: false,
    });
  });

  it("converts server-owned token envelopes to matching token and character meters", () => {
    const tokenPlan = planAiAssistantCost(
      {
        action: "prepare_copy",
        mode: "recommended",
        maximumPrivacyClass: "cloud",
        rateCards: [
          hostedCard([
            { kind: "input", unit: "token", unitQuantity: 1_000, priceMicros: 1_000 },
            { kind: "output", unit: "character", unitQuantity: 1_000, priceMicros: 2_000 },
            { kind: "request", unit: "request", unitQuantity: 1, priceMicros: 10_000 },
          ]),
        ],
        quotedAt,
      },
      [hostedAdapter],
    );
    expect(tokenPlan).toMatchObject({
      status: "quoted",
      forecasts: [
        { kind: "input", unit: "token", minimumUnits: 256, maximumUnits: 8_000 },
        { kind: "output", unit: "character", minimumUnits: 256, maximumUnits: 8_000 },
      ],
      reservationRequired: true,
      execution: false,
    });
  });

  it("fails closed for a mismatched target or unsupported time meter", () => {
    expect(
      planAiAssistantCost({
        action: "prepare_copy",
        mode: "recommended",
        maximumPrivacyClass: "cloud",
        rateCards: [localCard],
        rateCardId: localCard.id,
        quotedAt,
      }, [hostedAdapter]),
    ).toMatchObject({ status: "unavailable", durableQuoteAvailable: false });
    const unsupported = planAiAssistantCost(
      {
        action: "prepare_copy",
        mode: "recommended",
        maximumPrivacyClass: "cloud",
        rateCards: [
          hostedCard([
            { kind: "input", unit: "second", unitQuantity: 1, priceMicros: 1_000 },
          ]),
        ],
        quotedAt,
      },
      [hostedAdapter],
    );
    expect(unsupported).toMatchObject({
      status: "unavailable",
      currencyEstimateAvailable: false,
      execution: false,
    });
    expect(unsupported.reasons.join(" ")).toContain("no safe text-action conversion");
  });
});
