import { describe, expect, it } from "vitest";
import { MEASUREMENT_EVENT_TYPES } from "@market-me/domain";
import { channelConnectionSchema, measurementKeySchema } from "./publishing-schema";

const base = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  name: "Revenue collector",
};

describe("measurement ingest-key schema", () => {
  it("defaults legacy creation requests to every normalized event and no expiry", () => {
    expect(measurementKeySchema.parse(base)).toEqual({
      ...base,
      allowedEventTypes: [...MEASUREMENT_EVENT_TYPES],
      allowedCampaignIds: [],
    });
  });

  it("accepts a unique event allowlist and future expiry", () => {
    expect(
      measurementKeySchema.parse({
        ...base,
        allowedEventTypes: ["purchase", "revenue"],
        allowedCampaignIds: ["22222222-2222-4222-8222-222222222222"],
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    ).toEqual({
      ...base,
      allowedEventTypes: ["purchase", "revenue"],
      allowedCampaignIds: ["22222222-2222-4222-8222-222222222222"],
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
  });

  it("rejects empty, duplicate, unknown, or already-expired scope contracts", () => {
    expect(
      measurementKeySchema.safeParse({ ...base, allowedEventTypes: [] })
        .success,
    ).toBe(false);
    expect(
      measurementKeySchema.safeParse({
        ...base,
        allowedEventTypes: ["revenue", "revenue"],
      }).success,
    ).toBe(false);
    expect(
      measurementKeySchema.safeParse({
        ...base,
        allowedCampaignIds: [
          "22222222-2222-4222-8222-222222222222",
          "22222222-2222-4222-8222-222222222222",
        ],
      }).success,
    ).toBe(false);
    expect(
      measurementKeySchema.safeParse({
        ...base,
        allowedEventTypes: ["not_real"],
      }).success,
    ).toBe(false);
    expect(
      measurementKeySchema.safeParse({
        ...base,
        expiresAt: "2000-01-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("channel connection schema", () => {
  it("accepts closed Discord, Slack, Mastodon, and audience-managed Mailchimp contracts", () => {
    expect(channelConnectionSchema.safeParse({
      ...base, provider: "discord_webhook", webhookUrl: "https://discord.com/api/webhooks/123/token-token-token-token",
    }).success).toBe(true);
    expect(channelConnectionSchema.safeParse({
      ...base, provider: "slack_webhook", webhookUrl: "https://hooks.slack.com/services/T01234567/B01234567/abcdefghijklmnopqrstuvwxyz123456",
    }).success).toBe(true);
    expect(channelConnectionSchema.safeParse({
      ...base, provider: "mastodon_account", instanceOrigin: "https://social.example.test", accessToken: "mastodon-user-token-abcdefghijklmnopqrstuvwxyz",
    }).success).toBe(true);
    expect(channelConnectionSchema.parse({
      ...base,
      provider: "mailchimp_email",
      apiKey: `${"a".repeat(32)}-us21`,
      audienceId: "audience_1",
      fromName: "Market Me",
      replyTo: "OWNER@example.com",
    })).toMatchObject({ provider: "mailchimp_email", audienceId: "audience_1" });
  });

  it("rejects raw recipients, mixed provider secrets, and malformed sender fields", () => {
    expect(channelConnectionSchema.safeParse({
      ...base, provider: "mailchimp_email", apiKey: `${"a".repeat(32)}-us21`, audienceId: "audience_1", fromName: "Market Me", replyTo: "owner@example.com", recipients: ["person@example.com"],
    }).success).toBe(false);
    expect(channelConnectionSchema.safeParse({
      ...base, provider: "mailchimp_email", apiKey: "short", audienceId: "bad id", fromName: "", replyTo: "not-email", webhookUrl: "https://discord.com/api/webhooks/1/token",
    }).success).toBe(false);
    expect(channelConnectionSchema.safeParse({
      ...base, provider: "slack_webhook", webhookUrl: "https://hooks.slack.com/services/T01234567/B01234567/abcdefghijklmnopqrstuvwxyz123456", apiKey: "mixed-secret",
    }).success).toBe(false);
    expect(channelConnectionSchema.safeParse({
      ...base, provider: "mastodon_account", instanceOrigin: "https://social.example.test", accessToken: "mastodon-user-token-abcdefghijklmnopqrstuvwxyz", webhookUrl: "https://example.test/hook",
    }).success).toBe(false);
  });
});
