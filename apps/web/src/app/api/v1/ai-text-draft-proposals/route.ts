import { apiError } from "@/server/api-response";
import { aiTextDraftProposalListSchema } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getAiRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const parsed = aiTextDraftProposalListSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      return Response.json({ error: { code: "validation_failed", message: "The Draft-proposal query is not valid.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId);
    return Response.json({ data: await getAiRepository().listWorkspaceTextDraftProposals(
      parsed.data.workspaceId, parsed.data.contentDraftId, user.id,
    ) });
  } catch (error) {
    return apiError(error);
  }
}
