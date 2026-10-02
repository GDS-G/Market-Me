import { z } from "zod";

/** Browser-safe, closed wire/storage contracts; never import database runtime here. */
export const BUDGET_ACTION_LIMITS = Object.freeze({ requestBytes: 8192, recoveryBytes: 16384, responseBytes: 16384, timeoutMs: 20_000 });
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const explanation = z.string().trim().min(1).max(1000);
export const budgetActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("acknowledge_alert"), workspaceId: uuid, targetId: uuid }).strict(),
  z.object({ kind: z.literal("request_exception"), workspaceId: uuid, targetId: uuid, justification: explanation }).strict(),
  z.object({ kind: z.literal("decide_exception"), workspaceId: uuid, targetId: uuid, decision: z.enum(["approved", "rejected"]), note: explanation.optional() }).strict(),
]);
export const budgetActionTargetSchema = z.object({ workspaceId: uuid, kind: z.enum(["acknowledge_alert", "request_exception", "decide_exception"]), targetId: uuid }).strict();
export type BudgetAction = z.infer<typeof budgetActionSchema>;
export type BudgetActionTarget = z.infer<typeof budgetActionTargetSchema>;
export type BudgetActionScope = { userId: string; workspaceId: string };
const attemptSchema = z.object({ version: z.literal(1), userId: uuid, action: budgetActionSchema }).strict();
export type BudgetActionAttempt = z.infer<typeof attemptSchema>;
const timestamp = z.string().datetime({ offset: true });
export const budgetActionStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("alert"), workspaceId: uuid, id: uuid, status: z.enum(["open", "acknowledged"]), acknowledgedBy: uuid.optional(), acknowledgedAt: timestamp.optional() }).strict(),
  z.object({ kind: z.literal("exception"), workspaceId: uuid, id: uuid, deniedReservationId: uuid, status: z.enum(["pending", "approved", "rejected", "expired"]), justification: explanation,
    requestedBy: uuid, resolvedBy: uuid.optional(), decisionNote: explanation.optional(), expiresAt: timestamp, resolvedAt: timestamp.optional(), consumedAt: timestamp.optional() }).strict(),
]);
export type BudgetActionState = z.infer<typeof budgetActionStateSchema>;
const envelopeSchema = z.object({ data: budgetActionStateSchema }).strict();
const bytes = (value: string) => new TextEncoder().encode(value).length;
export function budgetActionStorageKey(scope: BudgetActionScope) {
  return `market-me:ai-budget-action:v1:${uuid.parse(scope.userId)}:${uuid.parse(scope.workspaceId)}`;
}
export function makeBudgetActionAttempt(scope: BudgetActionScope, action: unknown): BudgetActionAttempt {
  const parsed = attemptSchema.parse({ version: 1, userId: scope.userId, action });
  if (parsed.action.workspaceId !== uuid.parse(scope.workspaceId)) throw new Error("Wrong workspace.");
  if (bytes(JSON.stringify(parsed)) > BUDGET_ACTION_LIMITS.recoveryBytes) throw new Error("Recovery data exceeds its limit.");
  return Object.freeze({ ...parsed, action: Object.freeze(parsed.action) });
}
export function restoreBudgetActionAttempt(raw: string | null, scope: BudgetActionScope) {
  if (raw === null) return undefined;
  if (bytes(raw) > BUDGET_ACTION_LIMITS.recoveryBytes) throw new Error("Recovery data exceeds its limit.");
  const parsed = attemptSchema.parse(JSON.parse(raw));
  if (parsed.userId !== uuid.parse(scope.userId)) throw new Error("Wrong account.");
  return makeBudgetActionAttempt(scope, parsed.action);
}
type StorageAccess = Pick<Storage, "getItem" | "setItem">;
export function persistBudgetActionAttempt(storage: StorageAccess, scope: BudgetActionScope, attempt: BudgetActionAttempt) {
  const exact = restoreBudgetActionAttempt(JSON.stringify(attempt), scope)!;
  const key = budgetActionStorageKey(scope), raw = JSON.stringify(exact), existing = storage.getItem(key);
  if (existing !== null && existing !== raw) throw new Error("An earlier action is retained.");
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("Recovery data was not retained.");
  return exact;
}
export function budgetActionEndpoint(action: BudgetAction) {
  if (action.kind === "acknowledge_alert") return { url: `/api/v1/ai-budget-alerts/${action.targetId}/acknowledge`, method: "PATCH", body: { workspaceId: action.workspaceId } };
  if (action.kind === "request_exception") return { url: "/api/v1/ai-spend-exceptions", method: "POST", body: { workspaceId: action.workspaceId, deniedReservationId: action.targetId, justification: action.justification } };
  return { url: `/api/v1/ai-spend-exceptions/${action.targetId}/decision`, method: "PATCH", body: { workspaceId: action.workspaceId, decision: action.decision, ...(action.note ? { note: action.note } : {}) } };
}
export async function readBudgetActionJson(message: Pick<Response, "headers" | "body">, limit: number): Promise<unknown> {
  if (message.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new Error("Expected JSON.");
  if (Number(message.headers.get("content-length")) > limit) throw new Error("JSON exceeds its limit.");
  const reader = message.body?.getReader(); if (!reader) throw new Error("Missing JSON.");
  let length = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error("JSON exceeds its limit."); } chunks.push(part.value); }
    const buffer = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } finally { reader.releaseLock(); }
}
export function verifyBudgetActionState(action: BudgetAction, raw: unknown): BudgetActionState {
  const state = budgetActionStateSchema.parse(raw);
  if (state.workspaceId !== action.workspaceId) throw new Error("Wrong workspace result.");
  if (action.kind === "acknowledge_alert") {
    if (state.kind !== "alert" || state.id !== action.targetId) throw new Error("Wrong alert result.");
    if (state.status === "acknowledged" && (!state.acknowledgedBy || !state.acknowledgedAt)) throw new Error("Incomplete acknowledgement.");
    if (state.status === "open" && (state.acknowledgedBy || state.acknowledgedAt)) throw new Error("Inconsistent open alert.");
  } else {
    if (state.kind !== "exception" || (action.kind === "request_exception" ? state.deniedReservationId !== action.targetId : state.id !== action.targetId)) throw new Error("Wrong exception result.");
    if (["approved", "rejected"].includes(state.status) && (!state.resolvedBy || !state.resolvedAt)) throw new Error("Incomplete decision.");
    if (state.status === "pending" && (state.resolvedBy || state.resolvedAt || state.consumedAt || state.decisionNote)) throw new Error("Inconsistent pending request.");
    if (state.consumedAt && state.status !== "approved" && state.status !== "expired") throw new Error("Inconsistent consumption.");
  }
  return Object.freeze(state);
}
export async function runBudgetActionAttempt(storage: StorageAccess, scope: BudgetActionScope, attempt: BudgetActionAttempt, lookup: boolean): Promise<BudgetActionState> {
  const exact = persistBudgetActionAttempt(storage, scope, attempt), action = exact.action;
  const endpoint = budgetActionEndpoint(action), body = JSON.stringify(endpoint.body);
  if (bytes(body) > BUDGET_ACTION_LIMITS.requestBytes) throw new Error("Action exceeds its request limit.");
  const query = new URLSearchParams({ workspaceId: action.workspaceId, kind: action.kind, targetId: action.targetId });
  const response = await fetch(lookup ? `/api/v1/ai-budget-actions/state?${query}` : endpoint.url, {
    method: lookup ? "GET" : endpoint.method, cache: "no-store", signal: AbortSignal.timeout(BUDGET_ACTION_LIMITS.timeoutMs),
    ...(lookup ? {} : { headers: { "content-type": "application/json" }, body }),
  });
  // Do not surface arbitrary server text or turn an unexpected 2xx into confirmation.
  if (response.status !== (lookup || action.kind !== "request_exception" ? 200 : 201)) {
    if (response.status === 401 || response.status === 403) throw new Error("Current account permission could not be confirmed.");
    if (response.status === 404) throw new Error("No saved result was found. The original action could still finish.");
    throw new Error("No confirmed result was received.");
  }
  const envelope = envelopeSchema.parse(await readBudgetActionJson(response, BUDGET_ACTION_LIMITS.responseBytes));
  return verifyBudgetActionState(action, envelope.data);
}
/** Deliberately distinguishes an existing entity from proof that this actor's action won. */
export function budgetActionResultText(attempt: BudgetActionAttempt, state: BudgetActionState): string {
  const { action, userId } = attempt;
  if (state.kind === "alert") return state.status === "open" ? "The alert is currently open. The earlier action may still finish."
    : state.acknowledgedBy === userId ? "This account's acknowledgement is saved." : "The alert was acknowledged by another account; this is not confirmation of your action.";
  if (action.kind === "request_exception" && (state.requestedBy !== userId || state.justification !== action.justification))
    return `An existing exception has different request details or another author. Its current state is ${state.status}; your explanation was not saved as a new request.`;
  if (action.kind === "decide_exception") {
    if (state.status === "pending") return "The exception is currently pending. The earlier decision may still finish.";
    if (state.status === "expired") return "The exception has expired. This result does not confirm the requested approval or rejection.";
    if (state.status !== action.decision || state.resolvedBy !== userId || state.decisionNote !== action.note)
      return `An existing ${state.status} decision differs from your action or its author. No replacement decision is confirmed.`;
  }
  return state.consumedAt ? "The exception record is saved and has already been consumed. No new reservation was made by this check."
    : `The exception record is saved. Its current state is ${state.status}. No provider call or spending reservation was made by this check.`;
}
