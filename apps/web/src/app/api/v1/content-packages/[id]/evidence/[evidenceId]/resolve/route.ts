import { requireWorkspaceAccess } from "@/server/auth";
import { getRepository } from "@/server/database";
import { evidenceReviewBody, readReviewJson, reviewApiError, reviewEvidencePath, reviewOriginError, reviewResponse } from "@/server/content-package-review-api";
export async function POST(request: Request, context: { params: Promise<{ id: string; evidenceId: string }> }) {
  const forbidden = reviewOriginError(request); if (forbidden) return forbidden;
  try {
    const { id, evidenceId } = reviewEvidencePath.parse(await context.params);
    const body = evidenceReviewBody.parse(await readReviewJson(request));
    const { user, workspace } = await requireWorkspaceAccess(body.workspaceId, "approve");
    const review = await getRepository().resolveUnresolvedEvidence({ ...body, workspaceId: workspace.workspaceId, packageId: id, evidenceId, actorUserId: user.id });
    return review ? reviewResponse({ data: review }) : reviewResponse({ error: { code: "not_found", message: "Active unresolved evidence not found." } }, 404);
  } catch (error) { return reviewApiError(error); }
}
