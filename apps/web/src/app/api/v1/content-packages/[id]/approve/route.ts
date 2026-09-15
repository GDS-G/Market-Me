import { requireWorkspaceAccess } from "@/server/auth";
import { getContentPackageReviewRepository } from "@/server/database";
import { approvalLookupQuery, approvePackageBody, readReviewJson, reviewApiError, reviewOriginError, reviewPackagePath, reviewQuery, reviewResponse } from "@/server/content-package-review-api";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const forbidden = reviewOriginError(request); if (forbidden) return forbidden;
  try {
    const { id } = reviewPackagePath.parse(await context.params);
    const body = approvePackageBody.parse(await readReviewJson(request));
    const { user, workspace } = await requireWorkspaceAccess(body.workspaceId, "approve");
    const result = await getContentPackageReviewRepository().approve({ ...body, workspaceId: workspace.workspaceId, packageId: id, actorUserId: user.id });
    return reviewResponse({ data: result.approval, ...(result.review ? { review: result.review } : {}), meta: { replayed: result.replayed } }, result.replayed ? 200 : 201);
  } catch (error) { return reviewApiError(error); }
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = reviewPackagePath.parse(await context.params);
    const query = approvalLookupQuery.parse(reviewQuery(request, ["workspaceId", "idempotencyKey", "approvalId"]));
    const { user, workspace } = await requireWorkspaceAccess(query.workspaceId);
    const repository = getContentPackageReviewRepository();
    if (!query.idempotencyKey && !query.approvalId) return reviewResponse({ data: await repository.listApprovalSummaries(workspace.workspaceId, id, user.id) });
    const approval = query.idempotencyKey ? await repository.getApprovalByKey(workspace.workspaceId, query.idempotencyKey, user.id)
      : await repository.getApproval(workspace.workspaceId, query.approvalId!, user.id);
    return approval?.contentPackageId === id && approval.workspaceId === workspace.workspaceId ? reviewResponse({ data: approval })
      : reviewResponse({ error: { code: "not_found", message: "No completed approval was found. An earlier request may still finish." } }, 404);
  } catch (error) { return reviewApiError(error); }
}
