import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getPublishingRepository } from "@/server/database";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { workspace } = await requireWorkspaceAccess(new URL(request.url).searchParams.get("workspaceId") ?? undefined, "read");
    const id = (await context.params).id;
    const repository = getPublishingRepository();
    return Response.json({ data: {
      summary: await repository.getCampaignMeasurementSummary(workspace.workspaceId, id),
      publications: await repository.listPublicationActions(workspace.workspaceId, id),
      mailchimpReports: await repository.listMailchimpCampaignReportSnapshots(workspace.workspaceId, id),
      mastodonReports: await repository.listMastodonStatusReportSnapshots(workspace.workspaceId, id),
      mastodonReportCollectionStates: await repository.listMastodonStatusReportCollectionStates(workspace.workspaceId, id),
    } });
  } catch (error) { return apiError(error); }
}
