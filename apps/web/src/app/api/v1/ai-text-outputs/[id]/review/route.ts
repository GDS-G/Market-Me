import { apiError } from "@/server/api-response";
import { aiTextOutputReviewSchema } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getAiRepository } from "@/server/database";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = aiTextOutputReviewSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: { code: "validation_failed", message: "The output review is not valid.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "approve");
    return Response.json({
      data: await getAiRepository().reviewWorkspaceTextOutputArtifact({
        ...parsed.data,
        artifactId: (await context.params).id,
      }, user.id),
    });
  } catch (error) {
    return apiError(error);
  }
}
