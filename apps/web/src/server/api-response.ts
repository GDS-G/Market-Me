import { AuthenticationError, AuthorizationError } from "./auth";
import { DatabaseUnavailableError } from "./database";
import { IngestionConfigurationError, WebhookConfigurationError } from "./ingestion";
import { AiPolicyValidationError, CampaignValidationError, ContentPackageReviewError, DraftValidationError } from "@market-me/database";
import { CompanionAuthenticationError } from "./companion-auth";

export function apiError(error: unknown): Response {
  if (error instanceof ContentPackageReviewError) {
    const status = error.code === "access_denied" ? 403 : error.code === "package_unavailable" || error.code === "approval_unavailable" ? 404
      : error.code === "invalid_review_input" || error.code === "review_snapshot_too_large" || error.code === "review_snapshot_lossy" ? 422 : 409;
    return Response.json({ error: { code: error.code, message: error.message, blockers: error.blockers } }, { status, headers: { "Cache-Control": "no-store" } });
  }
  if (error instanceof AuthenticationError) {
    return Response.json({ error: { code: "authentication_required", message: error.message } }, { status: 401 });
  }
  if (error instanceof AuthorizationError) {
    return Response.json({ error: { code: "forbidden", message: error.message } }, { status: 403 });
  }
  if (error instanceof CompanionAuthenticationError) {
    return Response.json({ error: { code: "companion_authentication_required", message: error.message } }, { status: 401 });
  }
  if (error instanceof DatabaseUnavailableError) {
    return Response.json({ error: { code: "persistence_unavailable", message: error.message } }, { status: 503 });
  }
  if (error instanceof IngestionConfigurationError || error instanceof WebhookConfigurationError) {
    return Response.json({ error: { code: "ingestion_not_configured", message: error.message } }, { status: 503 });
  }
  if (isCampaignValidationError(error)) {
    return Response.json({ error: { code: "campaign_invalid", message: error.message, fields: error.issues } }, { status: 422 });
  }
  if (isDraftValidationError(error)) {
    return Response.json({ error: { code: "draft_invalid", message: error.message, fields: error.issues } }, { status: 422 });
  }
  if (isAiPolicyValidationError(error)) {
    return Response.json(
      {
        error: {
          code: "validation_failed",
          message: error.message,
          fields: error.issues,
        },
      },
      { status: 422 },
    );
  }
  console.error(error);
  return Response.json(
    { error: { code: "internal_error", message: "An unexpected server error occurred." } },
    { status: 500 },
  );
}

function isAiPolicyValidationError(error: unknown): error is AiPolicyValidationError {
  if (error instanceof AiPolicyValidationError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; message?: unknown; issues?: unknown };
  return candidate.name === "AiPolicyValidationError" && typeof candidate.message === "string" && Array.isArray(candidate.issues);
}

function isDraftValidationError(error: unknown): error is DraftValidationError {
  if (error instanceof DraftValidationError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; message?: unknown; issues?: unknown };
  return candidate.name === "DraftValidationError" && typeof candidate.message === "string" && Array.isArray(candidate.issues);
}

function isCampaignValidationError(error: unknown): error is CampaignValidationError {
  if (error instanceof CampaignValidationError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; message?: unknown; issues?: unknown };
  return candidate.name === "CampaignValidationError" && typeof candidate.message === "string" && Array.isArray(candidate.issues);
}
