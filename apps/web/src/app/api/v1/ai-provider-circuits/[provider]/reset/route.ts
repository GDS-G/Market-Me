import { apiError } from "@/server/api-response";
import { AuthorizationError, requireWorkspaceAccess } from "@/server/auth";
import { aiProviderCircuitResetSchema } from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const parsed = aiProviderCircuitResetSchema.safeParse({
      ...(await request.json().catch(() => ({}))),
      provider: (await context.params).provider,
    });
    if (!parsed.success)
      return Response.json({
        error: {
          code: "validation_failed",
          message: "Check the provider-circuit reset fields.",
          fields: parsed.error.flatten().fieldErrors,
        },
      }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId);
    if (workspace.role !== "owner" && workspace.role !== "admin")
      throw new AuthorizationError();
    return Response.json({
      data: await getAiRepository().resetWorkspaceProviderCircuit(parsed.data, user.id),
      meta: { tenantScoped: true, failClosed: true },
    });
  } catch (error) {
    return apiError(error);
  }
}
