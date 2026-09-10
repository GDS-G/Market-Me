import { z } from "zod";
import { MEASUREMENT_EVENT_TYPES } from "@market-me/domain";

const channelConnectionBase = {
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
};

export const channelConnectionSchema = z.discriminatedUnion("provider", [
  z.object({
    ...channelConnectionBase,
    provider: z.literal("discord_webhook"),
    webhookUrl: z.string().url().max(500),
  }).strict(),
  z.object({
    ...channelConnectionBase,
    provider: z.literal("slack_webhook"),
    webhookUrl: z.string().url().max(500),
  }).strict(),
  z.object({
    ...channelConnectionBase,
    provider: z.literal("mailchimp_email"),
    apiKey: z.string().trim().min(20).max(200),
    audienceId: z.string().trim().regex(/^[a-z0-9_-]{1,64}$/iu),
    fromName: z.string().trim().min(1).max(100),
    replyTo: z.string().trim().email().max(320),
  }).strict(),
  z.object({
    ...channelConnectionBase,
    provider: z.literal("mastodon_account"),
    instanceOrigin: z.string().url().max(500),
    accessToken: z.string().trim().min(20).max(500),
  }).strict(),
]);

export const measurementKeySchema = z
  .object({
    workspaceId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    allowedEventTypes: z
      .array(z.enum(MEASUREMENT_EVENT_TYPES))
      .min(1)
      .max(MEASUREMENT_EVENT_TYPES.length)
      .default([...MEASUREMENT_EVENT_TYPES]),
    allowedCampaignIds: z.array(z.string().uuid()).max(100).default([]),
    expiresAt: z.string().datetime().optional(),
  })
  .superRefine((value, context) => {
    if (
      new Set(value.allowedEventTypes).size !== value.allowedEventTypes.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["allowedEventTypes"],
        message: "Event scopes must be unique.",
      });
    }
    if (
      new Set(value.allowedCampaignIds).size !== value.allowedCampaignIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["allowedCampaignIds"],
        message: "Campaign scopes must be unique.",
      });
    }
    if (value.expiresAt && new Date(value.expiresAt).getTime() <= Date.now()) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Expiry must be in the future.",
      });
    }
  });

export const measurementEventSchema = z.object({
  eventKey: z.string().trim().min(1).max(200),
  eventType: z.enum(MEASUREMENT_EVENT_TYPES),
  source: z.string().trim().min(1).max(80),
  campaignId: z.string().uuid().optional(),
  campaignInstanceId: z.string().uuid().optional(),
  campaignStepRunId: z.string().uuid().optional(),
  destinationId: z.string().uuid().optional(),
  trackedLinkId: z.string().uuid().optional(),
  publicationActionId: z.string().uuid().optional(),
  externalEventId: z.string().max(200).optional(),
  value: z.number().finite().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  properties: z
    .record(z.string(), z.unknown())
    .refine(
      (value) =>
        Object.keys(value).length <= 50 &&
        JSON.stringify(value).length <= 32_768,
      "Properties must contain at most 50 keys and 32 KiB of JSON.",
    )
    .default({}),
  occurredAt: z.string().datetime(),
});
