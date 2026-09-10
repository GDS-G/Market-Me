import { apiError } from "@/server/api-response";
import { z } from "zod";
import { requireWorkspaceAccess } from "@/server/auth";
import { getDraftRepository } from "@/server/database";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { workspace } = await requireWorkspaceAccess(new URL(request.url).searchParams.get("workspaceId") ?? undefined);
    const data = await getDraftRepository().get(workspace.workspaceId, (await context.params).id);
    return data ? Response.json({ data }) : Response.json({ error: { code: "not_found", message: "Draft not found." } }, { status: 404 });
  } catch (error) { return apiError(error); }
}

const revisionSchema = z.object({ workspaceId: z.string().uuid(), leadIn: z.string().trim().max(120).default(""), callToAction: z.string().trim().max(300).optional(), hashtags: z.array(z.string().trim().max(51)).max(20).default([]), altText: z.string().trim().max(1000).optional(), changeNote: z.string().trim().min(3).max(1000) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = revisionSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Check the presentation changes and explain the revision." } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const data = await getDraftRepository().revise({ ...parsed.data, workspaceId: workspace.workspaceId, draftId: (await context.params).id, actorUserId: user.id });
    return data ? Response.json({ data }) : Response.json({ error: { code: "not_found", message: "Editable Draft not found." } }, { status: 404 });
  } catch (error) { return apiError(error); }
}
