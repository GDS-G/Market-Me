import { describe, expect, it } from "vitest";
import {
  aiBudgetAlertAcknowledgeSchema,
  aiSpendExceptionDecisionSchema,
  aiSpendExceptionRequestSchema,
  aiCapResponsePreviewSchema,
  aiRoutingPreviewSchema,
  aiAssistantAssignmentsSchema,
  aiAssistantCostQuoteCreateSchema,
  aiCostQuoteListSchema,
  aiRoutingPreferencesSchema,
  aiProviderAdapterListSchema,
  aiProviderConnectionListSchema,
  aiProviderConnectionSaveSchema,
  aiProviderConnectionRevokeSchema,
  aiProviderConnectionVerifySchema,
  aiProviderModelInventorySchema,
  aiAdapterCandidateListSchema,
  aiAdapterCandidateSubmitSchema,
  aiAdapterCandidateDecisionSchema,
  aiAdapterRegistrationListSchema,
  aiAdapterRegistrationCreateSchema,
  aiAdapterRegistrationRetireSchema,
  aiAdapterRateBindingListSchema,
  aiAdapterRateBindingCreateSchema,
  aiAdapterRateBindingRetireSchema,
  aiAdapterInvocationBindingListSchema,
  aiAdapterInvocationBindingCreateSchema,
  aiAdapterInvocationBindingRetireSchema,
  aiAdapterHealthProbeSchema,
  aiTextInvocationIntentListSchema,
  aiTextInvocationAttemptListSchema,
  aiExecutionControlListSchema,
  aiExecutionControlSaveSchema,
  aiProviderCircuitResetSchema,
  aiTextInvocationResolutionListSchema,
  aiTextInvocationResolveSchema,
  aiOperationalIncidentListSchema,
  aiOperationalIncidentAcknowledgeSchema,
  aiOperationalIncidentResponsePolicySchema,
  aiOperationalAlertWebhookSaveSchema,
  aiOperationalAlertWebhookActionSchema,
  aiOperationalAlertDeliveryListSchema,
  aiTextOutputListSchema,
  aiTextOutputReviewSchema,
  aiTextDraftProposalListSchema,
  aiTextDraftProposalAttachSchema,
  aiTextDraftProposalApplySchema,
  aiTextDraftProposalDismissSchema,
  aiTextInvocationIntentPrepareSchema,
  aiTextInvocationIntentExecuteSchema,
  aiDraftRevisionIntentPrepareSchema,
  aiDraftRevisionIntentExecuteSchema,
  aiTextInvocationIntentCancelSchema,
  workspaceAiPolicySchema,
} from "./ai-schema";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const policy = {
  workspaceId,
  mode: "recommended",
  maximumPrivacyClass: "cloud",
  failoverMode: "ask_before_switching",
  capBehavior: "require_approval",
  currency: "USD",
  monthlyBudgetMinor: 10_000,
  alertThresholdPercentages: [50, 80, 100],
};

