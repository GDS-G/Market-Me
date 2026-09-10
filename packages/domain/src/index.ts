export const INFORMATION_DEPTHS = [
  "minimal",
  "teaser",
  "contextual",
  "detailed",
  "comprehensive",
  "custom",
] as const;

export const PROMOTIONAL_STRENGTHS = [
  "informational",
  "subtle",
  "light",
  "standard",
  "strong",
  "campaign_push",
  "custom",
] as const;

export const READINESS_MODES = [
  "immediate",
  "related_files",
  "ready_marker",
  "ai_recommended",
] as const;

export const AUTONOMY_MODES = [
  "draft_only",
  "approval_required",
  "approve_uncertain",
  "approve_first_occurrence",
  "campaign_approval",
  "confidence_based",
  "fully_autonomous",
  "custom",
] as const;

export const PACKAGE_STATUSES = [
  "detecting",
  "stabilizing",
  "analyzing",
  "needs_review",
  "ready",
  "approved",
  "executing",
  "completed",
  "failed",
] as const;

export const CONTENT_ASSET_RIGHTS_STATUSES = [
  "unchecked",
  "cleared",
  "restricted",
  "expired",
] as const;

export const CONTENT_ASSET_RIGHTS_CHANNELS = ["discord_webhook", "mastodon_account"] as const;

export const EXECUTION_METHODS = [
  "official_api",
  "local_browser",
  "user_assisted",
  "manual_handoff",
] as const;

export const CONTEXT_PACK_STATUSES = [
  "draft",
  "published",
  "archived",
] as const;
export const CONTEXT_SOURCE_KINDS = [
  "source_item",
  "manual_text",
  "url",
] as const;
export const CONTEXT_FACT_STATUSES = [
  "proposed",
  "accepted",
  "conflicted",
  "unresolved",
] as const;

