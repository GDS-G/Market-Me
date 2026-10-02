import { describe, expect, it } from "vitest";
import type { WorkspaceAiPolicyWrite } from "@market-me/database";
import { AI_POLICY_VALUE_KEYS, aiPolicyChoiceLabel, aiPolicyValues } from "./ai-policy-presentation";
const policy: WorkspaceAiPolicyWrite = { workspaceId: "synthetic-workspace", mode: "recommended", maximumPrivacyClass: "cloud",
  failoverMode: "ask_before_switching", capBehavior: "require_approval", currency: "USD", alertThresholdPercentages: [50, 80, 100] };
describe("saved versus selected AI preferences", () => {
  it("retains the existing two-decimal editor convention without inventing budgets", () => {
    expect(aiPolicyValues(policy)).toEqual({ mode: "recommended", maximumPrivacyClass: "cloud", failoverMode: "ask_before_switching",
      capBehavior: "require_approval", currency: "USD", dailyBudget: "", campaignBudget: "", monthlyBudget: "", alerts: "50, 80, 100" });
    expect(aiPolicyValues({ ...policy, dailyBudgetMinor: 1, campaignBudgetMinor: 123, monthlyBudgetMinor: 1000000000 }))
      .toMatchObject({ dailyBudget: "0.01", campaignBudget: "1.23", monthlyBudget: "10000000.00" });
  });
  it("distinguishes loaded saved policy from unsaved application defaults", () => {
    expect(aiPolicyChoiceLabel(aiPolicyValues(policy), policy, true)).toBe("Saved preference");
    expect(aiPolicyChoiceLabel(aiPolicyValues(policy), policy, false)).toBe("Default preference — not yet saved");
    expect(Object.isFrozen(AI_POLICY_VALUE_KEYS)).toBe(true);
    expect([...AI_POLICY_VALUE_KEYS].sort()).toEqual(Object.keys(aiPolicyValues(policy)).sort());
  });
  it.each(AI_POLICY_VALUE_KEYS)("labels an edited %s field as unsaved", key => {
    const values = aiPolicyValues(policy); const changed = { ...values, [key]: "synthetic edit" };
    expect(aiPolicyChoiceLabel(changed, policy, true)).toBe("Selected preference — not saved");
    expect(aiPolicyChoiceLabel(changed, policy, false)).toBe("Selected preference — not saved");
    expect(aiPolicyChoiceLabel(values, policy, true)).toBe("Saved preference");
  });
  it("compares against refreshed server policy rather than retaining a false saved claim", () => {
    const oldValues = aiPolicyValues(policy);
    expect(aiPolicyChoiceLabel(oldValues, { ...policy, mode: "faster" }, true)).toBe("Selected preference — not saved");
    expect(policy.mode).toBe("recommended");
  });
});
