/** Existing policy/usage/reservation integers are hundredths, not a per-currency ISO scale. */
export const AI_BUDGET_LEDGER_EXPONENT = 2;
export const AI_BUDGET_LEDGER_DIVISOR = 10 ** AI_BUDGET_LEDGER_EXPONENT;
export const AI_BUDGET_UNIT_MISMATCH = "This quote uses a different money scale from the budget ledger. It can be inspected but cannot authorize spending.";
export const AI_BUDGET_HISTORY_MISMATCH = "This currency has historical reservations with incompatible money units. New spending and monetary settlement are blocked until those records are explicitly reconciled; inspection and release remain available.";
export type AiBudgetUnitIntegrity = {
  ledgerExponent: typeof AI_BUDGET_LEDGER_EXPONENT;
  status: "compatible" | "incompatible_history";
  incompatibleReservationCount: number;
};

export function isAiBudgetQuoteUnitCompatible(exponent: unknown): exponent is typeof AI_BUDGET_LEDGER_EXPONENT {
  return exponent === AI_BUDGET_LEDGER_EXPONENT;
}

/** Preserve recorded values; never let a locale's currency default round hundredths away. */
export function formatAiBudgetMoney(value: number, currency: string): string {
  if (!Number.isSafeInteger(value) || value < 0 || !/^[A-Z]{3}$/.test(currency)) return "Amount unavailable";
  const integer = BigInt(value), divisor = BigInt(AI_BUDGET_LEDGER_DIVISOR);
  const fraction = (integer % divisor).toString().padStart(AI_BUDGET_LEDGER_EXPONENT, "0");
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency,
    minimumFractionDigits: AI_BUDGET_LEDGER_EXPONENT,
    maximumFractionDigits: AI_BUDGET_LEDGER_EXPONENT,
  }).formatToParts(integer / divisor).map(part => part.type === "fraction" ? fraction : part.value).join("");
}
