import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceAccess(
      new URL(request.url).searchParams.get("workspaceId") ?? undefined,
    );
    const data = await getRepository().listWorkspaceMembers(
      workspace.workspaceId,
    );
    return Response.json({ data, meta: { count: data.length } });
  } catch (error) {
    return apiError(error);
  }
}
