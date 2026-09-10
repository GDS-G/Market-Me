export const AI_MODES = [
  "recommended",
  "lower_cost",
  "highest_quality",
  "faster",
  "private_local",
  "custom",
] as const;

export const AI_CAPABILITIES = [
  "generate_text",
  "generate_structured_output",
  "analyze_image",
  "transcribe",
  "embed",
  "rerank",
  "moderate",
  "use_tools",
] as const;

export const AI_PRIVACY_CLASSES = ["cloud", "private_cloud", "local"] as const;
export const AI_FAILOVER_MODES = [
  "automatic_approved",
  "ask_before_switching",
  "no_external_fallback",
] as const;
export const AI_CAP_BEHAVIORS = [
  "pause_ai_work",
  "lower_cost_fallback",
  "limited_drafts",
  "require_approval",
] as const;
export const AI_QUALITY_LEVELS = ["standard", "enhanced", "highest"] as const;
export const AI_SPEED_LEVELS = ["fast", "balanced", "thorough"] as const;
export const AI_COST_LEVELS = ["low", "medium", "high"] as const;
export const AI_HOSTED_PROVIDER_TYPES = [
  "openai",
  "anthropic",
  "google_generative_ai",
] as const;
export const AI_PROVIDER_CONNECTION_STATUSES = [
  "unverified",
  "verified",
  "error",
  "revoked",
] as const;
export const AI_ADAPTER_CANDIDATE_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "retired",
] as const;
export const AI_ADAPTER_REGISTRATION_STATUSES = [
  "registered",
  "retired",
] as const;
export const AI_ADAPTER_RATE_BINDING_STATUSES = ["bound", "retired"] as const;
export const AI_INVOCATION_CONTRACT_STATUSES = ["approved", "retired"] as const;
export const AI_ADAPTER_INVOCATION_BINDING_STATUSES = [
  "configured",
  "retired",
] as const;
export const AI_ADAPTER_HEALTH_STATUSES = ["healthy", "unhealthy"] as const;
export const AI_TEXT_INVOCATION_INTENT_STATUSES = ["prepared", "cancelled"] as const;
export const AI_TEXT_INVOCATION_ATTEMPT_STATUSES = [
  "claimed",
  "succeeded",
  "failed",
  "ambiguous",
] as const;
export const AI_TEXT_OUTPUT_ARTIFACT_STATUSES = [
  "pending_review",
  "accepted",
  "discarded",
] as const;
export const AI_TEXT_RECONCILIATION_STATUSES = ["settled", "quarantined"] as const;
export const AI_TEXT_INVOCATION_RESOLUTION_DISPOSITIONS = [
  "confirmed_no_charge",
  "settled_provider_charge",
] as const;
export const AI_TEXT_DRAFT_PROPOSAL_STATUSES = ["attached", "applied", "dismissed"] as const;
export const AI_DRAFT_REVISION_GOALS = [
  "clarity",
  "concision",
  "audience_fit",
  "call_to_action",
] as const;
export const AI_DRAFT_REVISION_PROMPT_VERSIONS = [
  "draft-revision-v1",
  "draft-revision-v2",
] as const;
export const AI_DRAFT_REVISION_CURRENT_PROMPT_VERSION = "draft-revision-v2" as const;
export const AI_DRAFT_REVISION_SUGGESTION_VERSION = "draft-revision-suggestion-v1" as const;
export const AI_EXECUTION_CONTROL_STATES = ["stopped", "enabled"] as const;
export const AI_PROVIDER_CIRCUIT_STATES = ["closed", "open"] as const;
export const AI_PROVIDER_CIRCUIT_FAILURES = [
  "credential_unavailable",
  "provider_outcome_unknown",
  "claim_abandoned",
] as const;
export const AI_OPERATIONAL_INCIDENT_TYPES = [
  "provider_circuit_open",
  "invocation_ambiguous",
  "reconciliation_quarantined",
] as const;
export const AI_OPERATIONAL_INCIDENT_SEVERITIES = ["critical", "high"] as const;
export const AI_OPERATIONAL_READINESS_STATES = ["ready", "attention", "blocked"] as const;
export const AI_OPERATIONAL_INCIDENT_RESPONSE_STATES = [
  "within_target",
  "acknowledgement_overdue",
  "acknowledgement_late",
  "resolution_overdue",
] as const;
export const AI_OPERATIONAL_ALERT_WEBHOOK_STATUSES = [
  "unverified", "verified", "error", "disabled",
] as const;
export const AI_OPERATIONAL_ALERT_EVENT_TYPES = [
  "incident_opened",
  "incident_acknowledged",
  "acknowledgement_overdue",
  "resolution_overdue",
  "incident_resolved",
] as const;
export const AI_OPERATIONAL_ALERT_DELIVERY_STATUSES = [
  "pending", "processing", "failed", "delivered", "dead_letter",
] as const;
export const AI_ADAPTER_HEALTH_FAILURES = [
  "credential_rejected",
  "rate_limited",
  "provider_unavailable",
  "unexpected_response",
] as const;
export const AI_RATE_CARD_STATUSES = ["draft", "approved", "retired"] as const;
export const AI_RATE_COMPONENT_KINDS = [
  "input",
  "cached_input",
  "output",
  "request",
] as const;
export const AI_RATE_UNITS = [
  "token",
  "character",
  "second",
  "image",
  "request",
] as const;
export const AI_SPEND_RESERVATION_STATUSES = [
  "reserved",
  "denied",
  "settled",
  "released",
  "expired",
] as const;
export const AI_BUDGET_SCOPES = ["daily", "campaign", "monthly"] as const;
export const AI_BUDGET_ALERT_STATUSES = ["open", "acknowledged"] as const;
export const AI_SPEND_EXCEPTION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
] as const;
export const AI_CAP_RESPONSE_ACTIONS = [
  "pause",
  "use_lower_cost_adapter",
  "create_limited_draft",
  "request_approval",
  "manual",
] as const;
export const AI_ASSISTANT_PROFILE_IDS = [
  "content_analyst",
  "copy_assistant",
  "campaign_planner",
  "discovery_assistant",
  "conversation_assistant",
  "compliance_reviewer",
  "performance_analyst",
] as const;
export const AI_ASSISTANT_ACTIONS = [
  "understand_content",
  "prepare_copy",
  "plan_campaign",
  "discover_profiles_and_content",
  "draft_eligible_interaction",
  "review_rules_rights_and_claims",
  "evaluate_results_and_experiments",
] as const;
export const AI_ASSISTANT_OUTPUT_KINDS = [
  "analysis",
  "draft",
  "recommendation",
  "proposed_action",
] as const;

