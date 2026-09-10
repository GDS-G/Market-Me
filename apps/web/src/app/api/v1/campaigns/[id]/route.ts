import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { campaignDraftSchema } from "@/server/campaign-schema";
import { getCampaignRepository } from "@/server/database";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { workspace } = await requireWorkspaceAccess(new URL(request.url).searchParams.get("workspaceId") ?? undefined);
    const data = await getCampaignRepository().getCampaign(workspace.workspaceId, (await context.params).id);
    return data ? Response.json({ data }) : Response.json({ error: { code: "not_found", message: "Campaign not found." } }, { status: 404 });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = campaignDraftSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Check the campaign graph.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const data = await getCampaignRepository().saveCampaignDraft((await context.params).id, parsed.data, user.id);
    return data ? Response.json({ data }) : Response.json({ error: { code: "not_found", message: "Campaign not found." } }, { status: 404 });
  } catch (error) { return apiError(error); }
}
