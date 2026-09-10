import { z } from "zod";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getCompanionRepository } from "@/server/database";

const schema = z.object({ workspaceId: z.uuid(), command: z.enum(["pause", "resume", "revoke"]) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Invalid companion command." } }, { status: 422 });
    const { workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const status = parsed.data.command === "pause" ? "paused" : parsed.data.command === "resume" ? "active" : "revoked";
    const changed = await getCompanionRepository().setWorkerStatus(workspace.workspaceId, id, status);
    if (!changed) return Response.json({ error: { code: "not_found", message: "Companion not found or already revoked." } }, { status: 404 });
    return Response.json({ data: { id, status } });
  } catch (error) { return apiError(error); }
}
