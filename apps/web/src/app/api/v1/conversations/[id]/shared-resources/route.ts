import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getConversationRepository } from "@/server/database";
import { conversationSharedResourceWriteSchema } from "@/server/conversation-schema";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = conversationSharedResourceWriteSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Check the shared-resource fields.",
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
    const data = await getConversationRepository().recordSharedResource(
      {
        ...parsed.data,
        conversationThreadId: (await context.params).id,
      },
      user.id,
    );
    return data
      ? Response.json({ data }, { status: 201 })
      : Response.json(
          { error: { code: "not_found", message: "Conversation not found." } },
          { status: 404 },
        );
  } catch (error) {
    if (isConversationValidationError(error)) {
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Check the shared-resource fields.",
            fields: Object.fromEntries(
              error.issues.map((issue) => [issue.field, [issue.message]]),
            ),
          },
        },
        { status: 422 },
      );
    }
    return apiError(error);
  }
}

function isConversationValidationError(error: unknown): error is {
  name: "ConversationValidationError";
  issues: { field: string; message: string }[];
} {
  return Boolean(
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "ConversationValidationError" &&
    "issues" in error &&
    Array.isArray(error.issues),
  );
}
