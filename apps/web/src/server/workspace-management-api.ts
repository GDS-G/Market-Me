import { isWorkspaceManagementError, WORKSPACE_MANAGEMENT_LIMITS } from "@market-me/database";
import { AuthenticationError } from "./auth";
import { preparationOriginAllowed } from "./campaign-preparation-api";

export class WorkspaceManagementTransportError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
export function workspaceManagementResponse(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
export function requireWorkspaceManagementOrigin(request: Request) {
  if (!preparationOriginAllowed(request.headers.get("origin"), process.env.APP_BASE_URL ?? "")) {
    throw new WorkspaceManagementTransportError("origin_forbidden", 403, "Manage workspaces from this application only.");
  }
  if (new URL(request.url).search) throw new WorkspaceManagementTransportError("invalid_input", 422, "Send workspace settings in the request body only.");
}
export async function readWorkspaceManagementJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new WorkspaceManagementTransportError("unsupported_media_type", 415, "Send workspace settings as application/json.");
  }
  const maximum = WORKSPACE_MANAGEMENT_LIMITS.requestBytes;
  const tooLarge = () => new WorkspaceManagementTransportError("request_too_large", 413, "Workspace settings exceed the bounded request limit.");
  if (Number(request.headers.get("content-length")) > maximum) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw new WorkspaceManagementTransportError("invalid_input", 422, "Provide valid JSON workspace settings.");
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
    if (error instanceof WorkspaceManagementTransportError) throw error;
    throw new WorkspaceManagementTransportError("invalid_input", 422, "Provide valid JSON workspace settings.");
  } finally { reader.releaseLock(); }
}
export function workspaceManagementApiError(error: unknown): Response {
  if (error instanceof WorkspaceManagementTransportError) return workspaceManagementResponse({ error: { code: error.code, message: error.message } }, error.status);
  if (isWorkspaceManagementError(error)) return workspaceManagementResponse({ error: { code: error.code, message: error.message } },
    error.code === "access_denied" ? 403 : error.code === "not_found" ? 404 : error.code === "invalid_input" ? 422 : 409);
  if (error instanceof AuthenticationError) return workspaceManagementResponse({ error: { code: "authentication_required", message: "Sign in to manage workspaces." } }, 401);
  console.error("Workspace management result unavailable; private requests and persistence details were not logged.");
  return workspaceManagementResponse({ error: { code: "workspace_management_unavailable", message: "No confirmed result was received. Check your saved request before retrying; do not assume it failed." } }, 503);
}
