import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { aiOperationalAlertDeliveryListSchema } from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const parsed = aiOperationalAlertDeliveryListSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      return Response.json({ error: { code: "validation_failed", message: "Check the delivery history query." } }, { status: 422 });
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId);
    return Response.json({
      data: await getAiRepository().listWorkspaceAiOperationalAlertDeliveries(
        parsed.data.workspaceId, user.id, parsed.data.limit,
      ),
      meta: {
        endpointReturned: false,
        signingSecretReturned: false,
        payloadReturned: false,
        executionAuthority: false,
      },
    });
  } catch (error) { return apiError(error); }
}
