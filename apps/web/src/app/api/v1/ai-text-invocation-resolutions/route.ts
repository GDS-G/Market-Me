import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { aiTextInvocationResolutionListSchema } from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const parsed = aiTextInvocationResolutionListSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      return Response.json({
        error: { code: "validation_failed", message: "A workspace is required." },
      }, { status: 422 });
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId);
    return Response.json({
      data: await getAiRepository().listWorkspaceTextInvocationResolutions(
        parsed.data.workspaceId, user.id,
      ),
      meta: {
        tenantScoped: true,
        usageUnitsKnown: false,
        retryAllowed: false,
        providerRequestRetried: false,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
