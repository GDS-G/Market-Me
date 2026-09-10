import { apiError } from "@/server/api-response";
import { aiTextOutputListSchema } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getAiRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const parsed = aiTextOutputListSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      return Response.json({
        error: {
          code: "validation_failed",
          message: "The text-output query is not valid.",
          fields: parsed.error.flatten().fieldErrors,
        },
      }, { status: 422 });
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId);
    const repository = getAiRepository();
    const [artifacts, reconciliations] = await Promise.all([
      repository.listWorkspaceTextOutputArtifacts(parsed.data.workspaceId, user.id),
      repository.listWorkspaceTextInvocationReconciliations(parsed.data.workspaceId, user.id),
    ]);
    return Response.json({ data: { artifacts, reconciliations } });
  } catch (error) {
    return apiError(error);
  }
}
