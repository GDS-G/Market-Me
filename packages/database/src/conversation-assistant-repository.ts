import { createHash, randomUUID } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";
import type {
  CampaignObjective,
  ConversationAssistantContextSnapshot,
  ConversationIntent,
  ConversationMessageKind,
  ConversationResponseCitation,
  ConversationResponseClaim,
  ConversationSentiment,
  ConversationUrgency,
  DestinationStatus,
  PromotionalStrength,
  RelationshipStage,
} from "@market-me/domain";
import {
  CONVERSATION_ASSISTANT_MODEL,
  CONVERSATION_ASSISTANT_PROMPT_VERSION,
  CONVERSATION_ASSISTANT_PROVIDER,
  CONVERSATION_ASSISTANT_VERSION,
  generateGroundedConversationResponse,
  type GeneratedConversationResponseSuggestion,
} from "@market-me/generation";
import type { DatabaseClient } from "./client";
import { ConversationComposerRepository } from "./conversation-composer-repository";
import type {
  ConversationResponseSuggestionDecision,
  StoredConversationResponseSuggestion,
} from "./models";

interface AssistantThreadRow {
  id: string;
  relationshipId: string;
  contactName: string;
  relationshipStage: RelationshipStage;
  preferredTone?: string | null;
  effectiveContactPermission: "allowed" | "suppressed";
  intent: ConversationIntent;
  sentiment: ConversationSentiment;
  urgency: ConversationUrgency;
  brandId?: string | null;
  brandName?: string | null;
  brandVersionId?: string | null;
  brandVersionNumber?: number | null;
  campaignId?: string | null;
  campaignName?: string | null;
  campaignVersionId?: string | null;
  campaignVersionNumber?: number | null;
  campaignObjective?: CampaignObjective | null;
  campaignPromotionalStrength?: PromotionalStrength | null;
  destinationId?: string | null;
  destinationTitle?: string | null;
  destinationCanonicalUrl?: string | null;
  destinationStatus?: DestinationStatus | null;
}

interface AssistantMessageRow {
  id: string;
  kind: ConversationMessageKind;
  body: string;
  occurredAt: string | Date;
}

export class ConversationAssistantValidationError extends Error {
  constructor(readonly issues: readonly { field: string; message: string }[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "ConversationAssistantValidationError";
  }
}

export class ConversationAssistantRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async listSuggestions(
    workspaceId: string,
    conversationThreadId: string,
  ): Promise<StoredConversationResponseSuggestion[]> {
    const rows = await this.sql<StoredConversationResponseSuggestion[]>`
      SELECT id, workspace_id, conversation_thread_id, status, recommendation,
        summary, identified_questions, response_text, uncertainty,
        uncertainty_reasons, recommended_promotional_strength,
        proposed_destination_id, context_snapshot, citations, claims,
        input_fingerprint, generator_provider, generator_model,
        generator_version, prompt_version, generated_by, dismissed_by,
        dismissed_at, created_at
      FROM conversation_response_suggestion
      WHERE workspace_id = ${workspaceId}
        AND conversation_thread_id = ${conversationThreadId}
      ORDER BY created_at DESC, id DESC
      LIMIT 20
    `;
    return rows.map(normalizeSuggestion);
  }

