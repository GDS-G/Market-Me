import { apiError } from "@/server/api-response";
import { AuthorizationError, requireWorkspaceAccess } from "@/server/auth";
import {
  aiAdapterRegistrationCreateSchema,
  aiAdapterRegistrationListSchema,
} from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const parsed = aiAdapterRegistrationListSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId);
    return Response.json({
      data: await getAiRepository().listWorkspaceAdapterRegistrations(
        parsed.data.workspaceId,
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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => undefined);
    const parsed = aiAdapterRegistrationCreateSchema.safeParse(body);
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId);
    if (workspace.role !== "owner" && workspace.role !== "admin") {
      throw new AuthorizationError();
    }
    return Response.json({
      data: await getAiRepository().registerWorkspaceAdapter(parsed.data, user.id),
      meta: {
        tenantScoped: true,
        deploymentStaging: true,
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      },
    }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json({
    error: {
      code: "validation_failed",
      message: "Check the adapter-registration fields.",
      fields,
    },
  }, { status: 422 });
}
