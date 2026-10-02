import { CampaignActivationError, campaignActivationUuid, normalizeCampaignActivationRequest } from "@market-me/database";
import { requireAuthenticatedUser } from "@/server/auth";
import { getCampaignActivationRepository } from "@/server/database";
import { activationApiError, activationResponse, readActivationJson, requireActivationOrigin } from "@/server/campaign-activation-api";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    requireActivationOrigin(request);
    const campaignId = campaignActivationUuid((await context.params).id), input = normalizeCampaignActivationRequest(await readActivationJson(request));
    if (input.campaignId !== campaignId) throw new CampaignActivationError("invalid_input", "Campaign mismatch.");
    const user = await requireAuthenticatedUser(), result = await getCampaignActivationRepository().activate(input, user.id);
    return activationResponse({ data: result.receipt, meta: { replayed: result.replayed } }, result.replayed ? 200 : 202);
  } catch (error) { return activationApiError(error); }
}
export async function GET(request: Request, context: Context) {
  try {
    const campaignId = campaignActivationUuid((await context.params).id), query = new URL(request.url).searchParams;
    if (query.getAll("workspaceId").length !== 1 || query.getAll("requestId").length > 1
      || [...query.keys()].some(k => k !== "workspaceId" && k !== "requestId")) throw new CampaignActivationError("invalid_input", "Unexpected query.");
    const workspaceId = campaignActivationUuid(query.get("workspaceId")), requestId = query.has("requestId") ? campaignActivationUuid(query.get("requestId")) : undefined;
    const user = await requireAuthenticatedUser(), repository = getCampaignActivationRepository();
    const data = requestId ? await repository.getOutcome(workspaceId, campaignId, requestId, user.id) : await repository.preview(workspaceId, campaignId, user.id);
    if (!data) throw new CampaignActivationError("not_found", "No result observed.");
    return activationResponse({ data });
  } catch (error) { return activationApiError(error); }
}
