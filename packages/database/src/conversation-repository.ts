import { randomUUID } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";
import type {
  ConversationAttentionItem,
  ConversationAttentionReason,
  ConversationHandoffBrief,
  ConversationMessage,
  ConversationRetentionCandidate,
  ConversationRetentionClass,
  ConversationRetentionDeletedCounts,
  ConversationRetentionErasureRequest,
  ConversationLegalHoldCase,
  ConversationLegalHoldReleaseRequest,
  ConversationStatus,
} from "@market-me/domain";
import type { DatabaseClient } from "./client";
import type {
  ConversationMessageWrite,
  ConversationHandoffWrite,
  ConversationThreadQuery,
  ConversationThreadWrite,
  ConversationContextDirectory,
  ConversationRoutingRuleWrite,
  ConversationReviewRequestWrite,
  ConversationRetentionPolicyWrite,
  ConversationRetentionErasureDecisionWrite,
  ConversationRetentionErasureRequestWrite,
  ConversationLegalHoldReleaseDecisionWrite,
  ConversationLegalHoldReleaseRequestWrite,
  ConversationLegalHoldWrite,
  ConversationServiceLevelPolicyWrite,
  ConversationSharedResourceWrite,
  StoredConversationRoutingRule,
  StoredConversationReviewRequest,
  StoredConversationRetentionPolicy,
  StoredConversationServiceLevelPolicy,
  StoredConversationSharedResource,
  StoredConversationThread,
} from "./models";

type ConversationThreadRow = Omit<
  StoredConversationThread,
  | "messages"
  | "latestMessage"
  | "messageCount"
  | "handoffs"
  | "activeHandoff"
  | "unreadCount"
  | "lastReadAt"
  | "sharedResourceHistoryCount"
  | "recentSharedResources"
  | "routingSuggestion"
  | "serviceLevel"
  | "openReviewRequestCount"
  | "reviewRequests"
  | "retentionClassUpdatedBy"
  | "retentionClassUpdatedAt"
> & {
  routingRuleId?: string | null;
  routingRuleName?: string | null;
  routingPriority?: number | null;
  routingBrandProfileId?: string | null;
  routingChannelConnectionId?: string | null;
  routingRelationshipStage?: string | null;
  routingIntent?: string | null;
  routingUrgency?: string | null;
  routingTargetOwnerId?: string | null;
  routingTargetOwnerDisplayName?: string | null;
  routingTargetStatus?: ConversationStatus | null;
  serviceLevelStartedAt?: string | Date | null;
  serviceLevelDueAt?: string | Date | null;
  serviceLevelSource?: "manual" | "workspace_policy" | null;
  serviceLevelAtRiskBeforeMinutes?: number | null;
  openReviewRequestCount?: number | null;
  retentionClassUpdatedBy?: string | null;
  retentionClassUpdatedAt?: string | Date | null;
};

type SharedResourceRow = Omit<
  StoredConversationSharedResource,
  "isCurrentThread"
>;

interface ConversationAttentionRow {
  conversationThreadId: string;
  subject: string;
  relationshipDisplayName: string;
  status: ConversationStatus;
  assignedOwnerId?: string | null;
  assignedOwnerDisplayName?: string | null;
  serviceLevelDueAt?: string | Date | null;
  atRiskBeforeMinutes?: number | null;
  escalationAfterMinutes?: number | null;
  followUpAt?: string | Date | null;
  reviewRequestDueAt?: string | Date | null;
  handoffDueAt?: string | Date | null;
}

interface ConversationRetentionCandidateRow {
  conversationThreadId: string;
  subject: string;
  relationshipDisplayName: string;
  status: "resolved" | "archived";
  retentionClass: Exclude<ConversationRetentionClass, "legal_hold">;
  lastActivityAt: string | Date;
  eligibleAfter: string | Date;
}

type ConversationRetentionErasureRow = Omit<
  ConversationRetentionErasureRequest,
  | "eligibleAfter"
  | "requestedAt"
  | "decidedAt"
  | "decidedBy"
  | "decidedByDisplayName"
  | "decisionNote"
  | "deletedCounts"
  | "subject"
  | "relationshipDisplayName"
> & {
  eligibleAfter: string | Date;
  requestedAt: string | Date;
  decidedBy?: string | null;
  decidedByDisplayName?: string | null;
  decidedAt?: string | Date | null;
  decisionNote?: string | null;
  deletedCounts?: ConversationRetentionDeletedCounts | null;
  subject?: string | null;
  relationshipDisplayName?: string | null;
};

type ConversationLegalHoldRow = Omit<
  ConversationLegalHoldCase,
  "caseReference" | "placedAt" | "releasedBy" | "releasedByDisplayName" |
  "releasedAt" | "releaseRequestId" | "subject" | "relationshipDisplayName"
> & {
  caseReference?: string | null;
  placedAt: string | Date;
  releasedBy?: string | null;
  releasedByDisplayName?: string | null;
  releasedAt?: string | Date | null;
  releaseRequestId?: string | null;
  subject?: string | null;
  relationshipDisplayName?: string | null;
};

type ConversationLegalHoldReleaseRow = Omit<
  ConversationLegalHoldReleaseRequest,
  "requestedAt" | "decidedBy" | "decidedByDisplayName" | "decidedAt" |
  "decisionNote" | "subject" | "relationshipDisplayName"
> & {
  requestedAt: string | Date;
  decidedBy?: string | null;
  decidedByDisplayName?: string | null;
  decidedAt?: string | Date | null;
  decisionNote?: string | null;
  subject?: string | null;
  relationshipDisplayName?: string | null;
};

type SharedResourceHistoryRow = SharedResourceRow & {
  contextThreadId: string;
  historyCount: number;
  resourceRank: number;
};

export class ConversationValidationError extends Error {
  constructor(readonly issues: readonly { field: string; message: string }[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "ConversationValidationError";
  }
}

export class ConversationRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async listContextDirectory(
    workspaceId: string,
  ): Promise<ConversationContextDirectory> {
    const [brands, channels, publications] = await Promise.all([
      this.sql<ConversationContextDirectory["brands"]>`
        SELECT id, name, status
        FROM brand_profile
        WHERE workspace_id = ${workspaceId}
        ORDER BY lower(name), id
        LIMIT 200
      `,
      this.sql<ConversationContextDirectory["channels"]>`
        SELECT id, name, provider, status
        FROM channel_connection
        WHERE workspace_id = ${workspaceId}
        ORDER BY lower(name), id
        LIMIT 200
      `,
      this.sql<
        {
          id: string;
          channelConnectionId: string;
          channelConnectionName: string;
          provider: string;
          providerExternalId: string | null;
          status: string;
          startedAt: string | Date;
        }[]
      >`
        SELECT publication.id, publication.channel_connection_id,
          channel.name AS channel_connection_name, channel.provider,
          publication.provider_external_id, publication.status,
          publication.started_at
        FROM publication_action publication
        JOIN channel_connection channel
          ON channel.id = publication.channel_connection_id
          AND channel.workspace_id = publication.workspace_id
        WHERE publication.workspace_id = ${workspaceId}
        ORDER BY publication.started_at DESC, publication.id
        LIMIT 200
      `,
    ]);
    return {
      brands,
      channels,
      publications: publications.map((publication) => ({
        ...publication,
        providerExternalId: publication.providerExternalId ?? undefined,
        startedAt: normalizeTimestamp(publication.startedAt)!,
      })),
    };
  }

  async listRoutingRules(
    workspaceId: string,
  ): Promise<StoredConversationRoutingRule[]> {
    const rows = await this.sql<StoredConversationRoutingRule[]>`
      SELECT rule.id, rule.workspace_id, rule.name, rule.enabled, rule.priority,
        rule.brand_profile_id, brand.name AS brand_profile_name,
        rule.channel_connection_id, channel.name AS channel_connection_name,
        rule.relationship_stage, rule.intent, rule.urgency,
        rule.target_owner_id, owner.display_name AS target_owner_display_name,
        rule.target_status, rule.created_by, rule.created_at, rule.updated_at
      FROM conversation_routing_rule rule
      LEFT JOIN brand_profile brand
        ON brand.id = rule.brand_profile_id
        AND brand.workspace_id = rule.workspace_id
      LEFT JOIN channel_connection channel
        ON channel.id = rule.channel_connection_id
        AND channel.workspace_id = rule.workspace_id
      LEFT JOIN app_user owner ON owner.id = rule.target_owner_id
      WHERE rule.workspace_id = ${workspaceId}
      ORDER BY rule.priority DESC, lower(rule.name), rule.id
      LIMIT 200
    `;
    return rows.map(normalizeRoutingRule);
  }

  async saveRoutingRule(
    input: ConversationRoutingRuleWrite,
    actorUserId: string,
    id: string = randomUUID(),
  ): Promise<StoredConversationRoutingRule | undefined> {
    const matcherCount = [
      input.brandProfileId,
      input.channelConnectionId,
      input.relationshipStage,
      input.intent,
      input.urgency,
    ].filter(Boolean).length;
    if (!matcherCount) {
      throw new ConversationValidationError([
        { field: "name", message: "Choose at least one routing matcher." },
      ]);
    }
    if (
      (input.targetStatus === "assigned" && !input.targetOwnerId) ||
      (input.targetStatus !== "assigned" && input.targetOwnerId)
    ) {
      throw new ConversationValidationError([
        {
          field: "targetOwnerId",
          message:
            "Routing owner and assigned status must be selected together.",
        },
      ]);
    }
    const saved = await this.sql.begin(async (transaction) => {
      await this.validateRoutingOwner(
        transaction,
        input.workspaceId,
        input.targetOwnerId,
      );
      if (input.brandProfileId) {
        const brands = await transaction<{ id: string }[]>`
          SELECT id FROM brand_profile
          WHERE id = ${input.brandProfileId}
            AND workspace_id = ${input.workspaceId}
        `;
        if (!brands[0]) {
          throw new ConversationValidationError([
            {
              field: "brandProfileId",
              message: "Brand must belong to this workspace.",
            },
          ]);
        }
      }
      if (input.channelConnectionId) {
        const channels = await transaction<{ id: string }[]>`
          SELECT id FROM channel_connection
          WHERE id = ${input.channelConnectionId}
            AND workspace_id = ${input.workspaceId}
        `;
        if (!channels[0]) {
          throw new ConversationValidationError([
            {
              field: "channelConnectionId",
              message: "Account must belong to this workspace.",
            },
          ]);
        }
      }
      const duplicates = await transaction<{ id: string }[]>`
        SELECT id FROM conversation_routing_rule
        WHERE workspace_id = ${input.workspaceId}
          AND lower(name) = lower(${input.name}) AND id <> ${id}
      `;
      if (duplicates[0]) {
        throw new ConversationValidationError([
          { field: "name", message: "Routing rule names must be unique." },
        ]);
      }
      const rows = await transaction<{ id: string }[]>`
        INSERT INTO conversation_routing_rule (
          id, workspace_id, name, enabled, priority,
          brand_profile_id, channel_connection_id, relationship_stage,
          intent, urgency, target_owner_id, target_status, created_by
        ) VALUES (
          ${id}, ${input.workspaceId}, ${input.name}, ${input.enabled},
          ${input.priority}, ${input.brandProfileId ?? null},
          ${input.channelConnectionId ?? null},
          ${input.relationshipStage ?? null}, ${input.intent ?? null},
          ${input.urgency ?? null}, ${input.targetOwnerId ?? null},
          ${input.targetStatus}, ${actorUserId}
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, enabled = EXCLUDED.enabled,
          priority = EXCLUDED.priority,
          brand_profile_id = EXCLUDED.brand_profile_id,
          channel_connection_id = EXCLUDED.channel_connection_id,
          relationship_stage = EXCLUDED.relationship_stage,
          intent = EXCLUDED.intent, urgency = EXCLUDED.urgency,
          target_owner_id = EXCLUDED.target_owner_id,
          target_status = EXCLUDED.target_status, updated_at = now()
        WHERE conversation_routing_rule.workspace_id = EXCLUDED.workspace_id
        RETURNING id
      `;
      if (!rows[0]) return undefined;
      await this.auditRoutingRule(
        transaction,
        input.workspaceId,
        actorUserId,
        "conversation.routing_rule_saved",
        id,
        {
          enabled: input.enabled,
          priority: input.priority,
          brandProfileId: input.brandProfileId ?? null,
          channelConnectionId: input.channelConnectionId ?? null,
          relationshipStage: input.relationshipStage ?? null,
          intent: input.intent ?? null,
          urgency: input.urgency ?? null,
          targetOwnerId: input.targetOwnerId ?? null,
          targetStatus: input.targetStatus,
        },
      );
      return id;
    });
    return saved
      ? (await this.listRoutingRules(input.workspaceId)).find(
          (rule) => rule.id === saved,
        )
      : undefined;
  }

  async setRoutingRuleEnabled(
    workspaceId: string,
    id: string,
    enabled: boolean,
    actorUserId: string,
  ): Promise<StoredConversationRoutingRule | undefined> {
    const saved = await this.sql.begin(async (transaction) => {
      const rows = await transaction<{ id: string }[]>`
        UPDATE conversation_routing_rule
        SET enabled = ${enabled}, updated_at = now()
        WHERE workspace_id = ${workspaceId} AND id = ${id}
        RETURNING id
      `;
      if (!rows[0]) return undefined;
      await this.auditRoutingRule(
        transaction,
        workspaceId,
        actorUserId,
        "conversation.routing_rule_enabled_changed",
        id,
        { enabled },
      );
      return id;
    });
    return saved
      ? (await this.listRoutingRules(workspaceId)).find(
          (rule) => rule.id === saved,
        )
      : undefined;
  }

  async getServiceLevelPolicy(
    workspaceId: string,
  ): Promise<StoredConversationServiceLevelPolicy | undefined> {
    const rows = await this.sql<StoredConversationServiceLevelPolicy[]>`
      SELECT workspace_id, timezone, business_days_mask,
        business_start_time::text, business_end_time::text,
        unknown_target_minutes, low_target_minutes, normal_target_minutes,
        high_target_minutes, critical_target_minutes, at_risk_before_minutes,
        escalation_after_minutes,
        created_by, updated_by, created_at, updated_at
      FROM conversation_service_level_policy
      WHERE workspace_id = ${workspaceId}
    `;
    return rows[0] ? normalizeServiceLevelPolicy(rows[0]) : undefined;
  }

