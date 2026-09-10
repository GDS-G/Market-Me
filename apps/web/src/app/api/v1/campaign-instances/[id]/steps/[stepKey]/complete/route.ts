import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getCampaignRepository } from "@/server/database";
import { CampaignValidationError } from "@market-me/database";
import { campaignInstanceControls } from "@/components/campaign-instance-controls";

const schema = z.object({ workspaceId: z.string().uuid(), output: z.record(z.string(), z.unknown()).default({}), idempotencyKey: z.string().trim().min(8).max(300).optional() });
export async function POST(request: Request, context: { params: Promise<{ id: string; stepKey: string }> }) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Step output must be a JSON object." } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const params = await context.params;
    const repository = getCampaignRepository();
    const instance = await repository.getCampaignInstance(workspace.workspaceId, params.id);
    if (!instance || instance.id !== params.id || instance.workspaceId !== workspace.workspaceId) return Response.json({ error: { code: "not_found", message: "Campaign instance not found." } }, { status: 404 });
    const run = instance.stepRuns.find((candidate) => candidate.campaignInstanceId === instance.id && candidate.stepKey === params.stepKey);
    if (!run) return Response.json({ error: { code: "not_found", message: "Campaign step run not found." } }, { status: 404 });
    const controls = campaignInstanceControls(instance);
    if (!controls.manualRuns.some((candidate) => candidate.id === run.id)) return Response.json({ error: { code: controls.scheduleBlocked ? "schedule_blocked" : "manual_completion_unavailable", message: controls.scheduleBlocked ? "Manual completion cannot bypass a missed schedule window." : "Only a current manual-resolution step in an active or paused run may be completed." } }, { status: 409 });
    const queued = await repository.queueInstanceCommand({ workspaceId: workspace.workspaceId, instanceId: params.id, commandType: "manual_step_completed", payload: { stepKey: params.stepKey, output: parsed.data.output }, idempotencyKey: parsed.data.idempotencyKey ?? `manual:${params.id}:${params.stepKey}:${randomUUID()}`, actorUserId: user.id });
    return queued ? Response.json({ data: { queued: true } }, { status: 202 }) : Response.json({ error: { code: "not_found", message: "Campaign instance not found." } }, { status: 404 });
  } catch (error) {
    if (error instanceof CampaignValidationError) {
      const issue = error.issues.find((candidate) => ["schedule_blocked", "manual_completion_unavailable"].includes(candidate.code));
      if (issue) return Response.json({ error: { code: issue.code, message: issue.message } }, { status: 409 });
    }
    return apiError(error);
  }
}
