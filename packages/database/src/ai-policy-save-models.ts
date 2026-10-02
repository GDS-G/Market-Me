import { AI_CAP_BEHAVIORS, AI_FAILOVER_MODES, AI_MODES, AI_PRIVACY_CLASSES } from "@market-me/domain";
import type { StoredWorkspaceAiPolicy, WorkspaceAiPolicyWrite } from "./models";

export const AI_POLICY_SAVE_LIMITS = Object.freeze({ requestBytes: 4_096, maxRevision: 2_147_483_647 });
const ERROR_BRAND = Symbol.for("@market-me/database/AiPolicySaveError/v1");
export class AiPolicySaveError extends Error {
  readonly [ERROR_BRAND] = true;
  constructor(readonly code: "invalid_input" | "access_denied" | "request_conflict" | "revision_conflict" | "not_found", message: string) {
    super(message); this.name = "AiPolicySaveError";
  }
}
export function isAiPolicySaveError(error: unknown): error is AiPolicySaveError {
  return error instanceof Error && Reflect.get(error, ERROR_BRAND) === true;
}
export type AiPolicySaveRequest = WorkspaceAiPolicyWrite & { requestId: string; expectedRevision: number };
export type RevisionedWorkspaceAiPolicy = StoredWorkspaceAiPolicy & { revision: number };
/** Original committed policy, not current policy or permission to execute AI. */
export interface AiPolicySaveReceipt {
  workspaceId: string;
  requestId: string;
  revision: number;
  policy: WorkspaceAiPolicyWrite;
  createdAt: string;
}
export function aiPolicySaveUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())) {
    throw new AiPolicySaveError("invalid_input", "Provide a valid workspace or request identifier.");
  }
  return value.trim().toLowerCase();
}
/** Closed, stable field order: keys, precondition and policy are bound together. */
export function normalizeAiPolicySaveRequest(input: unknown): AiPolicySaveRequest {
  const invalid = (message: string): never => { throw new AiPolicySaveError("invalid_input", message); };
  if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) invalid("Provide ordinary JSON policy settings.");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) {
    invalid("Policy requests cannot contain hidden fields or accessors.");
  }
  const raw = input as Record<string, unknown>;
  const keys = new Set(["workspaceId", "requestId", "expectedRevision", "mode", "maximumPrivacyClass", "failoverMode", "capBehavior",
    "currency", "dailyBudgetMinor", "campaignBudgetMinor", "monthlyBudgetMinor", "alertThresholdPercentages"]);
  if (Object.keys(raw).some(key => !keys.has(key))) invalid("Policy requests cannot contain extra fields or execution permissions.");
  if (typeof raw.expectedRevision !== "number" || !Number.isInteger(raw.expectedRevision)
    || raw.expectedRevision < 0 || raw.expectedRevision > AI_POLICY_SAVE_LIMITS.maxRevision) invalid("Provide the loaded policy revision, or zero for an unsaved policy.");
  for (const [key, choices] of [["mode", AI_MODES], ["maximumPrivacyClass", AI_PRIVACY_CLASSES], ["failoverMode", AI_FAILOVER_MODES],
    ["capBehavior", AI_CAP_BEHAVIORS]] as const) {
    if (typeof raw[key] !== "string" || !(choices as readonly string[]).includes(raw[key] as string)) invalid("Choose supported policy settings.");
  }
  if (typeof raw.currency !== "string" || !/^[A-Z]{3}$/.test(raw.currency)) invalid("Currency must be a three-letter uppercase code.");
  for (const key of ["dailyBudgetMinor", "campaignBudgetMinor", "monthlyBudgetMinor"] as const) {
    const value = raw[key];
    if (Object.hasOwn(raw, key) && (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1_000_000_000)) {
      invalid("Each supplied budget must be an integer from 1 through 1,000,000,000 in the existing policy units.");
    }
  }
  if (!Array.isArray(raw.alertThresholdPercentages) || Object.getPrototypeOf(raw.alertThresholdPercentages) !== Array.prototype) invalid("Provide ordinary ascending alert percentages.");
  const thresholds = raw.alertThresholdPercentages as unknown[];
  // Never invoke accessors on caller-owned arrays or accept sparse/extra properties.
  const arrayDescriptors = Object.getOwnPropertyDescriptors(thresholds);
  if (Reflect.ownKeys(arrayDescriptors).some(key => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)
    || !("value" in arrayDescriptors[key]!) || !arrayDescriptors[key]!.enumerable))
    || thresholds.length < 1 || thresholds.length > 5 || Object.keys(thresholds).length !== thresholds.length) invalid("Provide one to five ordinary alert percentages.");
  const copied = thresholds.map(value => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100) invalid("Alert percentages must be integers from 1 through 100.");
    return value as number;
  });
  if (copied.some((value, index) => index > 0 && value <= copied[index - 1]!)) invalid("Alert percentages must be unique and ascending.");
  const request: AiPolicySaveRequest = {
    workspaceId: aiPolicySaveUuid(raw.workspaceId), requestId: aiPolicySaveUuid(raw.requestId), expectedRevision: raw.expectedRevision as number,
    mode: raw.mode as WorkspaceAiPolicyWrite["mode"], maximumPrivacyClass: raw.maximumPrivacyClass as WorkspaceAiPolicyWrite["maximumPrivacyClass"],
    failoverMode: raw.failoverMode as WorkspaceAiPolicyWrite["failoverMode"], capBehavior: raw.capBehavior as WorkspaceAiPolicyWrite["capBehavior"],
    currency: raw.currency as string,
    ...(Object.hasOwn(raw, "dailyBudgetMinor") ? { dailyBudgetMinor: raw.dailyBudgetMinor as number } : {}),
    ...(Object.hasOwn(raw, "campaignBudgetMinor") ? { campaignBudgetMinor: raw.campaignBudgetMinor as number } : {}),
    ...(Object.hasOwn(raw, "monthlyBudgetMinor") ? { monthlyBudgetMinor: raw.monthlyBudgetMinor as number } : {}),
    alertThresholdPercentages: Object.freeze(copied),
  };
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > AI_POLICY_SAVE_LIMITS.requestBytes) invalid("Policy request exceeds the bounded limit.");
  return Object.freeze(request);
}
export function aiPolicySaveValues(request: AiPolicySaveRequest): WorkspaceAiPolicyWrite {
  const { requestId: _requestId, expectedRevision: _expectedRevision, ...policy } = request;
  return policy;
}
