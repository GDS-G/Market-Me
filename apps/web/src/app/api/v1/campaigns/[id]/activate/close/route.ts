import { CampaignActivationError, campaignActivationUuid, normalizeCampaignActivationRequest } from "@market-me/database";
import { requireAuthenticatedUser } from "@/server/auth";
import { getCampaignActivationRepository } from "@/server/database";
import { activationApiError, activationResponse, readActivationJson, requireActivationOrigin } from "@/server/campaign-activation-api";

/** This terminalizes the original request; an already accepted run is never canceled. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireActivationOrigin(request);
    const campaignId = campaignActivationUuid((await context.params).id), input = normalizeCampaignActivationRequest(await readActivationJson(request));
    if (input.campaignId !== campaignId) throw new CampaignActivationError("invalid_input", "Campaign mismatch.");
    const user = await requireAuthenticatedUser(), data = await getCampaignActivationRepository().closeRequest(input, user.id);
    return activationResponse({ data });
  } catch (error) { return activationApiError(error); }
}
