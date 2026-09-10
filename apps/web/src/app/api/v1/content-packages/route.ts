import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? undefined;
    const { workspace } = await requireWorkspaceAccess(workspaceId);
    const data = await getRepository().listContentPackages(workspace.workspaceId);
    return Response.json({ data, meta: { count: data.length, persistence: "postgresql" } });
  } catch (error) {
    return apiError(error);
  }
}
