import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getCampaignRepository } from "@/server/database";

const schema = z.object({ workspaceId: z.string().uuid(), command: z.enum(["pause", "resume", "cancel"]), idempotencyKey: z.string().trim().min(8).max(300).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Choose a valid workflow command." } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const instanceId = (await context.params).id;
    const queued = await getCampaignRepository().queueInstanceCommand({
      workspaceId: workspace.workspaceId, instanceId, commandType: parsed.data.command,
      idempotencyKey: parsed.data.idempotencyKey ?? `campaign:${instanceId}:${parsed.data.command}:${randomUUID()}`,
      actorUserId: user.id,
    });
    return queued ? Response.json({ data: { queued: true } }, { status: 202 }) : Response.json({ data: { queued: false, duplicate: true } });
  } catch (error) { return apiError(error); }
}