  async generateSuggestion(
    workspaceId: string,
    conversationThreadId: string,
    actorUserId: string,
  ): Promise<StoredConversationResponseSuggestion> {
    const composer = new ConversationComposerRepository(this.sql);
    await composer.heartbeatPresence(
      workspaceId,
      conversationThreadId,
      "assistant",
      actorUserId,
    );
    try {
      return await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, workspaceId, actorUserId);
      const thread = await this.loadThreadContext(
        transaction,
        workspaceId,
        conversationThreadId,
      );
      const messages = await transaction<AssistantMessageRow[]>`
        SELECT id, kind, body, occurred_at
        FROM conversation_message
        WHERE workspace_id = ${workspaceId}
          AND conversation_thread_id = ${conversationThreadId}
          AND kind IN ('inbound', 'outbound_observed')
        ORDER BY occurred_at DESC, created_at DESC, id DESC
        LIMIT 20
      `;
      messages.reverse();
      const context = buildContextSnapshot(thread, messages);
      const generated = generateGroundedConversationResponse({
        contactName: thread.contactName,
        intent: thread.intent,
        sentiment: thread.sentiment,
        urgency: thread.urgency,
        context,
      });
      validateGeneratedSuggestion(generated);
      const inputFingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            intent: thread.intent,
            sentiment: thread.sentiment,
            urgency: thread.urgency,
            context,
          }),
        )
        .digest("hex");
      const id = randomUUID();
      await transaction`
        UPDATE conversation_response_suggestion
        SET status = 'superseded'
        WHERE workspace_id = ${workspaceId}
          AND conversation_thread_id = ${conversationThreadId}
          AND status = 'active'
      `;
      const rows = await transaction<StoredConversationResponseSuggestion[]>`
        INSERT INTO conversation_response_suggestion (
          id, workspace_id, conversation_thread_id, status, recommendation,
          summary, identified_questions, response_text, uncertainty,
          uncertainty_reasons, recommended_promotional_strength,
          proposed_destination_id, context_snapshot, citations, claims,
          input_fingerprint, generator_provider, generator_model,
          generator_version, prompt_version, generated_by
        ) VALUES (
          ${id}, ${workspaceId}, ${conversationThreadId}, 'active',
          ${generated.recommendation}, ${generated.summary},
          ${generated.identifiedQuestions as string[]},
          ${generated.responseText ?? null}, ${generated.uncertainty},
          ${generated.uncertaintyReasons as string[]},
          ${generated.recommendedPromotionalStrength},
          ${generated.proposedDestinationId ?? null},
          ${transaction.json(context as unknown as JSONValue)},
          ${transaction.json(generated.citations as unknown as JSONValue)},
          ${transaction.json(generated.claims as unknown as JSONValue)},
          ${inputFingerprint}, ${CONVERSATION_ASSISTANT_PROVIDER},
          ${CONVERSATION_ASSISTANT_MODEL}, ${CONVERSATION_ASSISTANT_VERSION},
          ${CONVERSATION_ASSISTANT_PROMPT_VERSION}, ${actorUserId}
        )
        RETURNING id, workspace_id, conversation_thread_id, status,
          recommendation, summary, identified_questions, response_text,
          uncertainty, uncertainty_reasons, recommended_promotional_strength,
          proposed_destination_id, context_snapshot, citations, claims,
          input_fingerprint, generator_provider, generator_model,
          generator_version, prompt_version, generated_by, dismissed_by,
          dismissed_at, created_at
      `;
      await this.audit(transaction, workspaceId, actorUserId, conversationThreadId, {
        suggestionId: id,
        recommendation: generated.recommendation,
        uncertainty: generated.uncertainty,
        questionCount: generated.identifiedQuestions.length,
        citationKinds: [...new Set(generated.citations.map((item) => item.kind))],
        hasResponse: Boolean(generated.responseText),
        proposedDestinationId: generated.proposedDestinationId ?? null,
        recommendedPromotionalStrength:
          generated.recommendedPromotionalStrength,
        generatorProvider: CONVERSATION_ASSISTANT_PROVIDER,
        generatorModel: CONVERSATION_ASSISTANT_MODEL,
        generatorVersion: CONVERSATION_ASSISTANT_VERSION,
        promptVersion: CONVERSATION_ASSISTANT_PROMPT_VERSION,
        inputFingerprint,
      });
        return normalizeSuggestion(rows[0]!);
      });
    } finally {
      await composer.clearPresence(
        workspaceId,
        conversationThreadId,
        "assistant",
        actorUserId,
      );
    }
  }

  async dismissSuggestion(
    suggestionId: string,
    input: ConversationResponseSuggestionDecision,
    actorUserId: string,
  ): Promise<StoredConversationResponseSuggestion | undefined> {
    return this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      const rows = await transaction<StoredConversationResponseSuggestion[]>`
        UPDATE conversation_response_suggestion
        SET status = 'dismissed', dismissed_by = ${actorUserId},
          dismissed_at = now()
        WHERE id = ${suggestionId}
          AND workspace_id = ${input.workspaceId}
          AND conversation_thread_id = ${input.conversationThreadId}
          AND status = 'active'
        RETURNING id, workspace_id, conversation_thread_id, status,
          recommendation, summary, identified_questions, response_text,
          uncertainty, uncertainty_reasons, recommended_promotional_strength,
          proposed_destination_id, context_snapshot, citations, claims,
          input_fingerprint, generator_provider, generator_model,
          generator_version, prompt_version, generated_by, dismissed_by,
          dismissed_at, created_at
      `;
      if (!rows[0]) return undefined;
      await this.audit(
        transaction,
        input.workspaceId,
        actorUserId,
        input.conversationThreadId,
        { suggestionId, status: "dismissed" },
        "conversation.response_suggestion_dismissed",
      );
      return normalizeSuggestion(rows[0]);
    });
  }

  private async loadThreadContext(
    transaction: TransactionSql,
    workspaceId: string,
    conversationThreadId: string,
  ): Promise<AssistantThreadRow> {
    const rows = await transaction<AssistantThreadRow[]>`
      SELECT thread.id,
        relationship.id AS relationship_id,
        relationship.display_name AS contact_name,
        relationship.stage AS relationship_stage,
        relationship.preferred_tone,
        relationship_effective_contact_permission(
          thread.workspace_id, relationship.id
        ) AS effective_contact_permission,
        thread.intent, thread.sentiment, thread.urgency,
        brand.id AS brand_id, brand.name AS brand_name,
        brand_version.id AS brand_version_id,
        brand_version.version_number AS brand_version_number,
        campaign.id AS campaign_id, campaign.name AS campaign_name,
        campaign_version.id AS campaign_version_id,
        campaign_version.version_number AS campaign_version_number,
        campaign_version.objective AS campaign_objective,
        campaign_version.promotional_strength AS campaign_promotional_strength,
        destination.id AS destination_id,
        destination.title AS destination_title,
        destination.canonical_url AS destination_canonical_url,
        destination.status AS destination_status
      FROM conversation_thread thread
      JOIN relationship_contact relationship
        ON relationship.id = thread.relationship_contact_id
        AND relationship.workspace_id = thread.workspace_id
      LEFT JOIN brand_profile brand
        ON brand.id = thread.brand_profile_id
        AND brand.workspace_id = thread.workspace_id
        AND brand.status = 'published'
      LEFT JOIN brand_profile_version brand_version
        ON brand_version.id = brand.current_version_id
        AND brand_version.status = 'published'
      LEFT JOIN campaign
        ON campaign.id = thread.campaign_id
        AND campaign.workspace_id = thread.workspace_id
      LEFT JOIN campaign_version
        ON campaign_version.id = campaign.current_version_id
        AND campaign_version.status = 'published'
      LEFT JOIN destination
        ON destination.id = thread.destination_id
        AND destination.workspace_id = thread.workspace_id
        AND destination.status = 'published'
      WHERE thread.id = ${conversationThreadId}
        AND thread.workspace_id = ${workspaceId}
      FOR UPDATE OF thread
    `;
    if (!rows[0]) {
      throw new ConversationAssistantValidationError([
        { field: "conversationThreadId", message: "Conversation not found." },
      ]);
    }
    return rows[0];
  }

  private async requireWriter(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
  ): Promise<void> {
    const rows = await transaction<{ found: boolean }[]>`
      SELECT true AS found
      FROM workspace_membership
      WHERE workspace_id = ${workspaceId} AND user_id = ${actorUserId}
        AND role IN ('owner', 'admin', 'editor')
    `;
    if (!rows[0]) {
      throw new ConversationAssistantValidationError([
        {
          field: "workspaceId",
          message: "Conversation suggestions require workspace authoring access.",
        },
      ]);
    }
  }

  private async audit(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
    subjectId: string,
    data: Record<string, unknown>,
    eventType = "conversation.response_suggestion_generated",
  ): Promise<void> {
    await transaction`
      INSERT INTO audit_event (
        id, organization_id, workspace_id, actor_user_id,
        event_type, subject_type, subject_id, data
      )
      SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
        ${eventType}, 'conversation_thread', ${subjectId},
        ${transaction.json(data as JSONValue)}
      FROM workspace WHERE id = ${workspaceId}
    `;
  }
}

