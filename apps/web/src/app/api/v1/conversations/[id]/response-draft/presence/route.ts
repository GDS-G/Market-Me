import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { conversationDraftingPresenceSchema } from "@/server/conversation-schema";
import { getConversationComposerRepository } from "@/server/database";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = conversationDraftingPresenceSchema.safeParse(await request.json());
    if (!parsed.success) return validationResponse(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    await getConversationComposerRepository().heartbeatPresence(
      parsed.data.workspaceId,
      (await context.params).id,
      "human",
      user.id,
    );
    return Response.json({ data: { active: true } });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = conversationDraftingPresenceSchema.safeParse(await request.json());
    if (!parsed.success) return validationResponse(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    await getConversationComposerRepository().clearPresence(
      parsed.data.workspaceId,
      (await context.params).id,
      "human",
      user.id,
    );
    return Response.json({ data: { active: false } });
  } catch (error) {
    return apiError(error);
  }
}

function validationResponse(fields: Record<string, string[] | undefined>) {
  return Response.json(
    {
      error: {
        code: "validation_failed",
        message: "Check the drafting-presence request.",
        fields,
      },
    },
    { status: 422 },
  );
}