export const CAMPAIGN_OBJECTIVES = [
  "awareness",
  "audience_growth",
  "website_traffic",
  "lead_generation",
  "sales",
  "subscriptions",
  "registrations",
  "applications",
  "customer_retention",
  "community_engagement",
  "product_education",
  "fundraising",
  "recruitment",
  "custom",
] as const;
export const CAMPAIGN_STATUSES = [
  "draft",
  "validating",
  "awaiting_approval",
  "scheduled",
  "active",
  "paused",
  "completed",
  "failed",
  "canceled",
  "archived",
] as const;
export const CAMPAIGN_VERSION_STATUSES = [
  "draft",
  "published",
  "superseded",
] as const;
export const CAMPAIGN_STEP_TYPES = [
  "create_destination",
  "publish_content",
  "send_notification",
  "discover",
  "outreach",
  "monitor",
  "respond",
  "collect_lead",
  "update_system",
  "request_approval",
  "wait",
  "analyze",
  "evaluate",
  "schedule_follow_up",
  "manual_handoff",
] as const;
export const CAMPAIGN_STEP_STATUSES = [
  "planned",
  "waiting",
  "running",
  "succeeded",
  "partially_succeeded",
  "temporarily_failed",
  "permanently_failed",
  "canceled",
  "rolled_back",
  "manual_resolution",
  "schedule_blocked",
] as const;
export const SCHEDULE_TYPES = [
  "immediate",
  "exact_time",
  "preferred_window",
  "recurring",
  "evergreen_queue",
  "dependency",
  "conditional",
  "follow_up",
] as const;
export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "changes_requested",
  "canceled",
] as const;
export const DESTINATION_STATUSES = [
  "draft",
  "published",
  "unavailable",
  "expired",
  "replaced",
  "archived",
] as const;
export const PROFILE_STATUSES = ["draft", "published", "archived"] as const;
export const PROFILE_VERSION_STATUSES = [
  "draft",
  "published",
  "superseded",
] as const;
export const AUDIENCE_TYPES = [
  "consumer",
  "business",
  "professional",
  "community",
  "media",
  "donor",
  "applicant",
  "partner",
  "mixed",
] as const;
export const DRAFT_STATUSES = [
  "working",
  "pending_review",
  "approved",
  "rejected",
  "changes_requested",
  "archived",
] as const;
export const DRAFT_VERSION_STATUSES = [
  "working",
  "pending_review",
  "approved",
  "rejected",
  "changes_requested",
  "superseded",
] as const;
export const DRAFT_CLAIM_KINDS = ["fact", "call_to_action"] as const;
export const DRAFT_FORMATS = [
  "channel_neutral",
  "social_short",
  "social_standard",
  "email",
  "article_intro",
  "community_reply",
  "direct_message",
] as const;
export const DRAFT_CHANNEL_PREVIEW_STATUSES = ["ready", "blocked"] as const;
export const MEASUREMENT_EVENT_TYPES = [
  "impression",
  "reach",
  "view",
  "reaction",
  "comment",
  "reply",
  "share",
  "save",
  "follow",
  "profile_visit",
  "outbound_click",
  "destination_visit",
  "form_completion",
  "lead",
  "application",
  "registration",
  "subscription",
  "purchase",
  "booking",
  "donation",
  "revenue",
  "unsubscribe",
  "complaint",
  "custom",
] as const;
export const PROVIDER_AGGREGATE_METRIC_TYPES = [
  "email_sent",
  "email_unique_open",
  "email_unique_click",
  "email_unsubscribe",
  "email_bounce",
  "email_complaint",
  "mastodon_reply",
  "mastodon_reblog",
  "mastodon_favourite",
] as const;
export const CAMPAIGN_METRIC_TYPES = [
  ...MEASUREMENT_EVENT_TYPES,
  ...PROVIDER_AGGREGATE_METRIC_TYPES,
] as const;
export const CAMPAIGN_SUCCESS_ACTIONS = ["notify_only", "pause"] as const;
export const RELATIONSHIP_STAGES = [
  "unknown",
  "discovered",
  "new_contact",
  "engaged",
  "active_conversation",
  "lead",
  "customer",
  "partner",
  "collaborator",
  "community_member",
  "inactive",
] as const;
export const CONTACT_PERMISSIONS = ["allowed", "suppressed"] as const;
export const RELATIONSHIP_IDENTITY_STATUSES = ["reported", "verified"] as const;
export const RELATIONSHIP_IDENTITY_LINK_STATUSES = [
  "suggested",
  "confirmed",
  "dismissed",
] as const;
export const RELATIONSHIP_IDENTITY_EVIDENCE_KINDS = [
  "verified_link",
  "exact_address",
  "strong_identifier",
  "user_confirmation",
] as const;
export const RELATIONSHIP_IDENTITY_LINK_ORIGINS = [
  "manual_review",
  "deterministic_scan",
] as const;
export const CONVERSATION_STATUSES = [
  "new",
  "unassigned",
  "ai_managed",
  "assigned",
  "waiting_internal_information",
  "waiting_contact",
  "scheduled_follow_up",
  "resolved",
  "archived",
] as const;
export const CONVERSATION_MESSAGE_KINDS = [
  "inbound",
  "outbound_observed",
  "internal_note",
  "system",
] as const;

export const CONVERSATION_SHARED_RESOURCE_KINDS = [
  "destination",
  "publication",
] as const;

