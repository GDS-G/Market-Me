import { apiError } from "@/server/api-response";
import { aiTextDraftProposalApplySchema } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getAiRepository } from "@/server/database";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = aiTextDraftProposalApplySchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({
        error: {
          code: "validation_failed",
          message: "Choose bounded presentation fields and provide a change note.",
          fields: parsed.error.flatten().fieldErrors,
        },
      }, { status: 422 });
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    return Response.json({
      data: await getAiRepository().applyWorkspaceTextDraftProposal({
        ...parsed.data,
        proposalId: (await context.params).id,
      }, user.id),
      meta: {
        immutableSuccessor: true,
        evidenceClaimsPreserved: true,
        approvalRequired: true,
        publishingAuthorized: false,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
