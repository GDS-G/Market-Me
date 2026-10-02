import { z } from "zod";
import { AI_CAP_BEHAVIORS, AI_FAILOVER_MODES, AI_MODES, AI_PRIVACY_CLASSES } from "@market-me/domain";
import type { AiPolicyFormValues } from "./ai-policy-presentation";

// Browser contract only. Persistence independently validates and authorizes every action.
export const AI_POLICY_BROWSER_LIMITS = Object.freeze({ requestBytes: 4_096, recoveryBytes: 8_192, responseBytes: 8_192, timeoutMs: 20_000 });
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const revision = z.number().int().min(0).max(2_147_483_647);
const budget = z.number().int().min(1).max(1_000_000_000);
const policyFields = { mode: z.enum(AI_MODES), maximumPrivacyClass: z.enum(AI_PRIVACY_CLASSES), failoverMode: z.enum(AI_FAILOVER_MODES),
  capBehavior: z.enum(AI_CAP_BEHAVIORS), currency: z.string().regex(/^[A-Z]{3}$/), dailyBudgetMinor: budget.optional(),
  campaignBudgetMinor: budget.optional(), monthlyBudgetMinor: budget.optional(), alertThresholdPercentages: z.array(z.number().int().min(1).max(100))
    .min(1).max(5).refine(values => values.every((value, index) => !index || value > values[index - 1]!)) };
const requestSchema = z.strictObject({ workspaceId: uuid, requestId: uuid, expectedRevision: revision, ...policyFields });
const policySchema = z.strictObject({ workspaceId: uuid, ...policyFields });
const attemptSchema = z.strictObject({ version: z.literal(1), userId: uuid, request: requestSchema });
const receiptSchema = z.strictObject({ workspaceId: uuid, requestId: uuid, revision: revision.refine(value => value > 0), policy: policySchema, createdAt: z.iso.datetime() });
export type PolicySaveRequest = z.infer<typeof requestSchema>;
export type PolicySaveAttempt = z.infer<typeof attemptSchema>;
export type PolicySaveReceipt = z.infer<typeof receiptSchema>;
export type PolicySaveScope = { userId: string; workspaceId: string };
type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const size = (value: string) => new TextEncoder().encode(value).byteLength;

