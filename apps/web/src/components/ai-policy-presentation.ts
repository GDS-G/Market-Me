import type { WorkspaceAiPolicyWrite } from "@market-me/database";

export function aiPolicyValues(policy: WorkspaceAiPolicyWrite) {
  const budget = (value?: number) => value === undefined ? "" : (value / 100).toFixed(2);
  return {
    mode: policy.mode, maximumPrivacyClass: policy.maximumPrivacyClass,
    failoverMode: policy.failoverMode, capBehavior: policy.capBehavior, currency: policy.currency,
    dailyBudget: budget(policy.dailyBudgetMinor), campaignBudget: budget(policy.campaignBudgetMinor),
    monthlyBudget: budget(policy.monthlyBudgetMinor), alerts: policy.alertThresholdPercentages.join(", "),
  };
}
export type AiPolicyFormValues = ReturnType<typeof aiPolicyValues>;
export const AI_POLICY_VALUE_KEYS = Object.freeze([
  "mode", "maximumPrivacyClass", "failoverMode", "capBehavior", "currency",
  "dailyBudget", "campaignBudget", "monthlyBudget", "alerts",
] as const satisfies readonly (keyof AiPolicyFormValues)[]);
export function aiPolicyChoiceLabel(values: AiPolicyFormValues, policy: WorkspaceAiPolicyWrite, hasSavedPolicy: boolean): string {
  const saved = aiPolicyValues(policy);
  if (AI_POLICY_VALUE_KEYS.some(key => values[key] !== saved[key])) return "Selected preference — not saved";
  return hasSavedPolicy ? "Saved preference" : "Default preference — not yet saved";
}
