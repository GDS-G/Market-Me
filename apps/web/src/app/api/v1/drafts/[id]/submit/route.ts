import { z } from "zod";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getDraftRepository } from "@/server/database";

const schema = z.object({ workspaceId: z.string().uuid() });
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "A workspace is required." } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const data = await getDraftRepository().submit(workspace.workspaceId, (await context.params).id, user.id);
    return data ? Response.json({ data }) : Response.json({ error: { code: "not_found", message: "Working draft not found." } }, { status: 404 });
  } catch (error) { return apiError(error); }
}
