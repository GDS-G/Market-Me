import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getConversationRepository } from "@/server/database";
import { conversationRoutingRuleWriteSchema } from "@/server/conversation-schema";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceAccess(
      new URL(request.url).searchParams.get("workspaceId") ?? undefined,
    );
    const data = await getConversationRepository().listRoutingRules(
      workspace.workspaceId,
    );
    return Response.json({ data, meta: { count: data.length } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = conversationRoutingRuleWriteSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(
      parsed.data.workspaceId,
      "write",
    );
    return Response.json(
      {
        data: await getConversationRepository().saveRoutingRule(
          parsed.data,
          user.id,
        ),
      },
      { status: 201 },
    );
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
        message: "Check the routing-rule fields.",
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
