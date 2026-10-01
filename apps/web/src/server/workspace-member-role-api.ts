import { isWorkspaceMemberRoleError, WORKSPACE_MEMBER_ROLE_LIMITS } from "@market-me/database";
import { AuthenticationError } from "./auth";
import { preparationOriginAllowed } from "./campaign-preparation-api";

export class WorkspaceMemberRoleTransportError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
export function memberRoleResponse(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
export function requireMemberRoleOrigin(request: Request) {
  if (!preparationOriginAllowed(request.headers.get("origin"), process.env.APP_BASE_URL ?? "")) {
    throw new WorkspaceMemberRoleTransportError("origin_forbidden", 403, "Manage member roles from this application only.");
  }
  if (new URL(request.url).search) throw new WorkspaceMemberRoleTransportError("invalid_input", 422, "Send role-change settings in the request body only.");
}
export async function readMemberRoleJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new WorkspaceMemberRoleTransportError("unsupported_media_type", 415, "Send role-change settings as application/json.");
  }
  const maximum = WORKSPACE_MEMBER_ROLE_LIMITS.requestBytes;
  const tooLarge = () => new WorkspaceMemberRoleTransportError("request_too_large", 413, "Role-change settings exceed the bounded request limit.");
  if (Number(request.headers.get("content-length")) > maximum) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new WorkspaceMemberRoleTransportError("invalid_input", 422, "Provide valid JSON role-change settings.");
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
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof WorkspaceMemberRoleTransportError) throw error;
    throw new WorkspaceMemberRoleTransportError("invalid_input", 422, "Provide valid JSON role-change settings.");
  } finally { reader.releaseLock(); }
}
export function memberRoleApiError(error: unknown): Response {
  if (error instanceof WorkspaceMemberRoleTransportError) return memberRoleResponse({ error: { code: error.code, message: error.message } }, error.status);
  if (isWorkspaceMemberRoleError(error)) return memberRoleResponse({ error: { code: error.code, message: error.message } },
    error.code === "access_denied" || error.code === "protected_member" ? 403 : error.code === "not_found" ? 404 : error.code === "invalid_input" ? 422 : 409);
  if (error instanceof AuthenticationError) return memberRoleResponse({ error: { code: "authentication_required", message: "Sign in to manage member roles." } }, 401);
  console.error("Member role result unavailable; private requests and persistence details were not logged.");
  return memberRoleResponse({ error: { code: "member_role_unavailable", message: "No confirmed result was received. Check your saved request before retrying; do not assume it failed." } }, 503);
}
