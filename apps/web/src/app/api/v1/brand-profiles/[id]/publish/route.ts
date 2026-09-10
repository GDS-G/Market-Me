import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getProfileRepository } from "@/server/database";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; const body = (await request.json().catch(() => ({}))) as { workspaceId?: string }; const { user, workspace } = await requireWorkspaceAccess(body.workspaceId, "write"); const data = await getProfileRepository().publishBrandProfile(workspace.workspaceId, id, user.id); return data ? Response.json({ data }) : Response.json({ error: { code: "not_found", message: "Brand Profile not found." } }, { status: 404 }); } catch (error) { return apiError(error); } }
