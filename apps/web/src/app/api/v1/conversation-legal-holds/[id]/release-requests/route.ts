import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { conversationLegalHoldReleaseRequestSchema } from "@/server/conversation-schema";
import { getConversationRepository } from "@/server/database";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = conversationLegalHoldReleaseRequestSchema.safeParse(await request.json());
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const data = await getConversationRepository().requestLegalHoldRelease(
      { ...parsed.data, legalHoldCaseId: (await context.params).id }, user.id,
    );
    return data ? Response.json({ data }, { status: 201 }) : Response.json(
      { error: { code: "not_found", message: "Active legal hold not found." } }, { status: 404 },
    );
  } catch (error) {
    if (isConversationValidationError(error)) return validation(
      Object.fromEntries(error.issues.map((issue) => [issue.field, [issue.message]])),
    );
    return apiError(error);
  }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json({ error: { code: "validation_failed", message: "The hold release request could not be created.", fields } }, { status: 422 });
}
function isConversationValidationError(error: unknown): error is { issues: { field: string; message: string }[] } {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "ConversationValidationError" && "issues" in error && Array.isArray(error.issues));
}
