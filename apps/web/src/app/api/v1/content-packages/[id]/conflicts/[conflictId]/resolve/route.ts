import { z } from "zod";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getRepository } from "@/server/database";

const schema = z.object({
  workspaceId: z.string().uuid(),
  evidenceId: z.string().uuid(),
  note: z.string().trim().max(2000).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string; conflictId: string }> }) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Choose a valid evidence item." } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "approve");
    const params = await context.params;
    const data = await getRepository().resolveEvidenceConflict({
      workspaceId: workspace.workspaceId,
      packageId: params.id,
      conflictId: params.conflictId,
      evidenceId: parsed.data.evidenceId,
      note: parsed.data.note,
      actorUserId: user.id,
    });
    if (!data) return Response.json({ error: { code: "not_found", message: "Conflict or candidate evidence not found." } }, { status: 404 });
    return Response.json({ data });
  } catch (error) {
    return apiError(error);
  }
}
