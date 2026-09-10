import { z } from "zod";
import {
  AI_CAPABILITIES,
  AI_CAP_BEHAVIORS,
  AI_FAILOVER_MODES,
  AI_MODES,
  AI_PRIVACY_CLASSES,
  AI_ASSISTANT_ACTIONS,
  AI_ASSISTANT_PROFILE_IDS,
  AI_HOSTED_PROVIDER_TYPES,
  AI_OPERATIONAL_INCIDENT_TYPES,
  AI_DRAFT_REVISION_GOALS,
  type AiCapBehavior,
  type AiFailoverMode,
  type AiMode,
  type AiPrivacyClass,
} from "@market-me/domain";
import { isAiAssistantCompatible } from "@market-me/generation";
import { AI_TEXT_CODEC_LIMITS } from "@market-me/connectors";
import type { WorkspaceAiPolicyWrite } from "@market-me/database";

const optionalBudget = z.number().int().min(1).max(1_000_000_000).optional();

export const workspaceAiPolicySchema = z
  .object({
    workspaceId: z.string().uuid(),
    mode: z.enum(AI_MODES),
    maximumPrivacyClass: z.enum(AI_PRIVACY_CLASSES),
    failoverMode: z.enum(AI_FAILOVER_MODES),
    capBehavior: z.enum(AI_CAP_BEHAVIORS),
    currency: z.string().regex(/^[A-Z]{3}$/),
    dailyBudgetMinor: optionalBudget,
    campaignBudgetMinor: optionalBudget,
    monthlyBudgetMinor: optionalBudget,
    alertThresholdPercentages: z
      .array(z.number().int().min(1).max(100))
      .min(1)
      .max(5),
  })
  .strict()
  .superRefine((value, context) => {
    const thresholds = value.alertThresholdPercentages;
    if (
      new Set(thresholds).size !== thresholds.length ||
      thresholds.some((threshold, index) => index > 0 && threshold <= thresholds[index - 1]!)
    )
      context.addIssue({
        code: "custom",
        path: ["alertThresholdPercentages"],
        message: "Alert thresholds must be unique and ascending.",
      });
  });

export const aiRoutingPreviewSchema = z
  .object({
    workspaceId: z.string().uuid(),
    capability: z.enum(AI_CAPABILITIES),
    estimatedInputUnits: z.number().int().min(0).max(10_000_000).optional(),
    requiresTools: z.boolean().optional(),
  })
  .strict();

export const aiBudgetAlertAcknowledgeSchema = z
  .object({
    workspaceId: z.string().uuid(),
    alertId: z.string().uuid(),
  })
  .strict();

export const aiSpendExceptionRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    deniedReservationId: z.string().uuid(),
    justification: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const aiSpendExceptionDecisionSchema = z
  .object({
    workspaceId: z.string().uuid(),
    requestId: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]),
    note: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();

export const aiCapResponsePreviewSchema = z
  .object({
    workspaceId: z.string().uuid(),
    deniedReservationId: z.string().uuid(),
  })
  .strict();

export const aiAssistantAssignmentsSchema = z
  .object({
    workspaceId: z.string().uuid(),
    assignments: z
      .array(
        z
          .object({
            action: z.enum(AI_ASSISTANT_ACTIONS),
            profileId: z.enum(AI_ASSISTANT_PROFILE_IDS),
          })
          .strict(),
      )
      .max(AI_ASSISTANT_ACTIONS.length),
  })
  .strict()
  .superRefine((value, context) => {
    const actions = value.assignments.map((assignment) => assignment.action);
    if (new Set(actions).size !== actions.length)
      context.addIssue({
        code: "custom",
        path: ["assignments"],
        message: "Each action may have at most one assistant assignment.",
      });
    for (const [index, assignment] of value.assignments.entries()) {
      if (!isAiAssistantCompatible(assignment.action, assignment.profileId))
        context.addIssue({
          code: "custom",
          path: ["assignments", index, "profileId"],
          message: "Choose an assistant that supports this action and capability.",
        });
    }
  });

