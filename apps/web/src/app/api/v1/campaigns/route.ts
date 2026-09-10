import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { campaignDraftSchema } from "@/server/campaign-schema";
import { getCampaignRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceAccess(new URL(request.url).searchParams.get("workspaceId") ?? undefined);
    const data = await getCampaignRepository().listCampaigns(workspace.workspaceId);
    return Response.json({ data, meta: { count: data.length } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = campaignDraftSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Check the campaign graph.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    return Response.json({ data: await getCampaignRepository().createCampaign(parsed.data, user.id) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
