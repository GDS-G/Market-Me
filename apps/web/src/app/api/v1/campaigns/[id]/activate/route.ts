import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getCampaignRepository } from "@/server/database";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json();
    const { user, workspace } = await requireWorkspaceAccess(typeof body.workspaceId === "string" ? body.workspaceId : undefined, "write");
    const data = await getCampaignRepository().activateCampaign({ workspaceId: workspace.workspaceId, campaignId: (await context.params).id, actorUserId: user.id });
    return data ? Response.json({ data }, { status: 202 }) : Response.json({ error: { code: "not_found", message: "Published campaign not found." } }, { status: 404 });
  } catch (error) { return apiError(error); }
}
