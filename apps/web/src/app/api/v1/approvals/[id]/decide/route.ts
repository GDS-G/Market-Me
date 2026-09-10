import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getCampaignRepository } from "@/server/database";

const schema = z.object({ workspaceId: z.string().uuid(), decision: z.enum(["approved", "rejected", "changes_requested"]), notes: z.string().trim().max(2000).optional(), idempotencyKey: z.string().trim().min(8).max(300).optional() });
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Choose an approval decision." } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "approve");
    const approvalId = (await context.params).id;
    const updated = await getCampaignRepository().decideApproval({ workspaceId: workspace.workspaceId, approvalId, decision: parsed.data.decision, notes: parsed.data.notes, actorUserId: user.id, idempotencyKey: parsed.data.idempotencyKey ?? `approval:${approvalId}:${randomUUID()}` });
    return updated ? Response.json({ data: { queued: true } }, { status: 202 }) : Response.json({ error: { code: "not_found", message: "Pending approval not found." } }, { status: 404 });
  } catch (error) { return apiError(error); }
}
