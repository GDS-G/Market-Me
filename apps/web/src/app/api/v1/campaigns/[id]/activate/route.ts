import { requireWorkspaceAccess } from "@/server/auth";
import { getCampaignRepository } from "@/server/database";
import { finalizationUuid, finalizationValidation } from "@/server/campaign-finalization-api";
import { campaignVersionAction, campaignVersionActionError, campaignVersionOriginAllowed } from "@/server/campaign-version-action-api";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!campaignVersionOriginAllowed(request)) return Response.json({ error: { code: "origin_forbidden", message: "Activate campaign versions from this application only." } }, { status: 403 });
  try {
    const body = campaignVersionAction.safeParse(await request.json().catch(() => undefined));
    const id = finalizationUuid.safeParse((await context.params).id);
    if (!body.success || !id.success) return finalizationValidation("Choose a valid campaign, workspace, and expected version.");
    const { user, workspace } = await requireWorkspaceAccess(body.data.workspaceId, "write");
    const data = await getCampaignRepository().activateCampaign({ workspaceId: workspace.workspaceId, campaignId: id.data, actorUserId: user.id, expectedVersionId: body.data.expectedVersionId });
    return data ? Response.json({ data }, { status: 202 }) : Response.json({ error: { code: "not_found", message: "Published campaign not found." } }, { status: 404 });
  } catch (error) { return campaignVersionActionError(error); }
}
