import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import {
  aiOperationalIncidentListSchema,
  aiOperationalIncidentResponsePolicySchema,
} from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const parsed = aiOperationalIncidentListSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      return Response.json({
        error: { code: "validation_failed", message: "A workspace is required." },
      }, { status: 422 });
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId);
    return Response.json({
      data: await getAiRepository().getWorkspaceAiOperationalIncidentResponsePolicy(
        parsed.data.workspaceId, user.id,
      ),
      meta: { executionAuthority: false, externalAlertDeliveryChanged: false },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const parsed = aiOperationalIncidentResponsePolicySchema.safeParse(
      await request.json().catch(() => ({})),
    );
    if (!parsed.success)
      return Response.json({
        error: {
          code: "validation_failed",
          message: "Check the incident-response policy fields.",
          fields: parsed.error.flatten().fieldErrors,
        },
      }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId);
    if (!['owner', 'admin'].includes(workspace.role))
      return Response.json({
        error: { code: "forbidden", message: "Workspace administration is required." },
      }, { status: 403 });
    return Response.json({
      data: await getAiRepository().saveWorkspaceAiOperationalIncidentResponsePolicy(
        parsed.data, user.id,
      ),
      meta: { executionAuthority: false, externalAlertDeliveryChanged: false },
    });
  } catch (error) {
    return apiError(error);
  }
}
