import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { aiRoutingPreviewSchema, defaultWorkspaceAiPolicy } from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";
import { routeAiTask } from "@market-me/generation";

export async function POST(request: Request) {
  try {
    const parsed = aiRoutingPreviewSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Choose a supported capability and valid input estimate.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 422 },
      );
    const { workspace } = await requireWorkspaceAccess(parsed.data.workspaceId);
    const repository = getAiRepository();
    const [storedPolicy, adapters] = await Promise.all([
      repository.getPolicy(workspace.workspaceId),
      repository.listProviderAdapters(),
    ]);
    const policy =
      storedPolicy ??
      defaultWorkspaceAiPolicy(workspace.workspaceId);
    return Response.json({
      data: routeAiTask(
        {
          capability: parsed.data.capability,
          mode: policy.mode,
          maximumPrivacyClass: policy.maximumPrivacyClass,
          estimatedInputUnits: parsed.data.estimatedInputUnits,
          requiresTools: parsed.data.requiresTools,
        },
        adapters,
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}
