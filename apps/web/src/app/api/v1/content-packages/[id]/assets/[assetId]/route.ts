import { requireWorkspaceAccess } from "@/server/auth";
import { getRepository } from "@/server/database";
import { accessibilityReviewBody, rightsReviewBody, readReviewJson, reviewApiError, reviewAssetPath, reviewOriginError, reviewResponse } from "@/server/content-package-review-api";
export async function PATCH(request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  const forbidden = reviewOriginError(request); if (forbidden) return forbidden;
  try {
    const { id, assetId } = reviewAssetPath.parse(await context.params);
    const body = accessibilityReviewBody.parse(await readReviewJson(request));
    const { user, workspace } = await requireWorkspaceAccess(body.workspaceId, "write");
    const review = await getRepository().updateAssetAccessibility({ ...body, workspaceId: workspace.workspaceId, packageId: id, assetId, actorUserId: user.id });
    return review ? reviewResponse({ data: review }) : reviewResponse({ error: { code: "not_found", message: "Original image asset not found." } }, 404);
  } catch (error) { return reviewApiError(error); }
}
export async function PUT(request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  const forbidden = reviewOriginError(request); if (forbidden) return forbidden;
  try {
    const { id, assetId } = reviewAssetPath.parse(await context.params);
    const body = rightsReviewBody.parse(await readReviewJson(request));
    const { user, workspace } = await requireWorkspaceAccess(body.workspaceId, "write");
    const review = await getRepository().reviewAssetRights({ ...body, workspaceId: workspace.workspaceId, packageId: id, assetId }, user.id);
    return review ? reviewResponse({ data: review }) : reviewResponse({ error: { code: "not_found", message: "Original image asset not found." } }, 404);
  } catch (error) { return reviewApiError(error); }
}
