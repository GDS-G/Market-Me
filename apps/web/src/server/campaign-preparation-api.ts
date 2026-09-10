import { CampaignPreparationError, CampaignPreparationTemplateValidationError } from "@market-me/database";
import { apiError } from "./api-response";

/** This browser mutation accepts only the configured application origin, never forwarded host hints. */
export function preparationOriginAllowed(origin: string | null, appBaseUrl: string): boolean {
  if (!origin) return false;
  try {
    const configured = new URL(appBaseUrl);
    const requested = new URL(origin);
    return ["http:", "https:"].includes(configured.protocol)
      && !configured.username && !configured.password && configured.pathname === "/"
      && !configured.search && !configured.hash
      && origin === requested.origin && requested.origin === configured.origin;
  } catch {
    return false;
  }
}

export function preparationApiError(error: unknown): Response {
  if (error instanceof CampaignPreparationTemplateValidationError) {
    return Response.json({ error: { code: "validation_failed", message: error.message, fields: error.issues } }, { status: 422 });
  }
  if (error instanceof CampaignPreparationError) {
    const status = error.code === "access_denied" ? 403
      : error.code === "invalid_idempotency_key" ? 422
      : error.code === "package_unavailable" ? 404 : 409;
    return Response.json({ error: { code: error.code, message: error.message,
      ...(error.existingPreparationId ? { existingPreparationId: error.existingPreparationId } : {}) } }, { status });
  }
  return apiError(error);
}
