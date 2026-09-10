import { apiError } from "@/server/api-response";
import { AuthorizationError, requireWorkspaceAccess } from "@/server/auth";
import {
  aiAdapterInvocationBindingCreateSchema,
  aiAdapterInvocationBindingListSchema,
} from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const parsed = aiAdapterInvocationBindingListSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId);
    const repository = getAiRepository();
    const [contracts, bindings] = await Promise.all([
      repository.listProviderInvocationContracts(parsed.data.workspaceId, user.id),
      repository.listWorkspaceAdapterInvocationBindings(parsed.data.workspaceId, user.id),
    ]);
    return Response.json({
      data: { contracts, bindings },
      meta: boundary(),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => undefined);
    const parsed = aiAdapterInvocationBindingCreateSchema.safeParse(body);
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId);
    if (workspace.role !== "owner" && workspace.role !== "admin") {
      throw new AuthorizationError();
    }
    return Response.json({
      data: await getAiRepository().configureWorkspaceAdapterInvocation(
        parsed.data,
        user.id,
      ),
      meta: boundary(),
    }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json({
    error: {
      code: "validation_failed",
      message: "Check the invocation-configuration fields.",
      fields,
    },
  }, { status: 422 });
}

function boundary() {
  return {
    serverOwnedContract: true,
    providerHealthEvidenceAvailable: true,
    implementationAvailable: true,
    healthReady: false,
    routingAvailable: false,
    adapterActivation: false,
    execution: false,
  } as const;
}
