import { requireWorkspaceAccess } from "@/server/auth";
import { getCampaignRepository } from "@/server/database";
import { finalizationUuid, finalizationValidation } from "@/server/campaign-finalization-api";
import { campaignVersionAction, campaignVersionActionError, campaignVersionOriginAllowed } from "@/server/campaign-version-action-api";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!campaignVersionOriginAllowed(request)) return Response.json({ error: { code: "origin_forbidden", message: "Publish campaign versions from this application only." } }, { status: 403 });
  try {
    const body = campaignVersionAction.safeParse(await request.json().catch(() => undefined));
    const id = finalizationUuid.safeParse((await context.params).id);
    if (!body.success || !id.success) return finalizationValidation("Choose a valid campaign, workspace, and expected version.");
    const { workspace } = await requireWorkspaceAccess(body.data.workspaceId, "write");
    const data = await getCampaignRepository().publishCampaign(workspace.workspaceId, id.data, { expectedVersionId: body.data.expectedVersionId });
    return data ? Response.json({ data }) : Response.json({ error: { code: "not_found", message: "Campaign draft not found." } }, { status: 404 });
  } catch (error) { return campaignVersionActionError(error); }
}
