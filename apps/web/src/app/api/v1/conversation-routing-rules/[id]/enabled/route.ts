import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getConversationRepository } from "@/server/database";
import { conversationRoutingRuleEnabledSchema } from "@/server/conversation-schema";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = conversationRoutingRuleEnabledSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Check the routing-rule state.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 422 },
      );
    }
    const { user } = await requireWorkspaceAccess(
      parsed.data.workspaceId,
      "write",
    );
    const data = await getConversationRepository().setRoutingRuleEnabled(
      parsed.data.workspaceId,
      (await context.params).id,
      parsed.data.enabled,
      user.id,
    );
    return data
      ? Response.json({ data })
      : Response.json(
          { error: { code: "not_found", message: "Routing rule not found." } },
          { status: 404 },
        );
  } catch (error) {
    return apiError(error);
  }
}
