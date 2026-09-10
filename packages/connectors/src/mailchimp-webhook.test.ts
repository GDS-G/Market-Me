import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeMailchimpCredentialBundle, encodeMailchimpCredentialBundle, verifyMailchimpWebhookSignature } from "./mailchimp-webhook";

describe("Mailchimp signed webhook support", () => {
  it("preserves legacy API keys and round-trips a versioned secret bundle", () => {
    expect(decodeMailchimpCredentialBundle(`${"a".repeat(32)}-us21`)).toEqual({ apiKey: `${"a".repeat(32)}-us21` });
    expect(decodeMailchimpCredentialBundle(encodeMailchimpCredentialBundle({ apiKey: "key-us21", webhookSigningSecret: "secret" }))).toEqual({ apiKey: "key-us21", webhookSigningSecret: "secret" });
  });

  it("verifies exact raw bytes and rejects tampering or stale timestamps", () => {
    const timestamp = 1_718_000_000; const secret = "signed-webhook-secret";
    const body = new TextEncoder().encode("type=campaign&data%5Bid%5D=campaign_1&data%5Blist_id%5D=audience_1&data%5Bemail%5D=private%40example.com");
    const signature = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
    expect(verifyMailchimpWebhookSignature(secret, `t=${timestamp},v1=${signature}`, body, timestamp)).toEqual({ timestamp, deliveryHash: expect.stringMatching(/^[0-9a-f]{64}$/u) });
    expect(() => verifyMailchimpWebhookSignature(secret, `t=${timestamp},v1=${signature}`, new TextEncoder().encode("type=campaign"), timestamp)).toThrow("invalid");
    expect(() => verifyMailchimpWebhookSignature(secret, `t=${timestamp},v1=${signature}`, body, timestamp + 301)).toThrow("tolerance");
  });
});
