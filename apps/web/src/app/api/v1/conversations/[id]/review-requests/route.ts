import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { conversationReviewRequestWriteSchema } from "@/server/conversation-schema";
import { getConversationRepository } from "@/server/database";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const id = (await context.params).id;
    const parsed = conversationReviewRequestWriteSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success || parsed.data.conversationThreadId !== id) {
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Check the review request fields.",
            fields: parsed.success
              ? { conversationThreadId: ["Thread ID must match the route."] }
              : parsed.error.flatten().fieldErrors,
          },
        },
        { status: 422 },
      );
    }
    const { user } = await requireWorkspaceAccess(
      parsed.data.workspaceId,
      "write",
    );
    const data = await getConversationRepository().createReviewRequest(
      parsed.data,
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
            message: "Check the review request fields.",
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

function isConversationValidationError(
  error: unknown,
): error is {
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
