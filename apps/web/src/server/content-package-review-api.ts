import { z } from "zod";
import { CONTENT_ASSET_RIGHTS_CHANNELS } from "@market-me/domain";
import { ContentPackageReviewError } from "@market-me/database";
import { packageReviewPrecondition, reviewRightsInstant, reviewUuid } from "@/components/content-package-review-request";
import { preparationOriginAllowed } from "./campaign-preparation-api";
import { apiError } from "./api-response";

export const reviewResponse = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function readReviewJson(request: Request): Promise<unknown> {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 65_536) { await reader.cancel(); return undefined; }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return undefined; }
  finally { reader.releaseLock(); }
}
export function reviewOriginError(request: Request): Response | undefined {
  if (!preparationOriginAllowed(request.headers.get("origin"), process.env.APP_BASE_URL ?? "")) {
    return reviewResponse({ error: { code: "origin_forbidden", message: "Review Content Packages from this application only." } }, 403);
  }
}
export function reviewApiError(error: unknown): Response {
  if (error instanceof z.ZodError) return reviewResponse({ error: { code: "invalid_review_input", message: "Review the required fields and exact package revision.", fields: error.flatten().fieldErrors } }, 422);
  if (error instanceof ContentPackageReviewError) {
    const status = error.code === "access_denied" ? 403 : error.code === "package_unavailable" || error.code === "approval_unavailable" ? 404
      : error.code === "invalid_review_input" || error.code === "review_snapshot_too_large" || error.code === "review_snapshot_lossy" ? 422 : 409;
    return reviewResponse({ error: { code: error.code, message: error.message, blockers: error.blockers,
      ...(error.existingApprovalId ? { existingApprovalId: error.existingApprovalId } : {}) } }, status);
  }
  return apiError(error);
}
export const reviewPackagePath = z.object({ id: reviewUuid }).strict();
export const reviewConflictPath = z.object({ id: reviewUuid, conflictId: reviewUuid }).strict();
export const reviewEvidencePath = z.object({ id: reviewUuid, evidenceId: reviewUuid }).strict();
export const reviewAssetPath = z.object({ id: reviewUuid, assetId: reviewUuid }).strict();
export const approvePackageBody = z.object({ ...packageReviewPrecondition, idempotencyKey: reviewUuid }).strict();
export const conflictReviewBody = z.object({ ...packageReviewPrecondition, evidenceId: reviewUuid, note: z.string().trim().max(2000).optional() }).strict();
export const evidenceReviewBody = z.object({ ...packageReviewPrecondition, correctedClaim: z.string().trim().min(1).max(5000), note: z.string().trim().max(2000).optional() }).strict();
export const accessibilityReviewBody = z.object({ ...packageReviewPrecondition, altText: z.string().trim().max(2000).optional(), decorative: z.boolean(), notes: z.string().trim().max(2000).optional() }).strict()
  .refine((value) => value.decorative || Boolean(value.altText), { path: ["altText"], message: "Alternative text is required unless the image is decorative." });
export const rightsReviewBody = z.object({
  ...packageReviewPrecondition, status: z.enum(["cleared", "restricted"]), owner: z.string().trim().min(1).max(200),
  licenseOwner: z.string().trim().min(1).max(200).optional(), sourceReference: z.string().trim().min(3).max(1000), proofReference: z.string().trim().min(3).max(1000),
  commercialUseAllowed: z.boolean(), derivativeUseAllowed: z.boolean(), worldwideUseAllowed: z.boolean(),
  permittedChannels: z.array(z.enum(CONTENT_ASSET_RIGHTS_CHANNELS)).max(20), permittedChannelConnectionIds: z.array(reviewUuid).max(100),
  permittedCampaignIds: z.array(reviewUuid).max(100), permittedBrandProfileIds: z.array(reviewUuid).max(100),
  validFrom: reviewRightsInstant.optional(), expiresAt: reviewRightsInstant.optional(),
  attributionRequirement: z.string().trim().min(1).max(1000).optional(), watermarkRequirement: z.string().trim().min(1).max(1000).optional(),
  disclaimerRequirement: z.string().trim().min(1).max(1000).optional(), reviewNote: z.string().trim().min(3).max(2000),
}).strict().superRefine((value, context) => {
  // Fresh database time, scope membership, and sub-millisecond ordering are repository authority.
  if (value.status === "cleared" && (!value.commercialUseAllowed || !value.derivativeUseAllowed || !value.worldwideUseAllowed
    || !value.permittedChannels.length || !value.permittedChannelConnectionIds.length || value.attributionRequirement || value.watermarkRequirement || value.disclaimerRequirement)) {
    context.addIssue({ code: "custom", path: ["status"], message: "Clearance requires worldwide commercial and derivative permission, a supported provider and exact account, and no outstanding obligations." });
  }
});
export function reviewQuery(request: Request, allowed: readonly string[]): Record<string, string> {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !allowed.includes(key) || params.getAll(key).length !== 1)) {
    throw new z.ZodError([{ code: "custom", path: [], message: "Choose one explicit workspace and review request." }]);
  }
  return Object.fromEntries(params);
}
export const reviewWorkspaceQuery = z.object({ workspaceId: reviewUuid }).strict();
export const approvalLookupQuery = z.object({ workspaceId: reviewUuid, idempotencyKey: reviewUuid.optional(), approvalId: reviewUuid.optional() }).strict()
  .refine((value) => !(value.idempotencyKey && value.approvalId), "Choose an approval ID or attempt key, not both.");