describe("AI policy schemas", () => {
  it("accepts bounded, ascending policy controls", () => {
    expect(workspaceAiPolicySchema.safeParse(policy).success).toBe(true);
  });

  it("rejects invalid thresholds, currency, and undeclared execution controls", () => {
    expect(
      workspaceAiPolicySchema.safeParse({
        ...policy,
        alertThresholdPercentages: [80, 50],
      }).success,
    ).toBe(false);
    expect(
      workspaceAiPolicySchema.safeParse({ ...policy, currency: "usd" }).success,
    ).toBe(false);
    expect(
      workspaceAiPolicySchema.safeParse({ ...policy, execute: true }).success,
    ).toBe(false);
  });

  it("accepts only provider-neutral routing preview inputs", () => {
    expect(
      aiRoutingPreviewSchema.safeParse({
        workspaceId,
        capability: "analyze_image",
        estimatedInputUnits: 1_024,
      }).success,
    ).toBe(true);
    expect(
      aiRoutingPreviewSchema.safeParse({
        workspaceId,
        capability: "unknown",
      }).success,
    ).toBe(false);
  });

  it("accepts only workspace-bound UUID alert acknowledgements", () => {
    expect(
      aiBudgetAlertAcknowledgeSchema.safeParse({
        workspaceId,
        alertId: "22222222-2222-4222-8222-222222222222",
      }).success,
    ).toBe(true);
    expect(
      aiBudgetAlertAcknowledgeSchema.safeParse({
        workspaceId,
        alertId: "not-an-id",
        status: "acknowledged",
      }).success,
    ).toBe(false);
  });

  it("bounds spend-exception requests and closed decisions", () => {
    const deniedReservationId = "33333333-3333-4333-8333-333333333333";
    expect(
      aiSpendExceptionRequestSchema.safeParse({
        workspaceId,
        deniedReservationId,
        justification: "Approve one important launch draft.",
      }).success,
    ).toBe(true);
    expect(
      aiSpendExceptionRequestSchema.safeParse({
        workspaceId,
        deniedReservationId,
        justification: "",
        amount: 100,
      }).success,
    ).toBe(false);
    expect(
      aiSpendExceptionDecisionSchema.safeParse({
        workspaceId,
        requestId: "44444444-4444-4444-8444-444444444444",
        decision: "approved",
      }).success,
    ).toBe(true);
    expect(
      aiSpendExceptionDecisionSchema.safeParse({
        workspaceId,
        requestId: deniedReservationId,
        decision: "changes_requested",
      }).success,
    ).toBe(false);
  });

  it("accepts only a workspace and denied reservation for cap-response preview", () => {
    expect(
      aiCapResponsePreviewSchema.safeParse({
        workspaceId,
        deniedReservationId: "55555555-5555-4555-8555-555555555555",
      }).success,
    ).toBe(true);
    expect(
      aiCapResponsePreviewSchema.safeParse({
        workspaceId,
        deniedReservationId: "bad",
        provider: "cheap-cloud",
      }).success,
    ).toBe(false);
  });

  it("accepts compatible assistant assignments and rejects duplicates or role drift", () => {
    expect(
      aiAssistantAssignmentsSchema.safeParse({
        workspaceId,
        assignments: [
          {
            action: "prepare_copy",
            profileId: "conversation_assistant",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      aiAssistantAssignmentsSchema.safeParse({
        workspaceId,
        assignments: [
          { action: "prepare_copy", profileId: "copy_assistant" },
          { action: "prepare_copy", profileId: "conversation_assistant" },
        ],
      }).success,
    ).toBe(false);
    expect(
      aiAssistantAssignmentsSchema.safeParse({
        workspaceId,
        assignments: [
          { action: "prepare_copy", profileId: "performance_analyst" },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts only server-profiled assistant quote inputs", () => {
    expect(
      aiAssistantCostQuoteCreateSchema.safeParse({
        workspaceId,
        action: "prepare_copy",
        rateCardId: "66666666-6666-4666-8666-666666666666",
      }).success,
    ).toBe(true);
    expect(
      aiAssistantCostQuoteCreateSchema.safeParse({
        workspaceId,
        action: "prepare_copy",
        rateCardId: "66666666-6666-4666-8666-666666666666",
        forecasts: [{ kind: "output", unit: "token", maximumUnits: 999_999_999 }],
        capability: "generate_text",
        feature: "client-choice",
      }).success,
    ).toBe(false);
  });

  it("bounds recent quote-ledger reads", () => {
    expect(
      aiCostQuoteListSchema.safeParse({ workspaceId, limit: "25" }).data,
    ).toMatchObject({ workspaceId, limit: 25 });
    expect(
      aiCostQuoteListSchema.safeParse({ workspaceId, limit: "101" }).success,
    ).toBe(false);
    expect(
      aiCostQuoteListSchema.safeParse({ workspaceId, hash: "secret" }).success,
    ).toBe(false);
  });

  it("accepts only structurally safe unique route preferences", () => {
    const local = { provider: "market-me", model: "grounded-template" };
    expect(
      aiRoutingPreferencesSchema.safeParse({
        workspaceId,
        preferences: [{ action: "prepare_copy", ...local }],
      }).success,
    ).toBe(true);
    expect(
      aiRoutingPreferencesSchema.safeParse({
        workspaceId,
        preferences: [
          { action: "prepare_copy", ...local },
          { action: "prepare_copy", ...local },
        ],
      }).success,
    ).toBe(false);
    expect(
      aiRoutingPreferencesSchema.safeParse({
        workspaceId,
        preferences: [
          { action: "discover_profiles_and_content", ...local },
        ],
      }).success,
    ).toBe(true);
    expect(
      aiRoutingPreferencesSchema.safeParse({
        workspaceId,
        preferences: [
          { action: "prepare_copy", ...local, apiKey: "forbidden" },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires an exact workspace-only adapter-registry query", () => {
    expect(aiProviderAdapterListSchema.safeParse({ workspaceId }).success).toBe(
      true,
    );
    expect(
      aiProviderAdapterListSchema.safeParse({ workspaceId, credentials: true })
        .success,
    ).toBe(false);
    expect(
      aiProviderAdapterListSchema.safeParse({ workspaceId: "not-a-uuid" })
        .success,
    ).toBe(false);
  });

  it("keeps provider connection secrets inside a closed strict contract", () => {
    expect(aiProviderConnectionListSchema.safeParse({ workspaceId }).success).toBe(true);
    expect(aiProviderConnectionRevokeSchema.safeParse({ workspaceId }).success).toBe(true);
    expect(aiProviderConnectionVerifySchema.safeParse({ workspaceId }).success).toBe(true);
    expect(aiProviderConnectionVerifySchema.safeParse({ workspaceId, apiKey: "not-accepted" }).success).toBe(false);
    expect(aiProviderModelInventorySchema.safeParse({ workspaceId }).success).toBe(true);
    expect(aiProviderModelInventorySchema.safeParse({ workspaceId, endpoint: "https://example.com" }).success).toBe(false);
    expect(aiAdapterCandidateListSchema.safeParse({ workspaceId }).success).toBe(true);
    expect(aiAdapterCandidateSubmitSchema.safeParse({
      workspaceId, provider: "openai", modelId: "gpt-example", displayName: "GPT Example",
      capabilities: ["generate_text"], quality: "enhanced", speed: "balanced", cost: "medium",
      contextLimit: 128000, evidenceReference: "https://example.com/evidence", evidenceSha256: "a".repeat(64),
    }).success).toBe(true);
    expect(aiAdapterCandidateDecisionSchema.safeParse({ workspaceId, candidateId: workspaceId, decision: "approved", reviewNote: "Reviewed." }).success).toBe(true);
    expect(aiAdapterRegistrationListSchema.safeParse({ workspaceId }).success).toBe(true);
    expect(aiAdapterRegistrationCreateSchema.safeParse({ workspaceId, candidateId: workspaceId }).success).toBe(true);
    expect(aiAdapterRegistrationRetireSchema.safeParse({ workspaceId, registrationId: workspaceId, retirementReason: "Retired by administrator." }).success).toBe(true);
    expect(aiAdapterRegistrationCreateSchema.safeParse({ workspaceId, candidateId: workspaceId, execution: true }).success).toBe(false);
    expect(aiAdapterRateBindingListSchema.safeParse({ workspaceId }).success).toBe(true);
    expect(aiAdapterRateBindingCreateSchema.safeParse({ workspaceId, registrationId: workspaceId, rateCardId: workspaceId }).success).toBe(true);
    expect(aiAdapterRateBindingRetireSchema.safeParse({ workspaceId, bindingId: workspaceId, retirementReason: "Pricing evidence retired." }).success).toBe(true);
    expect(aiAdapterRateBindingCreateSchema.safeParse({ workspaceId, registrationId: workspaceId, rateCardId: workspaceId, available: true }).success).toBe(false);
    expect(aiAdapterInvocationBindingListSchema.safeParse({ workspaceId }).success).toBe(true);
    expect(aiAdapterInvocationBindingCreateSchema.safeParse({ workspaceId, registrationId: workspaceId, rateBindingId: workspaceId, contractId: workspaceId }).success).toBe(true);
    expect(aiAdapterInvocationBindingRetireSchema.safeParse({ workspaceId, bindingId: workspaceId, retirementReason: "Invocation staging retired." }).success).toBe(true);
    expect(aiAdapterInvocationBindingCreateSchema.safeParse({ workspaceId, registrationId: workspaceId, rateBindingId: workspaceId, contractId: workspaceId, execution: true }).success).toBe(false);
    expect(aiAdapterHealthProbeSchema.safeParse({ workspaceId }).success).toBe(true);
    expect(aiAdapterHealthProbeSchema.safeParse({ workspaceId, healthy: true }).success).toBe(false);
    expect(aiProviderConnectionSaveSchema.safeParse({
      workspaceId,
      provider: "openai",
      apiKey: "test-provider-key-1234567890",
    }).success).toBe(true);
    expect(aiProviderConnectionSaveSchema.safeParse({
      workspaceId,
      provider: "openai_compatible",
      apiKey: "test-provider-key-1234567890",
    }).success).toBe(false);
    expect(aiProviderConnectionSaveSchema.safeParse({
      workspaceId,
      provider: "anthropic",
      apiKey: "test-provider-key-1234567890",
      endpoint: "https://attacker.invalid",
    }).success).toBe(false);
  });

  it("bounds text invocation intent input and rejects execution authority", () => {
    const valid = {
      workspaceId,
      invocationBindingId: workspaceId,
      reservationId: workspaceId,
      idempotencyKey: workspaceId,
      userText: "Prepare a short draft.",
      maxOutputTokens: 512,
    };
    expect(aiTextInvocationIntentListSchema.safeParse({ workspaceId }).success).toBe(true);
    expect(aiTextInvocationAttemptListSchema.safeParse({ workspaceId }).success).toBe(true);
    expect(aiTextInvocationAttemptListSchema.safeParse({ workspaceId, execute: true }).success).toBe(false);
    expect(aiTextOutputListSchema.safeParse({ workspaceId }).success).toBe(true);
    expect(aiTextOutputListSchema.safeParse({ workspaceId, output: true }).success).toBe(false);
    expect(aiTextOutputReviewSchema.safeParse({
      workspaceId,
      decision: "accepted",
      reviewNote: "Approved after review.",
    }).success).toBe(true);
    expect(aiTextOutputReviewSchema.safeParse({
      workspaceId,
      decision: "published",
      reviewNote: "Publishing is outside this boundary.",
    }).success).toBe(false);
    expect(aiTextDraftProposalListSchema.safeParse({
      workspaceId, contentDraftId: workspaceId,
    }).success).toBe(true);
    expect(aiTextDraftProposalAttachSchema.safeParse({
      workspaceId, contentDraftId: workspaceId,
    }).success).toBe(true);
    expect(aiTextDraftProposalAttachSchema.safeParse({
      workspaceId, contentDraftId: workspaceId, mutateDraft: true,
    }).success).toBe(false);
    expect(aiTextDraftProposalDismissSchema.safeParse({
      workspaceId, dismissalNote: "Not suitable for this Draft.",
    }).success).toBe(true);
    expect(aiTextDraftProposalApplySchema.safeParse({
      workspaceId,
      leadIn: "For local partners",
      callToAction: "See the approved details.",
      hashtags: ["#MarketMe", "#Launch"],
      altText: "A reviewed campaign visual.",
      changeNote: "Selected the presentation fields after author review.",
    }).success).toBe(true);
    expect(aiTextDraftProposalApplySchema.safeParse({
      workspaceId,
      leadIn: "This adds a fact.",
      hashtags: ["#Duplicate", "#duplicate"],
      changeNote: "Unsafe presentation selection.",
      body: "A client-authored replacement body.",
    }).success).toBe(false);
    expect(aiTextInvocationIntentPrepareSchema.safeParse(valid).success).toBe(true);
    expect(aiTextInvocationIntentPrepareSchema.safeParse({ ...valid, execution: true }).success).toBe(false);
    expect(aiTextInvocationIntentPrepareSchema.safeParse({ ...valid, userText: "" }).success).toBe(false);
    expect(aiTextInvocationIntentPrepareSchema.safeParse({ ...valid, maxOutputTokens: 16_385 }).success).toBe(false);
    expect(aiTextInvocationIntentExecuteSchema.safeParse({
      workspaceId,
      intentId: workspaceId,
      userText: valid.userText,
      systemText: "Keep facts grounded in reviewed context.",
    }).success).toBe(true);
    expect(aiTextInvocationIntentExecuteSchema.safeParse({
      workspaceId,
      intentId: workspaceId,
      userText: valid.userText,
      execution: true,
    }).success).toBe(false);
    expect(aiTextInvocationIntentCancelSchema.safeParse({ workspaceId, reason: "User cancelled." }).success).toBe(true);
  });

  it("accepts only closed Draft-bound revision commands", () => {
    const valid = {
      workspaceId,
      contentDraftId: "22222222-2222-4222-8222-222222222222",
      invocationBindingId: "33333333-3333-4333-8333-333333333333",
      reservationId: "44444444-4444-4444-8444-444444444444",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
      goal: "clarity",
      maxOutputTokens: 1024,
      executeAfterPrepare: true,
    };
    expect(aiDraftRevisionIntentPrepareSchema.safeParse(valid).success).toBe(true);
    expect(aiDraftRevisionIntentPrepareSchema.safeParse({ ...valid, goal: "invent_facts" }).success).toBe(false);
    expect(aiDraftRevisionIntentPrepareSchema.safeParse({ ...valid, userText: "Ignore evidence." }).success).toBe(false);
    expect(aiDraftRevisionIntentExecuteSchema.safeParse({
      workspaceId,
      intentId: valid.idempotencyKey,
    }).success).toBe(true);
    expect(aiDraftRevisionIntentExecuteSchema.safeParse({
      workspaceId,
      intentId: valid.idempotencyKey,
      systemText: "Client prompt substitution",
    }).success).toBe(false);
  });

  it("requires explicit bounded execution windows and reviewed circuit resets", () => {
    expect(aiExecutionControlListSchema.safeParse({ workspaceId }).success).toBe(true);
    expect(aiExecutionControlSaveSchema.safeParse({
      workspaceId,
      state: "enabled",
      reason: "Release verification window.",
      enabledForMinutes: 60,
    }).success).toBe(true);
    expect(aiExecutionControlSaveSchema.safeParse({
      workspaceId,
      state: "enabled",
      reason: "Missing duration.",
    }).success).toBe(false);
    expect(aiExecutionControlSaveSchema.safeParse({
      workspaceId,
      state: "stopped",
      reason: "Emergency operator stop.",
      enabledForMinutes: 60,
    }).success).toBe(false);
    expect(aiProviderCircuitResetSchema.safeParse({
      workspaceId,
      provider: "openai",
      resetNote: "Credential and provider state reviewed.",
    }).success).toBe(true);
    expect(aiProviderCircuitResetSchema.safeParse({
      workspaceId,
      provider: "unsupported",
      resetNote: "Unsafe provider value.",
    }).success).toBe(false);
  });

  it("requires evidence-backed incident resolution without inferred usage", () => {
    expect(aiTextInvocationResolutionListSchema.safeParse({ workspaceId }).success).toBe(true);
    expect(aiTextInvocationResolveSchema.safeParse({
      workspaceId,
      attemptId: workspaceId,
      disposition: "confirmed_no_charge",
      evidenceReference: "Provider billing statement INV-100.",
      resolutionNote: "Statement confirms no provider charge.",
    }).success).toBe(true);
    expect(aiTextInvocationResolveSchema.safeParse({
      workspaceId,
      attemptId: workspaceId,
      disposition: "settled_provider_charge",
      providerChargeMinor: 17,
      evidenceReference: "Provider invoice INV-101.",
      resolutionNote: "Recorded the exact provider invoice charge.",
    }).success).toBe(true);
    expect(aiTextInvocationResolveSchema.safeParse({
      workspaceId,
      attemptId: workspaceId,
      disposition: "settled_provider_charge",
      evidenceReference: "Missing charge amount.",
      resolutionNote: "Invalid.",
    }).success).toBe(false);
    expect(aiTextInvocationResolveSchema.safeParse({
      workspaceId,
      attemptId: workspaceId,
      disposition: "confirmed_no_charge",
      providerChargeMinor: 1,
      evidenceReference: "Contradictory charge input.",
      resolutionNote: "Invalid.",
    }).success).toBe(false);
  });

  it("accepts only bounded operational-incident acknowledgement evidence", () => {
    expect(aiOperationalIncidentListSchema.safeParse({ workspaceId }).success).toBe(true);
    expect(aiOperationalIncidentAcknowledgeSchema.safeParse({
      workspaceId,
      type: "invocation_ambiguous",
      attemptId: workspaceId,
      acknowledgementNote: "Incident owner assigned and source evidence is under review.",
    }).success).toBe(true);
    expect(aiOperationalIncidentAcknowledgeSchema.safeParse({
      workspaceId,
      type: "unsupported_incident",
      attemptId: workspaceId,
      acknowledgementNote: "Invalid type.",
    }).success).toBe(false);
    expect(aiOperationalIncidentAcknowledgeSchema.safeParse({
      workspaceId,
      type: "provider_circuit_open",
      attemptId: workspaceId,
      acknowledgementNote: " ",
    }).success).toBe(false);
  });

  it("requires ordered incident-response targets and a credential-free HTTPS runbook", () => {
    expect(aiOperationalIncidentResponsePolicySchema.safeParse({
      workspaceId,
      criticalAcknowledgementMinutes: 5,
      highAcknowledgementMinutes: 30,
      criticalResolutionMinutes: 60,
      highResolutionMinutes: 240,
      runbookUrl: "https://operations.example.test/runbooks/ai-incidents",
    }).success).toBe(true);
    expect(aiOperationalIncidentResponsePolicySchema.safeParse({
      workspaceId,
      criticalAcknowledgementMinutes: 30,
      highAcknowledgementMinutes: 30,
      criticalResolutionMinutes: 10,
      highResolutionMinutes: 240,
      runbookUrl: "http://operations.example.test/runbook",
    }).success).toBe(false);
    expect(aiOperationalIncidentResponsePolicySchema.safeParse({
      workspaceId,
      criticalAcknowledgementMinutes: 5,
      highAcknowledgementMinutes: 30,
      criticalResolutionMinutes: 60,
      highResolutionMinutes: 240,
      runbookUrl: "https://user:secret@operations.example.test/runbook",
    }).success).toBe(false);
  });

  it("bounds operational alert configuration, actions, and history queries", () => {
    expect(aiOperationalAlertWebhookSaveSchema.safeParse({
      workspaceId,
      endpointUrl: "https://alerts.example.test/market-me",
      signingSecret: "a".repeat(32),
    }).success).toBe(true);
    expect(aiOperationalAlertWebhookSaveSchema.safeParse({
      workspaceId,
      endpointUrl: "https://alerts.example.test/market-me",
      signingSecret: "short",
    }).success).toBe(false);
    expect(aiOperationalAlertWebhookActionSchema.safeParse({ workspaceId }).success).toBe(true);
    expect(aiOperationalAlertDeliveryListSchema.safeParse({ workspaceId, limit: "100" }).success).toBe(true);
    expect(aiOperationalAlertDeliveryListSchema.safeParse({ workspaceId, limit: "101" }).success).toBe(false);
  });
});
