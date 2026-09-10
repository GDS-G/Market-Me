import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { conversationReadSchema } from "@/server/conversation-schema";
import { getConversationRepository } from "@/server/database";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = conversationReadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Check the read-state fields.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 422 },
      );
    }
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId);
    const lastReadAt = await getConversationRepository().markRead(
      parsed.data.workspaceId,
      (await context.params).id,
      user.id,
    );
    return lastReadAt
      ? Response.json({ data: { lastReadAt, unreadCount: 0 } })
      : Response.json(
          { error: { code: "not_found", message: "Conversation not found." } },
          { status: 404 },
        );
  } catch (error) {
    return apiError(error);
  }
}
