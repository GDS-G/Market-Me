import { z } from "zod";
import { SourcePreparationError } from "@market-me/database";
import { apiError } from "./api-response";
import { preparationOriginAllowed } from "./campaign-preparation-api";

export const SOURCE_PREPARATION_BODY_LIMIT_BYTES = 32_768;

const SOURCE_PREPARATION_CODES = new Set([
  "access_denied",
  "invalid_input",
  "source_unavailable",
  "binding_unavailable",
  "binding_changed",
  "writer_unavailable",
  "brand_unavailable",
  "audience_unavailable",
  "destination_unavailable",
]);

class SourcePreparationTransportError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = "SourcePreparationTransportError";
  }
}

export function sourcePreparationResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function sourcePreparationOriginError(request: Request): Response | undefined {
  if (!preparationOriginAllowed(request.headers.get("origin"), process.env.APP_BASE_URL ?? "")) {
    return sourcePreparationResponse({ error: {
      code: "origin_forbidden",
      message: "Configure approval-linked draft preparation from this application only.",
    } }, 403);
  }
}

export async function readSourcePreparationJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new SourcePreparationTransportError("unsupported_media_type", 415, "Send the preparation binding as application/json.");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > SOURCE_PREPARATION_BODY_LIMIT_BYTES) {
    throw new SourcePreparationTransportError("request_too_large", 413, "The preparation binding request is too large.");
  }
  if (!request.body) {
    throw new SourcePreparationTransportError("invalid_binding_input", 422, "Provide one complete preparation binding.");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > SOURCE_PREPARATION_BODY_LIMIT_BYTES) {
        await reader.cancel();
        throw new SourcePreparationTransportError("request_too_large", 413, "The preparation binding request is too large.");
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof SourcePreparationTransportError) throw error;
    throw new SourcePreparationTransportError("invalid_binding_input", 422, "Provide one valid JSON preparation binding.");
  } finally {
    reader.releaseLock();
  }
}

export function sourcePreparationApiError(error: unknown): Response {
  if (error instanceof SourcePreparationTransportError) {
    return sourcePreparationResponse({ error: { code: error.code, message: error.message } }, error.status);
  }
  if (error instanceof z.ZodError) {
    return sourcePreparationResponse({ error: {
      code: "invalid_binding_input",
      message: "Review the saved preparation settings.",
      fields: z.flattenError(error).fieldErrors,
    } }, 422);
  }
  if (error instanceof SourcePreparationError || isSourcePreparationError(error)) {
    const status = error.code === "access_denied" ? 403
      : error.code === "source_unavailable" || error.code === "binding_unavailable" ? 404
      : error.code === "invalid_input" ? 422 : 409;
    return sourcePreparationResponse({ error: { code: error.code, message: error.message } }, status);
  }
  return apiError(error);
}

function isSourcePreparationError(error: unknown): error is Error & { code: string } {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  return candidate.name === "SourcePreparationError" && typeof candidate.code === "string"
    && SOURCE_PREPARATION_CODES.has(candidate.code) && typeof candidate.message === "string";
}
