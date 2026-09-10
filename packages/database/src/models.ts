import type {
  AutonomyMode,
  ReadinessMode,
  SmartSource,
  SourceProvider,
  ContextAuthorityRule,
  ContextPack,
  ContextFactStatus,
  ContextSourceKind,
  ContentPackageStatus,
  ContentAssetRightsChannel,
  ContentAssetRightsStatus,
  EvidenceItem,
  ContentAsset,
  CampaignObjective,
  CampaignStatus,
  CampaignStep,
  CampaignStepStatus,
  CampaignVersion,
  Destination,
  InformationDepth,
  PromotionalStrength,
  AudienceProfile,
  AudienceProfileData,
  AudienceProfileVersion,
  AudienceType,
  BrandProfile,
  BrandProfileData,
  BrandProfileVersion,
  ContentDraftVersion,
  DraftStatus,
  DraftFormat,
  DraftChannelPreviewStatus,
  ContactPermission,
  RelationshipIdentity,
  RelationshipIdentityEvidenceKind,
  RelationshipIdentityGroupMember,
  RelationshipIdentityLink,
  RelationshipIdentityLinkStatus,
  RelationshipIdentityStatus,
  RelationshipRecord,
  RelationshipStage,
  ConversationMessage,
  ConversationMessageKind,
  ConversationSharedResource,
  ConversationSharedResourceKind,
  ConversationHandoffBrief,
  ConversationReviewRequest,
  ConversationResponseSuggestion,
  ConversationResponseDraft,
  ConversationDraftingPresence,
  ConversationStatus,
  ConversationThread,
  ConversationSentiment,
  ConversationIntent,
  ConversationServiceLevelState,
  ConversationUrgency,
  AiMode,
  AiPrivacyClass,
  AiFailoverMode,
  AiCapBehavior,
  AiCapability,
  AiUsageSummary,
  AiSpendReservation,
  AiBudgetAlert,
  AiSpendExceptionRequest,
  AiAssistantAssignment,
  AiAssistantAction,
  AiAssistantProfileId,
  AiRoutingPreference,
  AiProviderAdapterRegistryEntry,
  AiProviderConnection,
  AiHostedProviderType,
  AiProviderConnectionStatus,
  AiAnalysisCacheEntry,
  AiAnalysisCacheKey,
  AiProviderRateCard,
  AiStoredCostQuote,
  AiUsageQuantityForecast,
  AiTextInvocationIntent,
  AiTextInvocationAttempt,
  AiTextOutputArtifact,
  AiTextInvocationReconciliation,
  AiTextInvocationResolution,
  AiTextDraftProposal,
  AiWorkspaceExecutionControl,
  AiWorkspaceProviderCircuit,
  AiOperationalIncident,
  AiOperationalReadiness,
  AiOperationalIncidentType,
  AiOperationalIncidentResponsePolicy,
  AiOperationalAlertWebhook,
  AiOperationalAlertDelivery,
  AiOperationalAlertEventType,
  AiDraftRevisionGoal,
} from "@market-me/domain";

export const ORGANIZATION_ROLES = [
  "owner",
  "admin",
  "member",
  "viewer",
] as const;
export const WORKSPACE_ROLES = [
  "owner",
  "admin",
  "editor",
  "approver",
  "analyst",
  "viewer",
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
}

export interface StoredOidcAuthState {
  issuer: string;
  nonceHash: string;
  codeVerifier: string;
  returnTo: string;
}

export type OidcSignInResult =
  | { status: "authenticated" | "invited" | "bootstrapped"; user: AuthenticatedUser }
  | { status: "not_provisioned" };

export type WorkspaceInvitationRole = Exclude<WorkspaceRole, "owner">;

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceInvitationRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  invitedBy: string;
  acceptedBy?: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface WorkspaceAccess {
  workspaceId: string;
  organizationId: string;
  workspaceName: string;
  role: WorkspaceRole;
}

export interface WorkspaceMember {
  userId: string;
  displayName: string;
  role: WorkspaceRole;
  assignableToConversations: boolean;
}

export interface WorkspaceAiPolicyWrite {
  workspaceId: string;
  mode: AiMode;
  maximumPrivacyClass: AiPrivacyClass;
  failoverMode: AiFailoverMode;
  capBehavior: AiCapBehavior;
  currency: string;
  dailyBudgetMinor?: number;
  campaignBudgetMinor?: number;
  monthlyBudgetMinor?: number;
  alertThresholdPercentages: readonly number[];
}

