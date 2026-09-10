import { apiError } from "@/server/api-response";
import { aiSpendExceptionDecisionSchema } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getAiRepository } from "@/server/database";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const params = await context.params;
    const parsed = aiSpendExceptionDecisionSchema.safeParse({
      ...(await request.json()),
      requestId: params.id,
    });
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "approve");
    return Response.json({
      data: await getAiRepository().decideSpendException(
        parsed.data.workspaceId,
        parsed.data.requestId,
        parsed.data.decision,
        user.id,
        parsed.data.note,
      ),
    });
  } catch (error) {
    if (isAiPolicyValidationError(error))
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
    {
      error: {
        code: "validation_failed",
        message: "The spend exception decision could not be recorded.",
        fields,
      },
    },
    { status: 422 },
  );
}

function isAiPolicyValidationError(error: unknown): error is {
  name: "AiPolicyValidationError";
  issues: { field: string; message: string }[];
} {
  return Boolean(
    error && typeof error === "object" && "name" in error &&
      error.name === "AiPolicyValidationError" && "issues" in error &&
      Array.isArray(error.issues),
  );
}