export const CONVERSATION_HANDOFF_STATUSES = [
  "open",
  "resolved",
  "cancelled",
] as const;
export const CONVERSATION_REVIEW_REQUEST_STATUSES = [
  "open",
  "resolved",
  "cancelled",
] as const;
export const CONVERSATION_SENTIMENTS = [
  "unknown",
  "positive",
  "neutral",
  "negative",
  "mixed",
] as const;
export const CONVERSATION_INTENTS = [
  "unknown",
  "praise",
  "question",
  "support",
  "availability",
  "sales",
  "complaint",
  "collaboration",
  "media_inquiry",
  "other",
] as const;
export const CONVERSATION_URGENCIES = [
  "unknown",
  "low",
  "normal",
  "high",
  "critical",
] as const;
export const CONVERSATION_SERVICE_LEVEL_STATES = [
  "on_track",
  "at_risk",
  "overdue",
] as const;
export const CONVERSATION_RESPONSE_SUGGESTION_STATUSES = [
  "active",
  "dismissed",
  "superseded",
] as const;
export const CONVERSATION_RESPONSE_RECOMMENDATIONS = [
  "respond",
  "clarify",
  "no_response",
  "human_review",
] as const;
export const CONVERSATION_RESPONSE_CITATION_KINDS = [
  "message",
  "relationship",
  "brand",
  "campaign",
  "destination",
] as const;
export const CONVERSATION_DRAFTING_ACTOR_KINDS = [
  "human",
  "assistant",
] as const;
export const CONVERSATION_ATTENTION_REASONS = [
  "response_at_risk",
  "response_overdue",
  "response_escalation_due",
  "follow_up_due",
  "review_request_due",
  "handoff_due",
] as const;
export const CONVERSATION_RETENTION_CLASSES = [
  "standard",
  "personal_message",
  "imported_email",
  "legal_hold",
] as const;
export const CONVERSATION_RETENTION_ERASURE_STATUSES = [
  "pending",
  "executed",
  "rejected",
] as const;
export const CONVERSATION_LEGAL_HOLD_STATUSES = ["active", "released"] as const;
export const CONVERSATION_LEGAL_HOLD_RELEASE_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const;

export type InformationDepth = (typeof INFORMATION_DEPTHS)[number];
export type PromotionalStrength = (typeof PROMOTIONAL_STRENGTHS)[number];
export type ReadinessMode = (typeof READINESS_MODES)[number];
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];
export type ContentPackageStatus = (typeof PACKAGE_STATUSES)[number];
export type ContentAssetRightsStatus =
  (typeof CONTENT_ASSET_RIGHTS_STATUSES)[number];
export type ContentAssetRightsChannel =
  (typeof CONTENT_ASSET_RIGHTS_CHANNELS)[number];
export type ExecutionMethod = (typeof EXECUTION_METHODS)[number];
export type ContextPackStatus = (typeof CONTEXT_PACK_STATUSES)[number];
export type ContextSourceKind = (typeof CONTEXT_SOURCE_KINDS)[number];
export type ContextFactStatus = (typeof CONTEXT_FACT_STATUSES)[number];
export type CampaignObjective = (typeof CAMPAIGN_OBJECTIVES)[number];
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export type CampaignVersionStatus = (typeof CAMPAIGN_VERSION_STATUSES)[number];
export type CampaignStepType = (typeof CAMPAIGN_STEP_TYPES)[number];
export type CampaignStepStatus = (typeof CAMPAIGN_STEP_STATUSES)[number];
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export type DestinationStatus = (typeof DESTINATION_STATUSES)[number];
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];
export type ProfileVersionStatus = (typeof PROFILE_VERSION_STATUSES)[number];
export type AudienceType = (typeof AUDIENCE_TYPES)[number];
export type DraftStatus = (typeof DRAFT_STATUSES)[number];
export type DraftVersionStatus = (typeof DRAFT_VERSION_STATUSES)[number];
export type DraftClaimKind = (typeof DRAFT_CLAIM_KINDS)[number];
export type DraftFormat = (typeof DRAFT_FORMATS)[number];
export type DraftChannelPreviewStatus =
  (typeof DRAFT_CHANNEL_PREVIEW_STATUSES)[number];
export type MeasurementEventType = (typeof MEASUREMENT_EVENT_TYPES)[number];
export type ProviderAggregateMetricType =
  (typeof PROVIDER_AGGREGATE_METRIC_TYPES)[number];
export type CampaignMetricType = (typeof CAMPAIGN_METRIC_TYPES)[number];
export type CampaignSuccessAction = (typeof CAMPAIGN_SUCCESS_ACTIONS)[number];
export type RelationshipStage = (typeof RELATIONSHIP_STAGES)[number];
export type ContactPermission = (typeof CONTACT_PERMISSIONS)[number];
export type RelationshipIdentityStatus =
  (typeof RELATIONSHIP_IDENTITY_STATUSES)[number];
export type RelationshipIdentityLinkStatus =
  (typeof RELATIONSHIP_IDENTITY_LINK_STATUSES)[number];
export type RelationshipIdentityEvidenceKind =
  (typeof RELATIONSHIP_IDENTITY_EVIDENCE_KINDS)[number];
