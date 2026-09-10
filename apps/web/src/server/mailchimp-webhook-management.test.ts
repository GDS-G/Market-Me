import { describe, expect, it } from "vitest";
import { assessMailchimpWebhookHealth, webhooksEligibleForReplacement } from "./mailchimp-webhook-management";

const exact = {
  webhookId: "webhook_1", audienceId: "audience_1",
  callbackUrl: "https://market.example/api/webhooks/mailchimp/connection_1",
  events: { subscribe: false, unsubscribe: false, profile: false, cleaned: false, upemail: false, campaign: true, sms_subscribe: false, sms_unsubscribe: false, upsms: false, sms_campaign: false },
  sources: { user: false, admin: true, api: true },
} as const;

describe("Mailchimp webhook management", () => {
  it("reports an exact managed provider webhook as active", () => {
    expect(assessMailchimpWebhookHealth({
      webhooks: [exact], callbackUrl: exact.callbackUrl, management: "managed",
      providerWebhookId: exact.webhookId, signingConfigured: true,
    })).toEqual({ health: "managed_active", matchingCallbackCount: 1, providerWebhookPresent: true });
  });

  it("distinguishes provider drift, loss, and an unmanaged matching callback", () => {
    expect(assessMailchimpWebhookHealth({
      webhooks: [{ ...exact, events: { ...exact.events, unsubscribe: true } }], callbackUrl: exact.callbackUrl,
      management: "managed", providerWebhookId: exact.webhookId, signingConfigured: true,
    }).health).toBe("managed_drifted");
    expect(assessMailchimpWebhookHealth({
      webhooks: [], callbackUrl: exact.callbackUrl, management: "managed",
      providerWebhookId: exact.webhookId, signingConfigured: true,
    }).health).toBe("managed_missing");
    expect(assessMailchimpWebhookHealth({ webhooks: [exact], callbackUrl: exact.callbackUrl, signingConfigured: false }).health)
      .toBe("unmanaged_provider_webhook");
  });

  it("selects only the exact callback and stored managed identity for explicit replacement", () => {
    const old = { ...exact, webhookId: "old_webhook", callbackUrl: "https://old.example/hook" };
    const unrelated = { ...exact, webhookId: "unrelated", callbackUrl: "https://another.example/hook" };
    expect(webhooksEligibleForReplacement({ webhooks: [exact, old, unrelated], callbackUrl: exact.callbackUrl, providerWebhookId: old.webhookId }))
      .toEqual([exact, old]);
  });
});
