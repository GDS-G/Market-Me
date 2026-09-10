import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { defaultWorkspaceAiPolicy, workspaceAiPolicySchema } from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";
import { AI_ASSISTANT_ACTIONS } from "@market-me/domain";
import { AI_ASSISTANT_PROFILES, AI_MODE_INDICATORS, planAiAssistantCost, planAiAssistantWork, planAiCapResponse, quoteAiCost, selectAiAssistant } from "@market-me/generation";

export async function GET(request: Request) {
  try {
    const { user, workspace } = await requireWorkspaceAccess(
      new URL(request.url).searchParams.get("workspaceId") ?? undefined,
    );
    const repository = getAiRepository();
    const policy =
      (await repository.getPolicy(workspace.workspaceId)) ??
      defaultWorkspaceAiPolicy(workspace.workspaceId);
    const pricingAsOf = new Date();
    const [usage, budgetStatus, budgetAlerts, spendExceptions, assistantAssignments, routingPreferences, providerConnections, providerAdapters, adapterRegistry, analysisCache, rateCards, effectiveRateCards] = await Promise.all([
      repository.getCurrentMonthUsage(workspace.workspaceId, policy.currency),
      repository.getBudgetStatus(workspace.workspaceId, policy.currency),
      repository.listBudgetAlerts(workspace.workspaceId, policy.currency),
      repository.listSpendExceptions(workspace.workspaceId, policy.currency),
      repository.listAssistantAssignments(workspace.workspaceId),
      repository.listRoutingPreferences(workspace.workspaceId),
      repository.listProviderConnections(workspace.workspaceId, user.id),
      repository.listProviderAdapters(),
      repository.getProviderAdapterRegistrySummary(),
      repository.getAnalysisCacheSummary(workspace.workspaceId),
      repository.getProviderRateCardSummary(pricingAsOf),
      repository.listEffectiveProviderRateCards(pricingAsOf, policy.currency),
    ]);
    const referenceRateCard = effectiveRateCards.find(
      (card) =>
        card.provider === "market-me" &&
        card.modelFamily === "grounded-template" &&
        card.components.every((component) => component.kind === "request"),
    );
    const referenceQuote = referenceRateCard
      ? quoteAiCost(referenceRateCard, [], pricingAsOf)
      : undefined;
    const assistantByAction = new Map(
      assistantAssignments.map((assignment) => [
        assignment.action,
        assignment.profileId,
      ]),
    );
    const routeByAction = new Map(
      routingPreferences.map((preference) => [
        preference.action,
        { provider: preference.provider, model: preference.model },
      ]),
    );
    const assistantCostPreviews = AI_ASSISTANT_ACTIONS.map((action) =>
      planAiAssistantCost(
        {
          action,
          ...(assistantByAction.get(action)
            ? { profileId: assistantByAction.get(action)! }
            : {}),
          mode: policy.mode,
          maximumPrivacyClass: policy.maximumPrivacyClass,
          ...(routeByAction.get(action)
            ? { routingPreference: routeByAction.get(action)! }
            : {}),
          rateCards: effectiveRateCards,
          quotedAt: pricingAsOf,
        },
        providerAdapters,
      ),
    );
    return Response.json({
      data: {
        policy,
        usage,
        budgetStatus,
        budgetAlerts,
        spendExceptions,
        capResponses: budgetStatus.recentReservations
          .filter((reservation) => reservation.status === "denied")
          .map((reservation) =>
            planAiCapResponse(
              {
                reservation,
                maximumPrivacyClass: policy.maximumPrivacyClass,
              },
              providerAdapters.filter(
                (adapter) => !adapter.requiresPaidReservation,
              ),
            ),
          ),
        assistants: {
          selectionMode:
            assistantAssignments.length === 0 ? "automatic" : "workspace",
          profiles: AI_ASSISTANT_PROFILES,
          assignments: assistantAssignments,
          routingPreferences,
          selections: AI_ASSISTANT_ACTIONS.map((action) =>
            selectAiAssistant(action, assistantByAction.get(action)),
          ),
          workPlans: AI_ASSISTANT_ACTIONS.map((action) =>
            planAiAssistantWork(
              {
                action,
                profileId: assistantByAction.get(action),
                mode: policy.mode,
                maximumPrivacyClass: policy.maximumPrivacyClass,
                ...(routeByAction.get(action)
                  ? { routingPreference: routeByAction.get(action)! }
                  : {}),
              },
              providerAdapters,
            ),
          ),
          costPreviews: assistantCostPreviews,
        },
        analysisCache,
        adapterRegistry,
        providerConnections,
        rateCards: {
          ...rateCards,
          quoteTargets: effectiveRateCards.map((card) => ({
            id: card.id,
            provider: card.provider,
            modelFamily: card.modelFamily,
            modelVersion: card.modelVersion,
            currency: card.currency,
            requiredForecasts: card.components
              .filter((component) => component.kind !== "request")
              .map((component) => ({ kind: component.kind, unit: component.unit })),
          })),
          ...(referenceQuote
            ? {
                referenceQuote: {
                  currency: referenceQuote.currency,
                  minorUnitExponent: referenceQuote.minorUnitExponent,
                  minimumCostMinor: referenceQuote.minimumCostMinor,
                  maximumCostMinor: referenceQuote.maximumCostMinor,
                  quotedAt: referenceQuote.quotedAt,
                  expiresAt: referenceQuote.expiresAt,
                  reservationRequired: referenceQuote.reservationRequired,
                  reservationAuthorized: false,
                  execution: false,
                },
              }
            : {}),
        },
        modeIndicators: AI_MODE_INDICATORS,
        adapters: providerAdapters,
      },
      meta: {
        persistence: "postgresql",
        advancedUsage: true,
        assistantExecution: false,
        durableCostQuotes: true,
        quotedReservationBinding: true,
        assistantMeteringProfiles: true,
        assistantDurableQuoteCreation: true,
        governedRoutingPreferences: true,
        durableAdapterRegistry: true,
        encryptedProviderConnections: true,
        providerCredentialVerification: true,
        providerGeneration: false,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const parsed = workspaceAiPolicySchema.safeParse(await request.json());
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    return Response.json({
      data: await getAiRepository().savePolicy(parsed.data, user.id),
    });
  } catch (error) {
    if (isAiPolicyValidationError(error))
      return validation(
        Object.fromEntries(error.issues.map((issue) => [issue.field, [issue.message]])),
      );
    return apiError(error);
  }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json(
    {
      error: {
        code: "validation_failed",
        message: "Check the AI mode, privacy, failover, and budget controls.",
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
    error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AiPolicyValidationError" &&
      "issues" in error &&
      Array.isArray(error.issues),
  );
}
