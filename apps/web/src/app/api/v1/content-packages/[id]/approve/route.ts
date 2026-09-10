import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getRepository } from "@/server/database";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = (await request.json()) as { workspaceId?: string };
    const { user, workspace } = await requireWorkspaceAccess(body.workspaceId, "approve");
    const data = await getRepository().approveContentPackage({
      workspaceId: workspace.workspaceId,
      packageId: (await context.params).id,
      actorUserId: user.id,
    });
    if (!data) return Response.json({ error: { code: "review_required", message: "Resolve every conflict, unresolved fact, and accessibility review before approval." } }, { status: 409 });
    return Response.json({ data });
  } catch (error) {
    return apiError(error);
  }
}
