import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getRepository } from "@/server/database";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? undefined;
    const { workspace } = await requireWorkspaceAccess(workspaceId);
    const source = await getRepository().getSmartSource(workspace.workspaceId, id);
    if (!source) {
      return Response.json({ error: { code: "not_found", message: "Smart Source not found." } }, { status: 404 });
    }
    const data = await getRepository().listSourceItems(source.id);
    return Response.json({ data, meta: { count: data.length } });
  } catch (error) {
    return apiError(error);
  }
}
