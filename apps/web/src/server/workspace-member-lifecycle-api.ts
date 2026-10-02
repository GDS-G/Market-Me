import { WORKSPACE_MEMBER_LIFECYCLE_LIMITS, WorkspaceMemberLifecycleError, isWorkspaceMemberLifecycleError } from "@market-me/database";
import { AuthenticationError } from "./auth";
import { preparationOriginAllowed } from "./campaign-preparation-api";

class TransportError extends Error {
  constructor(readonly code: "origin_forbidden" | "unsupported_media_type" | "request_too_large", readonly status: number) { super(code); }
}
const MESSAGES = Object.freeze({
  origin_forbidden: "Manage workspace membership from this application only.",
  unsupported_media_type: "Send the reviewed removal as application/json.",
  request_too_large: "The member-removal request exceeds its size limit.",
  invalid_input: "Review one current member and provide a brief reason with exact workspace, grant and request identifiers.",
  access_denied: "Current workspace owner or administrator access is required. Reload after changing accounts or workspaces.",
  protected_member: "Your own access and all owner memberships are protected here.",
  not_found: "No selected member or confirmed original result was found. An earlier request may still finish; checking never resends it.",
  revision_conflict: "The selected member's grant changed. Check any original request, then review a fresh member preview.",
  request_conflict: "That request identifier belongs to another removal intent. Check the original result.",
  impact_conflict: "The member's work or your grant changed. Check any original request, then review a fresh impact preview.",
  unresolved_dependencies: "Revoke or resolve the member's pending incoming and issued invitations before removing access.",
});
export function memberRemovalResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" } });
}
export function requireMemberRemovalOrigin(request: Request) {
  if (!preparationOriginAllowed(request.headers.get("origin"), process.env.APP_BASE_URL ?? "")) throw new TransportError("origin_forbidden", 403);
  if (new URL(request.url).search) throw new WorkspaceMemberLifecycleError("invalid_input", "Unexpected query.");
}
export async function readMemberRemovalJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new TransportError("unsupported_media_type", 415);
  const maximum = WORKSPACE_MEMBER_LIFECYCLE_LIMITS.requestBytes;
  if (Number(request.headers.get("content-length")) > maximum) throw new TransportError("request_too_large", 413);
  const reader = request.body?.getReader(); if (!reader) throw new WorkspaceMemberLifecycleError("invalid_input", "Missing body.");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new TransportError("request_too_large", 413); } chunks.push(part.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), parsed: unknown = JSON.parse(text), keys = new Set<string>();
    // The only accepted payload is a flat seven-field object. Reject duplicate
    // JSON keys (including escaped spellings) before its independent normalizer.
    for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
      if (!text.slice(token.index + token[0].length).trimStart().startsWith(":")) continue;
      const key = JSON.parse(token[0]) as string; if (keys.has(key)) throw new Error("Duplicate member"); keys.add(key);
    }
    return parsed;
  } catch (error) { if (error instanceof TransportError) throw error; throw new WorkspaceMemberLifecycleError("invalid_input", "Malformed removal request."); }
  finally { reader.releaseLock(); }
}
export function memberRemovalApiError(error: unknown): Response {
  if (error instanceof TransportError) return memberRemovalResponse({ error: { code: error.code, message: MESSAGES[error.code] } }, error.status);
  if (isWorkspaceMemberLifecycleError(error)) return memberRemovalResponse({ error: { code: error.code, message: MESSAGES[error.code] } },
    error.code === "access_denied" || error.code === "protected_member" ? 403 : error.code === "not_found" ? 404 : error.code === "invalid_input" ? 422 : 409);
  if (error instanceof AuthenticationError) return memberRemovalResponse({ error: { code: "authentication_required", message: "Sign in again to review workspace membership." } }, 401);
  console.error("Workspace member removal unavailable; request and persistence details were not logged.");
  return memberRemovalResponse({ error: { code: "member_removal_unavailable", message: "No confirmed result was received. Check the original removal request before another action." } }, 503);
}
