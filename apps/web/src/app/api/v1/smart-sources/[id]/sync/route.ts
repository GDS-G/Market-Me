import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getIngestionService } from "@/server/ingestion";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { workspaceId?: string };
    const { workspace } = await requireWorkspaceAccess(body.workspaceId, "write");
    const data = await getIngestionService().syncSmartSource(workspace.workspaceId, id);
    return Response.json({ data });
  } catch (error) {
    return apiError(error);
  }
}
