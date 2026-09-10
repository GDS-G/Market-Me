import { z } from "zod";
import {
  AUTONOMY_MODES,
  CAMPAIGN_OBJECTIVES,
  CAMPAIGN_METRIC_TYPES,
  CAMPAIGN_STEP_TYPES,
  CAMPAIGN_SUCCESS_ACTIONS,
  DESTINATION_STATUSES,
  EXECUTION_METHODS,
  INFORMATION_DEPTHS,
  PROMOTIONAL_STRENGTHS,
  SCHEDULE_TYPES,
  MEASUREMENT_EVENT_TYPES,
  MAX_DEPENDENCY_DELAY_SECONDS,
} from "@market-me/domain";

const boundedStringArray = z.array(z.string().trim().min(1).max(200)).max(50);
const jsonRecord = z.record(z.string().max(100), z.unknown());

export const destinationWriteSchema = z.object({
  workspaceId: z.string().uuid(),
  provider: z.string().trim().min(1).max(100),
  externalId: z.string().trim().max(500).optional(),
  canonicalUrl: z
    .string()
    .url()
    .refine(
      (value) => new URL(value).protocol === "https:",
      "Destination URL must use HTTPS.",
    ),
  knownRedirects: z.array(z.string().url()).max(20).default([]),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).default(""),
  contentType: z.string().trim().min(1).max(100).default("web_page"),
  ownerUserId: z.string().uuid().optional(),
  identifiers: z.record(z.string().max(100), z.string().max(500)).default({}),
  topics: boundedStringArray.default([]),
  audiences: boundedStringArray.default([]),
  geography: boundedStringArray.default([]),
  language: z.string().trim().min(2).max(35).optional(),
  status: z.enum(DESTINATION_STATUSES).default("draft"),
  availableAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  replacementDestinationId: z.string().uuid().optional(),
  tracking: jsonRecord.default({}),
});

const campaignStepSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().trim().min(1).max(200),
  operationType: z.enum(CAMPAIGN_STEP_TYPES),
  desiredCapability: z.string().trim().min(1).max(150),
  dependsOn: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  dependencyDelaySeconds: z.number().int().min(0).max(MAX_DEPENDENCY_DELAY_SECONDS).default(0),
  inputs: jsonRecord.default({}),
  outputs: jsonRecord.default({}),
  executionMethods: z.array(z.enum(EXECUTION_METHODS)).min(1).max(4),
  approvalRequired: z.boolean().default(true),
  scheduleType: z.enum(SCHEDULE_TYPES).default("immediate"),
  scheduledAt: z.string().datetime().optional(),
  preferredWindowStart: z.string().datetime().optional(),
  preferredWindowEnd: z.string().datetime().optional(),
  condition: jsonRecord.default({}),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  timeoutSeconds: z.number().int().min(1).max(86400).default(300),
  optional: z.boolean().default(false),
}).superRefine((step, context) => {
  if (step.dependencyDelaySeconds > 0 && !step.dependsOn.length) {
    context.addIssue({ code: "custom", path: ["dependencyDelaySeconds"], message: "A positive delay requires at least one dependency." });
  }
  if (step.scheduleType === "preferred_window" && (!step.preferredWindowStart || !step.preferredWindowEnd
    || Date.parse(step.preferredWindowStart) >= Date.parse(step.preferredWindowEnd))) {
    context.addIssue({ code: "custom", path: ["preferredWindowEnd"], message: "A preferred window requires a start before its end." });
  }
});

const successCriterionIdentity = {
  id: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_-]*$/),
};
const campaignSuccessCriterionSchema = z.preprocess(
  (value) =>
    value && typeof value === "object" && !("metric" in value)
      ? { ...value, metric: "count" }
      : value,
  z.discriminatedUnion("metric", [
    z.object({
      ...successCriterionIdentity,
      eventType: z.enum(CAMPAIGN_METRIC_TYPES),
      metric: z.literal("count"),
      targetCount: z.number().int().min(1).max(1_000_000_000),
    }),
    z.object({
      ...successCriterionIdentity,
      eventType: z.enum(MEASUREMENT_EVENT_TYPES),
      metric: z.literal("value"),
      targetValue: z.number().finite().positive().max(1_000_000_000_000),
      currency: z.string().regex(/^[A-Z]{3}$/),
    }),
  ]),
);

export const campaignDraftSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(""),
  objective: z.enum(CAMPAIGN_OBJECTIVES),
  contentPackageIds: z.array(z.string().uuid()).max(100).default([]),
  destinationId: z.string().uuid().optional(),
  brandProfileVersionId: z.string().uuid().optional(),
  audienceProfileVersionIds: z.array(z.string().uuid()).max(20).default([]),
  informationDepth: z.enum(INFORMATION_DEPTHS),
  promotionalStrength: z.enum(PROMOTIONAL_STRENGTHS),
  autonomyMode: z.enum(AUTONOMY_MODES),
  timezone: z.string().trim().min(1).max(100).default("UTC"),
  context: jsonRecord.default({}),
  successCriteria: z
    .array(campaignSuccessCriterionSchema)
    .max(20)
    .default([])
    .superRefine((criteria, context) => {
      const seen = new Set<string>();
      criteria.forEach((criterion, index) => {
        if (seen.has(criterion.id))
          context.addIssue({
            code: "custom",
            path: [index, "id"],
            message: "Success criterion IDs must be unique.",
          });
        seen.add(criterion.id);
      });
    }),
  successAction: z.enum(CAMPAIGN_SUCCESS_ACTIONS).default("notify_only"),
  steps: z.array(campaignStepSchema).min(1).max(100),
});