function buildContextSnapshot(
  thread: AssistantThreadRow,
  messages: readonly AssistantMessageRow[],
): ConversationAssistantContextSnapshot {
  return {
    messages: messages.map((message) => ({
      id: message.id,
      kind: message.kind,
      body: message.body,
      occurredAt: new Date(message.occurredAt).toISOString(),
    })),
    relationship: {
      id: thread.relationshipId,
      stage: thread.relationshipStage,
      effectiveContactPermission: thread.effectiveContactPermission,
      ...(thread.preferredTone
        ? { preferredTone: thread.preferredTone }
        : {}),
    },
    ...(thread.brandId && thread.brandName
      ? {
          brand: {
            id: thread.brandId,
            name: thread.brandName,
            ...(thread.brandVersionId
              ? { versionId: thread.brandVersionId }
              : {}),
            ...(thread.brandVersionNumber
              ? { versionNumber: thread.brandVersionNumber }
              : {}),
          },
        }
      : {}),
    ...(thread.campaignId && thread.campaignName
      ? {
          campaign: {
            id: thread.campaignId,
            name: thread.campaignName,
            ...(thread.campaignVersionId
              ? { versionId: thread.campaignVersionId }
              : {}),
            ...(thread.campaignVersionNumber
              ? { versionNumber: thread.campaignVersionNumber }
              : {}),
            ...(thread.campaignObjective
              ? { objective: thread.campaignObjective }
              : {}),
            ...(thread.campaignPromotionalStrength
              ? {
                  promotionalStrength:
                    thread.campaignPromotionalStrength,
                }
              : {}),
          },
        }
      : {}),
    ...(thread.destinationId &&
    thread.destinationTitle &&
    thread.destinationCanonicalUrl &&
    thread.destinationStatus
      ? {
          destination: {
            id: thread.destinationId,
            title: thread.destinationTitle,
            canonicalUrl: thread.destinationCanonicalUrl,
            status: thread.destinationStatus,
          },
        }
      : {}),
  };
}

