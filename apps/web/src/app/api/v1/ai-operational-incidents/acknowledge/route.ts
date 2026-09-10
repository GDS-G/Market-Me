import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { aiOperationalIncidentAcknowledgeSchema } from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";

export async function POST(request: Request) {
  try {
    const parsed = aiOperationalIncidentAcknowledgeSchema.safeParse(
      await request.json().catch(() => ({})),
    );
    if (!parsed.success)
      return Response.json({
        error: {
          code: "validation_failed",
          message: "Check the incident acknowledgement fields.",
          fields: parsed.error.flatten().fieldErrors,
        },
      }, { status: 422 });
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "approve");
    return Response.json({
      data: await getAiRepository().acknowledgeWorkspaceAiOperationalIncident(
        parsed.data, user.id,
      ),
      meta: {
        incidentResolved: false,
        executionAuthority: false,
        providerRequestRetried: false,
      },
    }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
