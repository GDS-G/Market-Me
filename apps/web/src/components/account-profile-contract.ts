import { z } from "zod";

// Browser validation protects form state; the server independently enforces authority and shape.
export const ACCOUNT_PROFILE_BROWSER_LIMITS = Object.freeze({ displayName: 120, requestBytes: 4_096, responseBytes: 8_192, timeoutMs: 15_000 });
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const revision = z.number().int().min(1).max(2_147_483_647);
export function normalizeAccountDisplayName(value: string) {
  if (value.length > ACCOUNT_PROFILE_BROWSER_LIMITS.requestBytes || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) throw new Error("Use a plain display name without control characters or unpaired surrogates.");
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > ACCOUNT_PROFILE_BROWSER_LIMITS.displayName) throw new Error("Use a display name of 1–120 characters.");
  return normalized;
}
const name = z.string().min(1).max(120).refine(value => { try { return normalizeAccountDisplayName(value) === value; } catch { return false; } });
const requestSchema = z.strictObject({ accountId: uuid, requestId: uuid, expectedRevision: revision, displayName: name });
const receiptSchema = z.strictObject({ accountId: uuid, requestId: uuid, displayName: name, revision, changed: z.boolean(), createdAt: z.iso.datetime() });
const resultSchema = z.strictObject({ data: receiptSchema, meta: z.strictObject({ replayed: z.boolean() }).optional() });
export type AccountProfileIntent = Readonly<z.infer<typeof requestSchema>>;
export type AccountProfileResult = z.infer<typeof receiptSchema>;
export type AccountProfileView = { accountId: string; displayName: string; revision: number };
export function makeAccountProfileIntent(profile: AccountProfileView, displayName: string, requestId: string): AccountProfileIntent {
  return Object.freeze(requestSchema.parse({ accountId: profile.accountId, requestId, expectedRevision: profile.revision, displayName: normalizeAccountDisplayName(displayName) }));
}
export function parseAccountProfileReceipt(value: unknown, request: AccountProfileIntent): AccountProfileResult {
  const result = receiptSchema.parse(value);
  if (result.accountId !== request.accountId || result.requestId !== request.requestId || result.displayName !== request.displayName
    || result.revision !== request.expectedRevision + (result.changed ? 1 : 0)) throw new Error("The result does not match your exact display-name request.");
  return result;
}
export function accountProfileLookupPath(request: AccountProfileIntent) {
  const exact = requestSchema.parse(request);
  return `/api/v1/account-profile?${new URLSearchParams({ accountId: exact.accountId, requestId: exact.requestId })}`;
}
export async function readAccountProfileResponse(response: Response): Promise<unknown> {
  const maximum = ACCOUNT_PROFILE_BROWSER_LIMITS.responseBytes;
  if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
    || Number(response.headers.get("content-length")) > maximum || !response.body) throw new Error("No valid profile result was received.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new Error("The profile result exceeds its size limit."); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { reader.releaseLock(); }
}
export async function runAccountProfileIntent(request: AccountProfileIntent, lookup: boolean, signal: AbortSignal, send: typeof fetch = fetch): Promise<AccountProfileResult> {
  const exact = requestSchema.parse(request), body = JSON.stringify(exact);
  if (new TextEncoder().encode(body).byteLength > ACCOUNT_PROFILE_BROWSER_LIMITS.requestBytes) throw new Error("Profile settings exceed the request limit.");
  signal.throwIfAborted();
  const response = await send(lookup ? accountProfileLookupPath(exact) : "/api/v1/account-profile", {
    method: lookup ? "GET" : "POST", cache: "no-store", credentials: "same-origin", redirect: "error", signal,
    ...(lookup ? {} : { headers: { "content-type": "application/json" }, body }),
  });
  const payload = await readAccountProfileResponse(response); signal.throwIfAborted();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("Your sign-in account or access changed. Reload current settings before continuing.");
    if (response.status === 409) throw new Error("Your profile or request changed. Check the original result and reload current settings before another save.");
    if (response.status === 404 && lookup) throw new Error("No confirmed result was found yet. The earlier save may still finish; checking does not resend it.");
    throw new Error("No confirmed result was received. Check the original request before another save.");
  }
  if (response.status !== 200 && (lookup || response.status !== 201)) throw new Error("Unrecognized profile result.");
  return parseAccountProfileReceipt(resultSchema.parse(payload).data, exact);
}

/** Form-local duplicate/late-result fence. Cancellation never claims a server rollback. */
export function createAccountProfileGate() {
  let active: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | undefined;
  return {
    begin() {
      if (active) return undefined;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ACCOUNT_PROFILE_BROWSER_LIMITS.timeoutMs);
      const operation = { controller, timer }; active = operation;
      return { signal: controller.signal, current: () => active === operation && !controller.signal.aborted,
        finish: () => { clearTimeout(timer); if (active === operation) active = undefined; } };
    },
    cancel() { if (active) { clearTimeout(active.timer); active.controller.abort(); active = undefined; } },
  };
}
