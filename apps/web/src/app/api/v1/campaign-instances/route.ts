import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getCampaignRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const { workspace } = await requireWorkspaceAccess(url.searchParams.get("workspaceId") ?? undefined);
    const data = await getCampaignRepository().listCampaignInstances(workspace.workspaceId, url.searchParams.get("campaignId") ?? undefined);
    return Response.json({ data, meta: { count: data.length } });
  } catch (error) { return apiError(error); }
}
