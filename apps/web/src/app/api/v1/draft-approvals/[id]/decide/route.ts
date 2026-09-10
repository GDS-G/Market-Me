import { z } from "zod";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getDraftRepository } from "@/server/database";

const schema = z.object({ workspaceId: z.string().uuid(), decision: z.enum(["approved", "rejected", "changes_requested"]), notes: z.string().trim().max(2000).optional() });
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Choose a valid review decision." } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "approve");
    const data = await getDraftRepository().decide({ workspaceId: workspace.workspaceId, approvalId: (await context.params).id, decision: parsed.data.decision, notes: parsed.data.notes, actorUserId: user.id });
    return data ? Response.json({ data }) : Response.json({ error: { code: "not_found", message: "Pending draft approval not found." } }, { status: 404 });
  } catch (error) { return apiError(error); }
}
