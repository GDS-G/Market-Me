import { apiError } from "@/server/api-response";
import {
  aiAssistantCostQuoteCreateSchema,
  defaultWorkspaceAiPolicy,
} from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getAiRepository } from "@/server/database";
import { planAiAssistantCost } from "@market-me/generation";
import type { AiStoredCostQuote } from "@market-me/domain";

export async function POST(request: Request) {
  try {
    const parsed = aiAssistantCostQuoteCreateSchema.safeParse(await request.json());
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const repository = getAiRepository();
    const policy =
      (await repository.getPolicy(parsed.data.workspaceId)) ??
      defaultWorkspaceAiPolicy(parsed.data.workspaceId);
    const quotedAt = new Date();
    const [assignments, routingPreferences, providerAdapters, rateCards] = await Promise.all([
      repository.listAssistantAssignments(parsed.data.workspaceId),
      repository.listRoutingPreferences(parsed.data.workspaceId),
      repository.listProviderAdapters(),
      repository.listEffectiveProviderRateCards(quotedAt, policy.currency),
    ]);
    const assignment = assignments.find(
      (candidate) => candidate.action === parsed.data.action,
    );
    const routingPreference = routingPreferences.find(
      (candidate) => candidate.action === parsed.data.action,
    );
    const preview = planAiAssistantCost(
      {
        action: parsed.data.action,
        ...(assignment ? { profileId: assignment.profileId } : {}),
        mode: policy.mode,
        maximumPrivacyClass: policy.maximumPrivacyClass,
        ...(routingPreference
          ? {
              routingPreference: {
                provider: routingPreference.provider,
                model: routingPreference.model,
              },
            }
          : {}),
        rateCards,
        rateCardId: parsed.data.rateCardId,
        quotedAt,
      },
      providerAdapters,
    );
    if (preview.status !== "quoted")
      return Response.json(
        {
          error: {
            code: "assistant_cost_quote_unavailable",
            message: "This assistant action does not have a compatible bounded quote target.",
            reasons: preview.reasons,
          },
        },
        { status: 422 },
      );
    const quote = await repository.createCostQuote(
      {
        workspaceId: parsed.data.workspaceId,
        ...(parsed.data.campaignId ? { campaignId: parsed.data.campaignId } : {}),
        rateCardId: preview.rateCardId,
        capability: preview.capability,
        feature: preview.feature,
        forecasts: preview.forecasts,
      },
      user.id,
      quotedAt,
    );
    return Response.json({ data: presentQuote(quote) }, { status: 201 });
  } catch (error) {
    if (isValidationError(error))
      return validation(
        Object.fromEntries(
          error.issues.map((issue) => [issue.field, [issue.message]]),
        ),
      );
    return apiError(error);
  }
}

function presentQuote(quote: AiStoredCostQuote) {
  return {
    id: quote.id,
    campaignId: quote.campaignId,
    capability: quote.capability,
    feature: quote.feature,
    currency: quote.currency,
    minorUnitExponent: quote.minorUnitExponent,
    minimumCostMinor: quote.minimumCostMinor,
    maximumCostMinor: quote.maximumCostMinor,
    quotedAt: quote.quotedAt,
    expiresAt: quote.expiresAt,
    status: quote.status,
    reservationRequired: quote.reservationRequired,
    reservationAuthorized: false,
    execution: false,
  };
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json(
    {
      error: {
        code: "validation_failed",
        message: "The assistant cost quote request is not valid.",
        fields,
      },
    },
    { status: 422 },
  );
}

function isValidationError(error: unknown): error is {
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
