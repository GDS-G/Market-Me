import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getConnectorStatuses } from "@/server/connectors";
import { getRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? undefined;
    const { workspace } = await requireWorkspaceAccess(workspaceId);
    const connections = await getRepository().listStorageConnections(workspace.workspaceId);
    return Response.json({ data: { manifests: getConnectorStatuses(), connections } });
  } catch (error) {
    return apiError(error);
  }
}
