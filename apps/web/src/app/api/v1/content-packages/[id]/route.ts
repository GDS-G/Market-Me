import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getRepository } from "@/server/database";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? undefined;
    const { workspace } = await requireWorkspaceAccess(workspaceId);
    const data = await getRepository().getContentPackage(workspace.workspaceId, (await context.params).id);
    if (!data) return Response.json({ error: { code: "not_found", message: "Content Package not found." } }, { status: 404 });
    return Response.json({ data });
  } catch (error) {
    return apiError(error);
  }
}
