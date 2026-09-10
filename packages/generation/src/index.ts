import type {
  AudienceProfileData,
  BrandProfileData,
  EvidenceItem,
  DraftFormat,
  InformationDepth,
  PromotionalStrength,
  ConversationAssistantContextSnapshot,
  ConversationIntent,
  ConversationResponseCitation,
  ConversationResponseClaim,
  ConversationResponseRecommendation,
  ConversationSentiment,
  ConversationUrgency,
} from "@market-me/domain";

export * from "./gateway";
export * from "./metering";
export * from "./rate-card";

export const GENERATOR_PROVIDER = "market-me";
export const GENERATOR_MODEL = "grounded-template";
export const GENERATOR_VERSION = "1.0.0";
export const PROMPT_VERSION = "grounded-draft-v1";
export const CONVERSATION_ASSISTANT_PROVIDER = "market-me";
export const CONVERSATION_ASSISTANT_MODEL = "grounded-conversation-template";
export const CONVERSATION_ASSISTANT_VERSION = "1.0.0";
export const CONVERSATION_ASSISTANT_PROMPT_VERSION =
  "grounded-conversation-assistant-v1";

export interface ConversationAssistantInput {
  contactName: string;
  intent: ConversationIntent;
  sentiment: ConversationSentiment;
  urgency: ConversationUrgency;
  context: ConversationAssistantContextSnapshot;
}

export interface GeneratedConversationResponseSuggestion {
  recommendation: ConversationResponseRecommendation;
  summary: string;
  identifiedQuestions: readonly string[];
  responseText?: string;
  uncertainty: number;
  uncertaintyReasons: readonly string[];
  recommendedPromotionalStrength: PromotionalStrength;
  proposedDestinationId?: string;
  citations: readonly ConversationResponseCitation[];
  claims: readonly ConversationResponseClaim[];
}

export interface GroundedDraftInput {
  packageTitle: string;
  evidence: readonly EvidenceItem[];
  informationDepth: InformationDepth;
  promotionalStrength: PromotionalStrength;
  format?: DraftFormat;
  brand?: { name: string; profile: BrandProfileData };
  audience?: { name: string; profile: AudienceProfileData };
  characterBudgetAudienceName?: string;
}

export interface GeneratedDraftClaim {
  kind: "fact" | "call_to_action";
  text: string;
  evidenceItemIds: readonly string[];
}

export interface GeneratedDraft {
  headline: string;
  body: string;
  callToAction?: string;
  hashtags: readonly string[];
  altText?: string;
  rationale: string;
  presentationChoices: Readonly<Record<string, unknown>>;
  claims: readonly GeneratedDraftClaim[];
}

const depthClaimLimits: Record<InformationDepth, number> = {
  minimal: 1,
  teaser: 1,
  contextual: 2,
  detailed: 4,
  comprehensive: Number.POSITIVE_INFINITY,
  custom: 2,
};

const callsToAction: Record<PromotionalStrength, string | undefined> = {
  informational: undefined,
  subtle: "Learn more when it is useful.",
  light: "Explore the details.",
  standard: "See how this can help and take the next step.",
  strong: "Take the next step today.",
  campaign_push: "Act now and join the campaign.",
  custom: "Explore the next step.",
};

export const DRAFT_FORMAT_CHARACTER_LIMITS: Readonly<Record<DraftFormat, number | undefined>> = {
  channel_neutral: undefined,
  social_short: 280,
  social_standard: 1000,
  email: 4000,
  article_intro: 5000,
  community_reply: 2000,
  direct_message: 1000,
};

/**
 * Creates a reproducible channel-neutral draft. Factual sentences are copied from
 * approved evidence verbatim; audience and brand data only affect presentation.
 */
export function generateGroundedDraft(input: GroundedDraftInput): GeneratedDraft {
  const usable = input.evidence
    .filter((item) => item.provenance !== "unresolved" && !item.supersededByEvidenceId)
    .sort((left, right) => provenanceRank(left.provenance) - provenanceRank(right.provenance) || left.id.localeCompare(right.id));
  if (usable.length === 0) throw new Error("An approved evidence item is required to generate a draft.");
  const format = input.format ?? "channel_neutral";
  const limit = DRAFT_FORMAT_CHARACTER_LIMITS[format];
  const selected = selectClaimsForFormat(usable, depthClaimLimits[input.informationDepth], limit, input.characterBudgetAudienceName ?? input.audience?.name, callsToAction[input.promotionalStrength]);
  const audienceLead = input.audience ? `For ${input.audience.name}: ` : "";
  const facts = selected.map((item) => item.claim.trim().replace(/[.!?]?$/, "."));
  const body = `${audienceLead}${facts.join(" ")}`.trim();
  const callToAction = callsToAction[input.promotionalStrength];
  const tone = input.brand?.profile.voice.tones?.[0] ?? "clear";
  const knowledgeLevel = input.audience?.profile.knowledgeLevel ?? "general";
  const claims: GeneratedDraftClaim[] = selected.map((item) => ({ kind: "fact", text: item.claim, evidenceItemIds: [item.id] }));
  if (callToAction) claims.push({ kind: "call_to_action", text: callToAction, evidenceItemIds: [] });
  return {
    headline: input.packageTitle,
    body,
    ...(callToAction ? { callToAction } : {}),
    hashtags: [],
    rationale: `Used ${selected.length} of ${usable.length} approved evidence items at ${input.informationDepth} depth with ${input.promotionalStrength} promotion.`,
    presentationChoices: {
      audience: input.audience?.name ?? "general",
      leadIn: input.audience ? `For ${input.audience.name}` : "",
      brand: input.brand?.name ?? "workspace default",
      tone,
      knowledgeLevel,
      factOrder: selected.map((item) => item.id),
      format,
      ...(limit ? { characterLimit: limit, characterCount: body.length + (callToAction?.length ?? 0) } : {}),
    },
    claims,
  };
}

