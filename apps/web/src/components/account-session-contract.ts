import { z } from "zod";

export const ACCOUNT_SESSION_BROWSER_LIMITS = Object.freeze({ pageSize: 30, requestBytes: 2_048, responseBytes: 16_384, timeoutMs: 15_000 });
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const session = z.strictObject({ sessionId: uuid, createdAt: z.iso.datetime(), lastSeenAt: z.iso.datetime(), expiresAt: z.iso.datetime() });
const snapshot = z.strictObject({ accountId: uuid, observedAt: z.iso.datetime(), current: session,
  others: z.array(session).max(30), totalOthers: z.string().max(19).regex(/^(0|[1-9]\d*)$/), nextCursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).nullable(),
}).refine(value => new Set([value.current.sessionId, ...value.others.map(item => item.sessionId)]).size === value.others.length + 1
  && BigInt(value.totalOthers) >= BigInt(value.others.length) && (!value.nextCursor || value.others.length === 30 && BigInt(value.totalOthers) > BigInt(30)));
const request = z.strictObject({ accountId: uuid, requestId: uuid, targetSessionId: uuid });
const receipt = request.extend({ revokedAt: z.iso.datetime() });
const envelope = z.strictObject({ data: receipt, meta: z.strictObject({ replayed: z.boolean() }).optional() });
export type AccountSessionList = z.infer<typeof snapshot>;
export type AccountSessionItem = z.infer<typeof session>;
export type AccountSessionIntent = Readonly<z.infer<typeof request>>;
export type AccountSessionResult = z.infer<typeof receipt>;
export function parseAccountSessionSnapshot(value: unknown, accountId: string): AccountSessionList {
  const result = snapshot.parse(value); if (result.accountId !== accountId) throw new Error("Reload your own session list."); return result;
}
export function makeAccountSessionIntent(list: AccountSessionList, targetSessionId: string, requestId: string): AccountSessionIntent {
  if (targetSessionId === list.current.sessionId || !list.others.some(item => item.sessionId === targetSessionId)) throw new Error("Review one other session from the current list.");
  return Object.freeze(request.parse({ accountId: list.accountId, requestId, targetSessionId }));
}
export function accountSessionLookupPath(intent: AccountSessionIntent): string {
  const exact = request.parse(intent); return `/api/v1/account-sessions?${new URLSearchParams({ accountId: exact.accountId, requestId: exact.requestId })}`;
}
export function parseAccountSessionReceipt(value: unknown, intent: AccountSessionIntent): AccountSessionResult {
  const result = receipt.parse(value);
  if (result.accountId !== intent.accountId || result.requestId !== intent.requestId || result.targetSessionId !== intent.targetSessionId) throw new Error("The result does not match the original session selection.");
  return result;
}
export async function readAccountSessionResponse(response: Response): Promise<unknown> {
  const maximum = ACCOUNT_SESSION_BROWSER_LIMITS.responseBytes;
  if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
    || Number(response.headers.get("content-length")) > maximum || !response.body) throw new Error("No valid session result was received.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new Error("The session result exceeds its size limit."); } chunks.push(part.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { reader.releaseLock(); }
}
export async function runAccountSessionIntent(intent: AccountSessionIntent, lookup: boolean, signal: AbortSignal, send: typeof fetch = fetch): Promise<AccountSessionResult> {
  const exact = request.parse(intent), body = JSON.stringify(exact);
  if (new TextEncoder().encode(body).byteLength > ACCOUNT_SESSION_BROWSER_LIMITS.requestBytes) throw new Error("The session request exceeds its size limit.");
  signal.throwIfAborted();
  const response = await send(lookup ? accountSessionLookupPath(exact) : "/api/v1/account-sessions", {
    method: lookup ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    ...(lookup ? {} : { headers: { "content-type": "application/json" }, body }),
  });
  const payload = await readAccountSessionResponse(response); signal.throwIfAborted();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("Your sign-in session or account changed. Sign in again and reload your own settings.");
    if (response.status === 404) throw new Error("No confirmed result was found. The earlier request may still finish; checking never resends it.");
    if (response.status === 409) throw new Error("The selected session or request conflicts. Check the original result and reload current sessions.");
    throw new Error("No confirmed result was received. Check the original session request before another action.");
  }
  if (response.status !== 200 && (lookup || response.status !== 201)) throw new Error("Unrecognized session result.");
  return parseAccountSessionReceipt(envelope.parse(payload).data, exact);
}
export function createAccountSessionGate() {
  let active: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | undefined;
  return {
    begin() {
      if (active) return undefined;
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), ACCOUNT_SESSION_BROWSER_LIMITS.timeoutMs), operation = { controller, timer };
      active = operation;
      return { signal: controller.signal, current: () => active === operation && !controller.signal.aborted,
        finish: () => { clearTimeout(timer); if (active === operation) active = undefined; } };
    },
    cancel() { if (active) { clearTimeout(active.timer); active.controller.abort(); active = undefined; } },
  };
}
