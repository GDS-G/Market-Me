import { ACCOUNT_PROFILE_LIMITS, isAccountProfileError, AccountProfileError, accountProfileUuid } from "@market-me/database";
import { AuthenticationError } from "./auth";
import { preparationOriginAllowed } from "./campaign-preparation-api";

export class AccountProfileTransportError extends Error {
  constructor(readonly code: "origin_forbidden" | "unsupported_media_type" | "request_too_large" | "invalid_input", readonly status: number) { super(code); }
}
const MESSAGES = Object.freeze({
  origin_forbidden: "Change your display name from this application only.",
  unsupported_media_type: "Send profile settings as application/json.",
  request_too_large: "Profile settings exceed the request limit.",
  invalid_input: "Provide one account, request identifier, saved revision and a plain display name of 1–120 characters.",
  access_denied: "Only your signed-in account profile is available. Reload after changing accounts.",
  not_found: "No confirmed profile result was found. An earlier save may still finish.",
  request_conflict: "That request identifier belongs to different profile settings. Check its original result.",
  revision_conflict: "Your profile changed or reached its revision limit. Reload current settings before saving.",
});
export function accountProfileResponse(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" } });
}
export function requireAccountProfileSelf(accountId: string, actorUserId: string) {
  if (accountProfileUuid(accountId) !== accountProfileUuid(actorUserId)) throw new AccountProfileError("access_denied", "Foreign account hint.");
}
export function requireAccountProfileOrigin(request: Request) {
  if (!preparationOriginAllowed(request.headers.get("origin"), process.env.APP_BASE_URL ?? "")) throw new AccountProfileTransportError("origin_forbidden", 403);
  if (new URL(request.url).search) throw new AccountProfileTransportError("invalid_input", 422);
}
/** This endpoint accepts a flat object only; reject duplicate JSON member names before normalization. */
export function parseAccountProfileJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text), keys = new Set<string>();
  for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
    if (!text.slice(token.index + token[0].length).trimStart().startsWith(":")) continue;
    const key = JSON.parse(token[0]) as string;
    if (keys.has(key)) throw new AccountProfileTransportError("invalid_input", 422);
    keys.add(key);
  }
  return parsed;
}
export async function readAccountProfileJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new AccountProfileTransportError("unsupported_media_type", 415);
  const maximum = ACCOUNT_PROFILE_LIMITS.requestBytes;
  const tooLarge = () => new AccountProfileTransportError("request_too_large", 413);
  if (Number(request.headers.get("content-length")) > maximum) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new AccountProfileTransportError("invalid_input", 422);
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw tooLarge(); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return parseAccountProfileJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof AccountProfileTransportError) throw error;
    throw new AccountProfileTransportError("invalid_input", 422);
  } finally { reader.releaseLock(); }
}
export function accountProfileApiError(error: unknown): Response {
  if (error instanceof AccountProfileTransportError) return accountProfileResponse({ error: { code: error.code, message: MESSAGES[error.code] } }, error.status);
  if (isAccountProfileError(error)) return accountProfileResponse({ error: { code: error.code, message: MESSAGES[error.code] } },
    error.code === "access_denied" ? 403 : error.code === "not_found" ? 404 : error.code === "invalid_input" ? 422 : 409);
  if (error instanceof AuthenticationError) return accountProfileResponse({ error: { code: "authentication_required", message: "Sign in to manage your display name." } }, 401);
  console.error("Account profile result unavailable; request and persistence details were not logged.");
  return accountProfileResponse({ error: { code: "profile_unavailable", message: "No confirmed result was received. Check the original request before starting another save." } }, 503);
}
