import { apiError } from "@/server/api-response";
import { aiTextDraftProposalDismissSchema } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getAiRepository } from "@/server/database";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = aiTextDraftProposalDismissSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: { code: "validation_failed", message: "Provide a bounded dismissal note.", fields: parsed.error.flatten().fieldErrors } }, { status: 422 });
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    return Response.json({ data: await getAiRepository().dismissWorkspaceTextDraftProposal({
      ...parsed.data,
      proposalId: (await context.params).id,
    }, user.id) });
  } catch (error) {
    return apiError(error);
  }
}
