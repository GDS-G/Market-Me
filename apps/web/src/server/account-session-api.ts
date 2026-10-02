import { ACCOUNT_SESSION_LIMITS, AccountSessionError, accountSessionUuid, isAccountSessionError } from "@market-me/database";
import { AuthenticationError } from "./auth";
import { preparationOriginAllowed } from "./campaign-preparation-api";

class TransportError extends Error {
  constructor(readonly code: "origin_forbidden" | "unsupported_media_type" | "request_too_large", readonly status: number) { super(code); }
}
const MESSAGES = Object.freeze({
  origin_forbidden: "Manage your sessions from this application only.",
  unsupported_media_type: "Send the selected session as application/json.",
  request_too_large: "The session request exceeds its size limit.",
  invalid_input: "Provide one valid account, request and selected session. Reload the session list if its page expired.",
  access_denied: "Only your signed-in account sessions are available. Reload after changing accounts.",
  authentication_required: "Your current session is no longer active. Sign in again.",
  not_found: "No confirmed session result was found. An earlier request may still finish; checking never resends it.",
  request_conflict: "That request identifier belongs to another session selection. Check the original result.",
  current_session: "Use the existing Sign out action for this current session.",
});
export function accountSessionResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" } });
}
export function requireAccountSessionSelf(accountId: string, actorId: string) {
  if (accountSessionUuid(accountId) !== accountSessionUuid(actorId)) throw new AccountSessionError("access_denied", "Foreign account hint.");
}
export function requireAccountSessionOrigin(request: Request) {
  if (!preparationOriginAllowed(request.headers.get("origin"), process.env.APP_BASE_URL ?? "")) throw new TransportError("origin_forbidden", 403);
  if (new URL(request.url).search) throw new AccountSessionError("invalid_input", "Unexpected query.");
}
export async function readAccountSessionJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new TransportError("unsupported_media_type", 415);
  const maximum = ACCOUNT_SESSION_LIMITS.requestBytes;
  if (Number(request.headers.get("content-length")) > maximum) throw new TransportError("request_too_large", 413);
  const reader = request.body?.getReader(); if (!reader) throw new AccountSessionError("invalid_input", "Missing body.");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new TransportError("request_too_large", 413); } chunks.push(part.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), parsed: unknown = JSON.parse(text), keys = new Set<string>();
    for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
      if (!text.slice(token.index + token[0].length).trimStart().startsWith(":")) continue;
      const key = JSON.parse(token[0]) as string; if (keys.has(key)) throw new Error("Duplicate member"); keys.add(key);
    }
    return parsed;
  } catch (error) { if (error instanceof TransportError) throw error; throw new AccountSessionError("invalid_input", "Malformed session request."); }
  finally { reader.releaseLock(); }
}
export function accountSessionApiError(error: unknown): Response {
  if (error instanceof TransportError) return accountSessionResponse({ error: { code: error.code, message: MESSAGES[error.code] } }, error.status);
  if (isAccountSessionError(error)) return accountSessionResponse({ error: { code: error.code, message: MESSAGES[error.code] } },
    error.code === "authentication_required" ? 401 : error.code === "access_denied" ? 403 : error.code === "not_found" ? 404 : error.code === "invalid_input" ? 422 : 409);
  if (error instanceof AuthenticationError) return accountSessionResponse({ error: { code: "authentication_required", message: MESSAGES.authentication_required } }, 401);
  console.error("Account session result unavailable; request and authentication details were not logged.");
  return accountSessionResponse({ error: { code: "session_unavailable", message: "No confirmed result was received. Check the original request before another sign-out action." } }, 503);
}