function validateGeneratedSuggestion(
  suggestion: GeneratedConversationResponseSuggestion,
): void {
  const issues: { field: string; message: string }[] = [];
  if (!suggestion.summary.trim() || suggestion.summary.length > 2000)
    issues.push({ field: "summary", message: "Assistant summary is invalid." });
  if (suggestion.identifiedQuestions.length > 5)
    issues.push({
      field: "identifiedQuestions",
      message: "Assistant returned too many questions.",
    });
  if (suggestion.uncertainty < 0 || suggestion.uncertainty > 1)
    issues.push({
      field: "uncertainty",
      message: "Assistant uncertainty must be between zero and one.",
    });
  if (
    (suggestion.recommendation === "respond" ||
      suggestion.recommendation === "clarify") !==
    Boolean(suggestion.responseText?.trim())
  )
    issues.push({
      field: "responseText",
      message: "Assistant response presence conflicts with its recommendation.",
    });
  for (const claim of suggestion.claims) {
    if (
      claim.citationIndexes.length === 0 ||
      claim.citationIndexes.some(
        (index) =>
          !Number.isInteger(index) ||
          index < 0 ||
          index >= suggestion.citations.length,
      )
    )
      issues.push({
        field: "claims",
        message: "Every assistant claim requires a valid citation.",
      });
  }
  if (issues.length) throw new ConversationAssistantValidationError(issues);
}

function normalizeSuggestion(
  suggestion: StoredConversationResponseSuggestion,
): StoredConversationResponseSuggestion {
  return {
    ...suggestion,
    responseText: suggestion.responseText ?? undefined,
    proposedDestinationId: suggestion.proposedDestinationId ?? undefined,
    dismissedBy: suggestion.dismissedBy ?? undefined,
    dismissedAt: suggestion.dismissedAt
      ? new Date(suggestion.dismissedAt).toISOString()
      : undefined,
    createdAt: new Date(suggestion.createdAt).toISOString(),
    uncertainty: Number(suggestion.uncertainty),
    citations: suggestion.citations as readonly ConversationResponseCitation[],
    claims: suggestion.claims as readonly ConversationResponseClaim[],
  };
}
