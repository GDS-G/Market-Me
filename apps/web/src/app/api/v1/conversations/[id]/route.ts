import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { conversationThreadWriteSchema } from "@/server/conversation-schema";
import { getConversationRepository } from "@/server/database";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { workspace, user } = await requireWorkspaceAccess(
      new URL(request.url).searchParams.get("workspaceId") ?? undefined,
    );
    const data = await getConversationRepository().getThread(
      workspace.workspaceId,
      (await context.params).id,
      user.id,
    );
    return data
      ? Response.json({ data })
      : Response.json(
          { error: { code: "not_found", message: "Conversation not found." } },
          { status: 404 },
        );
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = conversationThreadWriteSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success)
      return validationResponse(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(
      parsed.data.workspaceId,
      "write",
    );
    const id = (await context.params).id;
    if (
      !(await getConversationRepository().getThread(
        parsed.data.workspaceId,
        id,
      ))
    ) {
      return Response.json(
        { error: { code: "not_found", message: "Conversation not found." } },
        { status: 404 },
      );
    }
    return Response.json({
      data: await getConversationRepository().saveThread(
        parsed.data,
        user.id,
        id,
      ),
    });
  } catch (error) {
    if (isConversationValidationError(error)) {
      return validationResponse(
        Object.fromEntries(
          error.issues.map((issue) => [issue.field, [issue.message]]),
        ),
      );
    }
    return apiError(error);
  }
}

function validationResponse(fields: Record<string, string[] | undefined>) {
  return Response.json(
    {
      error: {
        code: "validation_failed",
        message: "Check the conversation fields.",
        fields,
      },
    },
    { status: 422 },
  );
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
