import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getCampaignRepository } from "@/server/database";
import { CampaignValidationError } from "@market-me/database";
import { campaignInstanceControls } from "@/components/campaign-instance-controls";

const schema = z.object({ workspaceId: z.string().uuid(), command: z.enum(["pause", "resume", "cancel"]), idempotencyKey: z.string().trim().min(8).max(300).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Choose a valid workflow command." } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const instanceId = (await context.params).id;
    const repository = getCampaignRepository();
    const instance = await repository.getCampaignInstance(workspace.workspaceId, instanceId);
    if (!instance || instance.id !== instanceId || instance.workspaceId !== workspace.workspaceId) return Response.json({ error: { code: "not_found", message: "Campaign instance not found." } }, { status: 404 });
    const controls = campaignInstanceControls(instance);
    if (parsed.data.command === "resume" && !controls.canResume) return Response.json({ error: { code: controls.scheduleBlocked ? "schedule_blocked" : "command_not_allowed", message: controls.scheduleBlocked ? "A missed window cannot be resumed. Cancel this run and publish a revised plan." : "Only a paused run may be resumed." } }, { status: 409 });
    const queued = await repository.queueInstanceCommand({
      workspaceId: workspace.workspaceId, instanceId, commandType: parsed.data.command,
      idempotencyKey: parsed.data.idempotencyKey ?? `campaign:${instanceId}:${parsed.data.command}:${randomUUID()}`,
      actorUserId: user.id,
    });
    return queued ? Response.json({ data: { queued: true } }, { status: 202 }) : Response.json({ data: { queued: false, duplicate: true } });
  } catch (error) {
    if (error instanceof CampaignValidationError && error.issues.some((issue) => issue.code === "schedule_blocked")) return Response.json({ error: { code: "schedule_blocked", message: "A missed window cannot be resumed. Cancel this run and publish a revised plan." } }, { status: 409 });
    return apiError(error);
  }
}
