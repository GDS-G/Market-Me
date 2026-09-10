import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getConversationRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceAccess(
      new URL(request.url).searchParams.get("workspaceId") ?? undefined,
    );
    const data = await getConversationRepository().listAttentionItems(
      workspace.workspaceId,
    );
    return Response.json({ data, meta: { count: data.length, limit: 200 } });
  } catch (error) {
    return apiError(error);
  }
}