export interface StoredWorkspaceAiPolicy extends WorkspaceAiPolicyWrite {
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceAiAssistantAssignmentsWrite {
  workspaceId: string;
  assignments: readonly {
    action: AiAssistantAction;
    profileId: AiAssistantProfileId;
  }[];
}

export type StoredAiAssistantAssignment = AiAssistantAssignment;

export interface WorkspaceAiRoutingPreferencesWrite {
  workspaceId: string;
  preferences: readonly {
    action: AiAssistantAction;
    provider: string;
    model: string;
  }[];
}

export type StoredAiRoutingPreference = AiRoutingPreference;

export type StoredAiProviderAdapter = AiProviderAdapterRegistryEntry;

export interface AiProviderConnectionSecretWrite {
  workspaceId: string;
  provider: AiHostedProviderType;
  encryptedCredential: string;
  credentialFingerprint: string;
  encryptionKeyVersion: "v1";
}

export interface StoredAiProviderConnection extends AiProviderConnection {
  encryptedCredential?: string;
  credentialFingerprint?: string;
  encryptionKeyVersion?: "v1";
}

export interface AiProviderConnectionVerificationTarget {
  workspaceId: string;
  provider: AiHostedProviderType;
  status: AiProviderConnectionStatus;
  encryptedCredential: string;
  credentialFingerprint: string;
  encryptionKeyVersion: "v1";
}

export interface AiProviderConnectionVerificationWrite {
  workspaceId: string;
  provider: AiHostedProviderType;
  expectedCredentialFingerprint: string;
  status: "verified" | "error";
  lastError?: string;
}

export interface AiProviderModelDiscoveryWrite {
  workspaceId: string;
  provider: AiHostedProviderType;
  expectedCredentialFingerprint: string;
  models: readonly {
    modelId: string;
    displayName?: string;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    providerCreatedAt?: string;
  }[];
}

export interface AiWorkspaceAdapterCandidateWrite {
  workspaceId: string;
  provider: AiHostedProviderType;
  modelId: string;
  displayName: string;
  capabilities: readonly AiCapability[];
  quality: "standard" | "enhanced" | "highest";
  speed: "fast" | "balanced" | "thorough";
  cost: "low" | "medium" | "high";
  contextLimit: number;
  evidenceReference: string;
  evidenceSha256: string;
}

export interface AiWorkspaceAdapterCandidateDecisionWrite {
  workspaceId: string;
  candidateId: string;
  decision: "approved" | "rejected";
  reviewNote: string;
}

export interface AiWorkspaceAdapterRegistrationWrite {
  workspaceId: string;
  candidateId: string;
}

export interface AiWorkspaceAdapterRegistrationRetirementWrite {
  workspaceId: string;
  registrationId: string;
  retirementReason: string;
}

export interface AiWorkspaceAdapterRateBindingWrite {
  workspaceId: string;
  registrationId: string;
  rateCardId: string;
}

export interface AiWorkspaceAdapterRateBindingRetirementWrite {
  workspaceId: string;
  bindingId: string;
  retirementReason: string;
}

export interface AiWorkspaceAdapterInvocationBindingWrite {
  workspaceId: string;
  registrationId: string;
  rateBindingId: string;
  contractId: string;
}

export interface AiWorkspaceAdapterInvocationBindingRetirementWrite {
  workspaceId: string;
  bindingId: string;
  retirementReason: string;
}

export interface AiWorkspaceAdapterHealthProbeTarget {
  workspaceId: string;
  invocationBindingId: string;
  provider: "openai" | "anthropic" | "google_generative_ai";
  encryptedCredential: string;
  credentialFingerprint: string;
  contractSourceHash: string;
}

export interface AiWorkspaceAdapterHealthObservationWrite {
  workspaceId: string;
  invocationBindingId: string;
  provider: "openai" | "anthropic" | "google_generative_ai";
  expectedCredentialFingerprint: string;
  expectedContractSourceHash: string;
  status: "healthy" | "unhealthy";
  failureCode?:
    | "credential_rejected"
    | "rate_limited"
    | "provider_unavailable"
    | "unexpected_response";
  safeMessage?: string;
}

export interface AiAnalysisCacheWrite<
  TResult = unknown,
> extends AiAnalysisCacheKey {
  result: TResult;
  ttlSeconds: number;
}

export type StoredAiAnalysisCacheEntry<TResult = unknown> =
  AiAnalysisCacheEntry<TResult>;

export type StoredAiProviderRateCard = AiProviderRateCard;

export interface AiCostQuoteWrite {
  workspaceId: string;
  campaignId?: string;
  rateCardId: string;
  capability: AiCapability;
  feature: string;
  forecasts: readonly AiUsageQuantityForecast[];
}

export interface AiQuotedSpendReservationWrite {
  workspaceId: string;
  quoteId: string;
  idempotencyKey: string;
}

export type StoredAiCostQuote = AiStoredCostQuote;

export interface AiUsageEventWrite {
  id?: string;
  workspaceId: string;
  campaignId?: string;
  capability: AiCapability;
  feature: string;
  provider: string;
  model: string;
  privacyClass: AiPrivacyClass;
  inputUnits: number;
  outputUnits: number;
  cachedInputUnits: number;
  requestCount?: number;
  latencyMs: number;
  estimatedCostMinor: number;
  currency: string;
  promptVersion?: string;
  contextRevision?: string;
  contentHash?: string;
  occurredAt?: string;
}

export interface StoredAiUsageEvent
  extends
    Required<Pick<AiUsageEventWrite, "id" | "requestCount" | "occurredAt">>,
    Omit<AiUsageEventWrite, "id" | "requestCount" | "occurredAt"> {
  createdAt: string;
}

export type WorkspaceAiUsageSummary = AiUsageSummary;

export interface AiSpendReservationWrite {
  workspaceId: string;
  campaignId?: string;
  idempotencyKey: string;
  capability: AiCapability;
  feature: string;
  currency: string;
  estimatedCostMinor: number;
}

export type StoredAiSpendReservation = AiSpendReservation;
export type StoredAiTextInvocationIntent = AiTextInvocationIntent;
export type StoredAiTextInvocationAttempt = AiTextInvocationAttempt;
export type StoredAiTextOutputArtifact = AiTextOutputArtifact;
export type StoredAiTextInvocationReconciliation =
  AiTextInvocationReconciliation;
export type StoredAiTextInvocationResolution = AiTextInvocationResolution;
export type StoredAiTextDraftProposal = AiTextDraftProposal;
export type StoredAiWorkspaceExecutionControl = AiWorkspaceExecutionControl;
export type StoredAiWorkspaceProviderCircuit = AiWorkspaceProviderCircuit;
export type StoredAiOperationalIncident = AiOperationalIncident;
export type StoredAiOperationalReadiness = AiOperationalReadiness;
export type StoredAiOperationalIncidentResponsePolicy =
  AiOperationalIncidentResponsePolicy;
export type StoredAiOperationalAlertWebhook = AiOperationalAlertWebhook;
export type StoredAiOperationalAlertDelivery = AiOperationalAlertDelivery;

export interface AiWorkspaceExecutionControlWrite {
  workspaceId: string;
  state: "stopped" | "enabled";
  reason: string;
  enabledForMinutes?: number;
}

export interface AiWorkspaceProviderCircuitResetWrite {
  workspaceId: string;
  provider: AiHostedProviderType;
  resetNote: string;
}

export interface AiOperationalIncidentAcknowledgeWrite {
  workspaceId: string;
  type: AiOperationalIncidentType;
  attemptId: string;
  acknowledgementNote: string;
}

export interface AiOperationalIncidentResponsePolicyWrite {
  workspaceId: string;
  criticalAcknowledgementMinutes: number;
  highAcknowledgementMinutes: number;
  criticalResolutionMinutes: number;
  highResolutionMinutes: number;
  runbookUrl: string;
}

export interface AiOperationalAlertWebhookWrite {
  workspaceId: string;
  endpointUrl: string;
  encryptedSigningSecret: string;
  secretFingerprint: string;
  encryptionKeyVersion: "v1";
}

export interface AiOperationalAlertWebhookVerificationTarget {
  workspaceId: string;
  endpointUrl: string;
  encryptedSigningSecret: string;
  secretFingerprint: string;
  encryptionKeyVersion: "v1";
}

export interface AiOperationalAlertWebhookVerificationWrite {
  workspaceId: string;
  expectedSecretFingerprint: string;
  status: "verified" | "error";
  safeError?: string;
}

export interface AiOperationalAlertDeliveryTarget {
  id: string;
  workspaceId: string;
  endpointUrl: string;
  encryptedSigningSecret: string;
  secretFingerprint: string;
  encryptionKeyVersion: "v1";
  eventType: AiOperationalAlertEventType;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: string;
  attemptCount: number;
}

export interface AiOperationalAlertDeliveryOutcomeWrite {
  deliveryId: string;
  workspaceId: string;
  attemptCount: number;
  outcome:
    | { status: "delivered"; responseStatus: number }
    | {
        status: "failed";
        retryable: boolean;
        responseStatus?: number;
        safeError: string;
      };
}

export interface AiTextInvocationAttemptClaimWrite {
  workspaceId: string;
  intentId: string;
  userText: string;
  systemText?: string;
}

export interface AiTextInvocationAttemptTarget {
  attemptId: string;
  workspaceId: string;
  intentId: string;
  provider: "openai" | "anthropic" | "google_generative_ai";
  modelId: string;
  maxOutputTokens: number;
  encryptedCredential: string;
  credentialFingerprint: string;
  contractSourceHash: string;
}

export interface AiTextInvocationAttemptOutcomeWrite {
  workspaceId: string;
  attemptId: string;
  expectedCredentialFingerprint: string;
  expectedContractSourceHash: string;
  outcome:
    | {
        status: "succeeded";
        outputText: string;
        encryptedOutput: string;
        encryptionKeyVersion: "v1";
        responseId?: string;
        stopReason:
          "completed" | "max_output" | "refusal" | "blocked" | "unknown";
        inputTokens?: number;
        outputTokens?: number;
        latencyMs: number;
      }
    | {
        status: "failed" | "ambiguous";
        failureCode: "credential_unavailable" | "provider_outcome_unknown";
        safeMessage: string;
      };
}

export interface AiTextInvocationResolutionWrite {
  workspaceId: string;
  attemptId: string;
  disposition: "confirmed_no_charge" | "settled_provider_charge";
  providerChargeMinor?: number;
  evidenceReference: string;
  resolutionNote: string;
}

export interface AiTextOutputArtifactReviewWrite {
  workspaceId: string;
  artifactId: string;
  decision: "accepted" | "discarded";
  reviewNote: string;
}

export interface AiTextOutputArtifactReadTarget {
  id: string;
  workspaceId: string;
  status: "pending_review" | "accepted";
  encryptedOutput: string;
  encryptionKeyVersion: "v1";
}

export interface AiTextDraftProposalAttachWrite {
  workspaceId: string;
  artifactId: string;
  contentDraftId: string;
}

export interface AiTextDraftProposalDismissWrite {
  workspaceId: string;
  proposalId: string;
  dismissalNote: string;
}

export interface AiTextDraftProposalApplyWrite {
  workspaceId: string;
  proposalId: string;
  leadIn: string;
  callToAction?: string;
  hashtags: readonly string[];
  altText?: string;
  changeNote: string;
}

export interface AiTextDraftProposalReadTarget {
  id: string;
  workspaceId: string;
  contentDraftId: string;
  encryptedOutput: string;
  encryptionKeyVersion: "v1";
  productPromptVersion?: string;
  productBound: boolean;
}

export interface AiTextInvocationIntentWrite {
  workspaceId: string;
  invocationBindingId: string;
  reservationId: string;
  idempotencyKey: string;
  userText: string;
  systemText?: string;
  maxOutputTokens: number;
  draftRevision?: {
    contentDraftId: string;
    contentDraftVersionId: string;
    goal: AiDraftRevisionGoal;
    promptVersion: string;
    contextSha256: string;
  };
}

export interface AiDraftRevisionIntentWrite {
  workspaceId: string;
  contentDraftId: string;
  invocationBindingId: string;
  reservationId: string;
  idempotencyKey: string;
  goal: AiDraftRevisionGoal;
  maxOutputTokens: number;
}

export interface AiDraftRevisionPromptTarget {
  workspaceId: string;
  contentDraftId: string;
  contentDraftVersionId: string;
  goal: AiDraftRevisionGoal;
  promptVersion: string;
  contextSha256: string;
  systemText: string;
  userText: string;
}

export interface PreparedAiDraftRevisionIntent {
  intent: StoredAiTextInvocationIntent;
  prompt: AiDraftRevisionPromptTarget;
}

export interface AiTextInvocationIntentCancelWrite {
  workspaceId: string;
  intentId: string;
  reason: string;
}
export type StoredAiBudgetAlert = AiBudgetAlert;
export type StoredAiSpendExceptionRequest = AiSpendExceptionRequest;

export interface AiSpendExceptionRequestWrite {
  workspaceId: string;
  deniedReservationId: string;
  justification: string;
}

export interface AiSpendSettlementWrite {
  workspaceId: string;
  reservationId: string;
  actualCostMinor: number;
  usage: Omit<
    AiUsageEventWrite,
    | "id"
    | "workspaceId"
    | "campaignId"
    | "capability"
    | "feature"
    | "estimatedCostMinor"
    | "currency"
    | "occurredAt"
  > & { occurredAt?: string };
}

export interface SmartSourceWrite {
  workspaceId: string;
  storageConnectionId?: string;
  name: string;
  provider: SourceProvider;
  locations: readonly { providerLocationId: string; displayPath: string }[];
  recursive: boolean;
  readinessMode: ReadinessMode;
  stabilizationWindowSeconds: number;
  relatedFileMinimum?: number;
  readyMarker?: string;
  aiConfidenceThreshold?: number;
  allowedMimeTypes: readonly string[];
  ignorePatterns: readonly string[];
  contextPackIds: readonly string[];
  autonomyMode: AutonomyMode;
  enabled: boolean;
}

export interface SmartSourceTestResult {
  id: string;
  smartSourceId: string;
  status: "passed" | "warning" | "failed";
  matchedCount: number;
  ignoredCount: number;
  diagnostics: readonly {
    code: string;
    message: string;
    severity: "info" | "warning" | "error";
  }[];
  createdAt: string;
}

export interface StorageConnectionRecord {
  id: string;
  workspaceId: string;
  provider: Exclude<SourceProvider, "local">;
  displayName: string;
  providerAccountId?: string;
  status: "active" | "needs_reauthorization" | "revoked" | "error";
  scopes: readonly string[];
  accessTokenExpiresAt?: string;
}

export interface StorageConnectionSecrets extends StorageConnectionRecord {
  encryptedAccessToken: string;
  encryptedRefreshToken?: string;
}

export interface SourceItemWrite {
  workspaceId: string;
  smartSourceId: string;
  providerItemId: string;
  providerParentId?: string;
  name: string;
  displayPath: string;
  mimeType: string;
  isFolder: boolean;
  sizeBytes?: number;
  modifiedAt?: string;
  contentHash?: string;
  providerEtag?: string;
  webUrl?: string;
  objectKey?: string;
}

export interface SourceItemRecord extends SourceItemWrite {
  id: string;
  deletedAt?: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ConnectorCursorRecord {
  storageConnectionId: string;
  scopeKey: string;
  cursor: string;
  cursorKind: "google_page_token" | "microsoft_delta_link";
  lastSyncedAt?: string;
}

export interface WebhookSubscriptionTarget {
  workspaceId: string;
  storageConnectionId: string;
  provider: Exclude<SourceProvider, "local">;
  resource: string;
}

export interface WebhookSubscriptionRecord extends WebhookSubscriptionTarget {
  id: string;
  providerSubscriptionId: string;
  providerResourceId?: string;
  clientStateHash: string;
  expiresAt: string;
  status: "active" | "renewing" | "expired" | "revoked" | "error";
  lastNotificationAt?: string;
  renewalAttemptCount: number;
  lastError?: string;
}

export interface WebhookEventRecord {
  id: string;
  webhookSubscriptionId: string;
  storageConnectionId: string;
  workspaceId: string;
  provider: Exclude<SourceProvider, "local">;
  providerEventId: string;
  eventKind: string;
  payload: Record<string, unknown>;
  attemptCount: number;
}

export interface ContextPackSourceWrite {
  clientKey: string;
  kind: ContextSourceKind;
  sourceItemId?: string;
  label: string;
  sourceReference: string;
  selectedSections: readonly string[];
  authorityRank: number;
  contentText?: string;
  contentHash?: string;
}

export interface ContextPackFactWrite {
  factKey: string;
  value: unknown;
  sourceClientKey?: string;
  confidence?: number;
  status: ContextFactStatus;
  notes?: string;
}

export interface ContextPackDraftWrite {
  workspaceId: string;
  name: string;
  description: string;
  instructions: string;
  authorityRules: readonly ContextAuthorityRule[];
  sources: readonly ContextPackSourceWrite[];
  facts: readonly ContextPackFactWrite[];
}

export interface StoredContextPack extends ContextPack {
  createdBy: string;
}

export interface BrandProfileDraftWrite {
  workspaceId: string;
  name: string;
  description: string;
  profile: BrandProfileData;
  informationDepthDefault?: InformationDepth;
  informationDepthCeiling?: Exclude<InformationDepth, "custom">;
  promotionalStrengthDefault?: PromotionalStrength;
  promotionalStrengthCeiling?: Exclude<PromotionalStrength, "custom">;
}

export interface AudienceProfileDraftWrite {
  workspaceId: string;
  name: string;
  description: string;
  audienceType: AudienceType;
  profile: AudienceProfileData;
  informationDepthDefault?: InformationDepth;
  informationDepthCeiling?: Exclude<InformationDepth, "custom">;
  promotionalStrengthDefault?: PromotionalStrength;
  promotionalStrengthCeiling?: Exclude<PromotionalStrength, "custom">;
}

export interface StoredBrandProfile extends BrandProfile {
  createdBy: string;
}
export interface StoredAudienceProfile extends AudienceProfile {
  createdBy: string;
}
export type StoredBrandProfileVersion = BrandProfileVersion;
export type StoredAudienceProfileVersion = AudienceProfileVersion;

export interface StoredDraftGeneration {
  id: string;
  workspaceId: string;
  campaignVersionId: string;
  contentPackageId: string;
  contentPackageVersion: number;
  brandProfileVersionId?: string;
  informationDepth: InformationDepth;
  promotionalStrength: PromotionalStrength;
  evidenceSnapshot: readonly {
    id: string;
    factKey?: string;
    claim: string;
    provenance: EvidenceItem["provenance"];
    sourceReferences: readonly string[];
    confidence?: number;
  }[];
  generatorProvider: string;
  generatorModel: string;
  generatorVersion: string;
  promptVersion: string;
  draftFormat: DraftFormat;
  createdBy: string;
  createdAt: string;
}

export interface StoredContentDraft {
  id: string;
  workspaceId: string;
  draftGenerationId: string;
  audienceProfileVersionId?: string;
  audienceName?: string;
  campaignName: string;
  packageTitle: string;
  status: DraftStatus;
  currentVersion: ContentDraftVersion;
  generation: StoredDraftGeneration;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredContentDraftApproval {
  id: string;
  workspaceId: string;
  contentDraftId: string;
  contentDraftVersionId: string;
  status:
    "pending" | "approved" | "rejected" | "changes_requested" | "canceled";
  requestSnapshot: Readonly<Record<string, unknown>>;
  requestedBy: string;
  assignedReviewerId?: string;
  decidedBy?: string;
  decisionNotes?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface StoredDraftChannelPreview {
  id: string;
  workspaceId: string;
  contentDraftId: string;
  contentDraftVersionId: string;
  channelConnectionId: string;
  channelConnectionName: string;
  destinationId?: string;
  destinationTitle?: string;
  linkMode: "canonical" | "tracked";
  trackedLinkId?: string;
  trackedLinkSlug?: string;
  trackedLinkStatus?: "active" | "disabled" | "expired";
  provider: string;
  capabilityVersion: string;
  capabilityObservedAt: string;
  status: DraftChannelPreviewStatus;
  renderedContent: string;
  renderedSubject?: string;
  subjectCount?: number;
  subjectLimit?: number;
  characterCount: number;
  characterLimit?: number;
  validationIssues: readonly { code: string; message: string }[];
  capabilitySnapshot: Readonly<Record<string, unknown>>;
  assets: readonly StoredDraftPreviewAsset[];
  isStale: boolean;
  createdBy: string;
  createdAt: string;
}

export interface StoredDraftPreviewAsset {
  contentAssetId: string;
  sortOrder: number;
  sourceAssetId?: string;
  objectKey: string;
  contentHash: string;
  fileName: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  byteSize: number;
  altText?: string;
  altTextStatus: "approved" | "decorative";
  scanStatus: "clean" | "not_configured";
  scanRevision: number;
  scanScannedAt?: string;
  rightsStatus: "cleared" | "unchecked";
  rightsRevision: number;
  rightsReviewedAt?: string;
  rightsExpiresAt?: string;
  rightsChannelConnectionId?: string;
  rightsCampaignId?: string;
  rightsBrandProfileId?: string;
}

export interface StoredCampaignPreviewOption extends StoredDraftChannelPreview {
  campaignId: string;
  sourceCampaignVersionId: string;
  sourceCampaignVersionNumber: number;
  draftHeadline: string;
  audienceName?: string;
  isCurrentApprovedVersion: boolean;
}

export interface IngestionWorkItem {
  id: string;
  workspaceId: string;
  smartSourceId: string;
  storageConnectionId?: string;
  providerItemId: string;
  eventKind: "discovered" | "changed" | "deleted" | "reconciled";
  attemptCount: number;
}

export interface ContentPackageWrite {
  workspaceId: string;
  smartSourceId: string;
  rootSourceItemId: string;
  title: string;
  status: ContentPackageStatus;
  confidence?: number;
  contextPackVersionIds: readonly string[];
  assets: readonly (Omit<ContentAsset, "id" | "sourceAssetId"> & {
    clientKey?: string;
    sourceAssetClientKey?: string;
    sourceItemId?: string;
    extractedText?: string;
    extractionStatus: "pending" | "completed" | "skipped" | "failed";
    extractionError?: string;
    metadata: Record<string, unknown>;
  })[];
  evidence: readonly EvidenceItem[];
  conflicts: readonly {
    factKey: string;
    candidateEvidenceIds: readonly string[];
  }[];
}

export interface StoredContentPackage {
  id: string;
  workspaceId: string;
  smartSourceId: string;
  rootSourceItemId: string;
  title: string;
  status: ContentPackageStatus;
  confidence?: number;
  contextPackVersionIds: readonly string[];
  version: number;
  assets: readonly (ContentAsset & {
    sourceItemId?: string;
    extractedText?: string;
    extractionStatus: "pending" | "completed" | "skipped" | "failed";
    extractionError?: string;
    metadata: Record<string, unknown>;
  })[];
  evidence: readonly EvidenceItem[];
  conflicts: readonly {
    id: string;
    factKey: string;
    candidateEvidenceIds: readonly string[];
    status: "open" | "resolved" | "dismissed";
    resolutionEvidenceId?: string;
    resolutionNote?: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface ContentAssetRightsReviewWrite {
  workspaceId: string;
  packageId: string;
  assetId: string;
  status: Extract<ContentAssetRightsStatus, "cleared" | "restricted">;
  owner: string;
  licenseOwner?: string;
  sourceReference: string;
  proofReference: string;
  commercialUseAllowed: boolean;
  derivativeUseAllowed: boolean;
  worldwideUseAllowed: boolean;
  permittedChannels: readonly ContentAssetRightsChannel[];
  permittedChannelConnectionIds: readonly string[];
  permittedCampaignIds: readonly string[];
  permittedBrandProfileIds: readonly string[];
  validFrom?: string;
  expiresAt?: string;
  attributionRequirement?: string;
  watermarkRequirement?: string;
  disclaimerRequirement?: string;
  reviewNote: string;
}

export interface StoredContentAssetForAccess {
  id: string;
  contentPackageId: string;
  objectKey: string;
  mimeType: string;
  fileName: string;
  byteSize?: number;
}

export interface StoredSmartSource extends SmartSource {
  storageConnectionId?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DestinationWrite {
  workspaceId: string;
  provider: string;
  externalId?: string;
  canonicalUrl: string;
  knownRedirects: readonly string[];
  title: string;
  description: string;
  contentType: string;
  ownerUserId?: string;
  identifiers: Readonly<Record<string, string>>;
  topics: readonly string[];
  audiences: readonly string[];
  geography: readonly string[];
  language?: string;
  status: Destination["status"];
  availableAt?: string;
  expiresAt?: string;
  replacementDestinationId?: string;
  tracking: Readonly<Record<string, unknown>>;
}

export interface StoredDestination extends Destination {
  ownerUserId?: string;
  tracking: Readonly<Record<string, unknown>>;
  createdBy: string;
}

export interface RelationshipIdentityWrite {
  id?: string;
  provider: string;
  providerSubjectId: string;
  displayHandle?: string;
  profileUrl?: string;
  status: RelationshipIdentityStatus;
  confidence?: number;
}

export interface RelationshipWrite {
  workspaceId: string;
  displayName: string;
  organizationName?: string;
  stage: RelationshipStage;
  contactPermission: ContactPermission;
  assignedOwnerId?: string;
  observedInterests: readonly string[];
  sharedTopics: readonly string[];
  preferredTone?: string;
  notes: string;
  suppressionReason?: string;
  identities: readonly RelationshipIdentityWrite[];
}

export interface StoredRelationship extends RelationshipRecord {
  identities: readonly RelationshipIdentity[];
  effectiveContactPermission: ContactPermission;
  createdBy: string;
}

export interface RelationshipIdentityLinkWrite {
  workspaceId: string;
  relationshipId: string;
  candidateRelationshipId: string;
  evidenceKind: RelationshipIdentityEvidenceKind;
  confidence: number;
  initialStatus: Extract<
    RelationshipIdentityLinkStatus,
    "suggested" | "confirmed"
  >;
}

export interface RelationshipIdentityLinkDecision {
  workspaceId: string;
  relationshipId: string;
  linkId: string;
  status: Extract<RelationshipIdentityLinkStatus, "confirmed" | "dismissed">;
}

export interface StoredRelationshipIdentityLink extends RelationshipIdentityLink {
  relationshipAName: string;
  relationshipBName: string;
  suggestedByName: string;
  reviewedByName?: string;
}

export interface StoredRelationshipIdentityResolution {
  relationshipId: string;
  effectiveContactPermission: ContactPermission;
  members: readonly RelationshipIdentityGroupMember[];
  links: readonly StoredRelationshipIdentityLink[];
}

export interface RelationshipIdentityCandidateScanResult {
  scannedIdentityCount: number;
  matchedPairCount: number;
  createdSuggestionCount: number;
  skippedExistingCount: number;
  ambiguousSignalCount: number;
  scanTruncated: boolean;
  suggestions: readonly StoredRelationshipIdentityLink[];
}

export interface ConversationThreadWrite {
  workspaceId: string;
  relationshipId: string;
  campaignId?: string | null;
  destinationId?: string | null;
  brandProfileId?: string | null;
  channelConnectionId?: string | null;
  publicationActionId?: string | null;
  provider: string;
  providerThreadId?: string;
  subject: string;
  status: ConversationStatus;
  sentiment?: ConversationSentiment;
  intent?: ConversationIntent;
  urgency?: ConversationUrgency;
  assignedOwnerId?: string;
  responseDueAt?: string;
  followUpAt?: string;
}

export interface ConversationThreadQuery {
  search?: string;
  campaignId?: string;
  destinationId?: string;
  brandProfileId?: string;
  channelConnectionId?: string;
  publicationActionId?: string;
  provider?: string;
  status?: ConversationStatus;
  sentiment?: ConversationSentiment;
  intent?: ConversationIntent;
  urgency?: ConversationUrgency;
  assignedOwnerId?: string | null;
  handoff?: "open" | "none";
  deadline?: "overdue" | "upcoming" | "none";
  unread?: boolean;
  activityFrom?: string;
  activityTo?: string;
  limit?: number;
}

export interface ConversationHandoffWrite {
  workspaceId: string;
  conversationThreadId: string;
  contactSummary: string;
  importance: string;
  requestOrOffer: string;
  priorResponseSummary: string;
  relevantContext: string;
  suggestedResponse: string;
  dueAt?: string;
}

export interface ConversationReviewRequestWrite {
  workspaceId: string;
  conversationThreadId: string;
  sourceMessageId?: string;
  requestText: string;
  dueAt?: string;
  requestedReviewerId: string;
  mentionedUserIds: readonly string[];
}

export interface ConversationReviewMention {
  userId: string;
  displayName: string;
}

export type StoredConversationResponseSuggestion =
  ConversationResponseSuggestion;

export interface ConversationResponseSuggestionDecision {
  workspaceId: string;
  conversationThreadId: string;
  status: "dismissed";
}

export interface ConversationResponseDraftWrite {
  workspaceId: string;
  conversationThreadId: string;
  body: string;
  sourceSuggestionId?: string;
}

export interface StoredConversationComposerState {
  draft?: ConversationResponseDraft;
  presences: readonly ConversationDraftingPresence[];
}

export interface StoredConversationReviewRequest extends ConversationReviewRequest {
  requestedByDisplayName: string;
  requestedReviewerDisplayName: string;
  mentionedMembers: readonly ConversationReviewMention[];
}

export interface ConversationMessageWrite {
  workspaceId: string;
  conversationThreadId: string;
  providerMessageId?: string;
  kind: ConversationMessageKind;
  body: string;
  authorDisplay?: string;
  occurredAt: string;
  metadata: Readonly<Record<string, unknown>>;
}

export type ConversationSharedResourceWrite = {
  workspaceId: string;
  conversationThreadId: string;
  idempotencyKey: string;
  observedAt: string;
} & (
  | {
      kind: "destination";
      destinationId: string;
    }
  | {
      kind: "publication";
      publicationActionId: string;
    }
);

export interface StoredConversationSharedResource extends ConversationSharedResource {
  destinationTitle?: string;
  destinationCanonicalUrl?: string;
  channelConnectionName?: string;
  publicationExternalId?: string;
  publicationStatus?: string;
  sourceThreadSubject: string;
  isCurrentThread: boolean;
}

export interface ConversationRoutingRuleWrite {
  workspaceId: string;
  name: string;
  enabled: boolean;
  priority: number;
  brandProfileId?: string;
  channelConnectionId?: string;
  relationshipStage?: RelationshipStage;
  intent?: ConversationIntent;
  urgency?: ConversationUrgency;
  targetOwnerId?: string;
  targetStatus: ConversationStatus;
}

export interface StoredConversationRoutingRule extends ConversationRoutingRuleWrite {
  id: string;
  brandProfileName?: string;
  channelConnectionName?: string;
  targetOwnerDisplayName?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationRoutingSuggestion {
  ruleId: string;
  ruleName: string;
  priority: number;
  matchedOn: readonly (
    "brand" | "account" | "relationship_stage" | "intent" | "urgency"
  )[];
  targetOwnerId?: string;
  targetOwnerDisplayName?: string;
  targetStatus: ConversationStatus;
}

export interface ConversationServiceLevelPolicyWrite {
  workspaceId: string;
  timezone: string;
  businessDaysMask: number;
  businessStartTime: string;
  businessEndTime: string;
  unknownTargetMinutes: number;
  lowTargetMinutes: number;
  normalTargetMinutes: number;
  highTargetMinutes: number;
  criticalTargetMinutes: number;
  atRiskBeforeMinutes: number;
  escalationAfterMinutes: number;
}

export interface StoredConversationServiceLevelPolicy extends ConversationServiceLevelPolicyWrite {
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationRetentionPolicyWrite {
  workspaceId: string;
  enabled: boolean;
  standardDays: number;
  personalMessageDays: number;
  importedEmailDays: number;
}

export interface StoredConversationRetentionPolicy extends ConversationRetentionPolicyWrite {
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationRetentionErasureRequestWrite {
  workspaceId: string;
  conversationThreadId: string;
  requestNote: string;
}

export interface ConversationRetentionErasureDecisionWrite {
  workspaceId: string;
  requestId: string;
  decision: "execute" | "reject";
  decisionNote: string;
}

export interface ConversationLegalHoldWrite {
  workspaceId: string;
  conversationThreadId: string;
  reason: string;
  caseReference?: string;
}

export interface ConversationLegalHoldReleaseRequestWrite {
  workspaceId: string;
  legalHoldCaseId: string;
  targetRetentionClass: "standard" | "personal_message" | "imported_email";
  requestNote: string;
}

export interface ConversationLegalHoldReleaseDecisionWrite {
  workspaceId: string;
  requestId: string;
  decision: "approve" | "reject";
  decisionNote: string;
}

export interface ConversationServiceLevelSummary {
  startedAt: string;
  dueAt: string;
  source: "manual" | "workspace_policy";
  state: ConversationServiceLevelState;
}

export interface StoredConversationThread extends ConversationThread {
  relationshipDisplayName: string;
  relationshipStage: RelationshipStage;
  contactPermission: ContactPermission;
  priorThreadCount: number;
  priorMessageCount: number;
  lastPriorInteractionAt?: string;
  sharedResourceHistoryCount: number;
  recentSharedResources: readonly StoredConversationSharedResource[];
  routingSuggestion?: ConversationRoutingSuggestion;
  serviceLevel?: ConversationServiceLevelSummary;
  campaignName?: string;
  destinationTitle?: string;
  brandProfileName?: string;
  brandProfileStatus?: string;
  channelConnectionName?: string;
  channelProvider?: string;
  publicationExternalId?: string;
  publicationStatus?: string;
  assignedOwnerDisplayName?: string;
  messageCount: number;
  latestMessage?: ConversationMessage;
  messages: readonly ConversationMessage[];
  handoffs: readonly ConversationHandoffBrief[];
  activeHandoff?: ConversationHandoffBrief;
  openReviewRequestCount: number;
  reviewRequests: readonly StoredConversationReviewRequest[];
  unreadCount: number;
  lastReadAt?: string;
  createdBy: string;
}

export interface ConversationChannelOption {
  id: string;
  name: string;
  provider: string;
  status: string;
}

export interface ConversationBrandOption {
  id: string;
  name: string;
  status: string;
}

export interface ConversationPublicationOption {
  id: string;
  channelConnectionId: string;
  channelConnectionName: string;
  provider: string;
  providerExternalId?: string;
  status: string;
  startedAt: string;
}

export interface ConversationContextDirectory {
  brands: readonly ConversationBrandOption[];
  channels: readonly ConversationChannelOption[];
  publications: readonly ConversationPublicationOption[];
}

export interface CampaignStepWrite extends Omit<CampaignStep, "outputs"> {
  outputs?: Readonly<Record<string, unknown>>;
}

export interface CampaignDraftWrite {
  workspaceId: string;
  name: string;
  description: string;
  objective: CampaignObjective;
  contentPackageIds: readonly string[];
  destinationId?: string;
  brandProfileVersionId?: string;
  audienceProfileVersionIds: readonly string[];
  informationDepth: InformationDepth;
  promotionalStrength: PromotionalStrength;
  autonomyMode: AutonomyMode;
  timezone: string;
  context: Readonly<Record<string, unknown>>;
  successCriteria?: readonly import("@market-me/domain").CampaignSuccessCriterion[];
  successAction?: import("@market-me/domain").CampaignSuccessAction;
  steps: readonly CampaignStepWrite[];
}

export interface StoredCampaign {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  status: CampaignStatus;
  currentVersion?: CampaignVersion;
  draftVersion?: CampaignVersion;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredCampaignStepRun {
  id: string;
  campaignInstanceId: string;
  campaignStepId: string;
  stepKey?: string;
  stepName?: string;
  status: CampaignStepStatus;
  idempotencyKey: string;
  input: Readonly<Record<string, unknown>>;
  output: Readonly<Record<string, unknown>>;
  attemptCount: number;
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface StoredCampaignApproval {
  id: string;
  campaignInstanceId: string;
  campaignStepRunId?: string;
  status:
    "pending" | "approved" | "rejected" | "changes_requested" | "canceled";
  requestSnapshot: Readonly<Record<string, unknown>>;
  conditions: Readonly<Record<string, unknown>>;
  requestedBy: string;
  assignedReviewerId?: string;
  decidedBy?: string;
  decisionNotes?: string;
  dueAt?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface StoredCampaignInstance {
  id: string;
  workspaceId: string;
  campaignId: string;
  campaignVersionId: string;
  status: Exclude<CampaignStatus, "draft" | "validating" | "archived">;
  temporalWorkflowId?: string;
  temporalRunId?: string;
  context: Readonly<Record<string, unknown>>;
  requestedBy: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  stepRuns: readonly StoredCampaignStepRun[];
  approvals: readonly StoredCampaignApproval[];
}

export interface CampaignWorkflowCommand {
  id: string;
  workspaceId: string;
  campaignInstanceId: string;
  commandType:
    | "start"
    | "pause"
    | "resume"
    | "cancel"
    | "approval_decision"
    | "manual_step_completed"
    | "success_criteria_met";
  idempotencyKey: string;
  payload: Readonly<Record<string, unknown>>;
  attemptCount: number;
}

export interface CampaignWorkflowDefinition {
  instanceId: string;
  workspaceId: string;
  campaignId: string;
  campaignVersionId: string;
  timezone: string;
  autonomyMode: AutonomyMode;
  context: Readonly<Record<string, unknown>>;
  steps: readonly CampaignStep[];
}
