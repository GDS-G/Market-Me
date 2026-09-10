import { apiError } from "@/server/api-response";
import { AuthorizationError, requireWorkspaceAccess } from "@/server/auth";
import {
  aiExecutionControlListSchema,
  aiExecutionControlSaveSchema,
} from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";
import { getServerConfiguration } from "@/server/config";

export async function GET(request: Request) {
  try {
    const parsed = aiExecutionControlListSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId);
    const repository = getAiRepository();
    const [control, circuits] = await Promise.all([
      repository.getWorkspaceExecutionControl(parsed.data.workspaceId, user.id),
      repository.listWorkspaceProviderCircuits(parsed.data.workspaceId, user.id),
    ]);
    return Response.json({
      data: { control, circuits },
      meta: {
        deploymentExecutionEnabled: getServerConfiguration().aiProviderExecutionEnabled,
        tenantScoped: true,
        failClosed: true,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const parsed = aiExecutionControlSaveSchema.safeParse(
      await request.json().catch(() => undefined),
    );
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId);
    if (workspace.role !== "owner" && workspace.role !== "admin")
      throw new AuthorizationError();
    return Response.json({
      data: await getAiRepository().saveWorkspaceExecutionControl(parsed.data, user.id),
      meta: {
        deploymentExecutionEnabled: getServerConfiguration().aiProviderExecutionEnabled,
        tenantScoped: true,
        failClosed: true,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json({
    error: {
      code: "validation_failed",
      message: "Check the AI execution-control fields.",
      fields,
    },
  }, { status: 422 });
}
