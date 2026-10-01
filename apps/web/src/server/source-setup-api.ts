import { SourceSetupInputError } from "@market-me/domain";
import { SourceSetupError } from "@market-me/database";
import { AuthenticationError, AuthorizationError } from "./auth";
import { preparationOriginAllowed } from "./campaign-preparation-api";

export const SOURCE_SETUP_BODY_LIMIT = 32_768;
export class SourceSetupTransportError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
export function sourceSetupResponse(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
export function requireSourceSetupOrigin(request: Request) {
  if (!preparationOriginAllowed(request.headers.get("origin"), process.env.APP_BASE_URL ?? "")) {
    throw new SourceSetupTransportError("origin_forbidden", 403, "Configure a Smart Source from this application only.");
  }
}
export async function readSourceSetupJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new SourceSetupTransportError("unsupported_media_type", 415, "Send the setup as application/json.");
  }
  if (Number(request.headers.get("content-length")) > SOURCE_SETUP_BODY_LIMIT) {
    throw new SourceSetupTransportError("request_too_large", 413, "The setup request is too large.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SourceSetupInputError("Provide the setup settings.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > SOURCE_SETUP_BODY_LIMIT) {
        await reader.cancel();
        throw new SourceSetupTransportError("request_too_large", 413, "The setup request is too large.");
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof SourceSetupTransportError) throw error;
    throw new SourceSetupInputError("Provide valid JSON setup settings.");
  } finally { reader.releaseLock(); }
}
export function sourceSetupApiError(error: unknown, operation: "setup" | "browse" = "setup") {
  if (error instanceof SourceSetupTransportError) return sourceSetupResponse({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof SourceSetupInputError || error instanceof Error && error.name === "SourceSetupInputError") {
    return sourceSetupResponse({ error: { code: "invalid_setup", message: error.message } }, 422);
  }
  if (error instanceof SourceSetupError) return sourceSetupResponse({ error: { code: error.code, message: error.message } }, error.code === "access_denied" ? 403 : 409);
  if (error instanceof AuthenticationError) return sourceSetupResponse({ error: { code: "authentication_required", message: "Sign in to continue setup." } }, 401);
  if (error instanceof AuthorizationError) return sourceSetupResponse({ error: { code: "access_denied", message: "Current workspace writer access is required." } }, 403);
  // Provider/SQL exceptions can contain tokens or the private canonical request. Never reflect or log them.
  console.error("Guided source setup could not complete; provider or persistence operation failed.");
  return sourceSetupResponse({ error: operation === "browse"
    ? { code: "folder_browse_unavailable", message: "The folder list is unavailable. Reopen the folder or check the storage connection. Browsing does not create a source." }
    : { code: "setup_unavailable", message: "Setup could not complete. Check the saved result before retrying; your request can be retried safely." } }, 503);
}
