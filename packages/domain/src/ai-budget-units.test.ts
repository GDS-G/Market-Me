import { describe, expect, it } from "vitest";
import { AI_BUDGET_LEDGER_DIVISOR, AI_BUDGET_LEDGER_EXPONENT, formatAiBudgetMoney, isAiBudgetQuoteUnitCompatible } from "./ai-budget-units";

describe("explicit legacy AI budget units", () => {
  it("keeps the established hundredths scale", () => {
    expect(AI_BUDGET_LEDGER_EXPONENT).toBe(2); expect(AI_BUDGET_LEDGER_DIVISOR).toBe(100);
    expect(isAiBudgetQuoteUnitCompatible(2)).toBe(true);
  });
  it.each([0, 1, 3, 4, -1, 2.1, NaN, Infinity, "2", null, undefined, {}, []])("does not coerce incompatible exponent %j", value => {
    expect(isAiBudgetQuoteUnitCompatible(value)).toBe(false);
  });
  it.each(["USD", "JPY", "KWD", "XXX"])("preserves a recorded hundredth for %s without inferring its ISO minor unit", currency => {
    expect(formatAiBudgetMoney(1, currency)).toContain("0.01");
    expect(formatAiBudgetMoney(123456, currency)).toContain("1,234.56");
  });
  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("fails closed for invalid amount %s", value => {
    expect(formatAiBudgetMoney(value, "USD")).toBe("Amount unavailable");
  });
  it("preserves the final hundredth of the largest safe integer without floating-point division", () => {
    expect(formatAiBudgetMoney(Number.MAX_SAFE_INTEGER, "USD")).toBe("$90,071,992,547,409.91");
  });
  it.each(["US", "usd", "<script>", "", "USD "])("does not throw or reinterpret invalid currency %s", currency => {
    expect(formatAiBudgetMoney(1, currency)).toBe("Amount unavailable");
  });
});
