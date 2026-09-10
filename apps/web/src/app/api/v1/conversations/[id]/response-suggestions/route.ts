import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { conversationResponseSuggestionGenerateSchema } from "@/server/conversation-schema";
import {
  getConversationAssistantRepository,
  getConversationRepository,
} from "@/server/database";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { workspace } = await requireWorkspaceAccess(
      new URL(request.url).searchParams.get("workspaceId") ?? undefined,
    );
    const id = (await context.params).id;
    if (!(await getConversationRepository().getThread(workspace.workspaceId, id)))
      return Response.json(
        { error: { code: "not_found", message: "Conversation not found." } },
        { status: 404 },
      );
    return Response.json({
      data: await getConversationAssistantRepository().listSuggestions(
        workspace.workspaceId,
        id,
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = conversationResponseSuggestionGenerateSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success)
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Check the Conversation Assistant request.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 422 },
      );
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    return Response.json(
      {
        data: await getConversationAssistantRepository().generateSuggestion(
          parsed.data.workspaceId,
          (await context.params).id,
          user.id,
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    if (isAssistantValidationError(error))
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "The Conversation Assistant could not create a safe suggestion.",
            fields: Object.fromEntries(
              error.issues.map((issue) => [issue.field, [issue.message]]),
            ),
          },
        },
        { status: 422 },
      );
    return apiError(error);
  }
}

function isAssistantValidationError(error: unknown): error is {
  name: "ConversationAssistantValidationError";
  issues: readonly { field: string; message: string }[];
} {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "ConversationAssistantValidationError" &&
      "issues" in error &&
      Array.isArray(error.issues),
  );
}
