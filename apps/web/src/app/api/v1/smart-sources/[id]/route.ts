import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getRepository } from "@/server/database";
import { smartSourceInputSchema, validationError } from "@/server/smart-source-schema";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? undefined;
    const { workspace } = await requireWorkspaceAccess(workspaceId);
    const data = await getRepository().getSmartSource(workspace.workspaceId, id);
    if (!data) return Response.json({ error: { code: "not_found", message: "Smart Source not found." } }, { status: 404 });
    return Response.json({ data });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const parsed = smartSourceInputSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const data = await getRepository().updateSmartSource(id, parsed.data, user.id);
    if (!data) return Response.json({ error: { code: "not_found", message: "Smart Source not found." } }, { status: 404 });
    return Response.json({ data });
  } catch (error) {
    return apiError(error);
  }
}
