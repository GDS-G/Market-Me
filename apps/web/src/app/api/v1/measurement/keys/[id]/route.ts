import { z } from "zod";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getPublishingRepository } from "@/server/database";

const revokeSchema = z.object({ workspaceId: z.string().uuid() });

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const parsed = revokeSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Workspace is required." } }, { status: 422 });
    const id = (await params).id;
    if (!z.string().uuid().safeParse(id).success) return Response.json({ error: { code: "validation_failed", message: "Measurement key ID is invalid." } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const revoked = await getPublishingRepository().revokeMeasurementKey(workspace.workspaceId, id, user.id);
    if (!revoked) return Response.json({ error: { code: "not_found", message: "Active measurement key not found." } }, { status: 404 });
    return Response.json({ data: { id, status: "revoked" } });
  } catch (error) { return apiError(error); }
}
