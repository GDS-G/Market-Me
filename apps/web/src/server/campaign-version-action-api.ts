import { z } from "zod";
import { CampaignValidationError } from "@market-me/database";
import { apiError } from "./api-response";
import { finalizationUuid } from "./campaign-finalization-api";
import { preparationOriginAllowed } from "./campaign-preparation-api";

export const campaignVersionAction = z.object({ workspaceId: finalizationUuid, expectedVersionId: finalizationUuid.optional() }).strict();
export function campaignVersionOriginAllowed(request: Request): boolean {
  return preparationOriginAllowed(request.headers.get("origin"), process.env.APP_BASE_URL ?? "");
}
export function campaignVersionActionError(error: unknown): Response {
  if (error instanceof CampaignValidationError && error.issues.some((issue) => ["campaign_version_changed", "campaign_finalization_protected"].includes(issue.code))) {
    return Response.json({ error: { code: "campaign_changed", message: error.message, fields: error.issues } }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  return apiError(error);
}
