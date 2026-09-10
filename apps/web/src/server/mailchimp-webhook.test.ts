import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseMailchimpWebhookWakeup } from "./mailchimp-webhook";

function delivery(type = "campaign", status = "sent") {
  const timestamp = 1_718_000_000; const secret = "mailchimp-signing-secret";
  const rawBody = new TextEncoder().encode(`type=${type}&fired_at=2026-08-12&data%5Bid%5D=campaign_1&data%5Blist_id%5D=audience_1&data%5Bstatus%5D=${status}&data%5Bemail%5D=private%40example.com&data%5Bip_opt%5D=10.0.0.1`);
  const signature = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
  return { signingSecret: secret, signatureHeader: `t=${timestamp},v1=${signature}`, rawBody, expectedAudienceId: "audience_1", nowSeconds: timestamp };
}

describe("Mailchimp webhook wakeup parser", () => {
  it("returns only exact aggregate collection identity after signature verification", () => {
    const result = parseMailchimpWebhookWakeup(delivery());
    expect(result).toEqual({ audienceId: "audience_1", providerCampaignId: "campaign_1", timestamp: 1_718_000_000, deliveryHash: expect.stringMatching(/^[0-9a-f]{64}$/u) });
    expect(JSON.stringify(result)).not.toMatch(/private|email|ip_opt/iu);
  });
  it("discards signed recipient events and audience mismatches", () => {
    expect(parseMailchimpWebhookWakeup(delivery("unsubscribe"))).toBeUndefined();
    expect(parseMailchimpWebhookWakeup(delivery("campaign", "sending"))).toBeUndefined();
    expect(parseMailchimpWebhookWakeup({ ...delivery(), expectedAudienceId: "audience_2" })).toBeUndefined();
  });
  it("rejects unsigned, stale, and byte-tampered deliveries", () => {
    expect(() => parseMailchimpWebhookWakeup({ ...delivery(), signatureHeader: "" })).toThrow("malformed");
    expect(() => parseMailchimpWebhookWakeup({ ...delivery(), nowSeconds: 1_718_000_301 })).toThrow("tolerance");
    expect(() => parseMailchimpWebhookWakeup({ ...delivery(), rawBody: new TextEncoder().encode("type=campaign") })).toThrow("invalid");
  });
});
