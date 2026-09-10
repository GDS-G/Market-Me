import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { conversationResponseSuggestionDecisionSchema } from "@/server/conversation-schema";
import { getConversationAssistantRepository } from "@/server/database";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; suggestionId: string }> },
) {
  try {
    const parsed = conversationResponseSuggestionDecisionSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success)
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Check the suggestion decision.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 422 },
      );
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const params = await context.params;
    const data = await getConversationAssistantRepository().dismissSuggestion(
      params.suggestionId,
      {
        workspaceId: parsed.data.workspaceId,
        conversationThreadId: params.id,
        status: parsed.data.status,
      },
      user.id,
    );
    return data
      ? Response.json({ data })
      : Response.json(
          {
            error: {
              code: "not_found",
              message: "Active response suggestion not found.",
            },
          },
          { status: 404 },
        );
  } catch (error) {
    return apiError(error);
  }
}
