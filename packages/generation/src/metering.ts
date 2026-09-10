import type {
  AiAssistantAction,
  AiAssistantCostPreview,
  AiAssistantMeteringProfile,
  AiAssistantProfileId,
  AiAdapterIdentity,
  AiMode,
  AiPrivacyClass,
  AiProviderAdapterDescriptor,
  AiProviderRateCard,
  AiUsageQuantityForecast,
} from "@market-me/domain";
import { BUILT_IN_AI_ADAPTERS, planAiAssistantWork } from "./gateway";
import { quoteAiCost } from "./rate-card";

const PROFILE_VERSION = "assistant-metering-v1";

export const AI_ASSISTANT_METERING_PROFILES = {
  understand_content: profile("understand_content", "generate_structured_output", 512, 16_000, 256, 2_000),
  prepare_copy: profile("prepare_copy", "generate_text", 256, 8_000, 64, 2_000),
  plan_campaign: profile("plan_campaign", "generate_structured_output", 512, 12_000, 256, 3_000),
  discover_profiles_and_content: profile("discover_profiles_and_content", "rerank", 256, 4_000, 128, 1_000),
  draft_eligible_interaction: profile("draft_eligible_interaction", "generate_text", 128, 4_000, 64, 1_000),
  review_rules_rights_and_claims: profile("review_rules_rights_and_claims", "generate_structured_output", 512, 16_000, 128, 2_000),
  evaluate_results_and_experiments: profile("evaluate_results_and_experiments", "generate_structured_output", 512, 12_000, 256, 2_500),
} as const satisfies Readonly<Record<AiAssistantAction, AiAssistantMeteringProfile>>;

export function planAiAssistantCost(
  input: {
    action: AiAssistantAction;
    profileId?: AiAssistantProfileId;
    mode: AiMode;
    maximumPrivacyClass: AiPrivacyClass;
    rateCards: readonly AiProviderRateCard[];
    rateCardId?: string;
    quotedAt?: Date;
    routingPreference?: AiAdapterIdentity;
  },
  adapters: readonly AiProviderAdapterDescriptor[] = BUILT_IN_AI_ADAPTERS,
): AiAssistantCostPreview {
  const metering = AI_ASSISTANT_METERING_PROFILES[input.action];
  const work = planAiAssistantWork(
    {
      action: input.action,
      ...(input.profileId ? { profileId: input.profileId } : {}),
      mode: input.mode,
      maximumPrivacyClass: input.maximumPrivacyClass,
      ...(input.routingPreference
        ? { routingPreference: input.routingPreference }
        : {}),
    },
    adapters,
  );
  const base = {
    action: input.action,
    capability: metering.capability,
    feature: metering.feature,
    profileVersion: metering.version,
    reservationAuthorized: false as const,
    execution: false as const,
  };
  if (work.status !== "ready" || !work.routing.adapter)
    return unavailable(base, [], [
      "No policy-eligible adapter is ready for this assistant action.",
      ...work.reasons,
    ]);
  if (work.selection.requiredCapability !== metering.capability)
    return unavailable(base, [], [
      "The server-owned metering profile does not match the action capability.",
    ]);

  const adapter = work.routing.adapter;
  const card = input.rateCards.find(
    (candidate) =>
      (!input.rateCardId || candidate.id === input.rateCardId) &&
      candidate.provider === adapter.provider &&
      candidate.modelFamily === adapter.model,
  );
  if (!card)
    return unavailable(base, [], [
      input.rateCardId
        ? "The selected rate card does not match the policy-eligible adapter and currency."
        : "No approved effective rate card matches the policy-eligible adapter and currency.",
    ]);

  const forecastResult = forecastsForCard(metering, card);
  if (forecastResult.issues.length)
    return unavailable(base, [], forecastResult.issues);
  const quotedAt = input.quotedAt ?? new Date();
  try {
    const quote = quoteAiCost(card, forecastResult.forecasts, quotedAt);
    return {
      ...base,
      status: "quoted",
      rateCardId: card.id,
      forecasts: forecastResult.forecasts,
      currency: quote.currency,
      minorUnitExponent: quote.minorUnitExponent,
      minimumCostMinor: quote.minimumCostMinor,
      maximumCostMinor: quote.maximumCostMinor,
      quotedAt: quote.quotedAt,
      expiresAt: quote.expiresAt,
      reservationRequired: quote.reservationRequired,
      currencyEstimateAvailable: true,
      durableQuoteAvailable: true,
      reservationAuthorized: false,
      execution: false,
      reasons: [
        `Server-owned ${metering.version} bounds cover every billed component on the exact effective rate card.`,
        "This preview creates no durable quote, reservation, provider call, or execution authority.",
      ],
    };
  } catch (error) {
    return unavailable(base, forecastResult.forecasts, [
      error instanceof Error ? error.message : "The bounded cost preview could not be calculated.",
    ]);
  }
}

function profile(
  action: AiAssistantAction,
  capability: AiAssistantMeteringProfile["capability"],
  inputMinimum: number,
  inputMaximum: number,
  outputMinimum: number,
  outputMaximum: number,
): AiAssistantMeteringProfile {
  return {
    action,
    capability,
    feature: `assistant.${action}`,
    version: PROFILE_VERSION,
    inputTokens: { minimum: inputMinimum, maximum: inputMaximum },
    outputTokens: { minimum: outputMinimum, maximum: outputMaximum },
    execution: false,
  };
}

function forecastsForCard(
  profile: AiAssistantMeteringProfile,
  card: AiProviderRateCard,
): { forecasts: AiUsageQuantityForecast[]; issues: string[] } {
  const forecasts: AiUsageQuantityForecast[] = [];
  const issues: string[] = [];
  for (const component of card.components) {
    if (component.kind === "request") continue;
    const tokens = component.kind === "output"
      ? profile.outputTokens
      : component.kind === "cached_input"
        ? { minimum: 0, maximum: profile.inputTokens.maximum }
        : profile.inputTokens;
    if (component.unit !== "token" && component.unit !== "character") {
      issues.push(
        `The ${component.kind}:${component.unit} meter has no safe text-action conversion in ${profile.version}.`,
      );
      continue;
    }
    const multiplier = component.unit === "character" ? 4 : 1;
    forecasts.push({
      kind: component.kind,
      unit: component.unit,
      minimumUnits: tokens.minimum * multiplier,
      maximumUnits: tokens.maximum * multiplier,
    });
  }
  return { forecasts, issues };
}

function unavailable(
  base: Omit<AiAssistantCostPreview, "status" | "forecasts" | "currencyEstimateAvailable" | "durableQuoteAvailable" | "reasons">,
  forecasts: readonly AiUsageQuantityForecast[],
  reasons: readonly string[],
): AiAssistantCostPreview {
  return {
    ...base,
    status: "unavailable",
    forecasts,
    currencyEstimateAvailable: false,
    durableQuoteAvailable: false,
    reservationAuthorized: false,
    execution: false,
    reasons,
  };
}
