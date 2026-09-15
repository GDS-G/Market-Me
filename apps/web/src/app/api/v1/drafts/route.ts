import { z } from "zod";
import { DRAFT_FORMATS } from "@market-me/domain";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getDraftRepository } from "@/server/database";
import { packageReviewFingerprint, packageReviewVersion, reviewUuid } from "@/components/content-package-review-request";
import { readReviewJson, reviewOriginError, reviewResponse } from "@/server/content-package-review-api";

const schema = z.object({ workspaceId: reviewUuid, campaignId: reviewUuid, contentPackageId: reviewUuid, expectedPackageVersion: packageReviewVersion,
  expectedReviewFingerprint: packageReviewFingerprint, draftFormat: z.enum(DRAFT_FORMATS).default("channel_neutral") }).strict();

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceAccess(new URL(request.url).searchParams.get("workspaceId") ?? undefined);
    const data = await getDraftRepository().list(workspace.workspaceId);
    return Response.json({ data, meta: { count: data.length } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  const forbidden = reviewOriginError(request); if (forbidden) return forbidden;
  try {
    const parsed = schema.safeParse(await readReviewJson(request));
    if (!parsed.success) return reviewResponse({ error: { code: "validation_failed", message: "Choose a published Campaign and load its exact currently approved package review." } }, 422);
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const data = await getDraftRepository().generate({ ...parsed.data, workspaceId: workspace.workspaceId }, user.id);
    return reviewResponse({ data }, 201);
  } catch (error) { return apiError(error); }
}
