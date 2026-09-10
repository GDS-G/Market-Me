import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { destinationWriteSchema } from "@/server/campaign-schema";
import { getCampaignRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceAccess(new URL(request.url).searchParams.get("workspaceId") ?? undefined);
    const data = await getCampaignRepository().listDestinations(workspace.workspaceId);
    return Response.json({ data, meta: { count: data.length } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = destinationWriteSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Check the destination fields.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    return Response.json({ data: await getCampaignRepository().saveDestination(parsed.data, user.id) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
