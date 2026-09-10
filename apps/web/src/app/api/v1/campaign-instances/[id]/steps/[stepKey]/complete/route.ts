import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getCampaignRepository } from "@/server/database";

const schema = z.object({ workspaceId: z.string().uuid(), output: z.record(z.string(), z.unknown()).default({}), idempotencyKey: z.string().trim().min(8).max(300).optional() });
export async function POST(request: Request, context: { params: Promise<{ id: string; stepKey: string }> }) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Step output must be a JSON object." } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const params = await context.params;
    const queued = await getCampaignRepository().queueInstanceCommand({ workspaceId: workspace.workspaceId, instanceId: params.id, commandType: "manual_step_completed", payload: { stepKey: params.stepKey, output: parsed.data.output }, idempotencyKey: parsed.data.idempotencyKey ?? `manual:${params.id}:${params.stepKey}:${randomUUID()}`, actorUserId: user.id });
    return queued ? Response.json({ data: { queued: true } }, { status: 202 }) : Response.json({ error: { code: "not_found", message: "Campaign instance not found." } }, { status: 404 });
  } catch (error) { return apiError(error); }
}
