import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getRepository } from "@/server/database";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { workspaceId?: string };
    const { user, workspace } = await requireWorkspaceAccess(body.workspaceId, "write");
    const data = await getRepository().publishContextPack(workspace.workspaceId, id, user.id);
    if (!data) return Response.json({ error: { code: "not_found", message: "Context Pack not found." } }, { status: 404 });
    return Response.json({ data });
  } catch (error) {
    return apiError(error);
  }
}