export const aiRoutingPreferencesSchema = z
  .object({
    workspaceId: z.string().uuid(),
    preferences: z
      .array(
        z
          .object({
            action: z.enum(AI_ASSISTANT_ACTIONS),
            provider: z.string().trim().min(1).max(100),
            model: z.string().trim().min(1).max(100),
          })
          .strict(),
      )
      .max(AI_ASSISTANT_ACTIONS.length),
  })
  .strict()
  .superRefine((value, context) => {
    const actions = value.preferences.map((preference) => preference.action);
    if (new Set(actions).size !== actions.length)
      context.addIssue({
        code: "custom",
        path: ["preferences"],
        message: "Each action may have at most one processing-route preference.",
      });
  });

export const aiProviderAdapterListSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const aiProviderConnectionListSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const aiProviderConnectionSaveSchema = z
  .object({
    workspaceId: z.string().uuid(),
    provider: z.enum(AI_HOSTED_PROVIDER_TYPES),
    apiKey: z.string().trim().min(20).max(4096),
  })
  .strict();

export const aiProviderConnectionRevokeSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const aiProviderConnectionVerifySchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const aiProviderModelInventorySchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const aiAdapterCandidateListSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const aiAdapterCandidateSubmitSchema = z
  .object({
    workspaceId: z.string().uuid(),
    provider: z.enum(AI_HOSTED_PROVIDER_TYPES),
    modelId: z.string().trim().min(1).max(512),
    displayName: z.string().trim().min(1).max(160),
    capabilities: z.array(z.enum(AI_CAPABILITIES)).min(1).max(AI_CAPABILITIES.length)
      .refine((values) => new Set(values).size === values.length, "Capabilities must be unique."),
    quality: z.enum(["standard", "enhanced", "highest"]),
    speed: z.enum(["fast", "balanced", "thorough"]),
    cost: z.enum(["low", "medium", "high"]),
    contextLimit: z.number().int().min(1).max(2_000_000),
    evidenceReference: z.string().trim().min(1).max(1000),
    evidenceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export const aiAdapterCandidateDecisionSchema = z
  .object({
    workspaceId: z.string().uuid(),
    candidateId: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]),
    reviewNote: z.string().trim().min(1).max(1000),
  })
  .strict();

export const aiAdapterRegistrationListSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const aiAdapterRegistrationCreateSchema = z
  .object({
    workspaceId: z.string().uuid(),
    candidateId: z.string().uuid(),
  })
  .strict();

export const aiAdapterRegistrationRetireSchema = z
  .object({
    workspaceId: z.string().uuid(),
    registrationId: z.string().uuid(),
    retirementReason: z.string().trim().min(1).max(500),
  })
  .strict();

export const aiAdapterRateBindingListSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const aiAdapterRateBindingCreateSchema = z
  .object({
    workspaceId: z.string().uuid(),
    registrationId: z.string().uuid(),
    rateCardId: z.string().uuid(),
  })
  .strict();

export const aiAdapterRateBindingRetireSchema = z
  .object({
    workspaceId: z.string().uuid(),
    bindingId: z.string().uuid(),
    retirementReason: z.string().trim().min(1).max(500),
  })
  .strict();

export const aiAdapterInvocationBindingListSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const aiAdapterInvocationBindingCreateSchema = z
  .object({
    workspaceId: z.string().uuid(),
    registrationId: z.string().uuid(),
    rateBindingId: z.string().uuid(),
    contractId: z.string().uuid(),
  })
  .strict();

export const aiAdapterInvocationBindingRetireSchema = z
  .object({
    workspaceId: z.string().uuid(),
    bindingId: z.string().uuid(),
    retirementReason: z.string().trim().min(1).max(500),
  })
  .strict();

export const aiAdapterHealthProbeSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

const aiUsageForecastSchema = z
  .object({
    kind: z.enum(["input", "cached_input", "output"]),
    unit: z.enum(["token", "character", "second", "image"]),
    minimumUnits: z.number().int().min(0).max(1_000_000_000),
    maximumUnits: z.number().int().min(0).max(1_000_000_000),
  })
  .strict()
  .refine((value) => value.maximumUnits >= value.minimumUnits, {
    message: "Maximum units must be at least minimum units.",
    path: ["maximumUnits"],
  });

