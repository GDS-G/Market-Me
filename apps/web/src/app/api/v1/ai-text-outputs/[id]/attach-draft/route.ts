import { apiError } from "@/server/api-response";
import { aiTextDraftProposalAttachSchema } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getAiRepository } from "@/server/database";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = aiTextDraftProposalAttachSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: { code: "validation_failed", message: "Choose an accepted output and editable Draft.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    return Response.json({
      data: await getAiRepository().attachWorkspaceTextOutputToDraft({
        ...parsed.data,
        artifactId: (await context.params).id,
      }, user.id),
    }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
