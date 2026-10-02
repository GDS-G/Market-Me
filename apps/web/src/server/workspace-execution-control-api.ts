import { WORKSPACE_EXECUTION_CONTROL_LIMITS, WorkspaceExecutionControlError, isWorkspaceExecutionControlError } from "@market-me/database";
import { AuthenticationError } from "./auth";
import { preparationOriginAllowed } from "./campaign-preparation-api";

class TransportError extends Error {
  constructor(readonly code: "origin_forbidden" | "unsupported_media_type" | "request_too_large", readonly status: number) { super(code); }
}
const MESSAGES = Object.freeze({
  origin_forbidden: "Change execution state from this application only.",
  unsupported_media_type: "Send the reviewed execution change as application/json.",
  request_too_large: "The execution-control request exceeds its size limit.",
  invalid_input: "Review current execution state and provide one exact request with a brief reason.",
  access_denied: "Current workspace owner or administrator access is required for changes and original-result recovery.",
  not_found: "No confirmed original result was found yet. An earlier request may still finish; checking never resends it.",
  revision_conflict: "Execution state or your grant changed. Check the original result, then review fresh state before a new change.",
  request_conflict: "That request identifier belongs to another intent. Check the original result.",
  state_conflict: "This workspace already has the selected state. Review fresh execution state.",
  execution_paused: "Workspace execution is paused. No new work was admitted. Review Workspace execution in Settings.",
  control_unavailable: "Current workspace execution state is unavailable. New execution remains blocked; no change was confirmed.",
});
export function executionControlResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" } });
}
export function requireExecutionControlOrigin(request: Request) {
  if (!preparationOriginAllowed(request.headers.get("origin"), process.env.APP_BASE_URL ?? "")) throw new TransportError("origin_forbidden", 403);
  if (new URL(request.url).search) throw new WorkspaceExecutionControlError("invalid_input", "Unexpected query.");
}
export async function readExecutionControlJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new TransportError("unsupported_media_type", 415);
  const maximum = WORKSPACE_EXECUTION_CONTROL_LIMITS.requestBytes;
  if (Number(request.headers.get("content-length")) > maximum) throw new TransportError("request_too_large", 413);
  const reader = request.body?.getReader(); if (!reader) throw new WorkspaceExecutionControlError("invalid_input", "Missing body.");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new TransportError("request_too_large", 413); } chunks.push(part.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), parsed: unknown = JSON.parse(text), keys = new Set<string>();
    // Only a flat six-field request is accepted by the independent normalizer.
    for (const token of text.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
      if (!text.slice(token.index + token[0].length).trimStart().startsWith(":")) continue;
      const key = JSON.parse(token[0]) as string; if (keys.has(key)) throw new Error("Duplicate field"); keys.add(key);
    }
    return parsed;
  } catch (error) { if (error instanceof TransportError) throw error; throw new WorkspaceExecutionControlError("invalid_input", "Malformed request."); }
  finally { reader.releaseLock(); }
}
export function executionControlApiError(error: unknown): Response {
  if (error instanceof TransportError) return executionControlResponse({ error: { code: error.code, message: MESSAGES[error.code] } }, error.status);
  if (isWorkspaceExecutionControlError(error)) return executionControlResponse({ error: { code: error.code, message: MESSAGES[error.code] } },
    error.code === "access_denied" ? 403 : error.code === "not_found" ? 404 : error.code === "invalid_input" ? 422 : error.code === "control_unavailable" ? 503 : 409);
  if (error instanceof AuthenticationError) return executionControlResponse({ error: { code: "authentication_required", message: "Sign in again to review workspace execution." } }, 401);
  console.error("Workspace execution control unavailable; request and persistence details were not logged.");
  return executionControlResponse({ error: { code: "execution_control_unavailable", message: "No confirmed change was received. Check the original request before another action." } }, 503);
}
