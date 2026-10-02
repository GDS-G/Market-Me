import { z } from "zod";

// Independent browser contracts: never import SQL, Node or server authorization.
export const EXECUTION_CONTROL_BROWSER_LIMITS = Object.freeze({ reason: 500, requestBytes: 4_096, responseBytes: 16_384, timeoutMs: 15_000, revision: 2_147_483_647 });
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const revision = z.number().int().min(1).max(EXECUTION_CONTROL_BROWSER_LIMITS.revision), state = z.enum(["open", "paused"]);
export class ExecutionControlClientError extends Error {}
export function normalizeExecutionReason(value: string): string {
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) throw new ExecutionControlClientError("Use a one-line reason without control or hidden formatting characters.");
  const reason = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!reason || reason.length > EXECUTION_CONTROL_BROWSER_LIMITS.reason) throw new ExecutionControlClientError("Use an execution-change reason of 1–500 characters.");
  return reason;
}
const reason = z.string().min(1).max(500).refine(value => { try { return normalizeExecutionReason(value) === value; } catch { return false; } });
const base = { workspaceId: uuid, state, revision, changedAt: z.iso.datetime() };
const snapshot = z.discriminatedUnion("canManage", [z.strictObject({ ...base, canManage: z.literal(false) }),
  z.strictObject({ ...base, canManage: z.literal(true), actorIncarnationId: uuid, reason: z.union([z.literal(""), reason]) })]);
const request = z.strictObject({ workspaceId: uuid, requestId: uuid, expectedActorIncarnationId: uuid,
  expectedRevision: revision.max(EXECUTION_CONTROL_BROWSER_LIMITS.revision - 1), state, reason });
