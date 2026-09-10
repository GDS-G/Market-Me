import { z } from "zod";
import {
  CONVERSATION_INTENTS,
  CONVERSATION_SENTIMENTS,
  CONVERSATION_STATUSES,
  CONVERSATION_URGENCIES,
  RELATIONSHIP_STAGES,
} from "@market-me/domain";

export const conversationThreadWriteSchema = z
  .object({
    workspaceId: z.string().uuid(),
    relationshipId: z.string().uuid(),
    campaignId: z.string().uuid().nullable().optional(),
    destinationId: z.string().uuid().nullable().optional(),
    brandProfileId: z.string().uuid().nullable().optional(),
    channelConnectionId: z.string().uuid().nullable().optional(),
    publicationActionId: z.string().uuid().nullable().optional(),
    provider: z.string().trim().min(1).max(100),
    providerThreadId: z.string().trim().min(1).max(500).optional(),
    subject: z.string().trim().min(1).max(500),
    status: z.enum(CONVERSATION_STATUSES).default("new"),
    sentiment: z.enum(CONVERSATION_SENTIMENTS).optional(),
    intent: z.enum(CONVERSATION_INTENTS).optional(),
    urgency: z.enum(CONVERSATION_URGENCIES).optional(),
    assignedOwnerId: z.string().uuid().optional(),
    responseDueAt: z.string().datetime({ offset: true }).optional(),
    followUpAt: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((value, context) => {
    if (value.status === "assigned" && !value.assignedOwnerId) {
      context.addIssue({
        code: "custom",
        path: ["assignedOwnerId"],
        message: "Assigned conversations require an owner.",
      });
    }
    if (value.status === "unassigned" && value.assignedOwnerId) {
      context.addIssue({
        code: "custom",
        path: ["assignedOwnerId"],
        message: "Unassigned conversations cannot have an owner.",
      });
    }
    if (value.publicationActionId && !value.channelConnectionId) {
      context.addIssue({
        code: "custom",
        path: ["channelConnectionId"],
        message: "Publication context requires its account.",
      });
    }
  });

export const internalNoteSchema = z.object({
  workspaceId: z.string().uuid(),
  body: z.string().trim().min(1).max(50_000),
});

const sharedResourceBase = z.object({
  workspaceId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  observedAt: z.string().datetime({ offset: true }),
});

export const conversationSharedResourceWriteSchema = z.discriminatedUnion(
  "kind",
  [
    sharedResourceBase
      .extend({
        kind: z.literal("destination"),
        destinationId: z.string().uuid(),
      })
      .strict(),
    sharedResourceBase
      .extend({
        kind: z.literal("publication"),
        publicationActionId: z.string().uuid(),
      })
      .strict(),
  ],
);

export const conversationRoutingRuleWriteSchema = z
  .object({
    workspaceId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    enabled: z.boolean().default(true),
    priority: z.number().int().min(0).max(1000).default(100),
    brandProfileId: z.string().uuid().optional(),
    channelConnectionId: z.string().uuid().optional(),
    relationshipStage: z.enum(RELATIONSHIP_STAGES).optional(),
    intent: z.enum(CONVERSATION_INTENTS).optional(),
    urgency: z.enum(CONVERSATION_URGENCIES).optional(),
    targetOwnerId: z.string().uuid().optional(),
    targetStatus: z.enum(CONVERSATION_STATUSES),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !value.brandProfileId &&
      !value.channelConnectionId &&
      !value.relationshipStage &&
      !value.intent &&
      !value.urgency
    ) {
      context.addIssue({
        code: "custom",
        path: ["name"],
        message: "Choose at least one routing matcher.",
      });
    }
    if (value.targetStatus === "assigned" && !value.targetOwnerId) {
      context.addIssue({
        code: "custom",
        path: ["targetOwnerId"],
        message: "Assigned suggestions require an eligible owner.",
      });
    }
    if (value.targetStatus !== "assigned" && value.targetOwnerId) {
      context.addIssue({
        code: "custom",
        path: ["targetOwnerId"],
        message: "Only assigned suggestions may include an owner.",
      });
    }
  });

export const conversationRoutingRuleEnabledSchema = z.object({
  workspaceId: z.string().uuid(),
  enabled: z.boolean(),
});

const serviceTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM time.");

export const conversationServiceLevelPolicySchema = z
  .object({
    workspaceId: z.string().uuid(),
    timezone: z.string().trim().min(1).max(100),
    businessDaysMask: z.number().int().min(1).max(127),
    businessStartTime: serviceTimeSchema,
    businessEndTime: serviceTimeSchema,
    unknownTargetMinutes: z.number().int().min(1).max(10080),
    lowTargetMinutes: z.number().int().min(1).max(10080),
    normalTargetMinutes: z.number().int().min(1).max(10080),
    highTargetMinutes: z.number().int().min(1).max(10080),
    criticalTargetMinutes: z.number().int().min(1).max(10080),
    atRiskBeforeMinutes: z.number().int().min(0).max(1440),
    escalationAfterMinutes: z.number().int().min(0).max(10080),
  })
  .strict()
  .refine((value) => value.businessStartTime < value.businessEndTime, {
    path: ["businessEndTime"],
    message: "Business end time must be later than the start time.",
  });

export const conversationReadSchema = z.object({
  workspaceId: z.string().uuid(),
});

export const conversationHandoffWriteSchema = z.object({
  workspaceId: z.string().uuid(),
  conversationThreadId: z.string().uuid(),
  contactSummary: z.string().trim().min(1).max(2_000),
  importance: z.string().trim().min(1).max(5_000),
  requestOrOffer: z.string().trim().min(1).max(5_000),
  priorResponseSummary: z.string().trim().max(10_000).default(""),
  relevantContext: z.string().trim().max(10_000).default(""),
  suggestedResponse: z.string().trim().max(20_000).default(""),
  dueAt: z.string().datetime({ offset: true }).optional(),
});

export const conversationHandoffCloseSchema = z.object({
  workspaceId: z.string().uuid(),
  status: z.enum(["resolved", "cancelled"]),
});

export const conversationReviewRequestWriteSchema = z
  .object({
    workspaceId: z.string().uuid(),
    conversationThreadId: z.string().uuid(),
    sourceMessageId: z.string().uuid().optional(),
    requestText: z.string().trim().min(1).max(10_000),
    dueAt: z.string().datetime({ offset: true }).optional(),
    requestedReviewerId: z.string().uuid(),
    mentionedUserIds: z.array(z.string().uuid()).max(20).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.mentionedUserIds).size !== value.mentionedUserIds.length) {
      context.addIssue({
        code: "custom",
        path: ["mentionedUserIds"],
        message: "Mention each teammate once.",
      });
    }
    if (value.mentionedUserIds.includes(value.requestedReviewerId)) {
      context.addIssue({
        code: "custom",
        path: ["mentionedUserIds"],
        message: "The requested reviewer is already included.",
      });
    }
  });