export type RelationshipIdentityLinkOrigin =
  (typeof RELATIONSHIP_IDENTITY_LINK_ORIGINS)[number];
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export type ConversationMessageKind =
  (typeof CONVERSATION_MESSAGE_KINDS)[number];
export type ConversationSharedResourceKind =
  (typeof CONVERSATION_SHARED_RESOURCE_KINDS)[number];
export type ConversationHandoffStatus =
  (typeof CONVERSATION_HANDOFF_STATUSES)[number];
export type ConversationReviewRequestStatus =
  (typeof CONVERSATION_REVIEW_REQUEST_STATUSES)[number];
export type ConversationSentiment = (typeof CONVERSATION_SENTIMENTS)[number];
export type ConversationIntent = (typeof CONVERSATION_INTENTS)[number];
export type ConversationUrgency = (typeof CONVERSATION_URGENCIES)[number];
export type ConversationServiceLevelState =
  (typeof CONVERSATION_SERVICE_LEVEL_STATES)[number];
export type ConversationResponseSuggestionStatus =
  (typeof CONVERSATION_RESPONSE_SUGGESTION_STATUSES)[number];
export type ConversationResponseRecommendation =
  (typeof CONVERSATION_RESPONSE_RECOMMENDATIONS)[number];
export type ConversationResponseCitationKind =
  (typeof CONVERSATION_RESPONSE_CITATION_KINDS)[number];
export type ConversationDraftingActorKind =
  (typeof CONVERSATION_DRAFTING_ACTOR_KINDS)[number];
export type ConversationAttentionReason =
  (typeof CONVERSATION_ATTENTION_REASONS)[number];
export type ConversationRetentionClass =
  (typeof CONVERSATION_RETENTION_CLASSES)[number];
export type ConversationRetentionErasureStatus =
  (typeof CONVERSATION_RETENTION_ERASURE_STATUSES)[number];
export type ConversationLegalHoldStatus =
  (typeof CONVERSATION_LEGAL_HOLD_STATUSES)[number];
export type ConversationLegalHoldReleaseRequestStatus =
  (typeof CONVERSATION_LEGAL_HOLD_RELEASE_REQUEST_STATUSES)[number];

interface CampaignSuccessCriterionBase {
  id: string;
}

export interface CampaignCountCriterion extends CampaignSuccessCriterionBase {
  eventType: CampaignMetricType;
  metric?: "count";
  targetCount: number;
}

export interface CampaignValueCriterion extends CampaignSuccessCriterionBase {
  eventType: MeasurementEventType;
  metric: "value";
  targetValue: number;
  currency: string;
}

export type CampaignSuccessCriterion =
  CampaignCountCriterion | CampaignValueCriterion;

export interface DraftClaim {
  id: string;
  kind: DraftClaimKind;
  text: string;
  evidenceItemIds: readonly string[];
}

export interface ContentDraftVersion {
  id: string;
  contentDraftId: string;
  versionNumber: number;
  status: DraftVersionStatus;
  headline: string;
  body: string;
  callToAction?: string;
  hashtags: readonly string[];
  altText?: string;
  rationale: string;
  presentationChoices: Readonly<Record<string, unknown>>;
  claims: readonly DraftClaim[];
  sourceVersionId?: string;
  changeNote?: string;
  createdBy: string;
  createdAt: string;
}

export type SourceProvider =
  "google_drive" | "onedrive" | "sharepoint" | "local";

export interface SmartSourceLocation {
  providerLocationId: string;
  displayPath: string;
}

export interface SmartSource {
  id: string;
  workspaceId: string;
  name: string;
  provider: SourceProvider;
  locations: readonly SmartSourceLocation[];
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
  lastScanAt?: string;
}

export interface EvidenceItem {
  id: string;
  factKey?: string;
  claim: string;
  provenance: "observed" | "authoritative_context" | "inferred" | "unresolved";
  sourceReferences: readonly string[];
  confidence?: number;
  contextPackVersionId?: string;
  supersededByEvidenceId?: string;
}

