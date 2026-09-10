import { verifyMailchimpWebhookSignature } from "@market-me/connectors";

export interface MailchimpWebhookWakeup {
  audienceId: string;
  providerCampaignId: string;
  deliveryHash: string;
  timestamp: number;
}

export function parseMailchimpWebhookWakeup(input: {
  signingSecret: string;
  signatureHeader: string;
  rawBody: Uint8Array;
  expectedAudienceId: string;
  nowSeconds?: number;
}): MailchimpWebhookWakeup | undefined {
  const verified = verifyMailchimpWebhookSignature(input.signingSecret, input.signatureHeader, input.rawBody, input.nowSeconds);
  const form = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(input.rawBody));
  if (form.get("type") !== "campaign" || form.get("data[status]") !== "sent") return undefined;
  const audienceId = form.get("data[list_id]") ?? "";
  const providerCampaignId = form.get("data[id]") ?? form.get("data[campaign_id]") ?? "";
  if (audienceId !== input.expectedAudienceId || !/^[A-Za-z0-9_-]{1,128}$/u.test(providerCampaignId)) return undefined;
  return { audienceId, providerCampaignId, deliveryHash: verified.deliveryHash, timestamp: verified.timestamp };
}
