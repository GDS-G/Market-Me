import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { destinationWriteSchema } from "@/server/campaign-schema";
import { getCampaignRepository } from "@/server/database";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { workspace } = await requireWorkspaceAccess(new URL(request.url).searchParams.get("workspaceId") ?? undefined);
    const data = await getCampaignRepository().getDestination(workspace.workspaceId, (await context.params).id);
    return data ? Response.json({ data }) : Response.json({ error: { code: "not_found", message: "Destination not found." } }, { status: 404 });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = destinationWriteSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Check the destination fields.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const existing = await getCampaignRepository().getDestination(parsed.data.workspaceId, (await context.params).id);
    if (!existing) return Response.json({ error: { code: "not_found", message: "Destination not found." } }, { status: 404 });
    return Response.json({ data: await getCampaignRepository().saveDestination(parsed.data, user.id, existing.id) });
  } catch (error) { return apiError(error); }
}
