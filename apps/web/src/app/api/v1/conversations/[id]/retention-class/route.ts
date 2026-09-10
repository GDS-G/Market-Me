import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { conversationRetentionClassSchema } from "@/server/conversation-schema";
import { getConversationRepository } from "@/server/database";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = conversationRetentionClassSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const data = await getConversationRepository().setRetentionClass(
      parsed.data.workspaceId,
      (await context.params).id,
      parsed.data.retentionClass,
      user.id,
    );
    return data
      ? Response.json({ data })
      : Response.json(
          { error: { code: "not_found", message: "Conversation not found." } },
          { status: 404 },
        );
  } catch (error) {
    if (isConversationValidationError(error))
      return validation(
        Object.fromEntries(
          error.issues.map((issue) => [issue.field, [issue.message]]),
        ),
      );
    return apiError(error);
  }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json(
    { error: { code: "validation_failed", message: "Check the retention class.", fields } },
    { status: 422 },
  );
}

function isConversationValidationError(error: unknown): error is {
  name: "ConversationValidationError";
  issues: { field: string; message: string }[];
} {
  return Boolean(
    error && typeof error === "object" && "name" in error &&
      error.name === "ConversationValidationError" && "issues" in error &&
      Array.isArray(error.issues),
  );
}
