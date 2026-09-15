import { requireWorkspaceAccess } from "@/server/auth";
import { getRepository } from "@/server/database";
import { conflictReviewBody, readReviewJson, reviewApiError, reviewConflictPath, reviewOriginError, reviewResponse } from "@/server/content-package-review-api";
export async function POST(request: Request, context: { params: Promise<{ id: string; conflictId: string }> }) {
  const forbidden = reviewOriginError(request); if (forbidden) return forbidden;
  try {
    const { id, conflictId } = reviewConflictPath.parse(await context.params);
    const body = conflictReviewBody.parse(await readReviewJson(request));
    const { user, workspace } = await requireWorkspaceAccess(body.workspaceId, "approve");
    const review = await getRepository().resolveEvidenceConflict({ ...body, workspaceId: workspace.workspaceId, packageId: id, conflictId, actorUserId: user.id });
    return review ? reviewResponse({ data: review }) : reviewResponse({ error: { code: "not_found", message: "Conflict or candidate evidence not found." } }, 404);
  } catch (error) { return reviewApiError(error); }
}
