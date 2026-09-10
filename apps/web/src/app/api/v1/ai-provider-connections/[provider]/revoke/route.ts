import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { aiProviderConnectionRevokeSchema } from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";
import { AI_HOSTED_PROVIDER_TYPES } from "@market-me/domain";

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  try {
    const parsed = aiProviderConnectionRevokeSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "A workspace is required." } }, { status: 422 });
    const { provider } = await context.params;
    if (!AI_HOSTED_PROVIDER_TYPES.includes(provider as (typeof AI_HOSTED_PROVIDER_TYPES)[number])) return Response.json({ error: { code: "validation_failed", message: "Choose a supported hosted provider." } }, { status: 422 });
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    return Response.json({ data: await getAiRepository().revokeProviderConnection(parsed.data.workspaceId, provider as (typeof AI_HOSTED_PROVIDER_TYPES)[number], user.id), meta: { credentialErased: true, execution: false } });
  } catch (error) { return apiError(error); }
}
