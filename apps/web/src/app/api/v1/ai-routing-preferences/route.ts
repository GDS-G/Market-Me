import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { aiRoutingPreferencesSchema } from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";
import { AiPolicyValidationError } from "@market-me/database";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceAccess(
      new URL(request.url).searchParams.get("workspaceId") ?? undefined,
    );
    return Response.json({
      data: await getAiRepository().listRoutingPreferences(workspace.workspaceId),
      meta: { automaticByOmission: true, execution: false },
    });
  } catch (error) {
    return apiError(error);
  }
}

function isAiPolicyValidationError(
  error: unknown,
): error is AiPolicyValidationError {
  if (error instanceof AiPolicyValidationError) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; issues?: unknown };
  return (
    candidate.name === "AiPolicyValidationError" &&
    Array.isArray(candidate.issues)
  );
}

export async function PUT(request: Request) {
  try {
    const parsed = aiRoutingPreferencesSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Choose one approved compatible processing route per action.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 422 },
      );
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    return Response.json({
      data: await getAiRepository().replaceRoutingPreferences(parsed.data, user.id),
      meta: { automaticByOmission: true, execution: false },
    });
  } catch (error) {
    if (isAiPolicyValidationError(error))
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Choose one approved compatible processing route per action.",
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