export interface ContentAsset {
  id: string;
  role: "original" | "supporting" | "derivative";
  fileName: string;
  mimeType: string;
  contentHash: string;
  sourceAssetId?: string;
  objectKey?: string;
  byteSize?: number;
  processingVersion?: string;
  recipe?: Readonly<Record<string, unknown>>;
  mediaStatus?: "stored" | "processed" | "unsupported" | "failed";
  scanStatus?: "clean" | "infected" | "not_configured" | "failed";
  scanEngine?: string;
  scanScannedAt?: string;
  scanRevision?: number;
  rightsStatus?: ContentAssetRightsStatus;
  rightsOwner?: string;
  rightsLicenseOwner?: string;
  rightsSourceReference?: string;
  rightsProofReference?: string;
  rightsCommercialUseAllowed?: boolean;
  rightsDerivativeUseAllowed?: boolean;
  rightsWorldwideUseAllowed?: boolean;
  rightsPermittedChannels?: readonly ContentAssetRightsChannel[];
  rightsPermittedChannelConnectionIds?: readonly string[];
  rightsPermittedCampaignIds?: readonly string[];
  rightsPermittedBrandProfileIds?: readonly string[];
  rightsValidFrom?: string;
  rightsExpiresAt?: string;
  rightsAttributionRequirement?: string;
  rightsWatermarkRequirement?: string;
  rightsDisclaimerRequirement?: string;
  rightsReviewNote?: string;
  rightsReviewedBy?: string;
  rightsReviewedByDisplayName?: string;
  rightsReviewedAt?: string;
  rightsRevision?: number;
  altText?: string;
  altTextStatus?: "not_applicable" | "needs_review" | "approved" | "decorative";
  accessibilityNotes?: string;
}

