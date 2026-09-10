import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { conversationReviewRequestCloseSchema } from "@/server/conversation-schema";
import { getConversationRepository } from "@/server/database";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; reviewRequestId: string }> },
) {
  try {
    const parsed = conversationReviewRequestCloseSchema.safeParse(
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
    const data = await getConversationRepository().closeReviewRequest(
      parsed.data.workspaceId,
      params.id,
      params.reviewRequestId,
      parsed.data.status,
      user.id,
    );
    return data
      ? Response.json({ data })
      : Response.json(
          {
            error: {
              code: "not_found",
              message: "Open review request not found.",
            },
          },
          { status: 404 },
        );
  } catch (error) {
    if (isConversationValidationError(error)) {
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: error.issues[0]?.message ?? "Cannot close this request.",
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
