import { apiError } from "@/server/api-response";
import { aiTextInvocationIntentCancelSchema } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getAiRepository } from "@/server/database";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const parsed = aiTextInvocationIntentCancelSchema.safeParse(await request.json());
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    return Response.json({
      data: await getAiRepository().cancelWorkspaceTextInvocationIntent({
        workspaceId: parsed.data.workspaceId,
        intentId: id,
        reason: parsed.data.reason,
      }, user.id),
    });
  } catch (error) {
    if (isValidationError(error))
      return validation(Object.fromEntries(error.issues.map((issue) => [issue.field, [issue.message]])));
    return apiError(error);
  }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json({ error: { code: "validation_failed", message: "The text invocation intent cannot be cancelled.", fields } }, { status: 422 });
}

function isValidationError(error: unknown): error is { issues: { field: string; message: string }[] } {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AiPolicyValidationError" && "issues" in error && Array.isArray(error.issues));
}