export const aiCostQuoteCreateSchema = z
  .object({
    workspaceId: z.string().uuid(),
    campaignId: z.string().uuid().optional(),
    rateCardId: z.string().uuid(),
    capability: z.enum(AI_CAPABILITIES),
    feature: z.string().trim().min(1).max(100),
    forecasts: z.array(aiUsageForecastSchema).max(12),
  })
  .strict();

export const aiCostQuoteListSchema = z
  .object({
    workspaceId: z.string().uuid(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const aiAssistantCostQuoteCreateSchema = z
  .object({
    workspaceId: z.string().uuid(),
    campaignId: z.string().uuid().optional(),
    action: z.enum(AI_ASSISTANT_ACTIONS),
    rateCardId: z.string().uuid(),
  })
  .strict();

export const aiCostQuoteReserveSchema = z
  .object({
    workspaceId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export const aiTextInvocationIntentListSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const aiTextInvocationAttemptListSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const aiTextInvocationResolutionListSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const aiOperationalIncidentListSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const aiOperationalIncidentAcknowledgeSchema = z
  .object({
    workspaceId: z.string().uuid(),
    type: z.enum(AI_OPERATIONAL_INCIDENT_TYPES),
    attemptId: z.string().uuid(),
    acknowledgementNote: z.string().trim().min(3).max(1_000),
  })
  .strict();

export const aiOperationalIncidentResponsePolicySchema = z
  .object({
    workspaceId: z.string().uuid(),
    criticalAcknowledgementMinutes: z.number().int().min(1).max(60),
    highAcknowledgementMinutes: z.number().int().min(1).max(1_440),
    criticalResolutionMinutes: z.number().int().min(5).max(10_080),
    highResolutionMinutes: z.number().int().min(5).max(43_200),
    runbookUrl: z.string().trim().url().max(2_000).refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    }, "Use a credential-free HTTPS runbook URL."),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.criticalResolutionMinutes < value.criticalAcknowledgementMinutes)
      context.addIssue({
        code: "custom",
        path: ["criticalResolutionMinutes"],
        message: "Critical resolution target cannot precede acknowledgement.",
      });
    if (value.highResolutionMinutes < value.highAcknowledgementMinutes)
      context.addIssue({
        code: "custom",
        path: ["highResolutionMinutes"],
        message: "High-severity resolution target cannot precede acknowledgement.",
      });
  });

export const aiOperationalAlertWebhookSaveSchema = z
  .object({
    workspaceId: z.string().uuid(),
    endpointUrl: z.string().trim().url().max(2_000),
    signingSecret: z.string().min(32).max(256),
  })
  .strict();

export const aiOperationalAlertWebhookActionSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const aiOperationalAlertDeliveryListSchema = z
  .object({
    workspaceId: z.string().uuid(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const aiTextInvocationResolveSchema = z
  .object({
    workspaceId: z.string().uuid(),
    attemptId: z.string().uuid(),
    disposition: z.enum(["confirmed_no_charge", "settled_provider_charge"]),
    providerChargeMinor: z.number().int().min(1).max(1_000_000_000).optional(),
    evidenceReference: z.string().trim().min(3).max(1_000),
    resolutionNote: z.string().trim().min(3).max(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.disposition === "settled_provider_charge" && value.providerChargeMinor === undefined)
      context.addIssue({
        code: "custom",
        path: ["providerChargeMinor"],
        message: "Enter the provider charge shown by the reviewed billing evidence.",
      });
    if (value.disposition === "confirmed_no_charge" && value.providerChargeMinor !== undefined)
      context.addIssue({
        code: "custom",
        path: ["providerChargeMinor"],
        message: "A no-charge resolution cannot include a provider charge.",
      });
  });

export const aiExecutionControlListSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const aiExecutionControlSaveSchema = z
  .object({
    workspaceId: z.string().uuid(),
    state: z.enum(["stopped", "enabled"]),
    reason: z.string().trim().min(3).max(500),
    enabledForMinutes: z.number().int().min(1).max(1_440).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === "enabled" && value.enabledForMinutes === undefined)
      context.addIssue({
        code: "custom",
        path: ["enabledForMinutes"],
        message: "Choose how long provider execution should remain enabled.",
      });
    if (value.state === "stopped" && value.enabledForMinutes !== undefined)
      context.addIssue({
        code: "custom",
        path: ["enabledForMinutes"],
        message: "Stopped execution cannot carry an enablement duration.",
      });
  });

export const aiProviderCircuitResetSchema = z
  .object({
    workspaceId: z.string().uuid(),
    provider: z.enum(AI_HOSTED_PROVIDER_TYPES),
    resetNote: z.string().trim().min(3).max(500),
  })
  .strict();

export const aiTextOutputListSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const aiTextOutputReviewSchema = z
  .object({
    workspaceId: z.string().uuid(),
    decision: z.enum(["accepted", "discarded"]),
    reviewNote: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const aiTextDraftProposalListSchema = z
  .object({
    workspaceId: z.string().uuid(),
    contentDraftId: z.string().uuid(),
  })
  .strict();

export const aiTextDraftProposalAttachSchema = z
  .object({
    workspaceId: z.string().uuid(),
    contentDraftId: z.string().uuid(),
  })
  .strict();

export const aiTextDraftProposalDismissSchema = z
  .object({
    workspaceId: z.string().uuid(),
    dismissalNote: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const aiTextDraftProposalApplySchema = z
  .object({
    workspaceId: z.string().uuid(),
    leadIn: z.string().trim().max(500).refine(
      (value) => !/[.!?]/u.test(value),
      "The lead-in cannot contain sentence punctuation.",
    ),
    callToAction: z.string().trim().min(1).max(1_000).optional(),
    hashtags: z
      .array(z.string().regex(/^#[\p{L}\p{N}_]{1,50}$/u))
      .max(20)
      .refine(
        (values) => new Set(values.map((value) => value.toLocaleLowerCase())).size === values.length,
        "Hashtags must be unique.",
      ),
    altText: z.string().trim().min(1).max(2_000).optional(),
    changeNote: z.string().trim().min(3).max(1_000),
  })
  .strict();

export const aiTextInvocationIntentPrepareSchema = z
  .object({
    workspaceId: z.string().uuid(),
    invocationBindingId: z.string().uuid(),
    reservationId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
    userText: z.string().min(1).max(AI_TEXT_CODEC_LIMITS.userTextCharacters),
    systemText: z.string().min(1).max(AI_TEXT_CODEC_LIMITS.systemTextCharacters).optional(),
    maxOutputTokens: z.number().int().min(1).max(AI_TEXT_CODEC_LIMITS.maxOutputTokens),
  })
  .strict();

export const aiTextInvocationIntentCancelSchema = z
  .object({
    workspaceId: z.string().uuid(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const aiTextInvocationIntentExecuteSchema = z
  .object({
    workspaceId: z.string().uuid(),
    intentId: z.string().uuid(),
    userText: z.string().min(1).max(AI_TEXT_CODEC_LIMITS.userTextCharacters),
    systemText: z.string().min(1).max(AI_TEXT_CODEC_LIMITS.systemTextCharacters).optional(),
  })
  .strict();

export const aiDraftRevisionIntentPrepareSchema = z
  .object({
    workspaceId: z.string().uuid(),
    contentDraftId: z.string().uuid(),
    invocationBindingId: z.string().uuid(),
    reservationId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
    goal: z.enum(AI_DRAFT_REVISION_GOALS),
    maxOutputTokens: z.number().int().min(1).max(AI_TEXT_CODEC_LIMITS.maxOutputTokens),
    executeAfterPrepare: z.boolean(),
  })
  .strict();

export const aiDraftRevisionIntentExecuteSchema = z
  .object({
    workspaceId: z.string().uuid(),
    intentId: z.string().uuid(),
  })
  .strict();

export function defaultWorkspaceAiPolicy(
  workspaceId: string,
): WorkspaceAiPolicyWrite {
  return {
    workspaceId,
    mode: "recommended" satisfies AiMode,
    maximumPrivacyClass: "cloud" satisfies AiPrivacyClass,
    failoverMode: "ask_before_switching" satisfies AiFailoverMode,
    capBehavior: "require_approval" satisfies AiCapBehavior,
    currency: "USD",
    alertThresholdPercentages: [50, 80, 100],
  };
}
