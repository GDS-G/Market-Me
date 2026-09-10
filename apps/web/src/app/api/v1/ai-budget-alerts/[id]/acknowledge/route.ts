import { apiError } from "@/server/api-response";
import { aiBudgetAlertAcknowledgeSchema } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getAiRepository } from "@/server/database";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const params = await context.params;
    const parsed = aiBudgetAlertAcknowledgeSchema.safeParse({
      ...(await request.json()),
      alertId: params.id,
    });
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    return Response.json({
      data: await getAiRepository().acknowledgeBudgetAlert(
        parsed.data.workspaceId,
        parsed.data.alertId,
        user.id,
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
        message: "The AI budget alert could not be acknowledged.",
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
    error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AiPolicyValidationError" &&
      "issues" in error &&
      Array.isArray(error.issues),
  );
}