export interface ContentPackage {
  id: string;
  workspaceId: string;
  smartSourceId: string;
  title: string;
  status: ContentPackageStatus;
  assets: readonly ContentAsset[];
  evidence: readonly EvidenceItem[];
  confidence?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContextAuthorityRule {
  factKey: string;
  preferredSourceIds: readonly string[];
  resolution: "prefer_authority" | "require_review";
}

export interface ContextPackSource {
  id: string;
  kind: ContextSourceKind;
  sourceItemId?: string;
  label: string;
  sourceReference: string;
  selectedSections: readonly string[];
  authorityRank: number;
  contentHash?: string;
  contentText?: string;
}

export interface ContextPackFact {
  id: string;
  factKey: string;
  value: unknown;
  sourceId?: string;
  confidence?: number;
  status: ContextFactStatus;
  notes?: string;
}

export interface ContextPackVersion {
  id: string;
  contextPackId: string;
  versionNumber: number;
  status: "draft" | "published" | "superseded";
  instructions: string;
  authorityRules: readonly ContextAuthorityRule[];
  sources: readonly ContextPackSource[];
  facts: readonly ContextPackFact[];
  createdAt: string;
  publishedAt?: string;
}

export interface ContextPack {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  status: ContextPackStatus;
  currentVersion?: ContextPackVersion;
  draftVersion?: ContextPackVersion;
  createdAt: string;
  updatedAt: string;
}

export interface CommunicationControls {
  informationDepthDefault?: InformationDepth;
  informationDepthCeiling?: Exclude<InformationDepth, "custom">;
  promotionalStrengthDefault?: PromotionalStrength;
  promotionalStrengthCeiling?: Exclude<PromotionalStrength, "custom">;
}

export interface BrandProfileData {
  officialName: string;
  shortName?: string;
  description: string;
  products: readonly string[];
  services: readonly string[];
  valuePropositions: readonly string[];
  voice: Readonly<{
    tones: readonly string[];
    formality?: string;
    humor?: string;
    emotion?: string;
  }>;
  terminology: Readonly<{
    preferred: readonly string[];
    prohibited: readonly string[];
  }>;
  style: Readonly<{
    capitalization?: string;
    punctuation?: string;
    emoji?: string;
    hashtags?: string;
    abbreviations?: string;
  }>;
  callToActionGuidance?: string;
  claims: readonly string[];
  evidenceRequirements: readonly string[];
  requiredDisclosures: readonly string[];
  attributionRules: readonly string[];
  competitorRules: readonly string[];
  visualGuidance?: string;
  channelPersonas: Readonly<Record<string, string>>;
}

export interface AudienceProfileData {
  purpose: string;
  industries: readonly string[];
  roles: readonly string[];
  interests: readonly string[];
  locations: readonly string[];
  languages: readonly string[];
  knowledgeLevel?: string;
  needs: readonly string[];
  motivations: readonly string[];
  objections: readonly string[];
  questions: readonly string[];
  preferredChannels: readonly string[];
  preferredFormats: readonly string[];
  relationshipStage?: string;
  familiarity?: string;
  exclusions: readonly string[];
}

export interface BrandProfileVersion extends CommunicationControls {
  id: string;
  brandProfileId: string;
  versionNumber: number;
  status: ProfileVersionStatus;
  profile: BrandProfileData;
  createdAt: string;
  publishedAt?: string;
}

export interface AudienceProfileVersion extends CommunicationControls {
  id: string;
  audienceProfileId: string;
  versionNumber: number;
  status: ProfileVersionStatus;
  audienceType: AudienceType;
  profile: AudienceProfileData;
  createdAt: string;
  publishedAt?: string;
}

export interface BrandProfile {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  status: ProfileStatus;
  currentVersion?: BrandProfileVersion;
  draftVersion?: BrandProfileVersion;
  createdAt: string;
  updatedAt: string;
}

export interface AudienceProfile {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  status: ProfileStatus;
  currentVersion?: AudienceProfileVersion;
  draftVersion?: AudienceProfileVersion;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignStep {
  id: string;
  name: string;
  desiredCapability: string;
  dependsOn: readonly string[];
  inputs: Readonly<Record<string, unknown>>;
  outputs: Readonly<Record<string, unknown>>;
  executionMethods: readonly ExecutionMethod[];
  approvalRequired: boolean;
  operationType?: CampaignStepType;
  scheduleType?: ScheduleType;
  scheduledAt?: string;
  preferredWindowStart?: string;
  preferredWindowEnd?: string;
  /** Delay after each required predecessor's first successful completion; defaults to zero. */
  dependencyDelaySeconds?: number;
  condition?: Readonly<Record<string, unknown>>;
  maxAttempts?: number;
  timeoutSeconds?: number;
  optional?: boolean;
}

export interface Campaign {
  id: string;
  workspaceId: string;
  name: string;
  status: CampaignStatus;
  contentPackageIds: readonly string[];
  steps: readonly CampaignStep[];
  informationDepth: InformationDepth;
  promotionalStrength: PromotionalStrength;
  autonomyMode: AutonomyMode;
}

export interface CampaignVersion {
  id: string;
  campaignId: string;
  versionNumber: number;
  status: CampaignVersionStatus;
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
  successCriteria: readonly CampaignSuccessCriterion[];
  successAction: CampaignSuccessAction;
  steps: readonly CampaignStep[];
  createdAt: string;
  publishedAt?: string;
}

export interface Destination {
  id: string;
  workspaceId: string;
  provider: string;
  externalId?: string;
  canonicalUrl: string;
  knownRedirects: readonly string[];
  title: string;
  description: string;
  contentType: string;
  identifiers: Readonly<Record<string, string>>;
  topics: readonly string[];
  audiences: readonly string[];
  geography: readonly string[];
  language?: string;
  status: DestinationStatus;
  availableAt?: string;
  expiresAt?: string;
  replacementDestinationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RelationshipIdentity {
  id: string;
  provider: string;
  providerSubjectId: string;
  displayHandle?: string;
  profileUrl?: string;
  status: RelationshipIdentityStatus;
  confidence?: number;
}

export interface RelationshipRecord {
  id: string;
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
  suppressedAt?: string;
  suppressedBy?: string;
  identities: readonly RelationshipIdentity[];
  createdAt: string;
  updatedAt: string;
}

export interface RelationshipIdentityLink {
  id: string;
  workspaceId: string;
  relationshipAId: string;
  relationshipBId: string;
  status: RelationshipIdentityLinkStatus;
  evidenceKind: RelationshipIdentityEvidenceKind;
  origin: RelationshipIdentityLinkOrigin;
  confidence: number;
  suggestedBy: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RelationshipIdentityGroupMember {
  id: string;
  displayName: string;
  organizationName?: string;
  stage: RelationshipStage;
  contactPermission: ContactPermission;
  identities: readonly RelationshipIdentity[];
}

export interface ConversationMessage {
  id: string;
  conversationThreadId: string;
  providerMessageId?: string;
  kind: ConversationMessageKind;
  body: string;
  authorDisplay?: string;
  occurredAt: string;
  metadata: Readonly<Record<string, unknown>>;
  createdBy?: string;
  createdAt: string;
}

export interface ConversationThread {
  id: string;
  workspaceId: string;
  relationshipId: string;
  campaignId?: string;
  destinationId?: string;
  brandProfileId?: string;
  channelConnectionId?: string;
  publicationActionId?: string;
  provider: string;
  providerThreadId?: string;
  subject: string;
  status: ConversationStatus;
  sentiment: ConversationSentiment;
  intent: ConversationIntent;
  urgency: ConversationUrgency;
  classificationUpdatedBy?: string;
  classificationUpdatedAt?: string;
  assignedOwnerId?: string;
  lastMessageAt?: string;
  responseDueAt?: string;
  followUpAt?: string;
  retentionClass: ConversationRetentionClass;
  retentionClassUpdatedBy?: string;
  retentionClassUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationHandoffBrief {
  id: string;
  conversationThreadId: string;
  status: ConversationHandoffStatus;
  contactSummary: string;
  importance: string;
  requestOrOffer: string;
  priorResponseSummary: string;
  relevantContext: string;
  suggestedResponse: string;
  dueAt?: string;
  requestedBy: string;
  closedBy?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationReviewRequest {
  id: string;
  conversationThreadId: string;
  sourceMessageId?: string;
  status: ConversationReviewRequestStatus;
  requestText: string;
  dueAt?: string;
  requestedBy: string;
  requestedReviewerId: string;
  closedBy?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationResponseCitation {
  kind: ConversationResponseCitationKind;
  sourceId: string;
  label: string;
  excerpt?: string;
}

export interface ConversationResponseClaim {
  text: string;
  citationIndexes: readonly number[];
}

export interface ConversationAssistantContextSnapshot {
  messages: readonly Pick<
    ConversationMessage,
    "id" | "kind" | "body" | "occurredAt"
  >[];
  relationship: {
    id: string;
    stage: RelationshipStage;
    effectiveContactPermission: ContactPermission;
    preferredTone?: string;
  };
  brand?: {
    id: string;
    name: string;
    versionId?: string;
    versionNumber?: number;
  };
  campaign?: {
    id: string;
    name: string;
    versionId?: string;
    versionNumber?: number;
    objective?: CampaignObjective;
    promotionalStrength?: PromotionalStrength;
  };
  destination?: {
    id: string;
    title: string;
    canonicalUrl: string;
    status: DestinationStatus;
  };
}

export interface ConversationResponseSuggestion {
  id: string;
  workspaceId: string;
  conversationThreadId: string;
  status: ConversationResponseSuggestionStatus;
  recommendation: ConversationResponseRecommendation;
  summary: string;
  identifiedQuestions: readonly string[];
  responseText?: string;
  uncertainty: number;
  uncertaintyReasons: readonly string[];
  recommendedPromotionalStrength: PromotionalStrength;
  proposedDestinationId?: string;
  contextSnapshot: ConversationAssistantContextSnapshot;
  citations: readonly ConversationResponseCitation[];
  claims: readonly ConversationResponseClaim[];
  inputFingerprint: string;
  generatorProvider: string;
  generatorModel: string;
  generatorVersion: string;
  promptVersion: string;
  generatedBy: string;
  dismissedBy?: string;
  dismissedAt?: string;
  createdAt: string;
}

export interface ConversationResponseDraft {
  id: string;
  workspaceId: string;
  conversationThreadId: string;
  body: string;
  sourceSuggestionId?: string;
  createdBy: string;
  updatedBy: string;
  updatedByDisplayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDraftingPresence {
  conversationThreadId: string;
  actorKind: ConversationDraftingActorKind;
  actorUserId: string;
  actorDisplayName: string;
  expiresAt: string;
  updatedAt: string;
}

export interface ConversationAttentionItem {
  conversationThreadId: string;
  subject: string;
  relationshipDisplayName: string;
  status: ConversationStatus;
  assignedOwnerId?: string;
  assignedOwnerDisplayName?: string;
  reasons: readonly ConversationAttentionReason[];
  primaryDueAt: string;
  serviceLevelDueAt?: string;
  followUpAt?: string;
  reviewRequestDueAt?: string;
  handoffDueAt?: string;
}

export interface ConversationRetentionCandidate {
  conversationThreadId: string;
  subject: string;
  relationshipDisplayName: string;
  status: "resolved" | "archived";
  retentionClass: Exclude<ConversationRetentionClass, "legal_hold">;
  lastActivityAt: string;
  eligibleAfter: string;
}

export interface ConversationRetentionDeletedCounts {
  threads: 1;
  messages: number;
  handoffBriefs: number;
  readStates: number;
  draftingPresence: number;
  responseSuggestions: number;
  responseDrafts: number;
  reviewRequests: number;
  reviewMentions: number;
  sharedResources: number;
}

export interface ConversationRetentionErasureRequest {
  id: string;
  workspaceId: string;
  conversationThreadId: string;
  retentionClass: Exclude<ConversationRetentionClass, "legal_hold">;
  eligibleAfter: string;
  status: ConversationRetentionErasureStatus;
  requestNote: string;
  requestedBy: string;
  requestedByDisplayName: string;
  requestedAt: string;
  decidedBy?: string;
  decidedByDisplayName?: string;
  decidedAt?: string;
  decisionNote?: string;
  deletedCounts?: ConversationRetentionDeletedCounts;
  subject?: string;
  relationshipDisplayName?: string;
  threadRetentionRevision: number;
}

export interface ConversationLegalHoldCase {
  id: string;
  workspaceId: string;
  conversationThreadId: string;
  previousRetentionClass: Exclude<ConversationRetentionClass, "legal_hold">;
  reason: string;
  caseReference?: string;
  status: ConversationLegalHoldStatus;
  placedBy: string;
  placedByDisplayName: string;
  placedAt: string;
  releasedBy?: string;
  releasedByDisplayName?: string;
  releasedAt?: string;
  releaseRequestId?: string;
  subject?: string;
  relationshipDisplayName?: string;
}

export interface ConversationLegalHoldReleaseRequest {
  id: string;
  legalHoldCaseId: string;
  workspaceId: string;
  conversationThreadId: string;
  targetRetentionClass: Exclude<ConversationRetentionClass, "legal_hold">;
  requestNote: string;
  status: ConversationLegalHoldReleaseRequestStatus;
  requestedBy: string;
  requestedByDisplayName: string;
  requestedAt: string;
  decidedBy?: string;
  decidedByDisplayName?: string;
  decidedAt?: string;
  decisionNote?: string;
  subject?: string;
  relationshipDisplayName?: string;
}

export interface ConversationSharedResource {
  id: string;
  conversationThreadId: string;
  kind: ConversationSharedResourceKind;
  destinationId?: string;
  channelConnectionId?: string;
  publicationActionId?: string;
  observedAt: string;
  recordedBy: string;
  createdAt: string;
}

export interface ConversationReadState {
  conversationThreadId: string;
  userId: string;
  lastReadAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignInstance {
  id: string;
  workspaceId: string;
  campaignId: string;
  campaignVersionId: string;
  status: CampaignStatus;
  temporalWorkflowId?: string;
  temporalRunId?: string;
  context: Readonly<Record<string, unknown>>;
  startedAt?: string;
  completedAt?: string;
}

export interface ConnectorCapability {
  connectorId: string;
  capability: string;
  supported: boolean;
  executionMethods: readonly ExecutionMethod[];
  requiredScopes: readonly string[];
  observedAt: string;
  limits: Readonly<Record<string, number | string | boolean>>;
}

export * from "./policies";
export * from "./schedule";
export * from "./demo";
export * from "./ai";
