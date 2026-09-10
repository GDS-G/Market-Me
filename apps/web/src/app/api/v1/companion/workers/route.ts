import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getCompanionRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceAccess(new URL(request.url).searchParams.get("workspaceId") ?? undefined, "read");
    return Response.json({ data: await getCompanionRepository().listWorkers(workspace.workspaceId) });
  } catch (error) { return apiError(error); }
}
