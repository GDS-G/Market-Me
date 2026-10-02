import { z } from "zod";

// Browser-only independent schemas: never import SQL, Node or server authority.
export const ACTIVATION_BROWSER_LIMITS = Object.freeze({ requestBytes: 2_048, responseBytes: 65_536, storedBytes: 4_096, timeoutMs: 15_000, previewSteps: 100 });
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const request = z.strictObject({ workspaceId: uuid, campaignId: uuid, requestId: uuid, expectedVersionId: uuid, expectedActorIncarnationId: uuid });
const accepted = request.extend({ instanceId: uuid, initialStatus: z.enum(["scheduled", "awaiting_approval"]), acceptedAt: z.iso.datetime() });
const closed = request.extend({ closedAt: z.iso.datetime() });
const outcome = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("accepted"), receipt: accepted }), z.strictObject({ kind: z.literal("closed"), receipt: closed })]);
const step = z.strictObject({ stepKey: z.string().min(1).max(100), name: z.string().min(1).max(200), operationType: z.string().min(1).max(100), scheduleType: z.string().min(1).max(100), approvalRequired: z.boolean() });
const previewFields = { workspaceId: uuid, campaignId: uuid, versionId: uuid, versionNumber: z.number().int().positive(),
  campaignName: z.string().min(1).max(200), autonomyMode: z.string().min(1).max(100), timezone: z.string().min(1).max(100), observedAt: z.iso.datetime(), steps: z.array(step).min(1).max(100).readonly() };
