import type {
  AiCostQuote,
  AiCostQuoteLine,
  AiProviderRateCard,
  AiUsageQuantityForecast,
} from "@market-me/domain";

export class AiCostQuoteError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super("AI cost quote could not be created.");
    this.name = "AiCostQuoteError";
  }
}

export function quoteAiCost(
  rateCard: AiProviderRateCard,
  forecasts: readonly AiUsageQuantityForecast[],
  quotedAt: Date = new Date(),
  maximumAgeSeconds = 300,
): AiCostQuote {
  const issues: string[] = [];
  if (rateCard.status !== "approved" || !rateCard.approvedAt)
    issues.push("The rate card must be approved.");
  const effectiveFrom = new Date(rateCard.effectiveFrom);
  const effectiveTo = rateCard.effectiveTo
    ? new Date(rateCard.effectiveTo)
    : undefined;
  if (
    !Number.isFinite(effectiveFrom.getTime()) ||
    quotedAt < effectiveFrom ||
    (effectiveTo && quotedAt >= effectiveTo)
  )
    issues.push("The rate card is not effective at the quote time.");
  if (
    !Number.isInteger(rateCard.minorUnitExponent) ||
    rateCard.minorUnitExponent < 0 ||
    rateCard.minorUnitExponent > 4
  )
    issues.push("The currency minor-unit exponent must be an integer from 0 through 4.");
  if (
    !Number.isInteger(maximumAgeSeconds) ||
    maximumAgeSeconds < 30 ||
    maximumAgeSeconds > 900
  )
    issues.push("Quote lifetime must be 30 through 900 seconds.");
  if (rateCard.components.length === 0)
    issues.push("The rate card must contain at least one price component.");

  const forecastByKey = new Map<string, AiUsageQuantityForecast>();
  for (const forecast of forecasts) {
    const key = `${forecast.kind}:${forecast.unit}`;
    if (forecastByKey.has(key)) issues.push(`Duplicate forecast ${key}.`);
    forecastByKey.set(key, forecast);
    if (
      !Number.isSafeInteger(forecast.minimumUnits) ||
      !Number.isSafeInteger(forecast.maximumUnits) ||
      forecast.minimumUnits < 0 ||
      forecast.maximumUnits < forecast.minimumUnits ||
      forecast.maximumUnits > 1_000_000_000
    )
      issues.push(`Forecast ${key} must use ordered integer bounds from 0 through 1,000,000,000.`);
  }

  const usedForecasts = new Set<string>();
  const lineValues: {
    line: AiCostQuoteLine;
    minimum: bigint;
    maximum: bigint;
  }[] = [];
  for (const component of rateCard.components) {
    if (
      !Number.isSafeInteger(component.unitQuantity) ||
      component.unitQuantity < 1 ||
      !Number.isSafeInteger(component.priceMicros) ||
      component.priceMicros < 0
    ) {
      issues.push(`Rate component ${component.kind}:${component.unit} is not a bounded integer price.`);
      continue;
    }
    let minimumUnits = 1;
    let maximumUnits = 1;
    if (component.kind !== "request") {
      const key = `${component.kind}:${component.unit}`;
      const forecast = forecastByKey.get(key);
      if (!forecast) {
        issues.push(`Forecast ${key} is required by the rate card.`);
        continue;
      }
      usedForecasts.add(key);
      minimumUnits = forecast.minimumUnits;
      maximumUnits = forecast.maximumUnits;
    } else if (component.unit !== "request" || component.unitQuantity !== 1) {
      issues.push("Request prices must use one request as their unit quantity.");
      continue;
    }
    const unitQuantity = BigInt(component.unitQuantity);
    const price = BigInt(component.priceMicros);
    const minimum = ceilDivide(BigInt(minimumUnits) * price, unitQuantity);
    const maximum = ceilDivide(BigInt(maximumUnits) * price, unitQuantity);
    lineValues.push({
      line: {
        kind: component.kind,
        unit: component.unit,
        minimumUnits,
        maximumUnits,
        minimumCostMicros: safeNumber(minimum, issues),
        maximumCostMicros: safeNumber(maximum, issues),
      },
      minimum,
      maximum,
    });
  }
  for (const key of forecastByKey.keys())
    if (!usedForecasts.has(key))
      issues.push(`Forecast ${key} has no matching rate component.`);
  if (issues.length) throw new AiCostQuoteError(issues);

  const minimumMicros = lineValues.reduce((sum, item) => sum + item.minimum, BigInt(0));
  const maximumMicros = lineValues.reduce((sum, item) => sum + item.maximum, BigInt(0));
  const microsPerMinor = BigInt(10) ** BigInt(6 - rateCard.minorUnitExponent);
  const minimumCostMinor = safeNumber(ceilDivide(minimumMicros, microsPerMinor), issues);
  const maximumCostMinor = safeNumber(ceilDivide(maximumMicros, microsPerMinor), issues);
  if (issues.length) throw new AiCostQuoteError(issues);
  const ageExpiry = new Date(quotedAt.getTime() + maximumAgeSeconds * 1_000);
  const expiresAt = effectiveTo && effectiveTo < ageExpiry ? effectiveTo : ageExpiry;

  return {
    rateCardId: rateCard.id,
    provider: rateCard.provider,
    modelFamily: rateCard.modelFamily,
    modelVersion: rateCard.modelVersion,
    currency: rateCard.currency,
    minorUnitExponent: rateCard.minorUnitExponent,
    lines: lineValues.map((item) => item.line),
    minimumCostMinor,
    maximumCostMinor,
    quotedAt: quotedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    rounding: "ceil_to_minor_unit",
    reservationRequired: maximumCostMinor > 0,
    reservationAuthorized: false,
    execution: false,
  };
}

function ceilDivide(value: bigint, divisor: bigint) {
  return value === BigInt(0)
    ? BigInt(0)
    : (value + divisor - BigInt(1)) / divisor;
}

function safeNumber(value: bigint, issues: string[]) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    issues.push("The calculated quote exceeds the safe integer range.");
    return 0;
  }
  return Number(value);
}
