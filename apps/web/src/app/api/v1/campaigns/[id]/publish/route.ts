import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getCampaignRepository } from "@/server/database";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json();
    const { workspace } = await requireWorkspaceAccess(typeof body.workspaceId === "string" ? body.workspaceId : undefined, "write");
    const data = await getCampaignRepository().publishCampaign(workspace.workspaceId, (await context.params).id);
    return data ? Response.json({ data }) : Response.json({ error: { code: "not_found", message: "Campaign draft not found." } }, { status: 404 });
  } catch (error) { return apiError(error); }
}
