import { apiError } from "@/server/api-response";
import { AuthorizationError, requireWorkspaceAccess } from "@/server/auth";
import { aiAdapterInvocationBindingRetireSchema } from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = aiAdapterInvocationBindingRetireSchema.safeParse({
      ...body,
      bindingId: (await context.params).id,
    });
    if (!parsed.success) {
      return Response.json({
        error: {
          code: "validation_failed",
          message: "Check the invocation-configuration retirement fields.",
          fields: parsed.error.flatten().fieldErrors,
        },
      }, { status: 422 });
    }
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId);
    if (workspace.role !== "owner" && workspace.role !== "admin") {
      throw new AuthorizationError();
    }
    return Response.json({
      data: await getAiRepository().retireWorkspaceAdapterInvocationBinding(
        parsed.data,
        user.id,
      ),
      meta: {
        serverOwnedContract: true,
        implementationAvailable: true,
        healthReady: false,
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
