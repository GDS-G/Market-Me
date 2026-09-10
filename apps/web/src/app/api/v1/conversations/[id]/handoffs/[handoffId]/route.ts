import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { conversationHandoffCloseSchema } from "@/server/conversation-schema";
import { getConversationRepository } from "@/server/database";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; handoffId: string }> },
) {
  try {
    const parsed = conversationHandoffCloseSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Choose resolved or cancelled.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 422 },
      );
    }
    const { user } = await requireWorkspaceAccess(
      parsed.data.workspaceId,
      "write",
    );
    const params = await context.params;
    const data = await getConversationRepository().closeHandoff(
      parsed.data.workspaceId,
      params.id,
      params.handoffId,
      parsed.data.status,
      user.id,
    );
    return data
      ? Response.json({ data })
      : Response.json(
          { error: { code: "not_found", message: "Open handoff not found." } },
          { status: 404 },
        );
  } catch (error) {
    return apiError(error);
  }
}
