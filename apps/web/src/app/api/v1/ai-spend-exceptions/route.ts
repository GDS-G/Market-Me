import { apiError } from "@/server/api-response";
import { aiSpendExceptionRequestSchema } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getAiRepository } from "@/server/database";

export async function POST(request: Request) {
  try {
    const parsed = aiSpendExceptionRequestSchema.safeParse(await request.json());
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    return Response.json(
      {
        data: await getAiRepository().requestSpendException(
          parsed.data,
          user.id,
        ),
      },
      { status: 201 },
    );
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
        message: "The spend exception request is not eligible.",
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
