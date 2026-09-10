import { apiError } from "@/server/api-response";
import { AuthorizationError, requireWorkspaceAccess } from "@/server/auth";
import { aiAdapterRegistrationRetireSchema } from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = aiAdapterRegistrationRetireSchema.safeParse({
      ...body,
      registrationId: (await context.params).id,
    });
    if (!parsed.success) {
      return Response.json({
        error: {
          code: "validation_failed",
          message: "Check the adapter-registration retirement fields.",
          fields: parsed.error.flatten().fieldErrors,
        },
      }, { status: 422 });
    }
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId);
    if (workspace.role !== "owner" && workspace.role !== "admin") {
      throw new AuthorizationError();
    }
    return Response.json({
      data: await getAiRepository().retireWorkspaceAdapterRegistration(
        parsed.data,
        user.id,
      ),
      meta: {
        tenantScoped: true,
        deploymentStaging: true,
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
