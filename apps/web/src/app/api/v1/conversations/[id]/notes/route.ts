import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { internalNoteSchema } from "@/server/conversation-schema";
import { getConversationRepository } from "@/server/database";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = internalNoteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Write a non-empty internal note.",
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
    const data = await getConversationRepository().addInternalNote(
      parsed.data.workspaceId,
      (await context.params).id,
      parsed.data.body,
      user.id,
    );
    return data
      ? Response.json({ data }, { status: 201 })
      : Response.json(
          { error: { code: "not_found", message: "Conversation not found." } },
          { status: 404 },
        );
  } catch (error) {
    return apiError(error);
  }
}
