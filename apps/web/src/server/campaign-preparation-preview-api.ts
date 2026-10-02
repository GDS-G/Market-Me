import { createHash } from "node:crypto";
import { z } from "zod";
import { CampaignPreparationError, CampaignPreparationTemplateValidationError, CampaignValidationError, CAMPAIGN_PREPARATION_PREVIEW_LIMITS } from "@market-me/database";
import { AuthenticationError, requireAuthenticatedUser } from "./auth";
import { getCampaignPreparationRepository } from "./database";
import { preparationOriginAllowed } from "./campaign-preparation-api";

class PreviewTransportError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
const envelope = z.strictObject({ input: z.unknown(), expectedReviewFingerprint: z.string().regex(/^mm-package-review-v1:sha256:[0-9a-f]{64}$/) });
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

async function readPreviewRequest(request: Request) {
  const invalid = () => new PreviewTransportError("invalid_input", 422, "Provide valid UTF-8 JSON preparation settings and an exact approved review.");
  const tooLarge = () => new PreviewTransportError("request_too_large", 413, "The preparation preview request is too large.");
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json")
    throw new PreviewTransportError("unsupported_media_type", 415, "Send preparation preview settings as application/json.");
  if (Number(request.headers.get("content-length")) > CAMPAIGN_PREPARATION_PREVIEW_LIMITS.requestBytes) throw tooLarge();
  const reader = request.body?.getReader(); if (!reader) throw invalid();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const item = await reader.read(); if (item.done) break; length += item.value.byteLength;
      if (length > CAMPAIGN_PREPARATION_PREVIEW_LIMITS.requestBytes) { await reader.cancel(); throw tooLarge(); }
      chunks.push(item.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed = envelope.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (!parsed.success) throw invalid();
    return { ...parsed.data, requestDigest: createHash("sha256").update(bytes).digest("hex") };
  } catch (error) { if (error instanceof PreviewTransportError) throw error; throw invalid(); }
  finally { reader.releaseLock(); }
}

/** Read-only request: no attempt key, persistence receipt, provider transport or execution authority. */
export async function previewCampaignPreparationRequest(request: Request): Promise<Response> {
  try {
    if (!preparationOriginAllowed(request.headers.get("origin"), process.env.APP_BASE_URL ?? ""))
      throw new PreviewTransportError("origin_forbidden", 403, "Preview preparation from this application only.");
    if (new URL(request.url).search) throw new PreviewTransportError("invalid_input", 422, "Send preview settings in the request body only.");
    const user = await requireAuthenticatedUser();
    const parsed = await readPreviewRequest(request);
    const data = await getCampaignPreparationRepository().preview(parsed.input, user.id, { expectedReviewFingerprint: parsed.expectedReviewFingerprint });
    const value = { data, meta: { requestDigest: parsed.requestDigest } };
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > CAMPAIGN_PREPARATION_PREVIEW_LIMITS.responseBytes)
      throw new PreviewTransportError("preview_too_large", 422, "The exact preview is too large to display safely. Nothing was saved.");
    return reply(value);
  } catch (error) {
    if (error instanceof PreviewTransportError) return reply({ error: { code: error.code, message: error.message } }, error.status);
    if (error instanceof AuthenticationError) return reply({ error: { code: "authentication_required", message: "Sign in to preview a campaign." } }, 401);
    if (error instanceof CampaignPreparationError) return reply({ error: { code: error.code, message: error.message } },
      error.code === "access_denied" ? 403 : error.code === "package_unavailable" ? 404 : ["invalid_review_input", "preview_too_large", "preview_generation_failed"].includes(error.code) ? 422 : 409);
    if (error instanceof CampaignPreparationTemplateValidationError || error instanceof CampaignValidationError)
      return reply({ error: { code: "invalid_settings", message: "Review the preparation settings and current profile limits before previewing." } }, 422);
    console.error("Campaign preparation preview unavailable; private inputs and persistence details were not logged.");
    return reply({ error: { code: "preview_unavailable", message: "No verified preview was received. Your form is unchanged; nothing was prepared or sent." } }, 503);
  }
}
