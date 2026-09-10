import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeMailchimpCredentialBundle, encryptToken } from "@market-me/connectors";
import { MailchimpWebhookHealthMonitor } from "./webhook-health-monitor";

const key = randomBytes(32).toString("base64");
const apiKey = `${"a".repeat(32)}-us21`;
const target = {
  workspaceId: "11111111-1111-4111-8111-111111111111", connectionId: "22222222-2222-4222-8222-222222222222",
  audienceId: "audience_1", expectedCallbackUrl: "https://market.example/api/webhooks/mailchimp/connection_1",
  providerWebhookId: "webhook_1",
  encryptedCredentials: encryptToken(encodeMailchimpCredentialBundle({ apiKey, webhookSigningSecret: "s".repeat(32) }), key),
  attemptCount: 1,
};
const exactWebhook = {
  id: "webhook_1", list_id: "audience_1", url: target.expectedCallbackUrl,
  events: { subscribe: false, unsubscribe: false, profile: false, cleaned: false, upemail: false, campaign: true, sms_subscribe: false, sms_unsubscribe: false, upsms: false, sms_campaign: false },
  sources: { user: false, admin: true, api: true },
};

afterEach(() => vi.unstubAllGlobals());

describe("MailchimpWebhookHealthMonitor", () => {
  it("records an exact managed webhook as active", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ list_id: "audience_1", total_items: 1, webhooks: [exactWebhook] }), { status: 200 })));
    const complete = vi.fn(async () => undefined);
    const monitor = new MailchimpWebhookHealthMonitor({
      claimMailchimpWebhookHealthChecks: vi.fn(async () => [target]), completeMailchimpWebhookHealthCheck: complete,
    } as never, key, { batchSize: 10, checkIntervalSeconds: 3600 });
    await expect(monitor.runOnce()).resolves.toEqual({ claimed: 1, active: 1, unhealthy: 0, failed: 0 });
    expect(complete).toHaveBeenCalledWith(target.connectionId, { delaySeconds: 3600, healthCode: "managed_active" });
  });

  it("surfaces exact provider drift without mutating the provider", async () => {
    const request = vi.fn(async (_input?: unknown, _init?: RequestInit) => new Response(JSON.stringify({
      list_id: "audience_1", total_items: 1, webhooks: [{ ...exactWebhook, events: { ...exactWebhook.events, unsubscribe: true } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    const complete = vi.fn(async () => undefined);
    const monitor = new MailchimpWebhookHealthMonitor({
      claimMailchimpWebhookHealthChecks: vi.fn(async () => [target]), completeMailchimpWebhookHealthCheck: complete,
    } as never, key, { batchSize: 10, checkIntervalSeconds: 3600 });
    await expect(monitor.runOnce()).resolves.toEqual({ claimed: 1, active: 0, unhealthy: 1, failed: 0 });
    expect(complete).toHaveBeenCalledWith(target.connectionId, { delaySeconds: 3600, healthCode: "managed_drifted" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
  });

  it("detects a missing local secret without a provider request", async () => {
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    const complete = vi.fn(async () => undefined);
    const secretless = { ...target, encryptedCredentials: encryptToken(encodeMailchimpCredentialBundle({ apiKey }), key) };
    const monitor = new MailchimpWebhookHealthMonitor({
      claimMailchimpWebhookHealthChecks: vi.fn(async () => [secretless]), completeMailchimpWebhookHealthCheck: complete,
    } as never, key, { batchSize: 10, checkIntervalSeconds: 3600 });
    await expect(monitor.runOnce()).resolves.toEqual({ claimed: 1, active: 0, unhealthy: 1, failed: 0 });
    expect(complete).toHaveBeenCalledWith(target.connectionId, { delaySeconds: 3600, healthCode: "managed_secret_missing" });
    expect(request).not.toHaveBeenCalled();
  });
});
