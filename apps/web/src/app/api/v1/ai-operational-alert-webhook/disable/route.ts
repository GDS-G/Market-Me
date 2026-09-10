import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { aiOperationalAlertWebhookActionSchema } from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";

export async function POST(request: Request) {
  try {
    const parsed = aiOperationalAlertWebhookActionSchema.safeParse(
      await request.json().catch(() => ({})),
    );
    if (!parsed.success)
      return Response.json({ error: { code: "validation_failed", message: "A workspace is required." } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId);
    if (!["owner", "admin"].includes(workspace.role))
      return Response.json({ error: { code: "forbidden", message: "Workspace administration is required." } }, { status: 403 });
    return Response.json({
      data: await getAiRepository().disableWorkspaceAiOperationalAlertWebhook(
        parsed.data.workspaceId, user.id,
      ),
      meta: { executionAuthority: false, providerRequestAuthority: false },
    });
  } catch (error) { return apiError(error); }
}
