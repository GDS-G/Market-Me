import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { aiOperationalIncidentListSchema } from "@/server/ai-schema";
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
      data: await getAiRepository().getWorkspaceAiOperationalReadiness(
        parsed.data.workspaceId, user.id,
      ),
      meta: {
        observationOnly: true,
        executionAuthority: false,
        externalAlertDeliveryConfigured: false,
        publicExecutionRouteAvailable: false,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