const preview = z.discriminatedUnion("canActivate", [z.strictObject({ ...previewFields, canActivate: z.literal(false) }), z.strictObject({ ...previewFields, canActivate: z.literal(true), actorIncarnationId: uuid })]);
const attempt = z.strictObject({ schemaVersion: z.literal(1), userId: uuid, request });
export class ActivationClientError extends Error {}
export type ActivationScope = Readonly<{ userId: string; workspaceId: string; campaignId: string }>;
export type ActivationPreview = Readonly<z.infer<typeof preview>>;
export type ActivationAttempt = Readonly<z.infer<typeof attempt>>;
export type ActivationOutcome = Readonly<z.infer<typeof outcome>>;
export type ActivationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
function scopeIds(scope: ActivationScope) { return { userId: uuid.parse(scope.userId), workspaceId: uuid.parse(scope.workspaceId), campaignId: uuid.parse(scope.campaignId) }; }
export function parseActivationPreview(value: unknown, scope: ActivationScope): ActivationPreview {
  const selected = scopeIds(scope), result = preview.parse(value);
  if (result.workspaceId !== selected.workspaceId || result.campaignId !== selected.campaignId
    || new Set(result.steps.map(s => s.stepKey)).size !== result.steps.length) throw new ActivationClientError("Reload the published version for this workspace and campaign.");
  return Object.freeze({ ...result, steps: Object.freeze(result.steps.map(s => Object.freeze(s))) });
}
export function parseActivationAttempt(value: unknown, scope: ActivationScope): ActivationAttempt {
  const selected = scopeIds(scope), result = attempt.parse(value);
  if (result.userId !== selected.userId || result.request.workspaceId !== selected.workspaceId || result.request.campaignId !== selected.campaignId) throw new ActivationClientError("The retained request belongs to another account, workspace or campaign.");
  if (byteLength(JSON.stringify(result.request)) > ACTIVATION_BROWSER_LIMITS.requestBytes) throw new ActivationClientError("The activation request exceeds its limit.");
  return Object.freeze({ ...result, request: Object.freeze(result.request) });
}
export function makeActivationAttempt(scope: ActivationScope, value: ActivationPreview, requestId: string): ActivationAttempt {
  const selected = parseActivationPreview(value, scope);
  if (!selected.canActivate) throw new ActivationClientError("Current writer access is required for a new run.");
  return parseActivationAttempt({ schemaVersion: 1, userId: scope.userId, request: { workspaceId: selected.workspaceId, campaignId: selected.campaignId,
    requestId, expectedVersionId: selected.versionId, expectedActorIncarnationId: selected.actorIncarnationId } }, scope);
}
export function parseActivationOutcome(value: unknown, original: ActivationAttempt, scope: ActivationScope): ActivationOutcome {
  const exact = parseActivationAttempt(original, scope), result = outcome.parse(value);
  if (Object.entries(exact.request).some(([key,value]) => result.receipt[key as keyof typeof exact.request] !== value)) throw new ActivationClientError("The result does not match the exact original activation request.");
  return result.kind === "accepted" ? Object.freeze({ kind: "accepted", receipt: Object.freeze(result.receipt) })
    : Object.freeze({ kind: "closed", receipt: Object.freeze(result.receipt) });
}
export function activationStorageKey(scope: ActivationScope): string {
  const s = scopeIds(scope); return `market-me:campaign-activation:v1:${s.userId}:${s.workspaceId}:${s.campaignId}`;
}
export function loadActivationAttempt(storage: ActivationStorage, scope: ActivationScope): ActivationAttempt | undefined {
  const text = storage.getItem(activationStorageKey(scope)); if (text === null) return undefined;
  if (byteLength(text) > ACTIVATION_BROWSER_LIMITS.storedBytes) throw new ActivationClientError("The retained recovery data is too large. No new activation was sent.");
  return parseActivationAttempt(JSON.parse(text), scope);
}
export function retainActivationAttempt(storage: ActivationStorage, scope: ActivationScope, value: ActivationAttempt): ActivationAttempt {
  const exact = parseActivationAttempt(value, scope), prior = loadActivationAttempt(storage, scope), serialized = JSON.stringify(exact);
  if (prior && JSON.stringify(prior) !== serialized) throw new ActivationClientError("Resolve the retained original request before creating another.");
  storage.setItem(activationStorageKey(scope), serialized);
  // A failing/no-op storage adapter cannot allow an unrecorded POST.
  if (storage.getItem(activationStorageKey(scope)) !== serialized) throw new ActivationClientError("Recovery data could not be retained. Nothing was sent.");
  return exact;
}
export function forgetResolvedActivation(storage: ActivationStorage, scope: ActivationScope, original: ActivationAttempt, result: ActivationOutcome): void {
  parseActivationOutcome(result, original, scope);
  const prior = loadActivationAttempt(storage, scope);
  if (!prior || JSON.stringify(prior) !== JSON.stringify(parseActivationAttempt(original, scope))) throw new ActivationClientError("The retained request changed. Reload before reviewing another run.");
  storage.removeItem(activationStorageKey(scope));
  if (storage.getItem(activationStorageKey(scope)) !== null) throw new ActivationClientError("Recovery data could not be cleared. No new activation was sent.");
}
export async function readActivationResponse(response: Response): Promise<unknown> {
  if (response.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase() !== "application/json"
    || Number(response.headers.get("content-length")) > ACTIVATION_BROWSER_LIMITS.responseBytes || !response.body) throw new ActivationClientError("No valid activation response was received.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
      if (length > ACTIVATION_BROWSER_LIMITS.responseBytes) { await reader.cancel(); throw new ActivationClientError("The activation response exceeds its limit."); } chunks.push(part.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { reader.releaseLock(); }
}
function failed(status: number): never {
  if (status === 401 || status === 403) throw new ActivationClientError("Your current account or workspace access changed. Sign in again and reload this campaign.");
  if (status === 404) throw new ActivationClientError("No committed original result was observed. The earlier request may still finish. Check again or explicitly close this original request; do not start a replacement.");
  if (status === 409) throw new ActivationClientError("The request, published version, grant or execution requirements conflict. Check or explicitly close the original request before a new review.");
  throw new ActivationClientError("No confirmed result was received. Check the retained original request before another action.");
}
function endpoint(scope: ActivationScope) { const s = scopeIds(scope); return `/api/v1/campaigns/${s.campaignId}/activate`; }
export async function loadActivationPreview(scope: ActivationScope, signal: AbortSignal, send: typeof fetch = fetch): Promise<ActivationPreview> {
  const path = endpoint(scope), query = new URLSearchParams({ workspaceId: scope.workspaceId }); signal.throwIfAborted();
  const response = await send(`${path}?${query}`, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal });
  const payload = await readActivationResponse(response); signal.throwIfAborted(); if (!response.ok) failed(response.status);
  if (response.status !== 200) throw new ActivationClientError("Unrecognized published-version review.");
  return parseActivationPreview(z.strictObject({ data: preview }).parse(payload).data, scope);
}
export async function runActivationAttempt(original: ActivationAttempt, scope: ActivationScope, action: "activate" | "lookup" | "close", signal: AbortSignal, send: typeof fetch = fetch): Promise<ActivationOutcome> {
  const exact = parseActivationAttempt(original, scope), path = endpoint(scope), lookup = action === "lookup";
  const query = new URLSearchParams({ workspaceId: scope.workspaceId, requestId: exact.request.requestId }); signal.throwIfAborted();
  const response = await send(lookup ? `${path}?${query}` : action === "close" ? `${path}/close` : path, {
    method: lookup ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    ...(lookup ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(exact.request) }),
  });
  const payload = await readActivationResponse(response); signal.throwIfAborted(); if (!response.ok) failed(response.status);
  if (action === "activate") {
    const saved = z.strictObject({ data: accepted, meta: z.strictObject({ replayed: z.boolean() }) }).parse(payload);
    if (response.status !== (saved.meta.replayed ? 200 : 202)) throw new ActivationClientError("Unrecognized activation acceptance.");
    return parseActivationOutcome({ kind: "accepted", receipt: saved.data }, exact, scope);
  }
  if (response.status !== 200) throw new ActivationClientError("Unrecognized original request result.");
  return parseActivationOutcome(z.strictObject({ data: outcome }).parse(payload).data, exact, scope);
}
export function createActivationGate() {
  let active: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | undefined;
  return { begin() {
    if (active) return undefined;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), ACTIVATION_BROWSER_LIMITS.timeoutMs), operation = { controller,timer }; active = operation;
    return { signal: controller.signal, current: () => active === operation && !controller.signal.aborted,
      finish: () => { clearTimeout(timer); if (active === operation) active = undefined; } };
  }, cancel() { if (active) { clearTimeout(active.timer); active.controller.abort(); active = undefined; } } };
}