  async saveServiceLevelPolicy(
    input: ConversationServiceLevelPolicyWrite,
    actorUserId: string,
  ): Promise<StoredConversationServiceLevelPolicy> {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: input.timezone }).format();
    } catch {
      throw new ConversationValidationError([
        { field: "timezone", message: "Choose a valid IANA timezone." },
      ]);
    }
    await this.sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO conversation_service_level_policy (
          workspace_id, timezone, business_days_mask,
          business_start_time, business_end_time,
          unknown_target_minutes, low_target_minutes, normal_target_minutes,
          high_target_minutes, critical_target_minutes, at_risk_before_minutes,
          escalation_after_minutes,
          created_by, updated_by
        ) VALUES (
          ${input.workspaceId}, ${input.timezone}, ${input.businessDaysMask},
          ${input.businessStartTime}, ${input.businessEndTime},
          ${input.unknownTargetMinutes}, ${input.lowTargetMinutes},
          ${input.normalTargetMinutes}, ${input.highTargetMinutes},
          ${input.criticalTargetMinutes}, ${input.atRiskBeforeMinutes},
          ${input.escalationAfterMinutes},
          ${actorUserId}, ${actorUserId}
        )
        ON CONFLICT (workspace_id) DO UPDATE SET
          timezone = EXCLUDED.timezone,
          business_days_mask = EXCLUDED.business_days_mask,
          business_start_time = EXCLUDED.business_start_time,
          business_end_time = EXCLUDED.business_end_time,
          unknown_target_minutes = EXCLUDED.unknown_target_minutes,
          low_target_minutes = EXCLUDED.low_target_minutes,
          normal_target_minutes = EXCLUDED.normal_target_minutes,
          high_target_minutes = EXCLUDED.high_target_minutes,
          critical_target_minutes = EXCLUDED.critical_target_minutes,
          at_risk_before_minutes = EXCLUDED.at_risk_before_minutes,
          escalation_after_minutes = EXCLUDED.escalation_after_minutes,
          updated_by = EXCLUDED.updated_by, updated_at = now()
      `;
      await this.auditServiceLevelPolicy(
        transaction,
        input.workspaceId,
        actorUserId,
        {
          timezone: input.timezone,
          businessDaysMask: input.businessDaysMask,
          businessStartTime: input.businessStartTime,
          businessEndTime: input.businessEndTime,
          unknownTargetMinutes: input.unknownTargetMinutes,
          lowTargetMinutes: input.lowTargetMinutes,
          normalTargetMinutes: input.normalTargetMinutes,
          highTargetMinutes: input.highTargetMinutes,
          criticalTargetMinutes: input.criticalTargetMinutes,
          atRiskBeforeMinutes: input.atRiskBeforeMinutes,
          escalationAfterMinutes: input.escalationAfterMinutes,
        },
      );
    });
    return (await this.getServiceLevelPolicy(input.workspaceId))!;
  }

  async listAttentionItems(
    workspaceId: string,
    asOf: Date = new Date(),
  ): Promise<ConversationAttentionItem[]> {
    const rows = await this.sql<ConversationAttentionRow[]>`
      SELECT thread.id AS conversation_thread_id, thread.subject,
        relationship.display_name AS relationship_display_name,
        thread.status, thread.assigned_owner_id,
        assigned_owner.display_name AS assigned_owner_display_name,
        service_level.due_at AS service_level_due_at,
        service_policy.at_risk_before_minutes,
        service_policy.escalation_after_minutes,
        thread.follow_up_at,
        review_due.due_at AS review_request_due_at,
        handoff_due.due_at AS handoff_due_at
      FROM conversation_thread thread
      JOIN relationship_contact relationship
        ON relationship.id = thread.relationship_contact_id
        AND relationship.workspace_id = thread.workspace_id
      LEFT JOIN app_user assigned_owner ON assigned_owner.id = thread.assigned_owner_id
      LEFT JOIN conversation_service_level_policy service_policy
        ON service_policy.workspace_id = thread.workspace_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(max(message.created_at), thread.created_at) AS started_at
        FROM conversation_message message
        WHERE message.workspace_id = thread.workspace_id
          AND message.conversation_thread_id = thread.id
          AND message.kind = 'inbound'
      ) service_activity ON true
      LEFT JOIN LATERAL (
        SELECT CASE WHEN service_policy.workspace_id IS NOT NULL THEN
          COALESCE(
            thread.response_due_at,
            conversation_add_business_minutes(
              service_activity.started_at,
              service_policy.timezone,
              service_policy.business_days_mask,
              service_policy.business_start_time,
              service_policy.business_end_time,
              CASE thread.urgency
                WHEN 'low' THEN service_policy.low_target_minutes
                WHEN 'normal' THEN service_policy.normal_target_minutes
                WHEN 'high' THEN service_policy.high_target_minutes
                WHEN 'critical' THEN service_policy.critical_target_minutes
                ELSE service_policy.unknown_target_minutes
              END
            )
          ) END AS due_at
      ) service_level ON true
      LEFT JOIN LATERAL (
        SELECT min(review.due_at) AS due_at
        FROM conversation_review_request review
        WHERE review.workspace_id = thread.workspace_id
          AND review.conversation_thread_id = thread.id
          AND review.status = 'open' AND review.due_at IS NOT NULL
      ) review_due ON true
      LEFT JOIN LATERAL (
        SELECT min(handoff.due_at) AS due_at
        FROM conversation_handoff_brief handoff
        WHERE handoff.workspace_id = thread.workspace_id
          AND handoff.conversation_thread_id = thread.id
          AND handoff.status = 'open' AND handoff.due_at IS NOT NULL
      ) handoff_due ON true
      WHERE thread.workspace_id = ${workspaceId}
        AND thread.status NOT IN ('resolved', 'archived')
        AND (
          service_level.due_at <= ${asOf}::timestamptz
            + service_policy.at_risk_before_minutes * interval '1 minute'
          OR thread.follow_up_at <= ${asOf}
          OR review_due.due_at <= ${asOf}
          OR handoff_due.due_at <= ${asOf}
        )
      ORDER BY LEAST(
        COALESCE(service_level.due_at, 'infinity'::timestamptz),
        COALESCE(thread.follow_up_at, 'infinity'::timestamptz),
        COALESCE(review_due.due_at, 'infinity'::timestamptz),
        COALESCE(handoff_due.due_at, 'infinity'::timestamptz)
      ), thread.id
      LIMIT 200
    `;
    return rows
      .map((row) => normalizeAttentionItem(row, asOf))
      .sort(compareAttentionItems);
  }

  async getRetentionPolicy(
    workspaceId: string,
  ): Promise<StoredConversationRetentionPolicy | undefined> {
    const rows = await this.sql<StoredConversationRetentionPolicy[]>`
      SELECT workspace_id, enabled, standard_days, personal_message_days,
        imported_email_days, created_by, updated_by, created_at, updated_at
      FROM conversation_retention_policy
      WHERE workspace_id = ${workspaceId}
    `;
    return rows[0] ? normalizeRetentionPolicy(rows[0]) : undefined;
  }

  async saveRetentionPolicy(
    input: ConversationRetentionPolicyWrite,
    actorUserId: string,
  ): Promise<StoredConversationRetentionPolicy> {
    await this.sql.begin(async (transaction) => {
      await this.requireConversationWriter(
        transaction,
        input.workspaceId,
        actorUserId,
      );
      await transaction`
        INSERT INTO conversation_retention_policy (
          workspace_id, enabled, standard_days, personal_message_days,
          imported_email_days, created_by, updated_by
        ) VALUES (
          ${input.workspaceId}, ${input.enabled}, ${input.standardDays},
          ${input.personalMessageDays}, ${input.importedEmailDays},
          ${actorUserId}, ${actorUserId}
        )
        ON CONFLICT (workspace_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          standard_days = EXCLUDED.standard_days,
          personal_message_days = EXCLUDED.personal_message_days,
          imported_email_days = EXCLUDED.imported_email_days,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
      `;
      await this.auditRetentionPolicy(
        transaction,
        input.workspaceId,
        actorUserId,
        {
          enabled: input.enabled,
          standardDays: input.standardDays,
          personalMessageDays: input.personalMessageDays,
          importedEmailDays: input.importedEmailDays,
        },
      );
    });
    return (await this.getRetentionPolicy(input.workspaceId))!;
  }

  async setRetentionClass(
    workspaceId: string,
    conversationThreadId: string,
    retentionClass: ConversationRetentionClass,
    actorUserId: string,
  ): Promise<StoredConversationThread | undefined> {
    if (retentionClass === "legal_hold") {
      throw new ConversationValidationError([
        {
          field: "retentionClass",
          message: "Place a reasoned legal hold through the legal-hold workflow.",
        },
      ]);
    }
    const changed = await this.sql.begin(async (transaction) => {
      await this.requireConversationWriter(
        transaction,
        workspaceId,
        actorUserId,
      );
      const rows = await transaction<
        { retentionClass: ConversationRetentionClass }[]
      >`
        SELECT retention_class FROM conversation_thread
        WHERE workspace_id = ${workspaceId} AND id = ${conversationThreadId}
        FOR UPDATE
      `;
      if (!rows[0]) return undefined;
      if (rows[0].retentionClass === "legal_hold") {
        throw new ConversationValidationError([
          {
            field: "retentionClass",
            message: "A legal hold can be removed only through an approved release request.",
          },
        ]);
      }
      if (rows[0].retentionClass === retentionClass) return false;
      await transaction`
        UPDATE conversation_thread
        SET retention_class = ${retentionClass},
          retention_class_updated_by = ${actorUserId},
          retention_class_updated_at = now(), retention_revision = retention_revision + 1,
          updated_at = now()
        WHERE workspace_id = ${workspaceId} AND id = ${conversationThreadId}
      `;
      await this.audit(
        transaction,
        workspaceId,
        actorUserId,
        "conversation.retention_class_changed",
        conversationThreadId,
        {
          previousRetentionClass: rows[0].retentionClass,
          retentionClass,
        },
      );
      return true;
    });
    return changed === undefined
      ? undefined
      : this.getThread(workspaceId, conversationThreadId);
  }

  async listRetentionCandidates(
    workspaceId: string,
    asOf: Date = new Date(),
  ): Promise<ConversationRetentionCandidate[]> {
    const rows = await this.sql<ConversationRetentionCandidateRow[]>`
      SELECT thread.id AS conversation_thread_id, thread.subject,
        relationship.display_name AS relationship_display_name,
        thread.status, thread.retention_class,
        activity.last_activity_at, eligibility.eligible_after
      FROM conversation_thread thread
      JOIN conversation_retention_policy policy
        ON policy.workspace_id = thread.workspace_id AND policy.enabled
      JOIN relationship_contact relationship
        ON relationship.id = thread.relationship_contact_id
        AND relationship.workspace_id = thread.workspace_id
      CROSS JOIN LATERAL (
        SELECT COALESCE(thread.last_message_at, thread.created_at)
          AS last_activity_at
      ) activity
      CROSS JOIN LATERAL (
        SELECT activity.last_activity_at +
          CASE thread.retention_class
            WHEN 'personal_message' THEN policy.personal_message_days
            WHEN 'imported_email' THEN policy.imported_email_days
            ELSE policy.standard_days
          END * interval '1 day' AS eligible_after
      ) eligibility
      WHERE thread.workspace_id = ${workspaceId}
        AND thread.status IN ('resolved', 'archived')
        AND thread.retention_class <> 'legal_hold'
        AND eligibility.eligible_after <= ${asOf}
      ORDER BY eligibility.eligible_after, thread.id
      LIMIT 200
    `;
    return rows.map((row) => ({
      ...row,
      lastActivityAt: normalizeTimestamp(row.lastActivityAt)!,
      eligibleAfter: normalizeTimestamp(row.eligibleAfter)!,
    }));
  }

  async listRetentionErasureRequests(
    workspaceId: string,
  ): Promise<ConversationRetentionErasureRequest[]> {
    const rows = await this.sql<ConversationRetentionErasureRow[]>`
      SELECT request.id, request.workspace_id, request.conversation_thread_id,
        request.retention_class, request.eligible_after, request.status,
        request.request_note, request.requested_by,
        request.thread_retention_revision,
        requester.display_name AS requested_by_display_name,
        request.requested_at, request.decided_by,
        decider.display_name AS decided_by_display_name,
        request.decided_at, request.decision_note, request.deleted_counts,
        thread.subject, relationship.display_name AS relationship_display_name
      FROM conversation_retention_erasure_request request
      JOIN app_user requester ON requester.id = request.requested_by
      LEFT JOIN app_user decider ON decider.id = request.decided_by
      LEFT JOIN conversation_thread thread
        ON thread.id = request.conversation_thread_id
        AND thread.workspace_id = request.workspace_id
      LEFT JOIN relationship_contact relationship
        ON relationship.id = thread.relationship_contact_id
        AND relationship.workspace_id = thread.workspace_id
      WHERE request.workspace_id = ${workspaceId}
      ORDER BY
        CASE request.status WHEN 'pending' THEN 0 ELSE 1 END,
        request.requested_at DESC, request.id
      LIMIT 200
    `;
    return rows.map(normalizeRetentionErasureRequest);
  }

  async requestRetentionErasure(
    input: ConversationRetentionErasureRequestWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<ConversationRetentionErasureRequest | undefined> {
    const requestId = await this.sql.begin(async (transaction) => {
      await this.requireConversationWriter(
        transaction,
        input.workspaceId,
        actorUserId,
      );
      const eligibility = await this.lockRetentionEligibility(
        transaction,
        input.workspaceId,
        input.conversationThreadId,
        asOf,
      );
      if (!eligibility) return undefined;
      const existing = await transaction<{ id: string }[]>`
        SELECT id FROM conversation_retention_erasure_request
        WHERE workspace_id = ${input.workspaceId}
          AND conversation_thread_id = ${input.conversationThreadId}
          AND status = 'pending'
      `;
      if (existing[0]) return existing[0].id;
      const id = randomUUID();
      await transaction`
        INSERT INTO conversation_retention_erasure_request (
          id, workspace_id, conversation_thread_id, retention_class,
          eligible_after, request_note, requested_by, thread_retention_revision
        ) VALUES (
          ${id}, ${input.workspaceId}, ${input.conversationThreadId},
          ${eligibility.retentionClass}, ${eligibility.eligibleAfter},
          ${input.requestNote.trim()}, ${actorUserId}, ${eligibility.retentionRevision}
        )
      `;
      await this.auditRetentionErasure(
        transaction,
        input.workspaceId,
        actorUserId,
        "conversation.retention_erasure_requested",
        id,
        {
          conversationThreadId: input.conversationThreadId,
          retentionClass: eligibility.retentionClass,
          eligibleAfter: eligibility.eligibleAfter,
          threadRetentionRevision: eligibility.retentionRevision,
        },
      );
      return id;
    });
    if (!requestId) return undefined;
    return (await this.listRetentionErasureRequests(input.workspaceId)).find(
      (request) => request.id === requestId,
    );
  }

  async decideRetentionErasure(
    input: ConversationRetentionErasureDecisionWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<ConversationRetentionErasureRequest | undefined> {
    const decided = await this.sql.begin(async (transaction) => {
      await this.requireConversationApprover(
        transaction,
        input.workspaceId,
        actorUserId,
      );
      const requests = await transaction<
        {
          conversationThreadId: string;
          requestedBy: string;
          retentionClass: Exclude<ConversationRetentionClass, "legal_hold">;
          eligibleAfter: string | Date;
          threadRetentionRevision: number;
          status: "pending" | "executed" | "rejected";
        }[]
      >`
        SELECT conversation_thread_id, requested_by, retention_class,
          eligible_after, thread_retention_revision, status
        FROM conversation_retention_erasure_request
        WHERE id = ${input.requestId} AND workspace_id = ${input.workspaceId}
        FOR UPDATE
      `;
      const request = requests[0];
      if (!request || request.status !== "pending") return false;
      if (request.requestedBy === actorUserId) {
        throw new ConversationValidationError([
          {
            field: "requestId",
            message: "A different workspace approver must decide this erasure request.",
          },
        ]);
      }
      if (input.decision === "reject") {
        await transaction`
          UPDATE conversation_retention_erasure_request
          SET status = 'rejected', decided_by = ${actorUserId},
            decided_at = now(), decision_note = ${input.decisionNote.trim()}
          WHERE id = ${input.requestId}
        `;
        await this.auditRetentionErasure(
          transaction,
          input.workspaceId,
          actorUserId,
          "conversation.retention_erasure_rejected",
          input.requestId,
          { conversationThreadId: request.conversationThreadId },
        );
        return true;
      }

      const eligibility = await this.lockRetentionEligibility(
        transaction,
        input.workspaceId,
        request.conversationThreadId,
        asOf,
      );
      if (!eligibility) {
        throw new ConversationValidationError([
          {
            field: "requestId",
            message: "The conversation no longer exists and cannot be erased again.",
          },
        ]);
      }
      if (
        request.retentionClass !== eligibility.retentionClass ||
        normalizeTimestamp(request.eligibleAfter) !== eligibility.eligibleAfter ||
        request.threadRetentionRevision !== eligibility.retentionRevision
      ) {
        throw new ConversationValidationError([
          {
            field: "requestId",
            message: "The retention policy or class changed. Reject this stale request and create a new one.",
          },
        ]);
      }
      const counts = (
        await transaction<ConversationRetentionDeletedCounts[]>`
          SELECT 1::integer AS threads,
            (SELECT count(*)::integer FROM conversation_message
              WHERE workspace_id = ${input.workspaceId}
                AND conversation_thread_id = ${request.conversationThreadId}) AS messages,
            (SELECT count(*)::integer FROM conversation_handoff_brief
              WHERE workspace_id = ${input.workspaceId}
                AND conversation_thread_id = ${request.conversationThreadId}) AS handoff_briefs,
            (SELECT count(*)::integer FROM conversation_read_state
              WHERE workspace_id = ${input.workspaceId}
                AND conversation_thread_id = ${request.conversationThreadId}) AS read_states,
            (SELECT count(*)::integer FROM conversation_drafting_presence
              WHERE workspace_id = ${input.workspaceId}
                AND conversation_thread_id = ${request.conversationThreadId}) AS drafting_presence,
            (SELECT count(*)::integer FROM conversation_response_suggestion
              WHERE workspace_id = ${input.workspaceId}
                AND conversation_thread_id = ${request.conversationThreadId}) AS response_suggestions,
            (SELECT count(*)::integer FROM conversation_response_draft
              WHERE workspace_id = ${input.workspaceId}
                AND conversation_thread_id = ${request.conversationThreadId}) AS response_drafts,
            (SELECT count(*)::integer FROM conversation_review_request
              WHERE workspace_id = ${input.workspaceId}
                AND conversation_thread_id = ${request.conversationThreadId}) AS review_requests,
            (SELECT count(*)::integer FROM conversation_review_request_mention
              WHERE workspace_id = ${input.workspaceId}
                AND conversation_thread_id = ${request.conversationThreadId}) AS review_mentions,
            (SELECT count(*)::integer FROM conversation_shared_resource
              WHERE workspace_id = ${input.workspaceId}
                AND conversation_thread_id = ${request.conversationThreadId}) AS shared_resources
        `
      )[0]!;
      await transaction`
        DELETE FROM conversation_thread
        WHERE id = ${request.conversationThreadId}
          AND workspace_id = ${input.workspaceId}
      `;
      await transaction`
        UPDATE conversation_retention_erasure_request
        SET status = 'executed', decided_by = ${actorUserId},
          decided_at = now(), decision_note = ${input.decisionNote.trim()},
          deleted_counts = ${transaction.json(counts as unknown as JSONValue)}
        WHERE id = ${input.requestId}
      `;
      await this.auditRetentionErasure(
        transaction,
        input.workspaceId,
        actorUserId,
        "conversation.retention_erasure_executed",
        input.requestId,
        {
          conversationThreadId: request.conversationThreadId,
          retentionClass: eligibility.retentionClass,
          eligibleAfter: eligibility.eligibleAfter,
          threadRetentionRevision: eligibility.retentionRevision,
          deletedCounts: counts,
        },
      );
      return true;
    });
    if (!decided) return undefined;
    return (await this.listRetentionErasureRequests(input.workspaceId)).find(
      (request) => request.id === input.requestId,
    );
  }

  async listLegalHoldCases(
    workspaceId: string,
    conversationThreadId: string,
  ): Promise<ConversationLegalHoldCase[]> {
    const rows = await this.sql<ConversationLegalHoldRow[]>`
      SELECT hold.id, hold.workspace_id, hold.conversation_thread_id,
        hold.previous_retention_class, hold.reason, hold.case_reference,
        hold.status, hold.placed_by, placer.display_name AS placed_by_display_name,
        hold.placed_at, hold.released_by,
        releaser.display_name AS released_by_display_name,
        hold.released_at, hold.release_request_id, thread.subject,
        relationship.display_name AS relationship_display_name
      FROM conversation_legal_hold_case hold
      JOIN app_user placer ON placer.id = hold.placed_by
      LEFT JOIN app_user releaser ON releaser.id = hold.released_by
      LEFT JOIN conversation_thread thread
        ON thread.workspace_id = hold.workspace_id
        AND thread.id = hold.conversation_thread_id
      LEFT JOIN relationship_contact relationship
        ON relationship.workspace_id = thread.workspace_id
        AND relationship.id = thread.relationship_contact_id
      WHERE hold.workspace_id = ${workspaceId}
        AND hold.conversation_thread_id = ${conversationThreadId}
      ORDER BY hold.placed_at DESC, hold.id
      LIMIT 100
    `;
    return rows.map(normalizeLegalHoldCase);
  }

  async listActiveLegalHolds(
    workspaceId: string,
  ): Promise<ConversationLegalHoldCase[]> {
    const rows = await this.sql<ConversationLegalHoldRow[]>`
      SELECT hold.id, hold.workspace_id, hold.conversation_thread_id,
        hold.previous_retention_class, hold.reason, hold.case_reference,
        hold.status, hold.placed_by, placer.display_name AS placed_by_display_name,
        hold.placed_at, hold.released_by,
        releaser.display_name AS released_by_display_name,
        hold.released_at, hold.release_request_id, thread.subject,
        relationship.display_name AS relationship_display_name
      FROM conversation_legal_hold_case hold
      JOIN app_user placer ON placer.id = hold.placed_by
      LEFT JOIN app_user releaser ON releaser.id = hold.released_by
      LEFT JOIN conversation_thread thread
        ON thread.workspace_id = hold.workspace_id
        AND thread.id = hold.conversation_thread_id
      LEFT JOIN relationship_contact relationship
        ON relationship.workspace_id = thread.workspace_id
        AND relationship.id = thread.relationship_contact_id
      WHERE hold.workspace_id = ${workspaceId} AND hold.status = 'active'
      ORDER BY hold.placed_at DESC, hold.id
      LIMIT 200
    `;
    return rows.map(normalizeLegalHoldCase);
  }

  async listLegalHoldReleaseRequests(
    workspaceId: string,
    conversationThreadId: string,
  ): Promise<ConversationLegalHoldReleaseRequest[]> {
    const rows = await this.sql<ConversationLegalHoldReleaseRow[]>`
      SELECT request.id, request.legal_hold_case_id, request.workspace_id,
        request.conversation_thread_id, request.target_retention_class,
        request.request_note, request.status, request.requested_by,
        requester.display_name AS requested_by_display_name,
        request.requested_at, request.decided_by,
        decider.display_name AS decided_by_display_name,
        request.decided_at, request.decision_note, thread.subject,
        relationship.display_name AS relationship_display_name
      FROM conversation_legal_hold_release_request request
      JOIN app_user requester ON requester.id = request.requested_by
      LEFT JOIN app_user decider ON decider.id = request.decided_by
      LEFT JOIN conversation_thread thread
        ON thread.workspace_id = request.workspace_id
        AND thread.id = request.conversation_thread_id
      LEFT JOIN relationship_contact relationship
        ON relationship.workspace_id = thread.workspace_id
        AND relationship.id = thread.relationship_contact_id
      WHERE request.workspace_id = ${workspaceId}
        AND request.conversation_thread_id = ${conversationThreadId}
      ORDER BY
        CASE request.status WHEN 'pending' THEN 0 ELSE 1 END,
        request.requested_at DESC, request.id
      LIMIT 100
    `;
    return rows.map(normalizeLegalHoldReleaseRequest);
  }

  async listPendingLegalHoldReleaseRequests(
    workspaceId: string,
  ): Promise<ConversationLegalHoldReleaseRequest[]> {
    const rows = await this.sql<ConversationLegalHoldReleaseRow[]>`
      SELECT request.id, request.legal_hold_case_id, request.workspace_id,
        request.conversation_thread_id, request.target_retention_class,
        request.request_note, request.status, request.requested_by,
        requester.display_name AS requested_by_display_name,
        request.requested_at, request.decided_by,
        decider.display_name AS decided_by_display_name,
        request.decided_at, request.decision_note, thread.subject,
        relationship.display_name AS relationship_display_name
      FROM conversation_legal_hold_release_request request
      JOIN app_user requester ON requester.id = request.requested_by
      LEFT JOIN app_user decider ON decider.id = request.decided_by
      LEFT JOIN conversation_thread thread
        ON thread.workspace_id = request.workspace_id
        AND thread.id = request.conversation_thread_id
      LEFT JOIN relationship_contact relationship
        ON relationship.workspace_id = thread.workspace_id
        AND relationship.id = thread.relationship_contact_id
      WHERE request.workspace_id = ${workspaceId} AND request.status = 'pending'
      ORDER BY request.requested_at, request.id
      LIMIT 200
    `;
    return rows.map(normalizeLegalHoldReleaseRequest);
  }

  async listRecentLegalHoldReleaseDecisions(
    workspaceId: string,
  ): Promise<ConversationLegalHoldReleaseRequest[]> {
    const rows = await this.sql<ConversationLegalHoldReleaseRow[]>`
      SELECT request.id, request.legal_hold_case_id, request.workspace_id,
        request.conversation_thread_id, request.target_retention_class,
        request.request_note, request.status, request.requested_by,
        requester.display_name AS requested_by_display_name,
        request.requested_at, request.decided_by,
        decider.display_name AS decided_by_display_name,
        request.decided_at, request.decision_note, thread.subject,
        relationship.display_name AS relationship_display_name
      FROM conversation_legal_hold_release_request request
      JOIN app_user requester ON requester.id = request.requested_by
      LEFT JOIN app_user decider ON decider.id = request.decided_by
      LEFT JOIN conversation_thread thread
        ON thread.workspace_id = request.workspace_id
        AND thread.id = request.conversation_thread_id
      LEFT JOIN relationship_contact relationship
        ON relationship.workspace_id = thread.workspace_id
        AND relationship.id = thread.relationship_contact_id
      WHERE request.workspace_id = ${workspaceId}
        AND request.status IN ('approved', 'rejected')
      ORDER BY request.decided_at DESC, request.id
      LIMIT 200
    `;
    return rows.map(normalizeLegalHoldReleaseRequest);
  }

  async getLegalHoldReleaseRequest(
    workspaceId: string,
    requestId: string,
  ): Promise<ConversationLegalHoldReleaseRequest | undefined> {
    const rows = await this.sql<ConversationLegalHoldReleaseRow[]>`
      SELECT request.id, request.legal_hold_case_id, request.workspace_id,
        request.conversation_thread_id, request.target_retention_class,
        request.request_note, request.status, request.requested_by,
        requester.display_name AS requested_by_display_name,
        request.requested_at, request.decided_by,
        decider.display_name AS decided_by_display_name,
        request.decided_at, request.decision_note, thread.subject,
        relationship.display_name AS relationship_display_name
      FROM conversation_legal_hold_release_request request
      JOIN app_user requester ON requester.id = request.requested_by
      LEFT JOIN app_user decider ON decider.id = request.decided_by
      LEFT JOIN conversation_thread thread
        ON thread.workspace_id = request.workspace_id
        AND thread.id = request.conversation_thread_id
      LEFT JOIN relationship_contact relationship
        ON relationship.workspace_id = thread.workspace_id
        AND relationship.id = thread.relationship_contact_id
      WHERE request.workspace_id = ${workspaceId} AND request.id = ${requestId}
    `;
    return rows[0] ? normalizeLegalHoldReleaseRequest(rows[0]) : undefined;
  }

  async placeLegalHold(
    input: ConversationLegalHoldWrite,
    actorUserId: string,
  ): Promise<ConversationLegalHoldCase | undefined> {
    const id = await this.sql.begin(async (transaction) => {
      await this.requireConversationApprover(transaction, input.workspaceId, actorUserId);
      const threads = await transaction<{ retentionClass: ConversationRetentionClass }[]>`
        SELECT retention_class FROM conversation_thread
        WHERE workspace_id = ${input.workspaceId}
          AND id = ${input.conversationThreadId}
        FOR UPDATE
      `;
      const thread = threads[0];
      if (!thread) return undefined;
      const existing = await transaction<{ id: string }[]>`
        SELECT id FROM conversation_legal_hold_case
        WHERE workspace_id = ${input.workspaceId}
          AND conversation_thread_id = ${input.conversationThreadId}
          AND status = 'active'
      `;
      if (existing[0] && thread.retentionClass === "legal_hold") {
        return existing[0].id;
      }
      if (existing[0] || thread.retentionClass === "legal_hold") {
        throw new ConversationValidationError([
          {
            field: "conversationThreadId",
            message: "The active legal hold and conversation class are inconsistent.",
          },
        ]);
      }
      const holdId = randomUUID();
      await transaction`
        INSERT INTO conversation_legal_hold_case (
          id, workspace_id, conversation_thread_id, previous_retention_class,
          reason, case_reference, placed_by
        ) VALUES (
          ${holdId}, ${input.workspaceId}, ${input.conversationThreadId},
          ${thread.retentionClass}, ${input.reason.trim()},
          ${input.caseReference?.trim() || null}, ${actorUserId}
        )
      `;
      await transaction`
        UPDATE conversation_thread
        SET retention_class = 'legal_hold', retention_class_updated_by = ${actorUserId},
          retention_class_updated_at = now(), retention_revision = retention_revision + 1,
          updated_at = now()
        WHERE workspace_id = ${input.workspaceId} AND id = ${input.conversationThreadId}
      `;
      await this.auditLegalHold(transaction, input.workspaceId, actorUserId,
        "conversation.legal_hold_placed", holdId, {
          conversationThreadId: input.conversationThreadId,
          previousRetentionClass: thread.retentionClass,
          hasCaseReference: Boolean(input.caseReference?.trim()),
        });
      return holdId;
    });
    if (!id) return undefined;
    return (await this.listLegalHoldCases(input.workspaceId, input.conversationThreadId))
      .find((hold) => hold.id === id);
  }

  async requestLegalHoldRelease(
    input: ConversationLegalHoldReleaseRequestWrite,
    actorUserId: string,
  ): Promise<ConversationLegalHoldReleaseRequest | undefined> {
    const id = await this.sql.begin(async (transaction) => {
      await this.requireConversationWriter(transaction, input.workspaceId, actorUserId);
      const holds = await transaction<{ conversationThreadId: string; status: string }[]>`
        SELECT conversation_thread_id, status FROM conversation_legal_hold_case
        WHERE id = ${input.legalHoldCaseId} AND workspace_id = ${input.workspaceId}
        FOR UPDATE
      `;
      const hold = holds[0];
      if (!hold || hold.status !== "active") return undefined;
      const threads = await transaction<{ retentionClass: ConversationRetentionClass }[]>`
        SELECT retention_class FROM conversation_thread
        WHERE workspace_id = ${input.workspaceId}
          AND id = ${hold.conversationThreadId}
        FOR UPDATE
      `;
      if (threads[0]?.retentionClass !== "legal_hold") {
        throw new ConversationValidationError([
          { field: "legalHoldCaseId", message: "The active hold and conversation class are inconsistent." },
        ]);
      }
      const existing = await transaction<{ id: string }[]>`
        SELECT id FROM conversation_legal_hold_release_request
        WHERE legal_hold_case_id = ${input.legalHoldCaseId} AND status = 'pending'
      `;
      if (existing[0]) return existing[0].id;
      const requestId = randomUUID();
      await transaction`
        INSERT INTO conversation_legal_hold_release_request (
          id, legal_hold_case_id, workspace_id, conversation_thread_id,
          target_retention_class, request_note, requested_by
        ) VALUES (
          ${requestId}, ${input.legalHoldCaseId}, ${input.workspaceId},
          ${hold.conversationThreadId}, ${input.targetRetentionClass},
          ${input.requestNote.trim()}, ${actorUserId}
        )
      `;
      await this.auditLegalHold(transaction, input.workspaceId, actorUserId,
        "conversation.legal_hold_release_requested", input.legalHoldCaseId, {
          conversationThreadId: hold.conversationThreadId,
          releaseRequestId: requestId,
          targetRetentionClass: input.targetRetentionClass,
        });
      return requestId;
    });
    if (!id) return undefined;
    return this.getLegalHoldReleaseRequest(input.workspaceId, id);
  }

  async decideLegalHoldRelease(
    input: ConversationLegalHoldReleaseDecisionWrite,
    actorUserId: string,
  ): Promise<ConversationLegalHoldReleaseRequest | undefined> {
    const threadId = await this.sql.begin(async (transaction) => {
      await this.requireConversationApprover(transaction, input.workspaceId, actorUserId);
      const requests = await transaction<{
        legalHoldCaseId: string; conversationThreadId: string;
        targetRetentionClass: Exclude<ConversationRetentionClass, "legal_hold">;
        requestedBy: string; status: string;
      }[]>`
        SELECT legal_hold_case_id, conversation_thread_id, target_retention_class,
          requested_by, status
        FROM conversation_legal_hold_release_request
        WHERE id = ${input.requestId} AND workspace_id = ${input.workspaceId}
        FOR UPDATE
      `;
      const request = requests[0];
      if (!request || request.status !== "pending") return undefined;
      if (request.requestedBy === actorUserId) {
        throw new ConversationValidationError([
          { field: "requestId", message: "A different workspace approver must decide this hold release." },
        ]);
      }
      const holds = await transaction<{ status: string }[]>`
        SELECT status FROM conversation_legal_hold_case
        WHERE id = ${request.legalHoldCaseId} AND workspace_id = ${input.workspaceId}
        FOR UPDATE
      `;
      if (holds[0]?.status !== "active") return undefined;
      if (input.decision === "reject") {
        await transaction`
          UPDATE conversation_legal_hold_release_request
          SET status = 'rejected', decided_by = ${actorUserId}, decided_at = now(),
            decision_note = ${input.decisionNote.trim()}
          WHERE id = ${input.requestId}
        `;
        await this.auditLegalHold(transaction, input.workspaceId, actorUserId,
          "conversation.legal_hold_release_rejected", request.legalHoldCaseId,
          { conversationThreadId: request.conversationThreadId, releaseRequestId: input.requestId });
        return request.conversationThreadId;
      }
      const threads = await transaction<{ retentionClass: ConversationRetentionClass }[]>`
        SELECT retention_class FROM conversation_thread
        WHERE workspace_id = ${input.workspaceId}
          AND id = ${request.conversationThreadId}
        FOR UPDATE
      `;
      if (threads[0]?.retentionClass !== "legal_hold") {
        throw new ConversationValidationError([
          { field: "requestId", message: "The conversation is no longer under the exact active hold." },
        ]);
      }
      await transaction`
        UPDATE conversation_legal_hold_release_request
        SET status = 'approved', decided_by = ${actorUserId}, decided_at = now(),
          decision_note = ${input.decisionNote.trim()}
        WHERE id = ${input.requestId}
      `;
      await transaction`
        UPDATE conversation_legal_hold_case
        SET status = 'released', released_by = ${actorUserId}, released_at = now(),
          release_request_id = ${input.requestId}
        WHERE id = ${request.legalHoldCaseId}
      `;
      await transaction`
        UPDATE conversation_thread
        SET retention_class = ${request.targetRetentionClass},
          retention_class_updated_by = ${actorUserId}, retention_class_updated_at = now(),
          retention_revision = retention_revision + 1, updated_at = now()
        WHERE workspace_id = ${input.workspaceId} AND id = ${request.conversationThreadId}
      `;
      await this.auditLegalHold(transaction, input.workspaceId, actorUserId,
        "conversation.legal_hold_released", request.legalHoldCaseId, {
          conversationThreadId: request.conversationThreadId,
          releaseRequestId: input.requestId,
          targetRetentionClass: request.targetRetentionClass,
        });
      return request.conversationThreadId;
    });
    if (!threadId) return undefined;
    return this.getLegalHoldReleaseRequest(input.workspaceId, input.requestId);
  }

  async listThreads(
    workspaceId: string,
    query: ConversationThreadQuery = {},
    viewerUserId?: string,
  ): Promise<StoredConversationThread[]> {
    if (query.unread !== undefined && !viewerUserId) {
      throw new ConversationValidationError([
        { field: "unread", message: "Unread filtering requires a viewer." },
      ]);
    }
    return this.attachMessages(
      await this.threadRows(workspaceId, undefined, query, viewerUserId),
      false,
      viewerUserId,
    );
  }

  async getThread(
    workspaceId: string,
    id: string,
    viewerUserId?: string,
  ): Promise<StoredConversationThread | undefined> {
    return (
      await this.attachMessages(
        await this.threadRows(workspaceId, id),
        true,
        viewerUserId,
      )
    )[0];
  }

  async markRead(
    workspaceId: string,
    conversationThreadId: string,
    userId: string,
  ): Promise<string | undefined> {
    const rows = await this.sql<{ lastReadAt: string | Date }[]>`
      INSERT INTO conversation_read_state (
        workspace_id, conversation_thread_id, user_id, last_read_at
      )
      SELECT thread.workspace_id, thread.id, membership.user_id, now()
      FROM conversation_thread thread
      JOIN workspace_membership membership
        ON membership.workspace_id = thread.workspace_id
        AND membership.user_id = ${userId}
      WHERE thread.workspace_id = ${workspaceId}
        AND thread.id = ${conversationThreadId}
      ON CONFLICT (conversation_thread_id, user_id) DO UPDATE SET
        last_read_at = GREATEST(
          conversation_read_state.last_read_at,
          EXCLUDED.last_read_at
        ),
        updated_at = now()
      RETURNING last_read_at
    `;
    return normalizeTimestamp(rows[0]?.lastReadAt);
  }

  async recordSharedResource(
    input: ConversationSharedResourceWrite,
    actorUserId: string,
  ): Promise<StoredConversationSharedResource | undefined> {
    const observedAt = new Date(input.observedAt);
    if (
      Number.isNaN(observedAt.getTime()) ||
      observedAt.getTime() > Date.now() + 300_000
    ) {
      throw new ConversationValidationError([
        {
          field: "observedAt",
          message: "Observed time cannot be in the future.",
        },
      ]);
    }
    const candidateId = randomUUID();
    const saved = await this.sql.begin(async (transaction) => {
      const threads = await transaction<{ id: string }[]>`
        SELECT id FROM conversation_thread
        WHERE id = ${input.conversationThreadId}
          AND workspace_id = ${input.workspaceId}
        FOR UPDATE
      `;
      if (!threads[0]) return undefined;

      let destinationId: string | null = null;
      let channelConnectionId: string | null = null;
      let publicationActionId: string | null = null;
      if (input.kind === "destination") {
        const destinations = await transaction<{ id: string }[]>`
          SELECT id FROM destination
          WHERE id = ${input.destinationId}
            AND workspace_id = ${input.workspaceId}
        `;
        if (!destinations[0]) {
          throw new ConversationValidationError([
            {
              field: "destinationId",
              message: "Destination must belong to this workspace.",
            },
          ]);
        }
        destinationId = input.destinationId;
      } else {
        const publications = await transaction<
          { channelConnectionId: string }[]
        >`
          SELECT channel_connection_id FROM publication_action
          WHERE id = ${input.publicationActionId}
            AND workspace_id = ${input.workspaceId}
        `;
        if (!publications[0]) {
          throw new ConversationValidationError([
            {
              field: "publicationActionId",
              message: "Publication must belong to this workspace.",
            },
          ]);
        }
        publicationActionId = input.publicationActionId;
        channelConnectionId = publications[0].channelConnectionId;
      }

      const inserted = await transaction<{ id: string }[]>`
        INSERT INTO conversation_shared_resource (
          id, workspace_id, conversation_thread_id, kind,
          destination_id, channel_connection_id, publication_action_id,
          idempotency_key, observed_at, recorded_by
        ) VALUES (
          ${candidateId}, ${input.workspaceId}, ${input.conversationThreadId},
          ${input.kind}, ${destinationId}, ${channelConnectionId},
          ${publicationActionId}, ${input.idempotencyKey}, ${input.observedAt},
          ${actorUserId}
        )
        ON CONFLICT (workspace_id, conversation_thread_id, idempotency_key)
        DO NOTHING
        RETURNING id
      `;
      const resourceId =
        inserted[0]?.id ??
        (
          await transaction<{ id: string }[]>`
          SELECT id FROM conversation_shared_resource
          WHERE workspace_id = ${input.workspaceId}
            AND conversation_thread_id = ${input.conversationThreadId}
            AND idempotency_key = ${input.idempotencyKey}
        `
        )[0]?.id;
      if (!resourceId) return undefined;
      if (inserted[0]) {
        await this.audit(
          transaction,
          input.workspaceId,
          actorUserId,
          "conversation.shared_resource_recorded",
          input.conversationThreadId,
          {
            sharedResourceId: resourceId,
            kind: input.kind,
            destinationId,
            channelConnectionId,
            publicationActionId,
            observedAt: input.observedAt,
          },
        );
      }
      return resourceId;
    });
    return saved
      ? this.sharedResourceById(
          input.workspaceId,
          saved,
          input.conversationThreadId,
        )
      : undefined;
  }

  async saveThread(
    input: ConversationThreadWrite,
    actorUserId: string,
    id: string = randomUUID(),
  ): Promise<StoredConversationThread | undefined> {
    if (input.status === "assigned" && !input.assignedOwnerId) {
      throw new ConversationValidationError([
        {
          field: "assignedOwnerId",
          message: "Assigned conversations require an owner.",
        },
      ]);
    }
    if (input.status === "unassigned" && input.assignedOwnerId) {
      throw new ConversationValidationError([
        {
          field: "assignedOwnerId",
          message: "Unassigned conversations cannot have an owner.",
        },
      ]);
    }

    const saved = await this.sql.begin(async (transaction) => {
      const relationships = await transaction<{ id: string }[]>`
        SELECT id FROM relationship_contact
        WHERE id = ${input.relationshipId} AND workspace_id = ${input.workspaceId}
      `;
      if (!relationships[0]) {
        throw new ConversationValidationError([
          {
            field: "relationshipId",
            message: "Relationship must belong to this workspace.",
          },
        ]);
      }
      await this.validateOwner(
        transaction,
        input.workspaceId,
        input.assignedOwnerId,
      );
      if (input.providerThreadId) {
        const duplicate = (
          await transaction<{ id: string }[]>`
            SELECT id FROM conversation_thread
            WHERE workspace_id = ${input.workspaceId}
              AND provider = ${input.provider}
              AND provider_thread_id = ${input.providerThreadId}
              AND id <> ${id}
            LIMIT 1
          `
        )[0];
        if (duplicate) {
          throw new ConversationValidationError([
            {
              field: "providerThreadId",
              message:
                "This provider thread is already registered in the workspace.",
            },
          ]);
        }
      }

      const existing = (
        await transaction<
          {
            id: string;
            status: string;
            assignedOwnerId: string | null;
            sentiment: string;
            intent: string;
            urgency: string;
            campaignId: string | null;
            destinationId: string | null;
            brandProfileId: string | null;
            channelConnectionId: string | null;
            publicationActionId: string | null;
          }[]
        >`
          SELECT id, status, assigned_owner_id, sentiment, intent, urgency,
            campaign_id, destination_id, brand_profile_id,
            channel_connection_id,
            publication_action_id
          FROM conversation_thread
          WHERE id = ${id} AND workspace_id = ${input.workspaceId}
          FOR UPDATE
        `
      )[0];
      const campaignId =
        input.campaignId !== undefined
          ? input.campaignId
          : (existing?.campaignId ?? null);
      const destinationId =
        input.destinationId !== undefined
          ? input.destinationId
          : (existing?.destinationId ?? null);
      const brandProfileId =
        input.brandProfileId !== undefined
          ? input.brandProfileId
          : (existing?.brandProfileId ?? null);
      const channelConnectionId =
        input.channelConnectionId !== undefined
          ? input.channelConnectionId
          : (existing?.channelConnectionId ?? null);
      const publicationActionId =
        input.publicationActionId !== undefined
          ? input.publicationActionId
          : (existing?.publicationActionId ?? null);
      await this.validateContext(
        transaction,
        input.workspaceId,
        campaignId,
        destinationId,
        brandProfileId,
        channelConnectionId,
        publicationActionId,
      );
      const sentiment = input.sentiment ?? existing?.sentiment ?? "unknown";
      const intent = input.intent ?? existing?.intent ?? "unknown";
      const urgency = input.urgency ?? existing?.urgency ?? "unknown";
      const classificationChanged = existing
        ? existing.sentiment !== sentiment ||
          existing.intent !== intent ||
          existing.urgency !== urgency
        : sentiment !== "unknown" ||
          intent !== "unknown" ||
          urgency !== "unknown";
      const associationChanged = existing
        ? existing.campaignId !== campaignId ||
          existing.destinationId !== destinationId ||
          existing.brandProfileId !== brandProfileId ||
          existing.channelConnectionId !== channelConnectionId ||
          existing.publicationActionId !== publicationActionId
        : Boolean(campaignId || destinationId);
      if (existing) {
        await transaction`
          UPDATE conversation_thread SET
            relationship_contact_id = ${input.relationshipId},
            campaign_id = ${campaignId},
            destination_id = ${destinationId},
            brand_profile_id = ${brandProfileId},
            channel_connection_id = ${channelConnectionId},
            publication_action_id = ${publicationActionId},
            provider = ${input.provider},
            provider_thread_id = ${input.providerThreadId ?? null},
            subject = ${input.subject},
            status = ${input.status},
            sentiment = ${sentiment},
            intent = ${intent},
            urgency = ${urgency},
            classification_updated_by = CASE
              WHEN ${classificationChanged} THEN ${actorUserId}
              ELSE classification_updated_by
            END,
            classification_updated_at = CASE
              WHEN ${classificationChanged} THEN now()
              ELSE classification_updated_at
            END,
            assigned_owner_id = ${input.assignedOwnerId ?? null},
            response_due_at = ${input.responseDueAt ?? null},
            follow_up_at = ${input.followUpAt ?? null},
            updated_at = now()
          WHERE id = ${id} AND workspace_id = ${input.workspaceId}
        `;
      } else {
        await transaction`
          INSERT INTO conversation_thread (
            id, workspace_id, relationship_contact_id, campaign_id, destination_id,
            brand_profile_id, channel_connection_id, publication_action_id,
            provider, provider_thread_id,
            subject, status, sentiment, intent, urgency,
            classification_updated_by, classification_updated_at,
            assigned_owner_id, created_by
            , response_due_at, follow_up_at
          ) VALUES (
            ${id}, ${input.workspaceId}, ${input.relationshipId},
            ${campaignId}, ${destinationId}, ${brandProfileId},
            ${channelConnectionId},
            ${publicationActionId}, ${input.provider},
            ${input.providerThreadId ?? null}, ${input.subject}, ${input.status},
            ${sentiment}, ${intent}, ${urgency},
            ${classificationChanged ? actorUserId : null},
            CASE WHEN ${classificationChanged} THEN now() ELSE NULL END,
            ${input.assignedOwnerId ?? null}, ${actorUserId},
            ${input.responseDueAt ?? null}, ${input.followUpAt ?? null}
          )
        `;
      }
      const eventType = !existing
        ? "conversation.created"
        : existing.status !== input.status
          ? "conversation.status_changed"
          : existing.assignedOwnerId !== (input.assignedOwnerId ?? null)
            ? "conversation.assignment_changed"
            : classificationChanged
              ? "conversation.classification_changed"
              : associationChanged
                ? "conversation.context_changed"
                : "conversation.updated";
      await this.audit(
        transaction,
        input.workspaceId,
        actorUserId,
        eventType,
        id,
        {
          provider: input.provider,
          status: input.status,
          relationshipId: input.relationshipId,
          campaignId,
          destinationId,
          brandProfileId,
          channelConnectionId,
          publicationActionId,
          assigned: Boolean(input.assignedOwnerId),
          assignedOwnerId: input.assignedOwnerId ?? null,
          sentiment,
          intent,
          urgency,
        },
      );
      return true;
    });
    return saved ? this.getThread(input.workspaceId, id) : undefined;
  }

  async createHandoff(
    input: ConversationHandoffWrite,
    actorUserId: string,
  ): Promise<ConversationHandoffBrief | undefined> {
    const id = randomUUID();
    const inserted = await this.sql.begin(async (transaction) => {
      const threads = await transaction<{ id: string }[]>`
        SELECT id FROM conversation_thread
        WHERE id = ${input.conversationThreadId}
          AND workspace_id = ${input.workspaceId}
        FOR UPDATE
      `;
      if (!threads[0]) return false;
      const active = await transaction<{ id: string }[]>`
        SELECT id FROM conversation_handoff_brief
        WHERE conversation_thread_id = ${input.conversationThreadId}
          AND workspace_id = ${input.workspaceId}
          AND status = 'open'
      `;
      if (active[0]) {
        throw new ConversationValidationError([
          {
            field: "conversationThreadId",
            message: "This conversation already has an open handoff brief.",
          },
        ]);
      }
      await transaction`
        INSERT INTO conversation_handoff_brief (
          id, workspace_id, conversation_thread_id, contact_summary,
          importance, request_or_offer, prior_response_summary,
          relevant_context, suggested_response, due_at, requested_by
        ) VALUES (
          ${id}, ${input.workspaceId}, ${input.conversationThreadId},
          ${input.contactSummary}, ${input.importance}, ${input.requestOrOffer},
          ${input.priorResponseSummary}, ${input.relevantContext},
          ${input.suggestedResponse}, ${input.dueAt ?? null}, ${actorUserId}
        )
      `;
      await this.audit(
        transaction,
        input.workspaceId,
        actorUserId,
        "conversation.handoff_requested",
        input.conversationThreadId,
        { handoffId: id, hasDueAt: Boolean(input.dueAt) },
      );
      return true;
    });
    return inserted
      ? (
          await this.handoffRows(
            input.workspaceId,
            input.conversationThreadId,
            id,
          )
        )[0]
      : undefined;
  }

  async closeHandoff(
    workspaceId: string,
    conversationThreadId: string,
    handoffId: string,
    status: "resolved" | "cancelled",
    actorUserId: string,
  ): Promise<ConversationHandoffBrief | undefined> {
    const updated = await this.sql.begin(async (transaction) => {
      const rows = await transaction<{ id: string }[]>`
        UPDATE conversation_handoff_brief SET
          status = ${status}, closed_by = ${actorUserId}, closed_at = now(),
          updated_at = now()
        WHERE id = ${handoffId}
          AND conversation_thread_id = ${conversationThreadId}
          AND workspace_id = ${workspaceId}
          AND status = 'open'
        RETURNING id
      `;
      if (!rows[0]) return false;
      await this.audit(
        transaction,
        workspaceId,
        actorUserId,
        status === "resolved"
          ? "conversation.handoff_resolved"
          : "conversation.handoff_cancelled",
        conversationThreadId,
        { handoffId },
      );
      return true;
    });
    return updated
      ? (
          await this.handoffRows(workspaceId, conversationThreadId, handoffId)
        )[0]
      : undefined;
  }

  async createReviewRequest(
    input: ConversationReviewRequestWrite,
    actorUserId: string,
  ): Promise<StoredConversationReviewRequest | undefined> {
    const id = randomUUID();
    const mentionedUserIds = [...new Set(input.mentionedUserIds)];
    if (mentionedUserIds.length !== input.mentionedUserIds.length) {
      throw new ConversationValidationError([
        { field: "mentionedUserIds", message: "Mention each teammate once." },
      ]);
    }
    if (mentionedUserIds.length > 20) {
      throw new ConversationValidationError([
        { field: "mentionedUserIds", message: "Mention at most 20 teammates." },
      ]);
    }
    if (input.requestedReviewerId === actorUserId) {
      throw new ConversationValidationError([
        {
          field: "requestedReviewerId",
          message: "Choose another workspace teammate as reviewer.",
        },
      ]);
    }
    if (
      mentionedUserIds.includes(actorUserId) ||
      mentionedUserIds.includes(input.requestedReviewerId)
    ) {
      throw new ConversationValidationError([
        {
          field: "mentionedUserIds",
          message: "Mentions must name additional workspace teammates.",
        },
      ]);
    }
    const inserted = await this.sql.begin(async (transaction) => {
      const threads = await transaction<{ id: string }[]>`
        SELECT id FROM conversation_thread
        WHERE id = ${input.conversationThreadId}
          AND workspace_id = ${input.workspaceId}
        FOR UPDATE
      `;
      if (!threads[0]) return false;
      const reviewers = await transaction<{ userId: string }[]>`
        SELECT user_id FROM workspace_membership
        WHERE workspace_id = ${input.workspaceId}
          AND user_id = ${input.requestedReviewerId}
          AND role IN ('owner', 'admin', 'editor')
      `;
      if (!reviewers[0]) {
        throw new ConversationValidationError([
          {
            field: "requestedReviewerId",
            message: "Choose a workspace owner, administrator, or editor.",
          },
        ]);
      }
      if (mentionedUserIds.length > 0) {
        const mentioned = await transaction<{ userId: string }[]>`
          SELECT user_id FROM workspace_membership
          WHERE workspace_id = ${input.workspaceId}
            AND user_id IN ${transaction(mentionedUserIds)}
        `;
        if (mentioned.length !== mentionedUserIds.length) {
          throw new ConversationValidationError([
            {
              field: "mentionedUserIds",
              message: "Every mention must identify a current workspace member.",
            },
          ]);
        }
      }
      if (input.sourceMessageId) {
        const notes = await transaction<{ id: string }[]>`
          SELECT id FROM conversation_message
          WHERE id = ${input.sourceMessageId}
            AND workspace_id = ${input.workspaceId}
            AND conversation_thread_id = ${input.conversationThreadId}
            AND kind = 'internal_note'
        `;
        if (!notes[0]) {
          throw new ConversationValidationError([
            {
              field: "sourceMessageId",
              message: "The cited source must be an internal note on this conversation.",
            },
          ]);
        }
      }
      await transaction`
        INSERT INTO conversation_review_request (
          id, workspace_id, conversation_thread_id, source_message_id,
          request_text, due_at, requested_by, requested_reviewer_id
        ) VALUES (
          ${id}, ${input.workspaceId}, ${input.conversationThreadId},
          ${input.sourceMessageId ?? null}, ${input.requestText},
          ${input.dueAt ?? null}, ${actorUserId}, ${input.requestedReviewerId}
        )
      `;
      for (const mentionedUserId of mentionedUserIds) {
        await transaction`
          INSERT INTO conversation_review_request_mention (
            workspace_id, conversation_thread_id, review_request_id,
            mentioned_user_id
          ) VALUES (
            ${input.workspaceId}, ${input.conversationThreadId}, ${id},
            ${mentionedUserId}
          )
        `;
      }
      await this.audit(
        transaction,
        input.workspaceId,
        actorUserId,
        "conversation.review_requested",
        input.conversationThreadId,
        {
          reviewRequestId: id,
          requestedReviewerId: input.requestedReviewerId,
          mentionedUserIds,
          hasSourceNote: Boolean(input.sourceMessageId),
          hasDueAt: Boolean(input.dueAt),
        },
      );
      return true;
    });
    return inserted
      ? (
          await this.reviewRequestRows(
            input.workspaceId,
            input.conversationThreadId,
            id,
          )
        )[0]
      : undefined;
  }

  async closeReviewRequest(
    workspaceId: string,
    conversationThreadId: string,
    reviewRequestId: string,
    status: "resolved" | "cancelled",
    actorUserId: string,
  ): Promise<StoredConversationReviewRequest | undefined> {
    const updated = await this.sql.begin(async (transaction) => {
      const rows = await transaction<
        { requestedBy: string; requestedReviewerId: string }[]
      >`
        SELECT requested_by, requested_reviewer_id
        FROM conversation_review_request
        WHERE id = ${reviewRequestId}
          AND conversation_thread_id = ${conversationThreadId}
          AND workspace_id = ${workspaceId}
          AND status = 'open'
        FOR UPDATE
      `;
      const request = rows[0];
      if (!request) return false;
      const authorized =
        status === "resolved"
          ? request.requestedReviewerId === actorUserId
          : request.requestedBy === actorUserId;
      if (!authorized) {
        throw new ConversationValidationError([
          {
            field: "status",
            message:
              status === "resolved"
                ? "Only the requested reviewer may resolve this request."
                : "Only the requester may cancel this request.",
          },
        ]);
      }
      await transaction`
        UPDATE conversation_review_request SET
          status = ${status}, closed_by = ${actorUserId}, closed_at = now(),
          updated_at = now()
        WHERE id = ${reviewRequestId}
          AND conversation_thread_id = ${conversationThreadId}
          AND workspace_id = ${workspaceId}
      `;
      await this.audit(
        transaction,
        workspaceId,
        actorUserId,
        status === "resolved"
          ? "conversation.review_resolved"
          : "conversation.review_cancelled",
        conversationThreadId,
        { reviewRequestId },
      );
      return true;
    });
    return updated
      ? (
          await this.reviewRequestRows(
            workspaceId,
            conversationThreadId,
            reviewRequestId,
          )
        )[0]
      : undefined;
  }

  async recordMessage(
    input: ConversationMessageWrite,
    actorUserId?: string,
  ): Promise<ConversationMessage | undefined> {
    if (input.kind === "internal_note" && !actorUserId) {
      throw new ConversationValidationError([
        {
          field: "kind",
          message: "Internal notes require an authenticated author.",
        },
      ]);
    }
    const id = randomUUID();
    const inserted = await this.sql.begin(async (transaction) => {
      const threads = await transaction<{ id: string }[]>`
        SELECT id FROM conversation_thread
        WHERE id = ${input.conversationThreadId} AND workspace_id = ${input.workspaceId}
        FOR UPDATE
      `;
      if (!threads[0]) return false;
      const rows = await transaction<{ id: string }[]>`
        INSERT INTO conversation_message (
          id, workspace_id, conversation_thread_id, provider_message_id, kind,
          body, author_display, occurred_at, metadata, created_by
        ) VALUES (
          ${id}, ${input.workspaceId}, ${input.conversationThreadId},
          ${input.providerMessageId ?? null}, ${input.kind}, ${input.body},
          ${input.authorDisplay ?? null}, ${input.occurredAt},
          ${transaction.json(input.metadata as JSONValue)}, ${actorUserId ?? null}
        )
        ON CONFLICT (conversation_thread_id, provider_message_id)
          WHERE provider_message_id IS NOT NULL
        DO NOTHING
        RETURNING id
      `;
      if (!rows[0]) return false;
      await transaction`
        UPDATE conversation_thread
        SET last_message_at = GREATEST(COALESCE(last_message_at, ${input.occurredAt}), ${input.occurredAt}),
          updated_at = now()
        WHERE id = ${input.conversationThreadId} AND workspace_id = ${input.workspaceId}
      `;
      if (input.kind === "internal_note") {
        await this.audit(
          transaction,
          input.workspaceId,
          actorUserId!,
          "conversation.internal_note_added",
          input.conversationThreadId,
          { messageId: id },
        );
      }
      return true;
    });
    if (!inserted) return undefined;
    return (
      await this.messageRows(input.workspaceId, input.conversationThreadId, id)
    )[0];
  }

  async addInternalNote(
    workspaceId: string,
    conversationThreadId: string,
    body: string,
    actorUserId: string,
  ): Promise<ConversationMessage | undefined> {
    return this.recordMessage(
      {
        workspaceId,
        conversationThreadId,
        kind: "internal_note",
        body,
        occurredAt: new Date().toISOString(),
        metadata: {},
      },
      actorUserId,
    );
  }

  private async threadRows(
    workspaceId: string,
    id?: string,
    query: ConversationThreadQuery = {},
    viewerUserId?: string,
  ): Promise<ConversationThreadRow[]> {
    const searchPattern = query.search ? `%${query.search}%` : undefined;
    const deadlineAsOf = new Date().toISOString();
    return this.sql<ConversationThreadRow[]>`
      SELECT thread.id, thread.workspace_id,
        thread.relationship_contact_id AS relationship_id,
        relationship.display_name AS relationship_display_name,
        relationship.stage AS relationship_stage,
        relationship_effective_contact_permission(
          thread.workspace_id,
          relationship.id
        ) AS contact_permission,
        relationship_history.prior_thread_count,
        relationship_history.prior_message_count,
        relationship_history.last_prior_interaction_at,
        thread.campaign_id, campaign.name AS campaign_name,
        thread.destination_id, destination.title AS destination_title,
        thread.brand_profile_id, brand.name AS brand_profile_name,
        brand.status AS brand_profile_status,
        thread.channel_connection_id,
        channel.name AS channel_connection_name,
        channel.provider AS channel_provider,
        thread.publication_action_id,
        publication.provider_external_id AS publication_external_id,
        publication.status AS publication_status,
        routing.id AS routing_rule_id,
        routing.name AS routing_rule_name,
        routing.priority AS routing_priority,
        routing.brand_profile_id AS routing_brand_profile_id,
        routing.channel_connection_id AS routing_channel_connection_id,
        routing.relationship_stage AS routing_relationship_stage,
        routing.intent AS routing_intent,
        routing.urgency AS routing_urgency,
        routing.target_owner_id AS routing_target_owner_id,
        routing.target_owner_display_name AS routing_target_owner_display_name,
        routing.target_status AS routing_target_status,
        service_activity.started_at AS service_level_started_at,
        service_level.due_at AS service_level_due_at,
        service_level.source AS service_level_source,
        service_policy.at_risk_before_minutes AS service_level_at_risk_before_minutes,
        (
          SELECT count(*)::integer FROM conversation_review_request review
          WHERE review.workspace_id = thread.workspace_id
            AND review.conversation_thread_id = thread.id
            AND review.status = 'open'
        ) AS open_review_request_count,
        thread.provider, thread.provider_thread_id, thread.subject, thread.status,
        thread.sentiment, thread.intent, thread.urgency,
        thread.classification_updated_by, thread.classification_updated_at,
        thread.assigned_owner_id,
        assigned_owner.display_name AS assigned_owner_display_name,
        thread.last_message_at, thread.response_due_at,
        thread.follow_up_at, thread.retention_class,
        thread.retention_class_updated_by,
        thread.retention_class_updated_at, thread.created_by,
        thread.created_at, thread.updated_at
      FROM conversation_thread thread
      JOIN relationship_contact relationship
        ON relationship.id = thread.relationship_contact_id
        AND relationship.workspace_id = thread.workspace_id
      LEFT JOIN LATERAL (
        SELECT
          count(DISTINCT prior_thread.id)::integer AS prior_thread_count,
          count(prior_message.id)::integer AS prior_message_count,
          max(GREATEST(
            prior_thread.created_at,
            COALESCE(prior_message.created_at, prior_thread.created_at)
          )) AS last_prior_interaction_at
        FROM conversation_thread prior_thread
        LEFT JOIN conversation_message prior_message
          ON prior_message.conversation_thread_id = prior_thread.id
          AND prior_message.workspace_id = prior_thread.workspace_id
          AND prior_message.created_at < thread.created_at
        WHERE prior_thread.workspace_id = thread.workspace_id
          AND prior_thread.relationship_contact_id = thread.relationship_contact_id
          AND prior_thread.id <> thread.id
          AND prior_thread.created_at < thread.created_at
      ) relationship_history ON true
      LEFT JOIN app_user assigned_owner ON assigned_owner.id = thread.assigned_owner_id
      LEFT JOIN campaign
        ON campaign.id = thread.campaign_id
        AND campaign.workspace_id = thread.workspace_id
      LEFT JOIN destination
        ON destination.id = thread.destination_id
        AND destination.workspace_id = thread.workspace_id
      LEFT JOIN brand_profile brand
        ON brand.id = thread.brand_profile_id
        AND brand.workspace_id = thread.workspace_id
      LEFT JOIN channel_connection channel
        ON channel.id = thread.channel_connection_id
        AND channel.workspace_id = thread.workspace_id
      LEFT JOIN publication_action publication
        ON publication.id = thread.publication_action_id
        AND publication.channel_connection_id = thread.channel_connection_id
        AND publication.workspace_id = thread.workspace_id
      LEFT JOIN LATERAL (
        SELECT rule.id, rule.name, rule.priority, rule.brand_profile_id,
          rule.channel_connection_id, rule.relationship_stage, rule.intent,
          rule.urgency, rule.target_owner_id,
          target_owner.display_name AS target_owner_display_name,
          rule.target_status
        FROM conversation_routing_rule rule
        LEFT JOIN app_user target_owner ON target_owner.id = rule.target_owner_id
        WHERE rule.workspace_id = thread.workspace_id
          AND rule.enabled
          AND (rule.brand_profile_id IS NULL OR rule.brand_profile_id = thread.brand_profile_id)
          AND (rule.channel_connection_id IS NULL OR rule.channel_connection_id = thread.channel_connection_id)
          AND (rule.relationship_stage IS NULL OR rule.relationship_stage = relationship.stage)
          AND (rule.intent IS NULL OR rule.intent = thread.intent)
          AND (rule.urgency IS NULL OR rule.urgency = thread.urgency)
          AND (
            rule.target_owner_id IS NULL OR EXISTS (
              SELECT 1 FROM workspace_membership routing_owner
              WHERE routing_owner.workspace_id = rule.workspace_id
                AND routing_owner.user_id = rule.target_owner_id
                AND routing_owner.role IN ('owner', 'admin', 'editor')
            )
          )
        ORDER BY rule.priority DESC,
          num_nonnulls(
            rule.brand_profile_id, rule.channel_connection_id,
            rule.relationship_stage, rule.intent, rule.urgency
          ) DESC,
          rule.updated_at DESC, rule.id
        LIMIT 1
      ) routing ON true
      LEFT JOIN conversation_service_level_policy service_policy
        ON service_policy.workspace_id = thread.workspace_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(max(inbound.created_at), thread.created_at) AS started_at
        FROM conversation_message inbound
        WHERE inbound.workspace_id = thread.workspace_id
          AND inbound.conversation_thread_id = thread.id
          AND inbound.kind = 'inbound'
      ) service_activity ON true
      LEFT JOIN LATERAL (
        SELECT
          CASE WHEN service_policy.workspace_id IS NOT NULL
            AND thread.status NOT IN ('resolved', 'archived') THEN
            COALESCE(
              thread.response_due_at,
              conversation_add_business_minutes(
                service_activity.started_at,
                service_policy.timezone,
                service_policy.business_days_mask,
                service_policy.business_start_time,
                service_policy.business_end_time,
                CASE thread.urgency
                  WHEN 'low' THEN service_policy.low_target_minutes
                  WHEN 'normal' THEN service_policy.normal_target_minutes
                  WHEN 'high' THEN service_policy.high_target_minutes
                  WHEN 'critical' THEN service_policy.critical_target_minutes
                  ELSE service_policy.unknown_target_minutes
                END
              )
            )
          END AS due_at,
          CASE WHEN service_policy.workspace_id IS NULL
            OR thread.status IN ('resolved', 'archived') THEN NULL
            WHEN thread.response_due_at IS NULL THEN 'workspace_policy'
            ELSE 'manual' END AS source
      ) service_level
        ON true
      WHERE thread.workspace_id = ${workspaceId}
        ${id ? this.sql`AND thread.id = ${id}` : this.sql``}
        ${query.campaignId ? this.sql`AND thread.campaign_id = ${query.campaignId}` : this.sql``}
        ${query.destinationId ? this.sql`AND thread.destination_id = ${query.destinationId}` : this.sql``}
        ${query.brandProfileId ? this.sql`AND thread.brand_profile_id = ${query.brandProfileId}` : this.sql``}
        ${query.channelConnectionId ? this.sql`AND thread.channel_connection_id = ${query.channelConnectionId}` : this.sql``}
        ${query.publicationActionId ? this.sql`AND thread.publication_action_id = ${query.publicationActionId}` : this.sql``}
        ${query.provider ? this.sql`AND thread.provider = ${query.provider}` : this.sql``}
        ${query.status ? this.sql`AND thread.status = ${query.status}` : this.sql``}
        ${query.sentiment ? this.sql`AND thread.sentiment = ${query.sentiment}` : this.sql``}
        ${query.intent ? this.sql`AND thread.intent = ${query.intent}` : this.sql``}
        ${query.urgency ? this.sql`AND thread.urgency = ${query.urgency}` : this.sql``}
        ${query.assignedOwnerId === null ? this.sql`AND thread.assigned_owner_id IS NULL` : query.assignedOwnerId ? this.sql`AND thread.assigned_owner_id = ${query.assignedOwnerId}` : this.sql``}
        ${query.activityFrom ? this.sql`AND COALESCE(thread.last_message_at, thread.updated_at) >= ${query.activityFrom}` : this.sql``}
        ${query.activityTo ? this.sql`AND COALESCE(thread.last_message_at, thread.updated_at) <= ${query.activityTo}` : this.sql``}
        ${
          query.unread === undefined || !viewerUserId
            ? this.sql``
            : query.unread
              ? this.sql`AND EXISTS (
          SELECT 1 FROM conversation_message unread_message
          WHERE unread_message.workspace_id = thread.workspace_id
            AND unread_message.conversation_thread_id = thread.id
            AND unread_message.created_at > COALESCE((
              SELECT read_state.last_read_at
              FROM conversation_read_state read_state
              WHERE read_state.conversation_thread_id = thread.id
                AND read_state.workspace_id = thread.workspace_id
                AND read_state.user_id = ${viewerUserId}
            ), '-infinity'::timestamptz)
            AND unread_message.created_by IS DISTINCT FROM ${viewerUserId}
        )`
              : this.sql`AND NOT EXISTS (
          SELECT 1 FROM conversation_message unread_message
          WHERE unread_message.workspace_id = thread.workspace_id
            AND unread_message.conversation_thread_id = thread.id
            AND unread_message.created_at > COALESCE((
              SELECT read_state.last_read_at
              FROM conversation_read_state read_state
              WHERE read_state.conversation_thread_id = thread.id
                AND read_state.workspace_id = thread.workspace_id
                AND read_state.user_id = ${viewerUserId}
            ), '-infinity'::timestamptz)
            AND unread_message.created_by IS DISTINCT FROM ${viewerUserId}
        )`
        }
        ${
          searchPattern
            ? this.sql`AND (
          thread.subject ILIKE ${searchPattern}
          OR relationship.display_name ILIKE ${searchPattern}
          OR COALESCE(relationship.organization_name, '') ILIKE ${searchPattern}
          OR COALESCE(campaign.name, '') ILIKE ${searchPattern}
          OR COALESCE(campaign.description, '') ILIKE ${searchPattern}
          OR COALESCE(destination.title, '') ILIKE ${searchPattern}
          OR COALESCE(destination.description, '') ILIKE ${searchPattern}
          OR array_to_string(COALESCE(destination.topics, '{}'), ' ') ILIKE ${searchPattern}
          OR COALESCE(brand.name, '') ILIKE ${searchPattern}
          OR COALESCE(brand.description, '') ILIKE ${searchPattern}
          OR COALESCE(channel.name, '') ILIKE ${searchPattern}
          OR COALESCE(channel.provider, '') ILIKE ${searchPattern}
          OR COALESCE(publication.provider_external_id, '') ILIKE ${searchPattern}
          OR EXISTS (
            SELECT 1 FROM conversation_message message
            WHERE message.conversation_thread_id = thread.id
              AND message.workspace_id = thread.workspace_id
              AND message.body ILIKE ${searchPattern}
          )
        )`
            : this.sql``
        }
        ${
          query.handoff === "open"
            ? this.sql`AND EXISTS (
          SELECT 1 FROM conversation_handoff_brief handoff
          WHERE handoff.conversation_thread_id = thread.id
            AND handoff.workspace_id = thread.workspace_id
            AND handoff.status = 'open'
        )`
            : query.handoff === "none"
              ? this.sql`AND NOT EXISTS (
          SELECT 1 FROM conversation_handoff_brief handoff
          WHERE handoff.conversation_thread_id = thread.id
            AND handoff.workspace_id = thread.workspace_id
            AND handoff.status = 'open'
        )`
              : this.sql``
        }
        ${
          query.deadline === "overdue"
            ? this.sql`AND (
          thread.response_due_at <= ${deadlineAsOf}
          OR thread.follow_up_at <= ${deadlineAsOf}
          OR EXISTS (
            SELECT 1 FROM conversation_handoff_brief handoff
            WHERE handoff.conversation_thread_id = thread.id
              AND handoff.workspace_id = thread.workspace_id
              AND handoff.status = 'open' AND handoff.due_at <= ${deadlineAsOf}
          )
        )`
            : query.deadline === "upcoming"
              ? this.sql`AND (
          thread.response_due_at > ${deadlineAsOf}
          OR thread.follow_up_at > ${deadlineAsOf}
          OR EXISTS (
            SELECT 1 FROM conversation_handoff_brief handoff
            WHERE handoff.conversation_thread_id = thread.id
              AND handoff.workspace_id = thread.workspace_id
              AND handoff.status = 'open' AND handoff.due_at > ${deadlineAsOf}
          )
        )`
              : query.deadline === "none"
                ? this.sql`AND (
          thread.response_due_at IS NULL AND thread.follow_up_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM conversation_handoff_brief handoff
            WHERE handoff.conversation_thread_id = thread.id
              AND handoff.workspace_id = thread.workspace_id
              AND handoff.status = 'open' AND handoff.due_at IS NOT NULL
          )
        )`
                : this.sql``
        }
      ORDER BY thread.last_message_at DESC NULLS LAST, thread.updated_at DESC
      LIMIT ${query.limit ?? 100}
    `;
  }

  private async attachMessages(
    rows: readonly ConversationThreadRow[],
    includeAll: boolean,
    viewerUserId?: string,
  ): Promise<StoredConversationThread[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const counts = await this.sql<
      { conversationThreadId: string; count: number }[]
    >`
      SELECT conversation_thread_id, count(*)::integer AS count
      FROM conversation_message
      WHERE conversation_thread_id IN ${this.sql(ids)}
      GROUP BY conversation_thread_id
    `;
    const readStats = viewerUserId
      ? await this.sql<
          {
            conversationThreadId: string;
            lastReadAt: string | Date | null;
            unreadCount: number;
          }[]
        >`
          SELECT thread.id AS conversation_thread_id,
            read_state.last_read_at,
            count(message.id)::integer AS unread_count
          FROM conversation_thread thread
          LEFT JOIN conversation_read_state read_state
            ON read_state.conversation_thread_id = thread.id
            AND read_state.workspace_id = thread.workspace_id
            AND read_state.user_id = ${viewerUserId}
          LEFT JOIN conversation_message message
            ON message.conversation_thread_id = thread.id
            AND message.workspace_id = thread.workspace_id
            AND message.created_at > COALESCE(
              read_state.last_read_at, '-infinity'::timestamptz
            )
            AND message.created_by IS DISTINCT FROM ${viewerUserId}
          WHERE thread.workspace_id = ${rows[0].workspaceId}
            AND thread.id IN ${this.sql(ids)}
          GROUP BY thread.id, read_state.last_read_at
        `
      : [];
    const messages = includeAll
      ? await this.messageRows(rows[0].workspaceId, rows[0].id)
      : await this.sql<
          (ConversationMessage & { conversationThreadId: string })[]
        >`
          SELECT DISTINCT ON (conversation_thread_id)
            id, conversation_thread_id, provider_message_id, kind, body,
            author_display, occurred_at, metadata, created_by, created_at
          FROM conversation_message
          WHERE conversation_thread_id IN ${this.sql(ids)}
          ORDER BY conversation_thread_id, occurred_at DESC, created_at DESC
        `;
    const handoffs = includeAll
      ? await this.handoffRows(rows[0].workspaceId, rows[0].id)
      : await this.sql<
          (ConversationHandoffBrief & { conversationThreadId: string })[]
        >`
          SELECT id, conversation_thread_id, status, contact_summary, importance,
            request_or_offer, prior_response_summary, relevant_context,
            suggested_response, due_at, requested_by, closed_by, closed_at,
            created_at, updated_at
          FROM conversation_handoff_brief
          WHERE conversation_thread_id IN ${this.sql(ids)} AND status = 'open'
        `;
    const reviewRequests = includeAll
      ? await this.reviewRequestRows(rows[0].workspaceId, rows[0].id)
      : [];
    const sharedResourceHistory = await this.sql<SharedResourceHistoryRow[]>`
      WITH ranked AS (
        SELECT context_thread.id AS context_thread_id,
          shared.id, shared.conversation_thread_id, shared.kind,
          shared.destination_id, shared.channel_connection_id,
          shared.publication_action_id, shared.observed_at,
          shared.recorded_by, shared.created_at,
          source_thread.subject AS source_thread_subject,
          destination.title AS destination_title,
          destination.canonical_url AS destination_canonical_url,
          channel.name AS channel_connection_name,
          publication.provider_external_id AS publication_external_id,
          publication.status AS publication_status,
          (count(*) OVER (
            PARTITION BY context_thread.id
          ))::integer AS history_count,
          (row_number() OVER (
            PARTITION BY context_thread.id
            ORDER BY shared.observed_at DESC, shared.created_at DESC, shared.id
          ))::integer AS resource_rank
        FROM conversation_thread context_thread
        JOIN conversation_thread source_thread
          ON source_thread.workspace_id = context_thread.workspace_id
          AND source_thread.relationship_contact_id = context_thread.relationship_contact_id
        JOIN conversation_shared_resource shared
          ON shared.workspace_id = source_thread.workspace_id
          AND shared.conversation_thread_id = source_thread.id
        LEFT JOIN destination
          ON destination.id = shared.destination_id
          AND destination.workspace_id = shared.workspace_id
        LEFT JOIN channel_connection channel
          ON channel.id = shared.channel_connection_id
          AND channel.workspace_id = shared.workspace_id
        LEFT JOIN publication_action publication
          ON publication.id = shared.publication_action_id
          AND publication.channel_connection_id = shared.channel_connection_id
          AND publication.workspace_id = shared.workspace_id
        WHERE context_thread.workspace_id = ${rows[0].workspaceId}
          AND context_thread.id IN ${this.sql(ids)}
          AND (
            source_thread.id = context_thread.id
            OR (
              source_thread.created_at < context_thread.created_at
              AND shared.created_at < context_thread.created_at
            )
          )
      )
      SELECT * FROM ranked
      WHERE resource_rank <= ${includeAll ? 20 : 3}
      ORDER BY context_thread_id, resource_rank
    `;
    return rows.map((row) => {
      const threadMessages = messages
        .filter((message) => message.conversationThreadId === row.id)
        .map(normalizeMessage);
      const threadHandoffs = handoffs
        .filter((handoff) => handoff.conversationThreadId === row.id)
        .map(normalizeHandoff);
      const readStat = readStats.find(
        (stat) => stat.conversationThreadId === row.id,
      );
      const resourceRows = sharedResourceHistory.filter(
        (resource) => resource.contextThreadId === row.id,
      );
      return {
        ...row,
        campaignId: row.campaignId ?? undefined,
        campaignName: row.campaignName ?? undefined,
        destinationId: row.destinationId ?? undefined,
        destinationTitle: row.destinationTitle ?? undefined,
        brandProfileId: row.brandProfileId ?? undefined,
        brandProfileName: row.brandProfileName ?? undefined,
        brandProfileStatus: row.brandProfileStatus ?? undefined,
        channelConnectionId: row.channelConnectionId ?? undefined,
        channelConnectionName: row.channelConnectionName ?? undefined,
        channelProvider: row.channelProvider ?? undefined,
        publicationActionId: row.publicationActionId ?? undefined,
        publicationExternalId: row.publicationExternalId ?? undefined,
        publicationStatus: row.publicationStatus ?? undefined,
        providerThreadId: row.providerThreadId ?? undefined,
        assignedOwnerId: row.assignedOwnerId ?? undefined,
        assignedOwnerDisplayName: row.assignedOwnerDisplayName ?? undefined,
        lastPriorInteractionAt: normalizeTimestamp(row.lastPriorInteractionAt),
        sharedResourceHistoryCount: resourceRows[0]?.historyCount ?? 0,
        recentSharedResources: resourceRows.map((resource) =>
          normalizeSharedResource(resource, row.id),
        ),
        routingSuggestion:
          row.routingRuleId && row.routingRuleName && row.routingTargetStatus
            ? {
                ruleId: row.routingRuleId,
                ruleName: row.routingRuleName,
                priority: row.routingPriority ?? 0,
                matchedOn: [
                  ...(row.routingBrandProfileId ? (["brand"] as const) : []),
                  ...(row.routingChannelConnectionId
                    ? (["account"] as const)
                    : []),
                  ...(row.routingRelationshipStage
                    ? (["relationship_stage"] as const)
                    : []),
                  ...(row.routingIntent ? (["intent"] as const) : []),
                  ...(row.routingUrgency ? (["urgency"] as const) : []),
                ],
                targetOwnerId: row.routingTargetOwnerId ?? undefined,
                targetOwnerDisplayName:
                  row.routingTargetOwnerDisplayName ?? undefined,
                targetStatus: row.routingTargetStatus,
              }
            : undefined,
        serviceLevel:
          row.serviceLevelStartedAt &&
          row.serviceLevelDueAt &&
          row.serviceLevelSource &&
          row.serviceLevelAtRiskBeforeMinutes !== null &&
          row.serviceLevelAtRiskBeforeMinutes !== undefined
            ? (() => {
                const dueAt = normalizeTimestamp(row.serviceLevelDueAt)!;
                const dueTime = new Date(dueAt).getTime();
                const now = Date.now();
                const atRiskTime =
                  dueTime - row.serviceLevelAtRiskBeforeMinutes * 60_000;
                return {
                  startedAt: normalizeTimestamp(row.serviceLevelStartedAt)!,
                  dueAt,
                  source: row.serviceLevelSource,
                  state:
                    now >= dueTime
                      ? ("overdue" as const)
                      : now >= atRiskTime
                        ? ("at_risk" as const)
                        : ("on_track" as const),
                };
              })()
            : undefined,
        classificationUpdatedBy: row.classificationUpdatedBy ?? undefined,
        classificationUpdatedAt: normalizeTimestamp(
          row.classificationUpdatedAt,
        ),
        lastMessageAt: row.lastMessageAt ?? undefined,
        responseDueAt: normalizeTimestamp(row.responseDueAt),
        followUpAt: normalizeTimestamp(row.followUpAt),
        retentionClassUpdatedBy: row.retentionClassUpdatedBy ?? undefined,
        retentionClassUpdatedAt: normalizeTimestamp(
          row.retentionClassUpdatedAt,
        ),
        messageCount:
          counts.find((count) => count.conversationThreadId === row.id)
            ?.count ?? 0,
        latestMessage: threadMessages.at(-1),
        messages: includeAll ? threadMessages : [],
        activeHandoff: threadHandoffs.find(
          (handoff) => handoff.status === "open",
        ),
        handoffs: includeAll ? threadHandoffs : [],
        openReviewRequestCount: row.openReviewRequestCount ?? 0,
        reviewRequests: includeAll
          ? reviewRequests.filter(
              (request) => request.conversationThreadId === row.id,
            )
          : [],
        unreadCount: readStat?.unreadCount ?? 0,
        lastReadAt: normalizeTimestamp(readStat?.lastReadAt),
      };
    });
  }

  private async reviewRequestRows(
    workspaceId: string,
    conversationThreadId: string,
    id?: string,
  ): Promise<StoredConversationReviewRequest[]> {
    const rows = await this.sql<
      (Omit<
        StoredConversationReviewRequest,
        | "mentionedMembers"
        | "sourceMessageId"
        | "dueAt"
        | "closedBy"
        | "closedAt"
        | "createdAt"
        | "updatedAt"
      > & {
        sourceMessageId: string | null;
        dueAt: string | Date | null;
        closedBy: string | null;
        closedAt: string | Date | null;
        createdAt: string | Date;
        updatedAt: string | Date;
      })[]
    >`
      SELECT request.id, request.conversation_thread_id,
        request.source_message_id, request.status, request.request_text,
        request.due_at, request.requested_by,
        requester.display_name AS requested_by_display_name,
        request.requested_reviewer_id,
        reviewer.display_name AS requested_reviewer_display_name,
        request.closed_by, request.closed_at,
        request.created_at, request.updated_at
      FROM conversation_review_request request
      JOIN app_user requester ON requester.id = request.requested_by
      JOIN app_user reviewer ON reviewer.id = request.requested_reviewer_id
      WHERE request.workspace_id = ${workspaceId}
        AND request.conversation_thread_id = ${conversationThreadId}
        ${id ? this.sql`AND request.id = ${id}` : this.sql``}
      ORDER BY request.created_at DESC, request.id
    `;
    if (rows.length === 0) return [];
    const mentions = await this.sql<
      { reviewRequestId: string; userId: string; displayName: string }[]
    >`
      SELECT mention.review_request_id, mention.mentioned_user_id AS user_id,
        member.display_name
      FROM conversation_review_request_mention mention
      JOIN app_user member ON member.id = mention.mentioned_user_id
      WHERE mention.workspace_id = ${workspaceId}
        AND mention.review_request_id IN ${this.sql(rows.map((row) => row.id))}
      ORDER BY lower(member.display_name), member.id
    `;
    return rows.map((row) => ({
      ...row,
      sourceMessageId: row.sourceMessageId ?? undefined,
      dueAt: normalizeTimestamp(row.dueAt),
      closedBy: row.closedBy ?? undefined,
      closedAt: normalizeTimestamp(row.closedAt),
      createdAt: normalizeTimestamp(row.createdAt)!,
      updatedAt: normalizeTimestamp(row.updatedAt)!,
      mentionedMembers: mentions
        .filter((mention) => mention.reviewRequestId === row.id)
        .map(({ userId, displayName }) => ({ userId, displayName })),
    }));
  }

  private async messageRows(
    workspaceId: string,
    conversationThreadId: string,
    id?: string,
  ): Promise<ConversationMessage[]> {
    return this.sql<ConversationMessage[]>`
      SELECT id, conversation_thread_id, provider_message_id, kind, body,
        author_display, occurred_at, metadata, created_by, created_at
      FROM conversation_message
      WHERE workspace_id = ${workspaceId}
        AND conversation_thread_id = ${conversationThreadId}
        ${id ? this.sql`AND id = ${id}` : this.sql``}
      ORDER BY occurred_at, created_at
    `;
  }

  private async sharedResourceById(
    workspaceId: string,
    id: string,
    currentThreadId: string,
  ): Promise<StoredConversationSharedResource | undefined> {
    const rows = await this.sql<SharedResourceRow[]>`
      SELECT shared.id, shared.conversation_thread_id, shared.kind,
        shared.destination_id, shared.channel_connection_id,
        shared.publication_action_id, shared.observed_at,
        shared.recorded_by, shared.created_at,
        source_thread.subject AS source_thread_subject,
        destination.title AS destination_title,
        destination.canonical_url AS destination_canonical_url,
        channel.name AS channel_connection_name,
        publication.provider_external_id AS publication_external_id,
        publication.status AS publication_status
      FROM conversation_shared_resource shared
      JOIN conversation_thread source_thread
        ON source_thread.id = shared.conversation_thread_id
        AND source_thread.workspace_id = shared.workspace_id
      LEFT JOIN destination
        ON destination.id = shared.destination_id
        AND destination.workspace_id = shared.workspace_id
      LEFT JOIN channel_connection channel
        ON channel.id = shared.channel_connection_id
        AND channel.workspace_id = shared.workspace_id
      LEFT JOIN publication_action publication
        ON publication.id = shared.publication_action_id
        AND publication.channel_connection_id = shared.channel_connection_id
        AND publication.workspace_id = shared.workspace_id
      WHERE shared.workspace_id = ${workspaceId} AND shared.id = ${id}
    `;
    return rows[0]
      ? normalizeSharedResource(rows[0], currentThreadId)
      : undefined;
  }

  private async handoffRows(
    workspaceId: string,
    conversationThreadId: string,
    id?: string,
  ): Promise<ConversationHandoffBrief[]> {
    return this.sql<ConversationHandoffBrief[]>`
      SELECT id, conversation_thread_id, status, contact_summary, importance,
        request_or_offer, prior_response_summary, relevant_context,
        suggested_response, due_at, requested_by, closed_by, closed_at,
        created_at, updated_at
      FROM conversation_handoff_brief
      WHERE workspace_id = ${workspaceId}
        AND conversation_thread_id = ${conversationThreadId}
        ${id ? this.sql`AND id = ${id}` : this.sql``}
      ORDER BY created_at, id
    `;
  }

  private async validateOwner(
    transaction: TransactionSql,
    workspaceId: string,
    assignedOwnerId?: string,
  ) {
    if (!assignedOwnerId) return;
    const owners = await transaction<{ found: boolean }[]>`
      SELECT true AS found FROM workspace_membership
      WHERE workspace_id = ${workspaceId} AND user_id = ${assignedOwnerId}
        AND role IN ('owner', 'admin', 'editor')
    `;
    if (!owners[0]) {
      throw new ConversationValidationError([
        {
          field: "assignedOwnerId",
          message:
            "Assigned owner must be an owner, administrator, or editor in this workspace.",
        },
      ]);
    }
  }

  private async requireConversationWriter(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
  ): Promise<void> {
    const rows = await transaction<{ found: boolean }[]>`
      SELECT true AS found FROM workspace_membership
      WHERE workspace_id = ${workspaceId} AND user_id = ${actorUserId}
        AND role IN ('owner', 'admin', 'editor')
    `;
    if (!rows[0])
      throw new ConversationValidationError([
        {
          field: "workspaceId",
          message: "Conversation retention changes require workspace authoring access.",
        },
      ]);
  }

  private async requireConversationApprover(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
  ): Promise<void> {
    const rows = await transaction<{ found: boolean }[]>`
      SELECT true AS found FROM workspace_membership
      WHERE workspace_id = ${workspaceId} AND user_id = ${actorUserId}
        AND role IN ('owner', 'admin', 'approver')
    `;
    if (!rows[0])
      throw new ConversationValidationError([
        {
          field: "workspaceId",
          message: "Conversation erasure decisions require workspace approval access.",
        },
      ]);
  }

  private async lockRetentionEligibility(
    transaction: TransactionSql,
    workspaceId: string,
    conversationThreadId: string,
    asOf: Date,
  ): Promise<
    | {
        retentionClass: Exclude<ConversationRetentionClass, "legal_hold">;
        eligibleAfter: string;
        retentionRevision: number;
      }
    | undefined
  > {
    const policies = await transaction<
      {
        enabled: boolean;
        standardDays: number;
        personalMessageDays: number;
        importedEmailDays: number;
      }[]
    >`
      SELECT enabled, standard_days, personal_message_days, imported_email_days
      FROM conversation_retention_policy
      WHERE workspace_id = ${workspaceId}
      FOR UPDATE
    `;
    const policy = policies[0];
    if (!policy?.enabled) {
      throw new ConversationValidationError([
        {
          field: "workspaceId",
          message: "Enable the conversation retention policy before requesting or executing erasure.",
        },
      ]);
    }
    const threads = await transaction<
      {
        status: ConversationStatus;
        retentionClass: ConversationRetentionClass;
        retentionRevision: number;
        lastActivityAt: string | Date;
      }[]
    >`
      SELECT status, retention_class, retention_revision,
        COALESCE(last_message_at, created_at) AS last_activity_at
      FROM conversation_thread
      WHERE workspace_id = ${workspaceId} AND id = ${conversationThreadId}
      FOR UPDATE
    `;
    const thread = threads[0];
    if (!thread) return undefined;
    if (!(["resolved", "archived"] as const).includes(thread.status as "resolved" | "archived")) {
      throw new ConversationValidationError([
        {
          field: "conversationThreadId",
          message: "Only resolved or archived conversations can be erased by retention policy.",
        },
      ]);
    }
    if (thread.retentionClass === "legal_hold") {
      throw new ConversationValidationError([
        {
          field: "conversationThreadId",
          message: "A conversation under legal hold cannot be erased.",
        },
      ]);
    }
    const activeHolds = await transaction<{ found: boolean }[]>`
      SELECT true AS found
      FROM conversation_legal_hold_case
      WHERE workspace_id = ${workspaceId}
        AND conversation_thread_id = ${conversationThreadId}
        AND status = 'active'
    `;
    if (activeHolds[0]) {
      throw new ConversationValidationError([
        {
          field: "conversationThreadId",
          message: "A conversation with an active legal-hold case cannot be erased.",
        },
      ]);
    }
    const days =
      thread.retentionClass === "personal_message"
        ? policy.personalMessageDays
        : thread.retentionClass === "imported_email"
          ? policy.importedEmailDays
          : policy.standardDays;
    const eligibleAfterRows = await transaction<{ eligibleAfter: string | Date }[]>`
      SELECT ${thread.lastActivityAt}::timestamptz
        + ${days} * interval '1 day' AS eligible_after
    `;
    const eligibleAfter = normalizeTimestamp(eligibleAfterRows[0]!.eligibleAfter)!;
    if (new Date(eligibleAfter).getTime() > asOf.getTime()) {
      throw new ConversationValidationError([
        {
          field: "conversationThreadId",
          message: `This conversation is not eligible for erasure until ${eligibleAfter}.`,
        },
      ]);
    }
    return {
      retentionClass: thread.retentionClass,
      eligibleAfter,
      retentionRevision: thread.retentionRevision,
    };
  }

  private async validateRoutingOwner(
    transaction: TransactionSql,
    workspaceId: string,
    targetOwnerId?: string,
  ) {
    if (!targetOwnerId) return;
    const owners = await transaction<{ found: boolean }[]>`
      SELECT true AS found FROM workspace_membership
      WHERE workspace_id = ${workspaceId} AND user_id = ${targetOwnerId}
        AND role IN ('owner', 'admin', 'editor')
    `;
    if (!owners[0]) {
      throw new ConversationValidationError([
        {
          field: "targetOwnerId",
          message: "Routing owner must be an eligible workspace member.",
        },
      ]);
    }
  }

  private async validateContext(
    transaction: TransactionSql,
    workspaceId: string,
    campaignId: string | null,
    destinationId: string | null,
    brandProfileId: string | null,
    channelConnectionId: string | null,
    publicationActionId: string | null,
  ) {
    if (campaignId) {
      const campaigns = await transaction<{ found: boolean }[]>`
        SELECT true AS found FROM campaign
        WHERE id = ${campaignId} AND workspace_id = ${workspaceId}
      `;
      if (!campaigns[0]) {
        throw new ConversationValidationError([
          {
            field: "campaignId",
            message: "Campaign must belong to this workspace.",
          },
        ]);
      }
    }
    if (destinationId) {
      const destinations = await transaction<{ found: boolean }[]>`
        SELECT true AS found FROM destination
        WHERE id = ${destinationId} AND workspace_id = ${workspaceId}
      `;
      if (!destinations[0]) {
        throw new ConversationValidationError([
          {
            field: "destinationId",
            message: "Destination must belong to this workspace.",
          },
        ]);
      }
    }
    if (brandProfileId) {
      const brands = await transaction<{ found: boolean }[]>`
        SELECT true AS found FROM brand_profile
        WHERE id = ${brandProfileId} AND workspace_id = ${workspaceId}
      `;
      if (!brands[0]) {
        throw new ConversationValidationError([
          {
            field: "brandProfileId",
            message: "Brand must belong to this workspace.",
          },
        ]);
      }
    }
    if (channelConnectionId) {
      const channels = await transaction<{ found: boolean }[]>`
        SELECT true AS found FROM channel_connection
        WHERE id = ${channelConnectionId} AND workspace_id = ${workspaceId}
      `;
      if (!channels[0]) {
        throw new ConversationValidationError([
          {
            field: "channelConnectionId",
            message: "Account must belong to this workspace.",
          },
        ]);
      }
    }
    if (publicationActionId) {
      if (!channelConnectionId) {
        throw new ConversationValidationError([
          {
            field: "channelConnectionId",
            message: "Publication context requires its account.",
          },
        ]);
      }
      const publications = await transaction<{ channelConnectionId: string }[]>`
        SELECT channel_connection_id FROM publication_action
        WHERE id = ${publicationActionId} AND workspace_id = ${workspaceId}
      `;
      if (!publications[0]) {
        throw new ConversationValidationError([
          {
            field: "publicationActionId",
            message: "Publication must belong to this workspace.",
          },
        ]);
      }
      if (publications[0].channelConnectionId !== channelConnectionId) {
        throw new ConversationValidationError([
          {
            field: "publicationActionId",
            message: "Publication must belong to the selected account.",
          },
        ]);
      }
    }
  }

  private async audit(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
    eventType: string,
    subjectId: string,
    data: Record<string, unknown>,
  ) {
    await transaction`
      INSERT INTO audit_event (
        id, organization_id, workspace_id, actor_user_id,
        event_type, subject_type, subject_id, data
      )
      SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, ${eventType},
        'conversation_thread', ${subjectId}, ${transaction.json(data as JSONValue)}
      FROM workspace WHERE id = ${workspaceId}
    `;
  }

  private async auditRoutingRule(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
    eventType: string,
    subjectId: string,
    data: Record<string, unknown>,
  ) {
    await transaction`
      INSERT INTO audit_event (
        id, organization_id, workspace_id, actor_user_id,
        event_type, subject_type, subject_id, data
      )
      SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, ${eventType},
        'conversation_routing_rule', ${subjectId},
        ${transaction.json(data as JSONValue)}
      FROM workspace WHERE id = ${workspaceId}
    `;
  }

  private async auditServiceLevelPolicy(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
    data: Record<string, unknown>,
  ) {
    await transaction`
      INSERT INTO audit_event (
        id, organization_id, workspace_id, actor_user_id,
        event_type, subject_type, subject_id, data
      )
      SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
        'conversation.service_level_policy_saved',
        'conversation_service_level_policy', ${workspaceId},
        ${transaction.json(data as JSONValue)}
      FROM workspace WHERE id = ${workspaceId}
    `;
  }

  private async auditRetentionPolicy(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
    data: Record<string, unknown>,
  ) {
    await transaction`
      INSERT INTO audit_event (
        id, organization_id, workspace_id, actor_user_id,
        event_type, subject_type, subject_id, data
      )
      SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
        'conversation.retention_policy_saved',
        'conversation_retention_policy', ${workspaceId},
        ${transaction.json(data as JSONValue)}
      FROM workspace WHERE id = ${workspaceId}
    `;
  }

  private async auditRetentionErasure(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
    eventType: string,
    requestId: string,
    data: Record<string, unknown>,
  ) {
    await transaction`
      INSERT INTO audit_event (
        id, organization_id, workspace_id, actor_user_id,
        event_type, subject_type, subject_id, data
      )
      SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, ${eventType},
        'conversation_retention_erasure_request', ${requestId},
        ${transaction.json(data as JSONValue)}
      FROM workspace WHERE id = ${workspaceId}
    `;
  }

  private async auditLegalHold(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
    eventType: string,
    holdId: string,
    data: Record<string, unknown>,
  ) {
    await transaction`
      INSERT INTO audit_event (
        id, organization_id, workspace_id, actor_user_id,
        event_type, subject_type, subject_id, data
      )
      SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, ${eventType},
        'conversation_legal_hold_case', ${holdId},
        ${transaction.json(data as JSONValue)}
      FROM workspace WHERE id = ${workspaceId}
    `;
  }
}

function normalizeMessage(message: ConversationMessage): ConversationMessage {
  return {
    ...message,
    providerMessageId: message.providerMessageId ?? undefined,
    authorDisplay: message.authorDisplay ?? undefined,
    createdBy: message.createdBy ?? undefined,
  };
}

function normalizeHandoff(
  handoff: ConversationHandoffBrief,
): ConversationHandoffBrief {
  return {
    ...handoff,
    dueAt: normalizeTimestamp(handoff.dueAt),
    closedBy: handoff.closedBy ?? undefined,
    closedAt: handoff.closedAt ?? undefined,
  };
}

function normalizeSharedResource(
  resource: SharedResourceRow,
  currentThreadId: string,
): StoredConversationSharedResource {
  return {
    id: resource.id,
    conversationThreadId: resource.conversationThreadId,
    kind: resource.kind,
    destinationId: resource.destinationId ?? undefined,
    destinationTitle: resource.destinationTitle ?? undefined,
    destinationCanonicalUrl: resource.destinationCanonicalUrl ?? undefined,
    channelConnectionId: resource.channelConnectionId ?? undefined,
    channelConnectionName: resource.channelConnectionName ?? undefined,
    publicationActionId: resource.publicationActionId ?? undefined,
    publicationExternalId: resource.publicationExternalId ?? undefined,
    publicationStatus: resource.publicationStatus ?? undefined,
    observedAt: normalizeTimestamp(resource.observedAt)!,
    recordedBy: resource.recordedBy,
    createdAt: normalizeTimestamp(resource.createdAt)!,
    sourceThreadSubject: resource.sourceThreadSubject,
    isCurrentThread: resource.conversationThreadId === currentThreadId,
  };
}

function normalizeRoutingRule(
  rule: StoredConversationRoutingRule,
): StoredConversationRoutingRule {
  return {
    ...rule,
    brandProfileId: rule.brandProfileId ?? undefined,
    brandProfileName: rule.brandProfileName ?? undefined,
    channelConnectionId: rule.channelConnectionId ?? undefined,
    channelConnectionName: rule.channelConnectionName ?? undefined,
    relationshipStage: rule.relationshipStage ?? undefined,
    intent: rule.intent ?? undefined,
    urgency: rule.urgency ?? undefined,
    targetOwnerId: rule.targetOwnerId ?? undefined,
    targetOwnerDisplayName: rule.targetOwnerDisplayName ?? undefined,
    createdAt: normalizeTimestamp(rule.createdAt)!,
    updatedAt: normalizeTimestamp(rule.updatedAt)!,
  };
}

function normalizeServiceLevelPolicy(
  policy: StoredConversationServiceLevelPolicy,
): StoredConversationServiceLevelPolicy {
  return {
    ...policy,
    businessStartTime: policy.businessStartTime.slice(0, 5),
    businessEndTime: policy.businessEndTime.slice(0, 5),
    createdAt: normalizeTimestamp(policy.createdAt)!,
    updatedAt: normalizeTimestamp(policy.updatedAt)!,
  };
}

function normalizeRetentionPolicy(
  policy: StoredConversationRetentionPolicy,
): StoredConversationRetentionPolicy {
  return {
    ...policy,
    createdAt: normalizeTimestamp(policy.createdAt)!,
    updatedAt: normalizeTimestamp(policy.updatedAt)!,
  };
}

function normalizeRetentionErasureRequest(
  request: ConversationRetentionErasureRow,
): ConversationRetentionErasureRequest {
  return {
    ...request,
    eligibleAfter: normalizeTimestamp(request.eligibleAfter)!,
    requestedAt: normalizeTimestamp(request.requestedAt)!,
    decidedBy: request.decidedBy ?? undefined,
    decidedByDisplayName: request.decidedByDisplayName ?? undefined,
    decidedAt: normalizeTimestamp(request.decidedAt),
    decisionNote: request.decisionNote ?? undefined,
    deletedCounts: request.deletedCounts ?? undefined,
    subject: request.subject ?? undefined,
    relationshipDisplayName: request.relationshipDisplayName ?? undefined,
  };
}

function normalizeLegalHoldCase(
  hold: ConversationLegalHoldRow,
): ConversationLegalHoldCase {
  return {
    ...hold,
    caseReference: hold.caseReference ?? undefined,
    placedAt: normalizeTimestamp(hold.placedAt)!,
    releasedBy: hold.releasedBy ?? undefined,
    releasedByDisplayName: hold.releasedByDisplayName ?? undefined,
    releasedAt: normalizeTimestamp(hold.releasedAt),
    releaseRequestId: hold.releaseRequestId ?? undefined,
    subject: hold.subject ?? undefined,
    relationshipDisplayName: hold.relationshipDisplayName ?? undefined,
  };
}

function normalizeLegalHoldReleaseRequest(
  request: ConversationLegalHoldReleaseRow,
): ConversationLegalHoldReleaseRequest {
  return {
    ...request,
    requestedAt: normalizeTimestamp(request.requestedAt)!,
    decidedBy: request.decidedBy ?? undefined,
    decidedByDisplayName: request.decidedByDisplayName ?? undefined,
    decidedAt: normalizeTimestamp(request.decidedAt),
    decisionNote: request.decisionNote ?? undefined,
    subject: request.subject ?? undefined,
    relationshipDisplayName: request.relationshipDisplayName ?? undefined,
  };
}

function normalizeAttentionItem(
  row: ConversationAttentionRow,
  asOf: Date,
): ConversationAttentionItem {
  const reasons: ConversationAttentionReason[] = [];
  const serviceLevelDueAt = normalizeTimestamp(row.serviceLevelDueAt);
  const followUpAt = normalizeTimestamp(row.followUpAt);
  const reviewRequestDueAt = normalizeTimestamp(row.reviewRequestDueAt);
  const handoffDueAt = normalizeTimestamp(row.handoffDueAt);
  const asOfTime = asOf.getTime();
  if (
    serviceLevelDueAt &&
    row.escalationAfterMinutes !== null &&
    row.escalationAfterMinutes !== undefined
  ) {
    const dueTime = new Date(serviceLevelDueAt).getTime();
    const escalationTime =
      dueTime + row.escalationAfterMinutes * 60_000;
    if (asOfTime >= escalationTime) reasons.push("response_escalation_due");
    else if (asOfTime >= dueTime) reasons.push("response_overdue");
    else reasons.push("response_at_risk");
  }
  if (followUpAt && new Date(followUpAt).getTime() <= asOfTime)
    reasons.push("follow_up_due");
  if (
    reviewRequestDueAt &&
    new Date(reviewRequestDueAt).getTime() <= asOfTime
  )
    reasons.push("review_request_due");
  if (handoffDueAt && new Date(handoffDueAt).getTime() <= asOfTime)
    reasons.push("handoff_due");
  const dueTimes = [
    serviceLevelDueAt,
    followUpAt,
    reviewRequestDueAt,
    handoffDueAt,
  ].filter((value): value is string => Boolean(value));
  return {
    conversationThreadId: row.conversationThreadId,
    subject: row.subject,
    relationshipDisplayName: row.relationshipDisplayName,
    status: row.status,
    assignedOwnerId: row.assignedOwnerId ?? undefined,
    assignedOwnerDisplayName: row.assignedOwnerDisplayName ?? undefined,
    reasons,
    primaryDueAt: dueTimes.sort(
      (left, right) => new Date(left).getTime() - new Date(right).getTime(),
    )[0]!,
    serviceLevelDueAt,
    followUpAt,
    reviewRequestDueAt,
    handoffDueAt,
  };
}

function compareAttentionItems(
  left: ConversationAttentionItem,
  right: ConversationAttentionItem,
): number {
  const rank = (item: ConversationAttentionItem) => {
    if (item.reasons.includes("response_escalation_due")) return 0;
    if (item.reasons.includes("response_overdue")) return 1;
    if (
      item.reasons.some((reason) =>
        ["follow_up_due", "review_request_due", "handoff_due"].includes(reason),
      )
    )
      return 2;
    return 3;
  };
  return (
    rank(left) - rank(right) ||
    new Date(left.primaryDueAt).getTime() -
      new Date(right.primaryDueAt).getTime() ||
    left.conversationThreadId.localeCompare(right.conversationThreadId)
  );
}

function normalizeTimestamp(
  value: string | Date | null | undefined,
): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}
