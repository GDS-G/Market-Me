import { z } from "zod";
import { requireWorkspaceAccess } from "@/server/auth";
import { getCampaignFinalizationRepository } from "@/server/database";
import { finalizationApiError, finalizationUuid, finalizationValidation } from "@/server/campaign-finalization-api";

const selectionQuery = z.object({ workspaceId: finalizationUuid, previewId: finalizationUuid }).strict();
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = finalizationUuid.safeParse((await context.params).id);
    const query = new URL(request.url).searchParams;
    if (!id.success || [...query.keys()].some((key) => !["workspaceId", "previewId"].includes(key))
      || query.getAll("workspaceId").length !== 1 || query.getAll("previewId").length !== 1) return finalizationValidation("Choose one preparation, workspace, and preview.");
    const parsed = selectionQuery.safeParse(Object.fromEntries(query));
    if (!parsed.success) return finalizationValidation("Choose a valid workspace and preview.");
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId);
    const selected = await getCampaignFinalizationRepository().getPreviewSelection(workspace.workspaceId, id.data, parsed.data.previewId, user.id);
    return selected ? Response.json({ data: selected }, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: { code: "not_found", message: "This preview is unavailable for the selected preparation." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return finalizationApiError(error); }
}
