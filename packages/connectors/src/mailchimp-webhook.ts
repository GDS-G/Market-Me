import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface MailchimpCredentialBundle { apiKey: string; webhookSigningSecret?: string; }

export function encodeMailchimpCredentialBundle(bundle: MailchimpCredentialBundle): string {
  return JSON.stringify({ version: 1, apiKey: bundle.apiKey, webhookSigningSecret: bundle.webhookSigningSecret });
}

export function decodeMailchimpCredentialBundle(value: string): MailchimpCredentialBundle {
  if (!value.startsWith("{")) return { apiKey: value };
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("Unsupported Mailchimp credential envelope"); }
  if (!parsed || typeof parsed !== "object") throw new Error("Unsupported Mailchimp credential envelope");
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 || typeof record.apiKey !== "string") throw new Error("Unsupported Mailchimp credential envelope");
  if (record.webhookSigningSecret !== undefined && typeof record.webhookSigningSecret !== "string") throw new Error("Unsupported Mailchimp credential envelope");
  return { apiKey: record.apiKey, webhookSigningSecret: record.webhookSigningSecret as string | undefined };
}

export function verifyMailchimpWebhookSignature(signingSecret: string, signatureHeader: string, rawBody: Uint8Array, nowSeconds = Math.floor(Date.now() / 1000)): { timestamp: number; deliveryHash: string } {
  const match = /^t=(\d{10}),v1=([0-9a-f]{64})$/u.exec(signatureHeader);
  if (!match) throw new Error("Mailchimp webhook signature is malformed");
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) throw new Error("Mailchimp webhook timestamp is outside the tolerance window");
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const signed = new Uint8Array(prefix.length + rawBody.length); signed.set(prefix); signed.set(rawBody, prefix.length);
  const expected = createHmac("sha256", signingSecret).update(signed).digest();
  const received = Buffer.from(match[2], "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("Mailchimp webhook signature is invalid");
  return { timestamp, deliveryHash: createHash("sha256").update(received).digest("hex") };
}