export const conversationReviewRequestCloseSchema = z
  .object({
    workspaceId: z.string().uuid(),
    status: z.enum(["resolved", "cancelled"]),
  })
  .strict();

export const conversationResponseSuggestionGenerateSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const conversationResponseSuggestionDecisionSchema = z
  .object({
    workspaceId: z.string().uuid(),
    status: z.literal("dismissed"),
  })
  .strict();

export const conversationResponseDraftWriteSchema = z
  .object({
    workspaceId: z.string().uuid(),
    body: z.string().min(1).max(20_000).refine((value) => value.trim().length > 0, {
      message: "Response draft cannot be blank.",
    }),
    sourceSuggestionId: z.string().uuid().optional(),
  })
  .strict();

export const conversationDraftingPresenceSchema = z
  .object({ workspaceId: z.string().uuid() })
  .strict();

export const conversationRetentionClassSchema = z
  .object({
    workspaceId: z.string().uuid(),
    retentionClass: z.enum(["standard", "personal_message", "imported_email"]),
  })
  .strict();

export const conversationRetentionPolicySchema = z
  .object({
    workspaceId: z.string().uuid(),
    enabled: z.boolean(),
    standardDays: z.number().int().min(1).max(3650),
    personalMessageDays: z.number().int().min(1).max(3650),
    importedEmailDays: z.number().int().min(1).max(3650),
  })
  .strict();

export const conversationRetentionErasureRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    requestNote: z.string().trim().min(3).max(1000),
  })
  .strict();

export const conversationRetentionErasureDecisionSchema = z
  .object({
    workspaceId: z.string().uuid(),
    decision: z.enum(["execute", "reject"]),
    decisionNote: z.string().trim().min(3).max(1000),
  })
  .strict();

export const conversationLegalHoldSchema = z
  .object({
    workspaceId: z.string().uuid(),
    reason: z.string().trim().min(3).max(1000),
    caseReference: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const conversationLegalHoldReleaseRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    targetRetentionClass: z.enum(["standard", "personal_message", "imported_email"]),
    requestNote: z.string().trim().min(3).max(1000),
  })
  .strict();

export const conversationLegalHoldReleaseDecisionSchema = z
  .object({
    workspaceId: z.string().uuid(),
    decision: z.enum(["approve", "reject"]),
    decisionNote: z.string().trim().min(3).max(1000),
  })
  .strict();

export const conversationThreadQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  campaign: z.string().uuid().optional(),
  destination: z.string().uuid().optional(),
  brand: z.string().uuid().optional(),
  account: z.string().uuid().optional(),
  publication: z.string().uuid().optional(),
  provider: z.string().trim().min(1).max(100).optional(),
  status: z.enum(CONVERSATION_STATUSES).optional(),
  sentiment: z.enum(CONVERSATION_SENTIMENTS).optional(),
  intent: z.enum(CONVERSATION_INTENTS).optional(),
  urgency: z.enum(CONVERSATION_URGENCIES).optional(),
  owner: z.union([z.enum(["me", "unassigned"]), z.string().uuid()]).optional(),
  handoff: z.enum(["open", "none"]).optional(),
  deadline: z.enum(["overdue", "upcoming", "none"]).optional(),
  read: z.enum(["unread", "read"]).optional(),
  activityFrom: z.string().date().optional(),
  activityTo: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
