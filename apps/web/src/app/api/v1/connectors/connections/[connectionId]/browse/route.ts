import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getIngestionService } from "@/server/ingestion";

export async function GET(
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) {
  try {
    const { connectionId } = await context.params;
    const url = new URL(request.url);
    const locationId = url.searchParams.get("locationId");
    if (!locationId) {
      return Response.json({ error: { code: "location_required", message: "A provider location ID is required." } }, { status: 400 });
    }
    const { workspace } = await requireWorkspaceAccess(url.searchParams.get("workspaceId") ?? undefined);
    const data = await getIngestionService().sampleLocation({
      workspaceId: workspace.workspaceId,
      connectionId,
      providerLocationId: locationId,
    });
    return Response.json({ data });
  } catch (error) {
    return apiError(error);
  }
}