const receipt = request.extend({ previousState: state, revision: revision.min(2), changedAt: z.iso.datetime() });
export type ExecutionControlScope = Readonly<{ userId: string; workspaceId: string }>;
export type ExecutionControlSnapshot = Readonly<z.infer<typeof snapshot>>;
export type ExecutionControlRequest = Readonly<z.infer<typeof request>>;
export type ExecutionControlReceipt = Readonly<z.infer<typeof receipt>>;
export type ExecutionControlAttempt = Readonly<{ userId: string; preview: ExecutionControlSnapshot; request: ExecutionControlRequest }>;
export function parseExecutionSnapshot(value: unknown, scope: ExecutionControlScope): ExecutionControlSnapshot {
  uuid.parse(scope.userId); const result = snapshot.parse(value);
  if (result.workspaceId !== uuid.parse(scope.workspaceId) || result.canManage && (result.revision === 1 ? result.reason !== "" || result.state !== "open" : result.reason === "")) {
    throw new ExecutionControlClientError("Reload execution state for your current workspace.");
  }
  return Object.freeze(result);
}
export function makeExecutionAttempt(scope: ExecutionControlScope, preview: ExecutionControlSnapshot, requestId: string, note: string): ExecutionControlAttempt {
  const exact = parseExecutionSnapshot(preview, scope);
  if (!exact.canManage || exact.revision >= EXECUTION_CONTROL_BROWSER_LIMITS.revision) throw new ExecutionControlClientError("Current administration and an available revision are required.");
  const intent = request.parse({ workspaceId: exact.workspaceId, requestId, expectedActorIncarnationId: exact.actorIncarnationId,
    expectedRevision: exact.revision, state: exact.state === "open" ? "paused" : "open", reason: normalizeExecutionReason(note) });
  if (new TextEncoder().encode(JSON.stringify(intent)).byteLength > EXECUTION_CONTROL_BROWSER_LIMITS.requestBytes) throw new ExecutionControlClientError("The reviewed request exceeds its size limit.");
  return Object.freeze({ userId: uuid.parse(scope.userId), preview: exact, request: Object.freeze(intent) });
}
function checkAttempt(attempt: ExecutionControlAttempt, scope: ExecutionControlScope) {
  if (attempt.userId !== scope.userId) throw new ExecutionControlClientError("The original request belongs to another account.");
  const exact = makeExecutionAttempt(scope, attempt.preview, attempt.request.requestId, attempt.request.reason);
  if (JSON.stringify(request.parse(attempt.request)) !== JSON.stringify(exact.request)) throw new ExecutionControlClientError("The request differs from the reviewed intent.");
  return exact;
}
export function parseExecutionReceipt(value: unknown, attempt: ExecutionControlAttempt): ExecutionControlReceipt {
  const result = receipt.parse(value), original = attempt.request;
  if (Object.keys(original).some(key => result[key as keyof ExecutionControlRequest] !== original[key as keyof ExecutionControlRequest])
    || result.previousState !== attempt.preview.state || result.state === result.previousState || result.revision !== original.expectedRevision + 1) {
    throw new ExecutionControlClientError("The result does not match the exact original execution-change request.");
  }
  return Object.freeze(result);
}
export async function readExecutionResponse(response: Response): Promise<unknown> {
  const maximum = EXECUTION_CONTROL_BROWSER_LIMITS.responseBytes;
  if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
    || Number(response.headers.get("content-length")) > maximum || !response.body) throw new ExecutionControlClientError("No valid execution-control result was received.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new ExecutionControlClientError("The result exceeds its size limit."); } chunks.push(part.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { reader.releaseLock(); }
}
function failedResponse(status: number): never {
  if (status === 401 || status === 403) throw new ExecutionControlClientError("Your current account or workspace authority changed. Sign in again and reload execution settings.");
  if (status === 404) throw new ExecutionControlClientError("No confirmed original result was found. The earlier request may still finish; checking never resends it.");
  if (status === 409) throw new ExecutionControlClientError("The state, grant or request conflicts. Check the original result, then reload for a fresh review.");
  throw new ExecutionControlClientError("No confirmed result was received. Check any original request before another change.");
}
export async function loadExecutionSnapshot(scope: ExecutionControlScope, signal: AbortSignal, send: typeof fetch = fetch): Promise<ExecutionControlSnapshot> {
  uuid.parse(scope.userId); const query = new URLSearchParams({ workspaceId: uuid.parse(scope.workspaceId) }); signal.throwIfAborted();
  const response = await send(`/api/v1/workspace-execution-control?${query}`, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal });
  const payload = await readExecutionResponse(response); signal.throwIfAborted();
  if (!response.ok) failedResponse(response.status); if (response.status !== 200) throw new ExecutionControlClientError("Unrecognized current-state result.");
  return parseExecutionSnapshot(z.strictObject({ data: snapshot }).parse(payload).data, scope);
}
export async function runExecutionAttempt(attempt: ExecutionControlAttempt, scope: ExecutionControlScope, lookup: boolean, signal: AbortSignal, send: typeof fetch = fetch): Promise<ExecutionControlReceipt> {
  const exact = checkAttempt(attempt, scope); signal.throwIfAborted();
  const query = new URLSearchParams({ workspaceId: exact.request.workspaceId, requestId: exact.request.requestId });
  const response = await send(lookup ? `/api/v1/workspace-execution-control?${query}` : "/api/v1/workspace-execution-control", {
    method: lookup ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    ...(lookup ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(exact.request) }),
  });
  const payload = await readExecutionResponse(response); signal.throwIfAborted();
  if (!response.ok) failedResponse(response.status);
  if (lookup) {
    if (response.status !== 200) throw new ExecutionControlClientError("Unrecognized original result.");
    return parseExecutionReceipt(z.strictObject({ data: receipt }).parse(payload).data, exact);
  }
  const saved = z.strictObject({ data: receipt, meta: z.strictObject({ replayed: z.boolean() }) }).parse(payload);
  if (response.status !== (saved.meta.replayed ? 200 : 201)) throw new ExecutionControlClientError("Unrecognized transition result.");
  return parseExecutionReceipt(saved.data, exact);
}
export function createExecutionControlGate() {
  let active: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | undefined;
  return {
    begin() {
      if (active) return undefined;
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), EXECUTION_CONTROL_BROWSER_LIMITS.timeoutMs), operation = { controller, timer };
      active = operation;
      return { signal: controller.signal, current: () => active === operation && !controller.signal.aborted,
        finish: () => { clearTimeout(timer); if (active === operation) active = undefined; } };
    },
    cancel() { if (active) { clearTimeout(active.timer); active.controller.abort(); active = undefined; } },
  };
}
