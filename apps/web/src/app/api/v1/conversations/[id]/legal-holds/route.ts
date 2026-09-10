import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { conversationLegalHoldSchema } from "@/server/conversation-schema";
import { getConversationRepository } from "@/server/database";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = conversationLegalHoldSchema.safeParse(await request.json());
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "approve");
    const data = await getConversationRepository().placeLegalHold(
      { ...parsed.data, conversationThreadId: (await context.params).id }, user.id,
    );
    return data ? Response.json({ data }, { status: 201 }) : Response.json(
      { error: { code: "not_found", message: "Conversation not found." } }, { status: 404 },
    );
  } catch (error) {
    if (isConversationValidationError(error)) return validation(
      Object.fromEntries(error.issues.map((issue) => [issue.field, [issue.message]])),
    );
    return apiError(error);
  }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json({ error: { code: "validation_failed", message: "The legal hold could not be placed.", fields } }, { status: 422 });
}
function isConversationValidationError(error: unknown): error is { issues: { field: string; message: string }[] } {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "ConversationValidationError" && "issues" in error && Array.isArray(error.issues));
}
