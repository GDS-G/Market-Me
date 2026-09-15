import { requireWorkspaceAccess } from "@/server/auth";
import { getContentPackageReviewRepository } from "@/server/database";
import { reviewApiError, reviewPackagePath, reviewQuery, reviewResponse, reviewWorkspaceQuery } from "@/server/content-package-review-api";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = reviewPackagePath.parse(await context.params);
    const { workspaceId } = reviewWorkspaceQuery.parse(reviewQuery(request, ["workspaceId"]));
    const { user, workspace } = await requireWorkspaceAccess(workspaceId);
    const review = await getContentPackageReviewRepository().getReview(workspace.workspaceId, id, user.id);
    return review ? reviewResponse({ data: review }) : reviewResponse({ error: { code: "not_found", message: "Content Package not found." } }, 404);
  } catch (error) { return reviewApiError(error); }
}