function selectClaimsForFormat(evidence: readonly EvidenceItem[], maximum: number, characterLimit: number | undefined, audienceName: string | undefined, callToAction: string | undefined): EvidenceItem[] {
  const bounded = evidence.slice(0, maximum);
  if (!characterLimit) return bounded;
  const prefix = audienceName ? `For ${audienceName}: ` : "";
  const ctaLength = callToAction ? callToAction.length + 1 : 0;
  const selected: EvidenceItem[] = [];
  for (const item of bounded) {
    const candidate = [...selected, item].map((entry) => entry.claim.trim().replace(/[.!?]?$/, ".")).join(" ");
    if (prefix.length + candidate.length + ctaLength > characterLimit) break;
    selected.push(item);
  }
  if (!selected.length) throw new Error(`Approved evidence cannot fit the ${characterLimit}-character ${inputFormatLabel(characterLimit)} format limit.`);
  return selected;
}

function inputFormatLabel(limit: number): string {
  return Object.entries(DRAFT_FORMAT_CHARACTER_LIMITS).find(([, value]) => value === limit)?.[0] ?? "selected";
}

function provenanceRank(provenance: EvidenceItem["provenance"]): number {
  return { authoritative_context: 0, observed: 1, inferred: 2, unresolved: 3 }[provenance];
}

/**
 * Produces a reproducible, review-only response suggestion. The template can
 * acknowledge or ask for clarification, but it may only add a business fact
 * when that fact is copied from a cited, published Destination snapshot.
 */
export function generateGroundedConversationResponse(
  input: ConversationAssistantInput,
): GeneratedConversationResponseSuggestion {
  const externalMessages = input.context.messages.filter(
    (message) => message.kind === "inbound" || message.kind === "outbound_observed",
  );
  const latestExternal = externalMessages.at(-1);
  const latestInbound = [...externalMessages]
    .reverse()
    .find((message) => message.kind === "inbound");
  const questions = latestInbound
    ? extractQuestions(latestInbound.body).slice(0, 5)
    : [];
  const citations = buildConversationCitations(input, latestInbound);
  const suppressed =
    input.context.relationship.effectiveContactPermission === "suppressed";
  const requiresHuman =
    input.urgency === "high" ||
    input.urgency === "critical" ||
    ["complaint", "sales", "collaboration", "media_inquiry"].includes(
      input.intent,
    );

  let recommendation: ConversationResponseRecommendation;
  if (suppressed || !latestInbound || latestExternal?.kind === "outbound_observed") {
    recommendation = "no_response";
  } else if (requiresHuman) {
    recommendation = "human_review";
  } else if (questions.length > 0 && !input.context.destination) {
    recommendation = "clarify";
  } else {
    recommendation = "respond";
  }

  const proposedDestination =
    recommendation === "respond" &&
    input.context.destination?.status === "published"
      ? input.context.destination
      : undefined;
  const responseText = buildResponseText(
    recommendation,
    input.sentiment,
    input.intent,
    proposedDestination,
  );
  const destinationCitationIndex = proposedDestination
    ? citations.findIndex(
        (citation) =>
          citation.kind === "destination" &&
          citation.sourceId === proposedDestination.id,
      )
    : -1;
  const claims: ConversationResponseClaim[] =
    proposedDestination && destinationCitationIndex >= 0
      ? [
          {
            text: `Approved destination: ${proposedDestination.title} (${proposedDestination.canonicalUrl})`,
            citationIndexes: [destinationCitationIndex],
          },
        ]
      : [];
  const uncertainty = conversationUncertainty(
    recommendation,
    questions.length > 0,
    Boolean(proposedDestination),
  );

  return {
    recommendation,
    summary: summarizeConversation(input.contactName, latestInbound, externalMessages.length),
    identifiedQuestions: questions,
    ...(responseText ? { responseText } : {}),
    uncertainty,
    uncertaintyReasons: uncertaintyReasons(
      recommendation,
      questions.length > 0,
      Boolean(proposedDestination),
    ),
    recommendedPromotionalStrength: recommendConversationPromotion(
      input,
      recommendation,
      Boolean(proposedDestination),
    ),
    ...(proposedDestination
      ? { proposedDestinationId: proposedDestination.id }
      : {}),
    citations,
    claims,
  };
}

