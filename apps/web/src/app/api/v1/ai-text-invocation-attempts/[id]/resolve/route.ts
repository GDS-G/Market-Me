import { apiError } from "@/server/api-response";
import { AuthorizationError, requireWorkspaceAccess } from "@/server/auth";
import { aiTextInvocationResolveSchema } from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = aiTextInvocationResolveSchema.safeParse({
      ...(await request.json().catch(() => ({}))),
      attemptId: (await context.params).id,
    });
    if (!parsed.success)
      return Response.json({
        error: {
          code: "validation_failed",
          message: "Check the invocation-resolution fields.",
          fields: parsed.error.flatten().fieldErrors,
        },
      }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId);
    if (!["owner", "admin", "approver"].includes(workspace.role))
      throw new AuthorizationError();
    return Response.json({
      data: await getAiRepository().resolveWorkspaceTextInvocation(parsed.data, user.id),
      meta: {
        tenantScoped: true,
        usageUnitsKnown: false,
        retryAllowed: false,
        providerRequestRetried: false,
      },
    }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
