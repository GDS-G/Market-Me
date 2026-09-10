import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { conversationServiceLevelPolicySchema } from "@/server/conversation-schema";
import { getConversationRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceAccess(
      new URL(request.url).searchParams.get("workspaceId") ?? undefined,
    );
    return Response.json({
      data: await getConversationRepository().getServiceLevelPolicy(
        workspace.workspaceId,
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const parsed = conversationServiceLevelPolicySchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    return Response.json({
      data: await getConversationRepository().saveServiceLevelPolicy(
        parsed.data,
        user.id,
      ),
    });
  } catch (error) {
    if (isConversationValidationError(error)) {
      return validation(
        Object.fromEntries(
          error.issues.map((issue) => [issue.field, [issue.message]]),
        ),
      );
    }
    return apiError(error);
  }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json(
    {
      error: {
        code: "validation_failed",
        message: "Check the service-level policy fields.",
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
