import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { conversationResponseDraftWriteSchema } from "@/server/conversation-schema";
import {
  getConversationComposerRepository,
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
      data: await getConversationComposerRepository().getState(
        workspace.workspaceId,
        id,
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = conversationResponseDraftWriteSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) return validationResponse(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    return Response.json({
      data: await getConversationComposerRepository().saveDraft(
        {
          ...parsed.data,
          conversationThreadId: (await context.params).id,
        },
        user.id,
      ),
    });
  } catch (error) {
    if (isComposerValidationError(error))
      return validationResponse(
        Object.fromEntries(error.issues.map((issue) => [issue.field, [issue.message]])),
      );
    return apiError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = conversationResponseDraftWriteSchema.pick({ workspaceId: true }).safeParse(
      await request.json(),
    );
    if (!parsed.success) return validationResponse(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const deleted = await getConversationComposerRepository().discardDraft(
      parsed.data.workspaceId,
      (await context.params).id,
      user.id,
    );
    return deleted
      ? Response.json({ data: { discarded: true } })
      : Response.json(
          { error: { code: "not_found", message: "Response draft not found." } },
          { status: 404 },
        );
  } catch (error) {
    return apiError(error);
  }
}

function validationResponse(fields: Record<string, string[] | undefined>) {
  return Response.json(
    {
      error: {
        code: "validation_failed",
        message: "Check the response draft.",
        fields,
      },
    },
    { status: 422 },
  );
}

function isComposerValidationError(error: unknown): error is {
  name: "ConversationComposerValidationError";
  issues: readonly { field: string; message: string }[];
} {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "ConversationComposerValidationError" &&
      "issues" in error &&
      Array.isArray(error.issues),
  );
}
