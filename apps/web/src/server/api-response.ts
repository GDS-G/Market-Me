import { AuthenticationError, AuthorizationError } from "./auth";
import { DatabaseUnavailableError } from "./database";
import { IngestionConfigurationError, WebhookConfigurationError } from "./ingestion";
import { AiPolicyValidationError, CampaignValidationError, DraftValidationError } from "@market-me/database";
import { CompanionAuthenticationError } from "./companion-auth";

export function apiError(error: unknown): Response {
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