export type AiMode = (typeof AI_MODES)[number];
export type AiCapability = (typeof AI_CAPABILITIES)[number];
export type AiPrivacyClass = (typeof AI_PRIVACY_CLASSES)[number];
export type AiFailoverMode = (typeof AI_FAILOVER_MODES)[number];
export type AiCapBehavior = (typeof AI_CAP_BEHAVIORS)[number];
export type AiQualityLevel = (typeof AI_QUALITY_LEVELS)[number];
export type AiSpeedLevel = (typeof AI_SPEED_LEVELS)[number];
export type AiCostLevel = (typeof AI_COST_LEVELS)[number];
export type AiHostedProviderType = (typeof AI_HOSTED_PROVIDER_TYPES)[number];
export type AiProviderConnectionStatus =
  (typeof AI_PROVIDER_CONNECTION_STATUSES)[number];
export type AiAdapterCandidateStatus =
  (typeof AI_ADAPTER_CANDIDATE_STATUSES)[number];
export type AiAdapterRegistrationStatus =
  (typeof AI_ADAPTER_REGISTRATION_STATUSES)[number];
export type AiAdapterRateBindingStatus =
  (typeof AI_ADAPTER_RATE_BINDING_STATUSES)[number];
export type AiInvocationContractStatus =
  (typeof AI_INVOCATION_CONTRACT_STATUSES)[number];
export type AiAdapterInvocationBindingStatus =
  (typeof AI_ADAPTER_INVOCATION_BINDING_STATUSES)[number];
export type AiAdapterHealthStatus = (typeof AI_ADAPTER_HEALTH_STATUSES)[number];
export type AiTextInvocationIntentStatus =
  (typeof AI_TEXT_INVOCATION_INTENT_STATUSES)[number];
export type AiTextInvocationAttemptStatus =
  (typeof AI_TEXT_INVOCATION_ATTEMPT_STATUSES)[number];
export type AiTextOutputArtifactStatus = (typeof AI_TEXT_OUTPUT_ARTIFACT_STATUSES)[number];
export type AiTextReconciliationStatus = (typeof AI_TEXT_RECONCILIATION_STATUSES)[number];
export type AiTextInvocationResolutionDisposition =
  (typeof AI_TEXT_INVOCATION_RESOLUTION_DISPOSITIONS)[number];
export type AiTextDraftProposalStatus = (typeof AI_TEXT_DRAFT_PROPOSAL_STATUSES)[number];
export type AiDraftRevisionGoal = (typeof AI_DRAFT_REVISION_GOALS)[number];
export type AiDraftRevisionPromptVersion = (typeof AI_DRAFT_REVISION_PROMPT_VERSIONS)[number];
export type AiExecutionControlState = (typeof AI_EXECUTION_CONTROL_STATES)[number];
export type AiProviderCircuitState = (typeof AI_PROVIDER_CIRCUIT_STATES)[number];
export type AiProviderCircuitFailure = (typeof AI_PROVIDER_CIRCUIT_FAILURES)[number];
export type AiOperationalIncidentType = (typeof AI_OPERATIONAL_INCIDENT_TYPES)[number];
export type AiOperationalIncidentSeverity = (typeof AI_OPERATIONAL_INCIDENT_SEVERITIES)[number];
export type AiOperationalReadinessState = (typeof AI_OPERATIONAL_READINESS_STATES)[number];
export type AiOperationalIncidentResponseState =
  (typeof AI_OPERATIONAL_INCIDENT_RESPONSE_STATES)[number];