function buildConversationCitations(
  input: ConversationAssistantInput,
  latestInbound:
    | ConversationAssistantContextSnapshot["messages"][number]
    | undefined,
): ConversationResponseCitation[] {
  const citations: ConversationResponseCitation[] = [];
  if (latestInbound) {
    citations.push({
      kind: "message",
      sourceId: latestInbound.id,
      label: "Latest inbound message",
      excerpt: boundedExcerpt(latestInbound.body),
    });
  }
  citations.push({
    kind: "relationship",
    sourceId: input.context.relationship.id,
    label: `Relationship stage: ${input.context.relationship.stage.replaceAll("_", " ")}`,
  });
  if (input.context.brand)
    citations.push({
      kind: "brand",
      sourceId: input.context.brand.versionId ?? input.context.brand.id,
      label: input.context.brand.versionNumber
        ? `${input.context.brand.name} v${input.context.brand.versionNumber}`
        : input.context.brand.name,
    });
  if (input.context.campaign)
    citations.push({
      kind: "campaign",
      sourceId: input.context.campaign.versionId ?? input.context.campaign.id,
      label: input.context.campaign.versionNumber
        ? `${input.context.campaign.name} v${input.context.campaign.versionNumber}`
        : input.context.campaign.name,
    });
  if (input.context.destination)
    citations.push({
      kind: "destination",
      sourceId: input.context.destination.id,
      label: input.context.destination.title,
      excerpt: input.context.destination.canonicalUrl,
    });
  return citations;
}

function extractQuestions(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => {
      const questionEnd = sentence.indexOf("?");
      return questionEnd >= 0
        ? sentence.slice(0, questionEnd + 1).trim()
        : "";
    })
    .filter((question) => question.length > 0 && question.length <= 500);
}

function boundedExcerpt(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 280
    ? normalized
    : `${normalized.slice(0, 277)}...`;
}

function summarizeConversation(
  contactName: string,
  latestInbound:
    | ConversationAssistantContextSnapshot["messages"][number]
    | undefined,
  externalMessageCount: number,
): string {
  if (!latestInbound)
    return `No inbound message from ${contactName} is available for response review.`;
  return `${contactName} most recently wrote: “${boundedExcerpt(latestInbound.body)}” (${externalMessageCount} external message${externalMessageCount === 1 ? "" : "s"} reviewed).`;
}

function buildResponseText(
  recommendation: ConversationResponseRecommendation,
  sentiment: ConversationSentiment,
  intent: ConversationIntent,
  destination: ConversationAssistantContextSnapshot["destination"] | undefined,
): string | undefined {
  if (recommendation === "no_response" || recommendation === "human_review")
    return undefined;
  if (destination) {
    return `Thanks for reaching out. The approved destination that may help is ${destination.title}: ${destination.canonicalUrl}. If that does not answer your question, a teammate can follow up.`;
  }
  if (recommendation === "clarify")
    return "Thanks for reaching out. Could you share a little more detail so we can give you an accurate answer?";
  if (intent === "praise" || sentiment === "positive")
    return "Thank you for taking the time to share this with us.";
  return "Thanks for reaching out. We’re reviewing your message and will follow up with an accurate answer.";
}

function conversationUncertainty(
  recommendation: ConversationResponseRecommendation,
  hasQuestion: boolean,
  hasDestination: boolean,
): number {
  if (recommendation === "human_review") return 0.85;
  if (recommendation === "no_response") return 0.2;
  if (recommendation === "clarify") return 0.65;
  if (hasQuestion && hasDestination) return 0.25;
  return hasQuestion ? 0.55 : 0.35;
}

function uncertaintyReasons(
  recommendation: ConversationResponseRecommendation,
  hasQuestion: boolean,
  hasDestination: boolean,
): string[] {
  if (recommendation === "human_review")
    return ["The reviewed intent or urgency requires human judgment."];
  if (recommendation === "no_response")
    return ["Contact safety or conversation order indicates that no reply should be drafted."];
  const reasons = [
    "The local assistant does not infer facts beyond cited structured context.",
  ];
  if (hasQuestion && !hasDestination)
    reasons.push("No approved Destination is attached to answer the identified question.");
  return reasons;
}

function recommendConversationPromotion(
  input: ConversationAssistantInput,
  recommendation: ConversationResponseRecommendation,
  hasDestination: boolean,
): PromotionalStrength {
  if (
    recommendation !== "respond" ||
    !hasDestination ||
    input.intent !== "availability"
  )
    return "informational";
  const campaignStrength = input.context.campaign?.promotionalStrength;
  return campaignStrength && ["light", "standard", "strong", "campaign_push"].includes(campaignStrength)
    ? "light"
    : "informational";
}
