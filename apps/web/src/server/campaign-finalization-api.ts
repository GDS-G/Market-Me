import { z } from "zod";
import { CampaignFinalizationError, CampaignFinalizationTemplateValidationError, ExactPreviewReadError, ExactPreviewFingerprintValidationError } from "@market-me/database";
import { apiError } from "./api-response";

export const finalizationUuid = z.string().trim().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).transform((value) => value.toLowerCase());

export function finalizationApiError(error: unknown): Response {
  const headers = { "Cache-Control": "no-store" };
  if (error instanceof CampaignFinalizationTemplateValidationError) {
    return Response.json({ error: { code: "validation_failed", message: error.message, fields: error.issues } }, { status: 422, headers });
  }
  if (error instanceof CampaignFinalizationError) {
    const status = error.code === "access_denied" ? 403 : error.code === "invalid_idempotency_key" ? 422
      : ["preparation_unavailable", "package_unavailable"].includes(error.code) ? 404 : 409;
    return Response.json({ error: { code: error.code, message: error.message,
      ...(error.existingFinalizationId ? { existingFinalizationId: error.existingFinalizationId } : {}) } }, { status, headers });
  }
  if (error instanceof ExactPreviewReadError || error instanceof ExactPreviewFingerprintValidationError) {
    return Response.json({ error: { code: error instanceof ExactPreviewReadError ? error.code : "preview_ineligible",
      message: "This exact preview is no longer eligible. Review the approved draft, account, and Destination, then recreate and select its preview." } }, { status: error instanceof ExactPreviewReadError && error.code === "preview_unavailable" ? 404 : 409, headers });
  }
  return apiError(error);
}

export function finalizationValidation(message: string): Response {
  return Response.json({ error: { code: "validation_failed", message } }, { status: 422, headers: { "Cache-Control": "no-store" } });
}