export type AiOperationalAlertWebhookStatus =
  (typeof AI_OPERATIONAL_ALERT_WEBHOOK_STATUSES)[number];
export type AiOperationalAlertEventType =
  (typeof AI_OPERATIONAL_ALERT_EVENT_TYPES)[number];
export type AiOperationalAlertDeliveryStatus =
  (typeof AI_OPERATIONAL_ALERT_DELIVERY_STATUSES)[number];
export type AiAdapterHealthFailure = (typeof AI_ADAPTER_HEALTH_FAILURES)[number];
export type AiRateCardStatus = (typeof AI_RATE_CARD_STATUSES)[number];
export type AiRateComponentKind =
  (typeof AI_RATE_COMPONENT_KINDS)[number];
export type AiRateUnit = (typeof AI_RATE_UNITS)[number];
export type AiSpendReservationStatus =
  (typeof AI_SPEND_RESERVATION_STATUSES)[number];
export type AiBudgetScope = (typeof AI_BUDGET_SCOPES)[number];
export type AiBudgetAlertStatus = (typeof AI_BUDGET_ALERT_STATUSES)[number];
export type AiSpendExceptionStatus =
  (typeof AI_SPEND_EXCEPTION_STATUSES)[number];
export type AiCapResponseAction = (typeof AI_CAP_RESPONSE_ACTIONS)[number];
export type AiAssistantProfileId = (typeof AI_ASSISTANT_PROFILE_IDS)[number];
export type AiAssistantAction = (typeof AI_ASSISTANT_ACTIONS)[number];
export type AiAssistantOutputKind = (typeof AI_ASSISTANT_OUTPUT_KINDS)[number];

export interface AiModeIndicators {
  quality: AiQualityLevel;
  speed: AiSpeedLevel;
  privacy: AiPrivacyClass;
  estimatedCost: AiCostLevel;
}

export interface AiProviderAdapterDescriptor {
  provider: string;
  model: string;
  displayName: string;
  capabilities: readonly AiCapability[];
  privacyClass: AiPrivacyClass;
  quality: AiQualityLevel;
  speed: AiSpeedLevel;
  cost: AiCostLevel;
  contextLimit: number;
  available: boolean;
  approved: boolean;
  requiresPaidReservation: boolean;
}

