import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getCampaignRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const { workspace } = await requireWorkspaceAccess(url.searchParams.get("workspaceId") ?? undefined);
    const status = url.searchParams.get("status") === "pending" ? "pending" : undefined;
    const data = await getCampaignRepository().listApprovals(workspace.workspaceId, status);
    return Response.json({ data, meta: { count: data.length } });
  } catch (error) { return apiError(error); }
}
