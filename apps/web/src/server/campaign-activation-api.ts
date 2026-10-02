import { CAMPAIGN_ACTIVATION_LIMITS, CampaignActivationError, isCampaignValidationError, isCampaignActivationError } from "@market-me/database";
import { AuthenticationError } from "./auth";
import { preparationOriginAllowed } from "./campaign-preparation-api";

class TransportError extends Error { constructor(readonly code: "origin_forbidden" | "unsupported_media_type" | "request_too_large", readonly status: number) { super(code); } }
const MESSAGES = Object.freeze({
  origin_forbidden: "Activate campaigns from this application only.", unsupported_media_type: "Use a JSON activation request.",
  request_too_large: "This activation request is too large.", invalid_input: "Review one published version and retain its exact activation request.",
  access_denied: "Current workspace access is required; new activation requires owner, administrator or editor access.",
  not_found: "No matching published campaign or original receipt was observed. An earlier request may still finish; lookup never resends it.",
  request_conflict: "That request identifier belongs to another activation intent. Check the original request.",
  request_closed: "This original request is closed and cannot create a run. Review a new request explicitly.",
  grant_changed: "Your workspace grant changed. Check the original request, then review the current version before a new activation.",
  preview_unavailable: "A bounded review of the published version is unavailable. No activation was confirmed.",
});
export function activationResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" } });
}
export function requireActivationOrigin(request: Request): void {
  if (!preparationOriginAllowed(request.headers.get("origin"), process.env.APP_BASE_URL ?? "")) throw new TransportError("origin_forbidden", 403);
  if (new URL(request.url).search) throw new CampaignActivationError("invalid_input", "Unexpected query.");
}
export async function readActivationJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new TransportError("unsupported_media_type", 415);
  const maximum = CAMPAIGN_ACTIVATION_LIMITS.requestBytes;
  if (Number(request.headers.get("content-length")) > maximum) throw new TransportError("request_too_large", 413);
  const reader = request.body?.getReader(); if (!reader) throw new CampaignActivationError("invalid_input", "Missing body.");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new TransportError("request_too_large", 413); } chunks.push(part.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), parsed: unknown = JSON.parse(text), keys = new Set<string>();
    // The independent normalizer accepts a flat five-field UUID-only object.
    for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
      if (!text.slice(token.index + token[0].length).trimStart().startsWith(":")) continue;
      const key = JSON.parse(token[0]) as string; if (keys.has(key)) throw new Error("Duplicate field"); keys.add(key);
    }
    return parsed;
  } catch (error) { if (error instanceof TransportError) throw error; throw new CampaignActivationError("invalid_input", "Malformed request."); }
  finally { reader.releaseLock(); }
}
export function activationApiError(error: unknown): Response {
  if (error instanceof TransportError) return activationResponse({ error: { code: error.code, message: MESSAGES[error.code] } }, error.status);
  if (isCampaignActivationError(error)) return activationResponse({ error: { code: error.code, message: MESSAGES[error.code] } },
    error.code === "invalid_input" ? 422 : error.code === "access_denied" ? 403 : error.code === "not_found" ? 404 : error.code === "preview_unavailable" ? 503 : 409);
  if (error instanceof AuthenticationError) return activationResponse({ error: { code: "authentication_required", message: "Sign in again to review the original activation request." } }, 401);
  if (isCampaignValidationError(error)) {
    const code = error.issues.some(i => i.code === "execution_paused") ? "execution_paused"
      : error.issues.some(i => i.code === "control_unavailable") ? "control_unavailable"
      : error.issues.some(i => i.code === "campaign_version_changed") ? "campaign_version_changed" : "activation_not_ready";
    const message = code === "execution_paused" ? "Workspace execution is paused. New runs are blocked; original receipt lookup remains available."
      : code === "control_unavailable" ? "Current execution control is unavailable. New activation remains blocked."
      : code === "campaign_version_changed" ? "The published version changed. Check the original request, then review the current version."
      : "The published plan does not currently meet activation requirements. Review its approvals, exact previews, rights, routes and schedules.";
    return activationResponse({ error: { code, message } }, code === "control_unavailable" ? 503 : 409);
  }
  console.error("Campaign activation unavailable; request and persistence details were not logged.");
  return activationResponse({ error: { code: "activation_unavailable", message: "No confirmed result was received. Check the original request before considering another activation." } }, 503);
}