export interface AiProviderAdapterRegistryEntry
  extends AiProviderAdapterDescriptor {
  availabilityReason?: string;
  configurationSource: "built_in" | "administrator";
  verifiedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiProviderAdapterRegistrySummary {
  totalAdapterCount: number;
  approvedAdapterCount: number;
  availableAdapterCount: number;
  paidReservationAdapterCount: number;
  capabilityCount: number;
  latestVerifiedAt?: string;
}

export interface AiProviderConnection {
  workspaceId: string;
  provider: AiHostedProviderType;
  status: AiProviderConnectionStatus;
  credentialConfigured: boolean;
  lastError?: string;
  verifiedAt?: string;
  revokedAt?: string;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
  execution: false;
}

export interface AiProviderModelInventoryItem {
  workspaceId: string;
  provider: AiHostedProviderType;
  modelId: string;
  displayName?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  providerCreatedAt?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  retiredAt?: string;
  adapterActivation: false;
  execution: false;
}

export interface AiProviderModelInventorySummary {
  totalModelCount: number;
  activeModelCount: number;
  retiredModelCount: number;
  latestDiscoveryAt?: string;
  adapterActivation: false;
  execution: false;
}

export interface AiWorkspaceAdapterCandidate {
  id: string;
  workspaceId: string;
  provider: AiHostedProviderType;
  modelId: string;
  status: AiAdapterCandidateStatus;
  displayName: string;
  capabilities: readonly AiCapability[];
  privacyClass: "cloud";
  quality: AiQualityLevel;
  speed: AiSpeedLevel;
  cost: AiCostLevel;
  contextLimit: number;
  requiresPaidReservation: true;
  evidenceReference: string;
  evidenceSha256: string;
  submittedByUserId: string;
  reviewedByUserId?: string;
  reviewNote?: string;
  submittedAt: string;
  reviewedAt?: string;
  retiredAt?: string;
  createdAt: string;
  updatedAt: string;
  routingAvailable: false;
  adapterActivation: false;
  execution: false;
}

export interface AiWorkspaceAdapterRegistration {
  id: string;
  workspaceId: string;
  candidateId: string;
  provider: AiHostedProviderType;
  modelId: string;
  status: AiAdapterRegistrationStatus;
  displayName: string;
  capabilities: readonly AiCapability[];
  privacyClass: "cloud";
  quality: AiQualityLevel;
  speed: AiSpeedLevel;
  cost: AiCostLevel;
  contextLimit: number;
  requiresPaidReservation: true;
  registeredByUserId: string;
  retiredByUserId?: string;
  retirementReason?: string;
  registeredAt: string;
  retiredAt?: string;
  createdAt: string;
  updatedAt: string;
  routingAvailable: false;
  adapterActivation: false;
  execution: false;
}

export interface AiWorkspaceAdapterRateBinding {
  id: string;
  workspaceId: string;
  registrationId: string;
  rateCardId: string;
  provider: AiHostedProviderType;
  modelId: string;
  displayName: string;
  status: AiAdapterRateBindingStatus;
  currency: string;
  minorUnitExponent: number;
  modelVersion: string;
  components: readonly AiProviderRateComponent[];
  effectiveFrom: string;
  effectiveTo?: string;
  sourceReference: string;
  sourceHash: string;
  verifiedAt: string;
  evidenceCurrent: boolean;
  pricingReady: boolean;
  boundByUserId: string;
  retiredByUserId?: string;
  retirementReason?: string;
  boundAt: string;
  retiredAt?: string;
  createdAt: string;
  updatedAt: string;
  routingAvailable: false;
  adapterActivation: false;
  execution: false;
}

export interface AiProviderInvocationContract {
  id: string;
  provider: AiHostedProviderType;
  contractKey: string;
  contractVersion: string;
  status: AiInvocationContractStatus;
  transport: "https_json";
  credentialMode: "bearer_api_key" | "api_key_header";
  requestSchemaVersion: string;
  responseSchemaVersion: string;
  sourceReference: string;
  sourceHash: string;
  codecAvailable: boolean;
  codecVersion?: string;
  transportAvailable: boolean;
  transportVersion?: string;
  endpointPolicy?: string;
  implementationVersion?: string;
  reviewedAt: string;
  createdAt: string;
  updatedAt: string;
  implementationAvailable: boolean;
  healthReady: false;
  execution: false;
}

export interface AiWorkspaceAdapterInvocationBinding {
  id: string;
  workspaceId: string;
  registrationId: string;
  rateBindingId: string;
  rateCardId: string;
  contractId: string;
  provider: AiHostedProviderType;
  modelId: string;
  displayName: string;
  pricingCurrency: string;
  status: AiAdapterInvocationBindingStatus;
  contractKey: string;
  contractVersion: string;
  transport: "https_json";
  credentialMode: "bearer_api_key" | "api_key_header";
  requestSchemaVersion: string;
  responseSchemaVersion: string;
  sourceReference: string;
  sourceHash: string;
  codecAvailable: boolean;
  codecVersion?: string;
  transportAvailable: boolean;
  transportVersion?: string;
  endpointPolicy?: string;
  implementationVersion?: string;
  configurationCurrent: boolean;
  providerHealthEvidenceCurrent: boolean;
  latestHealthObservation?: AiWorkspaceAdapterHealthObservation;
  configuredByUserId: string;
  retiredByUserId?: string;
  retirementReason?: string;
  configuredAt: string;
  retiredAt?: string;
  createdAt: string;
  updatedAt: string;
  implementationAvailable: boolean;
  healthReady: boolean;
  routingAvailable: false;
  adapterActivation: false;
  execution: false;
}

export interface AiWorkspaceAdapterHealthObservation {
  id: string;
  invocationBindingId: string;
  provider: AiHostedProviderType;
  status: AiAdapterHealthStatus;
  failureCode?: AiAdapterHealthFailure;
  safeMessage?: string;
  checkedByUserId: string;
  checkedAt: string;
  expiresAt: string;
  evidenceCurrent: boolean;
  providerRequest: true;
  providerResponseStored: false;
  generation: false;
  implementationAvailable: boolean;
  healthReady: boolean;
  routingAvailable: false;
  adapterActivation: false;
  execution: false;
}

export interface AiTextInvocationIntent {
  id: string;
  workspaceId: string;
  invocationBindingId: string;
  reservationId: string;
  costQuoteId: string;
  provider: AiHostedProviderType;
  modelId: string;
  feature: string;
  currency: string;
  estimatedCostMinor: number;
  maxOutputTokens: number;
  status: AiTextInvocationIntentStatus;
  preparedByUserId: string;
  cancelledByUserId?: string;
  cancellationReason?: string;
  preparedAt: string;
  expiresAt: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
  sourceContentDraftId?: string;
  sourceContentDraftVersionId?: string;
  draftRevisionGoal?: AiDraftRevisionGoal;
  productPromptVersion?: string;
  productBound: boolean;
  sourceContextHashStored: boolean;
  authorizationCurrent: boolean;
  promptStored: false;
  providerRequest: false;
  outputStored: false;
  usageRecorded: false;
  settlement: false;
  routingAvailable: false;
  execution: false;
}

export interface AiTextInvocationAttempt {
  id: string;
  workspaceId: string;
  intentId: string;
  provider: AiHostedProviderType;
  modelId: string;
  status: AiTextInvocationAttemptStatus;
  stopReason?: "completed" | "max_output" | "refusal" | "blocked" | "unknown";
  failureCode?: "credential_unavailable" | "provider_outcome_unknown" | "evidence_changed" | "claim_abandoned";
  safeMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
  claimedByUserId: string;
  claimedAt: string;
  claimExpiresAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  providerRequestStatus: "unknown" | "sent" | "not_sent";
  outputStored: boolean;
  outputEncrypted: boolean;
  outputHashStored: boolean;
  providerResponseIdStored: false;
  providerResponseIdHashStored: boolean;
  usageRecorded: false;
  settlement: false;
  retryAllowed: false;
  routingAvailable: false;
  attemptComplete: boolean;
  providerExecutionSucceeded: boolean;
}

export interface AiWorkspaceExecutionControl {
  workspaceId: string;
  state: AiExecutionControlState;
  reason?: string;
  enabledUntil?: string;
  updatedByUserId?: string;
  createdAt?: string;
  updatedAt?: string;
  configured: boolean;
  executionAllowed: boolean;
}

export interface AiWorkspaceProviderCircuit {
  workspaceId: string;
  provider: AiHostedProviderType;
  state: AiProviderCircuitState;
  consecutiveUnsafeOutcomes: number;
  lastFailureCode?: AiProviderCircuitFailure;
  lastOutcomeAt?: string;
  openedAt?: string;
  openedByAttemptId?: string;
  resetByUserId?: string;
  resetNote?: string;
  resetAt?: string;
  createdAt: string;
  updatedAt: string;
  executionAllowed: boolean;
}

export interface AiOperationalIncident {
  id: string;
  workspaceId: string;
  type: AiOperationalIncidentType;
  severity: AiOperationalIncidentSeverity;
  attemptId: string;
  provider: AiHostedProviderType;
  reconciliationId?: string;
  reason:
    | AiProviderCircuitFailure
    | "evidence_changed"
    | "missing_usage"
    | "unsupported_rate_card"
    | "cost_exceeds_authorization";
  summary: string;
  openedAt: string;
  acknowledged: boolean;
  acknowledgementId?: string;
  acknowledgementNote?: string;
  acknowledgedByUserId?: string;
  acknowledgedAt?: string;
  acknowledgementDueAt: string;
  resolutionDueAt: string;
  acknowledgementOverdue: boolean;
  acknowledgementLate: boolean;
  resolutionOverdue: boolean;
  responseState: AiOperationalIncidentResponseState;
  active: true;
  providerRequestRetried: false;
  executionAuthority: false;
}

export interface AiOperationalReadiness {
  workspaceId: string;
  state: AiOperationalReadinessState;
  activeIncidentCount: number;
  unacknowledgedIncidentCount: number;
  criticalIncidentCount: number;
  acknowledgementOverdueCount: number;
  acknowledgementLateCount: number;
  resolutionOverdueCount: number;
  oldestActiveAt?: string;
  nextResponseDueAt?: string;
  evaluatedAt: string;
  executionShouldRemainStopped: boolean;
  externalAlertDeliveryConfigured: boolean;
  publicExecutionRouteAvailable: false;
}

export interface AiOperationalIncidentResponsePolicy {
  workspaceId: string;
  criticalAcknowledgementMinutes: number;
  highAcknowledgementMinutes: number;
  criticalResolutionMinutes: number;
  highResolutionMinutes: number;
  runbookUrl?: string;
  configured: boolean;
  updatedByUserId?: string;
  createdAt?: string;
  updatedAt?: string;
  executionAuthority: false;
  externalAlertDeliveryConfigured: boolean;
}

export interface AiOperationalAlertWebhook {
  workspaceId: string;
  status: AiOperationalAlertWebhookStatus;
  endpointOrigin?: string;
  secretConfigured: boolean;
  lastTestedAt?: string;
  safeError?: string;
  createdAt?: string;
  updatedAt?: string;
  configured: boolean;
  deliveryEnabled: boolean;
  executionAuthority: false;
  providerRequestAuthority: false;
}

export interface AiOperationalAlertDelivery {
  id: string;
  workspaceId: string;
  incidentType: AiOperationalIncidentType;
  attemptId: string;
  provider: AiHostedProviderType;
  eventType: AiOperationalAlertEventType;
  status: AiOperationalAlertDeliveryStatus;
  attemptCount: number;
  nextAttemptAt: string;
  deliveredAt?: string;
  responseStatus?: number;
  safeError?: string;
  createdAt: string;
  updatedAt: string;
  payloadReturned: false;
  endpointReturned: false;
  signingSecretReturned: false;
  executionAuthority: false;
}

export interface AiTextOutputArtifact {
  id: string;
  workspaceId: string;
  attemptId: string;
  intentId: string;
  provider: AiHostedProviderType;
  modelId: string;
  status: AiTextOutputArtifactStatus;
  characterCount: number;
  createdByUserId: string;
  reviewedByUserId?: string;
  reviewNote?: string;
  createdAt: string;
  reviewedAt?: string;
  updatedAt: string;
  sourceContentDraftId?: string;
  sourceContentDraftVersionId?: string;
  draftRevisionGoal?: AiDraftRevisionGoal;
  productBound: boolean;
  outputEncrypted: true;
  outputReturned: false;
  outputHashReturned: false;
  publishingAuthorized: false;
  execution: false;
}

export interface AiDraftRevisionPresentationSuggestion {
  schemaVersion: typeof AI_DRAFT_REVISION_SUGGESTION_VERSION;
  leadIn?: string;
  callToAction?: string;
  hashtags?: readonly string[];
  altText?: string;
  rationale: string;
}

export interface AiDraftRevisionSuggestionParseResult {
  status: "valid" | "unavailable";
  suggestion?: AiDraftRevisionPresentationSuggestion;
  issues: readonly string[];
  draftContentMutated: false;
  publishingAuthorized: false;
}

export function parseAiDraftRevisionPresentationSuggestion(
  outputText: string,
): AiDraftRevisionSuggestionParseResult {
  if (outputText.length > 400_000)
    return unavailableSuggestion("Output exceeds the bounded artifact size.");
  const trimmed = outputText.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;
  let parsed: unknown;
  try { parsed = JSON.parse(candidate); }
  catch { return unavailableSuggestion("Output is not one exact JSON object."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return unavailableSuggestion("Suggestion must be one JSON object.");
  const record = parsed as Record<string, unknown>;
  const allowed = new Set(["schemaVersion", "leadIn", "callToAction", "hashtags", "altText", "rationale"]);
  if (Object.keys(record).some((key) => !allowed.has(key)))
    return unavailableSuggestion("Suggestion contains an unsupported field.");
  if (record.schemaVersion !== AI_DRAFT_REVISION_SUGGESTION_VERSION)
    return unavailableSuggestion("Suggestion schema version is not supported.");
  if (typeof record.rationale !== "string" || record.rationale.trim() !== record.rationale ||
    record.rationale.length < 3 || record.rationale.length > 1_000)
    return unavailableSuggestion("Suggestion rationale must contain 3-1,000 trimmed characters.");
  if (record.leadIn !== undefined && (typeof record.leadIn !== "string" ||
    record.leadIn.trim() !== record.leadIn || record.leadIn.length > 500 || /[.!?]/u.test(record.leadIn)))
    return unavailableSuggestion("Suggested lead-in is outside the presentation-only bounds.");
  if (record.callToAction !== undefined && (typeof record.callToAction !== "string" ||
    record.callToAction.trim() !== record.callToAction || record.callToAction.length < 1 || record.callToAction.length > 1_000))
    return unavailableSuggestion("Suggested call to action is outside the presentation bounds.");
  if (record.altText !== undefined && (typeof record.altText !== "string" ||
    record.altText.trim() !== record.altText || record.altText.length < 1 || record.altText.length > 2_000))
    return unavailableSuggestion("Suggested alternative text is outside the accessibility bounds.");
  if (record.hashtags !== undefined) {
    if (!Array.isArray(record.hashtags) || record.hashtags.length > 20 ||
      record.hashtags.some((tag) => typeof tag !== "string" || !/^#[\p{L}\p{N}_]{1,50}$/u.test(tag)) ||
      new Set(record.hashtags.map((tag) => String(tag).toLocaleLowerCase())).size !== record.hashtags.length)
      return unavailableSuggestion("Suggested hashtags must be bounded, unique, and syntactically valid.");
  }
  const suggestion: AiDraftRevisionPresentationSuggestion = {
    schemaVersion: AI_DRAFT_REVISION_SUGGESTION_VERSION,
    ...(record.leadIn !== undefined ? { leadIn: record.leadIn as string } : {}),
    ...(record.callToAction !== undefined ? { callToAction: record.callToAction as string } : {}),
    ...(record.hashtags !== undefined ? { hashtags: Object.freeze([...(record.hashtags as string[])]) } : {}),
    ...(record.altText !== undefined ? { altText: record.altText as string } : {}),
    rationale: record.rationale,
  };
  return {
    status: "valid",
    suggestion: Object.freeze(suggestion),
    issues: Object.freeze([]),
    draftContentMutated: false,
    publishingAuthorized: false,
  };
}

function unavailableSuggestion(issue: string): AiDraftRevisionSuggestionParseResult {
  return {
    status: "unavailable",
    issues: Object.freeze([issue]),
    draftContentMutated: false,
    publishingAuthorized: false,
  };
}

export interface AiTextInvocationReconciliation {
  id: string;
  workspaceId: string;
  attemptId: string;
  reservationId: string;
  rateCardId: string;
  status: AiTextReconciliationStatus;
  reason?: "missing_usage" | "unsupported_rate_card" | "cost_exceeds_authorization";
  currency: string;
  actualCostMinor?: number;
  inputTokens?: number;
  outputTokens?: number;
  usageEventId?: string;
  reconciledByUserId: string;
  reconciledAt: string;
  createdAt: string;
  usageRecorded: boolean;
  reservationSettled: boolean;
  retryAllowed: false;
}

export interface AiTextInvocationResolution {
  id: string;
  workspaceId: string;
  attemptId: string;
  reservationId: string;
  reconciliationId?: string;
  provider: AiHostedProviderType;
  modelId: string;
  disposition: AiTextInvocationResolutionDisposition;
  providerChargeMinor?: number;
  currency: string;
  evidenceReference: string;
  resolutionNote: string;
  reservationPreviousStatus: "reserved" | "released" | "expired";
  reservationFinalStatus: "settled" | "released" | "expired";
  resolvedByUserId: string;
  resolvedAt: string;
  createdAt: string;
  usageUnitsKnown: false;
  retryAllowed: false;
  providerRequestRetried: false;
}

export interface AiTextDraftProposal {
  id: string;
  workspaceId: string;
  artifactId: string;
  attemptId: string;
  contentDraftId: string;
  sourceDraftVersionId: string;
  provider: AiHostedProviderType;
  modelId: string;
  characterCount: number;
  status: AiTextDraftProposalStatus;
  attachedByUserId: string;
  dismissedByUserId?: string;
  dismissalNote?: string;
  appliedByUserId?: string;
  applicationNote?: string;
  appliedVersionId?: string;
  selectedFields?: readonly ("lead_in" | "call_to_action" | "hashtags" | "alt_text")[];
  attachedAt: string;
  dismissedAt?: string;
  appliedAt?: string;
  updatedAt: string;
  sourceCurrent: boolean;
  outputEncrypted: true;
  outputReturned: false;
  draftContentMutated: boolean;
  publishingAuthorized: false;
  execution: false;
}

export interface AiAdapterIdentity {
  provider: string;
  model: string;
}

export interface AiProviderRateComponent {
  kind: AiRateComponentKind;
  unit: AiRateUnit;
  unitQuantity: number;
  priceMicros: number;
}

export interface AiProviderRateCard {
  id: string;
  provider: string;
  modelFamily: string;
  modelVersion: string;
  currency: string;
  minorUnitExponent: number;
  status: AiRateCardStatus;
  components: readonly AiProviderRateComponent[];
  effectiveFrom: string;
  effectiveTo?: string;
  sourceReference: string;
  sourceHash: string;
  verifiedAt: string;
  approvedAt?: string;
  createdAt: string;
}

export interface AiUsageQuantityForecast {
  kind: Exclude<AiRateComponentKind, "request">;
  unit: Exclude<AiRateUnit, "request">;
  minimumUnits: number;
  maximumUnits: number;
}

export interface AiCostQuoteLine {
  kind: AiRateComponentKind;
  unit: AiRateUnit;
  minimumUnits: number;
  maximumUnits: number;
  minimumCostMicros: number;
  maximumCostMicros: number;
}

export interface AiCostQuote {
  rateCardId: string;
  provider: string;
  modelFamily: string;
  modelVersion: string;
  currency: string;
  minorUnitExponent: number;
  lines: readonly AiCostQuoteLine[];
  minimumCostMinor: number;
  maximumCostMinor: number;
  quotedAt: string;
  expiresAt: string;
  rounding: "ceil_to_minor_unit";
  reservationRequired: boolean;
  reservationAuthorized: false;
  execution: false;
}

export interface AiStoredCostQuote extends AiCostQuote {
  id: string;
  workspaceId: string;
  campaignId?: string;
  capability: AiCapability;
  feature: string;
  forecasts: readonly AiUsageQuantityForecast[];
  quoteHash: string;
  createdBy: string;
  createdAt: string;
  reservationId?: string;
  status: "active" | "expired" | "consumed";
}

export interface AiProviderRateCardSummary {
  asOf: string;
  activeCardCount: number;
  currencies: readonly string[];
  latestVerifiedAt?: string;
  monetaryEstimateAvailable: false;
}

export interface AiRoutingRequest {
  capability: AiCapability;
  mode: AiMode;
  maximumPrivacyClass: AiPrivacyClass;
  estimatedInputUnits?: number;
  requiresTools?: boolean;
  preferredAdapter?: AiAdapterIdentity;
}

export interface AiRoutingDecision {
  status: "selected" | "unavailable";
  adapter?: AiProviderAdapterDescriptor;
  consideredAdapters: number;
  reasons: readonly string[];
  requiresApproval: boolean;
}

export interface AiUsageSummary {
  currency: string;
  currentMonthCostMinor: number;
  requestCount: number;
  inputUnits: number;
  outputUnits: number;
  cachedInputUnits: number;
  averageLatencyMs?: number;
  byFeature: readonly {
    feature: string;
    costMinor: number;
    requestCount: number;
  }[];
}

export interface AiSpendReservation {
  id: string;
  workspaceId: string;
  campaignId?: string;
  spendExceptionRequestId?: string;
  costQuoteId?: string;
  capability: AiCapability;
  feature: string;
  currency: string;
  estimatedCostMinor: number;
  actualCostMinor?: number;
  status: AiSpendReservationStatus;
  exceededScopes: readonly AiBudgetScope[];
  capBehavior: AiCapBehavior;
  requestedBy: string;
  resolvedBy?: string;
  expiresAt?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiBudgetScopeStatus {
  scope: AiBudgetScope;
  spentMinor: number;
  reservedMinor: number;
  capMinor?: number;
  availableMinor?: number;
}

export interface AiBudgetStatus {
  asOf: string;
  currency: string;
  daily: AiBudgetScopeStatus;
  monthly: AiBudgetScopeStatus;
  activeReservationCount: number;
  recentReservations: readonly AiSpendReservation[];
}

export interface AiBudgetAlert {
  id: string;
  workspaceId: string;
  campaignId?: string;
  sourceReservationId?: string;
  scope: AiBudgetScope;
  windowKey: string;
  thresholdPercentage: number;
  committedCostMinor: number;
  capMinor: number;
  currency: string;
  status: AiBudgetAlertStatus;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiSpendExceptionRequest {
  id: string;
  workspaceId: string;
  deniedReservationId: string;
  campaignId?: string;
  capability: AiCapability;
  feature: string;
  currency: string;
  estimatedCostMinor: number;
  exceededScopes: readonly AiBudgetScope[];
  capBehavior: AiCapBehavior;
  status: AiSpendExceptionStatus;
  justification: string;
  requestedBy: string;
  resolvedBy?: string;
  decisionNote?: string;
  expiresAt: string;
  resolvedAt?: string;
  consumedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiCapResponsePlan {
  deniedReservationId: string;
  capability: AiCapability;
  capBehavior: AiCapBehavior;
  status: "ready" | "unavailable";
  action: AiCapResponseAction;
  adapter?: AiProviderAdapterDescriptor;
  requiresApproval: boolean;
  requiresPaidReservation: false;
  limitations: readonly string[];
  reasons: readonly string[];
}

export interface AiAssistantProfile {
  id: AiAssistantProfileId;
  displayName: string;
  purpose: string;
  actions: readonly AiAssistantAction[];
  capabilities: readonly AiCapability[];
  outputKinds: readonly AiAssistantOutputKind[];
  executionAuthority: false;
}

export interface AiAssistantSelection {
  action: AiAssistantAction;
  profile: AiAssistantProfile;
  requiredCapability: AiCapability;
  status: "selected";
  automatic: boolean;
  executionAuthority: false;
  reasons: readonly string[];
}

export interface AiAssistantAssignment {
  workspaceId: string;
  action: AiAssistantAction;
  profileId: AiAssistantProfileId;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiRoutingPreference extends AiAdapterIdentity {
  workspaceId: string;
  action: AiAssistantAction;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiAnalysisCacheKey {
  workspaceId: string;
  capability: AiCapability;
  feature: string;
  contentHash: string;
  modelFamily: string;
  promptVersion: string;
  contextRevision: string;
}

export interface AiAnalysisCacheEntry<TResult = unknown>
  extends AiAnalysisCacheKey {
  result: TResult;
  resultHash: string;
  resultBytes: number;
  hitCount: number;
  createdBy: string;
  lastHitAt?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiAnalysisCacheSummary {
  asOf: string;
  activeEntryCount: number;
  totalResultBytes: number;
  totalHitCount: number;
  oldestEntryAt?: string;
  newestEntryAt?: string;
  lastHitAt?: string;
}

export interface AiAssistantWorkPlan {
  selection: AiAssistantSelection;
  routing: AiRoutingDecision;
  status: "ready" | "unavailable";
  estimatedCost?: AiCostLevel;
  currencyEstimateAvailable: false;
  execution: false;
  reasons: readonly string[];
}

export interface AiAssistantMeteringProfile {
  action: AiAssistantAction;
  capability: AiCapability;
  feature: string;
  version: string;
  inputTokens: Readonly<{ minimum: number; maximum: number }>;
  outputTokens: Readonly<{ minimum: number; maximum: number }>;
  execution: false;
}

interface AiAssistantCostPreviewBase {
  action: AiAssistantAction;
  capability: AiCapability;
  feature: string;
  profileVersion: string;
  forecasts: readonly AiUsageQuantityForecast[];
  reservationAuthorized: false;
  execution: false;
  reasons: readonly string[];
}

export type AiAssistantCostPreview =
  | (AiAssistantCostPreviewBase & {
      status: "quoted";
      rateCardId: string;
      currency: string;
      minorUnitExponent: number;
      minimumCostMinor: number;
      maximumCostMinor: number;
      quotedAt: string;
      expiresAt: string;
      reservationRequired: boolean;
      currencyEstimateAvailable: true;
      durableQuoteAvailable: true;
    })
  | (AiAssistantCostPreviewBase & {
      status: "unavailable";
      currencyEstimateAvailable: false;
      durableQuoteAvailable: false;
    });

export interface AiCostQuoteLedgerItem {
  id: string;
  campaignId?: string;
  capability: AiCapability;
  feature: string;
  currency: string;
  minorUnitExponent: number;
  minimumCostMinor: number;
  maximumCostMinor: number;
  quotedAt: string;
  expiresAt: string;
  status: "active" | "expired" | "consumed";
  reservationId?: string;
  reservationRequired: boolean;
  reservationAuthorized: false;
  execution: false;
}