/** Keep the existing hundredths convention. Invalid nonempty caps must never silently disappear. */
export function policySaveRequestFromValues(scope: PolicySaveScope, expectedRevision: number, requestId: string, values: AiPolicyFormValues): PolicySaveRequest {
  function cap(text: string): number | undefined {
    if (!text.trim()) return undefined;
    if (!/^\d+(?:\.\d{1,2})?$/.test(text.trim())) throw new Error("Use positive caps with at most two decimal places, or leave them blank.");
    const [whole, fraction = ""] = text.trim().split(".");
    return budget.parse(Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
  }
  const dailyBudgetMinor = cap(values.dailyBudget), campaignBudgetMinor = cap(values.campaignBudget), monthlyBudgetMinor = cap(values.monthlyBudget);
  const parts = values.alerts.split(",").map(value => value.trim());
  if (parts.some(value => !/^\d{1,3}$/.test(value))) throw new Error("Use one to five ascending, unique alert percentages from 1 through 100.");
  return requestSchema.parse({ workspaceId: scope.workspaceId, requestId, expectedRevision, mode: values.mode, maximumPrivacyClass: values.maximumPrivacyClass,
    failoverMode: values.failoverMode, capBehavior: values.capBehavior, currency: values.currency.trim().toUpperCase(),
    ...(dailyBudgetMinor === undefined ? {} : { dailyBudgetMinor }), ...(campaignBudgetMinor === undefined ? {} : { campaignBudgetMinor }),
    ...(monthlyBudgetMinor === undefined ? {} : { monthlyBudgetMinor }), alertThresholdPercentages: parts.map(Number) });
}
export function policySaveStorageKey(scope: PolicySaveScope) {
  return `market-me:ai-policy-save:v1:${uuid.parse(scope.userId)}:${uuid.parse(scope.workspaceId)}`;
}
function checkScope(attempt: PolicySaveAttempt, scope: PolicySaveScope): PolicySaveAttempt {
  if (attempt.userId !== scope.userId || attempt.request.workspaceId !== scope.workspaceId) throw new Error("Saved policy request belongs to another account or workspace.");
  if (size(JSON.stringify(attempt.request)) > AI_POLICY_BROWSER_LIMITS.requestBytes) throw new Error("Policy request is too large.");
  Object.freeze(attempt.request.alertThresholdPercentages); Object.freeze(attempt.request); return Object.freeze(attempt);
}
export function makePolicySaveAttempt(scope: PolicySaveScope, request: PolicySaveRequest): PolicySaveAttempt {
  return checkScope(attemptSchema.parse({ version: 1, userId: scope.userId, request }), scope);
}
export function restorePolicySaveAttempt(raw: string | null, scope: PolicySaveScope): PolicySaveAttempt | undefined {
  if (raw === null) return undefined;
  if (size(raw) > AI_POLICY_BROWSER_LIMITS.recoveryBytes) throw new Error("Saved policy request is too large.");
  return checkScope(attemptSchema.parse(JSON.parse(raw)), scope);
}
export function persistPolicySaveAttempt(storage: RecoveryStorage, scope: PolicySaveScope, attempt: PolicySaveAttempt): PolicySaveAttempt {
  const valid = checkScope(attemptSchema.parse(attempt), scope), key = policySaveStorageKey(scope), serialized = JSON.stringify(valid);
  const prior = restorePolicySaveAttempt(storage.getItem(key), scope);
  if (prior && JSON.stringify(prior) !== serialized) throw new Error("Another policy request is saved. Reload to recover it first.");
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error("Recovery storage did not retain the exact request. Nothing was sent.");
  return valid;
}
export function policySaveLookupPath(attempt: PolicySaveAttempt) {
  return `/api/v1/ai-policy/saves?${new URLSearchParams({ workspaceId: attempt.request.workspaceId, requestId: attempt.request.requestId })}`;
}
export function parsePolicySaveReceipt(value: unknown, attempt: PolicySaveAttempt): PolicySaveReceipt {
  const receipt = receiptSchema.parse(value), { requestId, expectedRevision, ...policy } = attempt.request;
  if (receipt.workspaceId !== policy.workspaceId || receipt.requestId !== requestId || receipt.revision !== expectedRevision + 1
    || JSON.stringify(receipt.policy) !== JSON.stringify(policySchema.parse(policy))) throw new Error("Result does not match the exact saved policy request.");
  return receipt;
}
export async function readPolicySaveResponse(response: Response): Promise<unknown> {
  const maximum = AI_POLICY_BROWSER_LIMITS.responseBytes;
  if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
    || Number(response.headers.get("content-length")) > maximum || !response.body) throw new Error("Invalid policy-save response.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new Error("Policy-save response is too large."); } chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { reader.releaseLock(); }
}
const resultSchema = z.strictObject({ data: receiptSchema, meta: z.strictObject({ replayed: z.boolean() }).optional() });
const errorSchema = z.strictObject({ error: z.strictObject({ code: z.string().min(1).max(80), message: z.string().min(1).max(1_000) }) });
const explanations: Readonly<Record<string, string>> = Object.freeze({
  not_found: "No completed result was found. An earlier save may still finish.",
  revision_conflict: "The loaded policy is no longer current. Check the saved result and reload current settings before choosing a separate request.",
  request_conflict: "This request identifier is already bound to different settings or another actor.",
  access_denied: "Your current access does not allow saving or recovering this policy.",
  authentication_required: "Sign in again before checking the saved request.",
  invalid_input: "The saved policy request is not valid. Check the current settings before clearing it.",
});
/** No automatic retry. An aborted response is an unknown outcome, never a rollback guarantee. */
export async function runPolicySaveAttempt(storage: RecoveryStorage, scope: PolicySaveScope, attempt: PolicySaveAttempt,
  lookup: boolean, send: typeof fetch = fetch): Promise<PolicySaveReceipt> {
  const exact = persistPolicySaveAttempt(storage, scope, attempt);
  const response = await send(lookup ? policySaveLookupPath(exact) : "/api/v1/ai-policy/saves", {
    ...(lookup ? { method: "GET" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(exact.request) }),
    cache: "no-store", signal: AbortSignal.timeout(AI_POLICY_BROWSER_LIMITS.timeoutMs),
  });
  const payload = await readPolicySaveResponse(response);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(payload);
    throw new Error(parsed.success && Object.hasOwn(explanations, parsed.data.error.code) ? explanations[parsed.data.error.code]
      : "No confirmed result. Check or retry the saved request; do not assume it failed.");
  }
  const result = resultSchema.parse(payload);
  if ((lookup && (response.status !== 200 || result.meta !== undefined)) || (!lookup &&
    ((response.status !== 200 && response.status !== 201) || result.meta?.replayed !== (response.status === 200)))) {
    throw new Error("Unrecognized policy-save result. Recover the saved request.");
  }
  return parsePolicySaveReceipt(result.data, exact);
}
