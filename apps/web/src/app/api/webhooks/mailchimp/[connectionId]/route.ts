import { decodeMailchimpCredentialBundle, decryptToken } from "@market-me/connectors";
import { getServerConfiguration } from "@/server/config";
import { getPublishingRepository } from "@/server/database";
import { parseMailchimpWebhookWakeup } from "@/server/mailchimp-webhook";

const MAX_BODY_BYTES = 32_768;

export function GET() { return new Response(null, { status: 204 }); }

export async function POST(request: Request, context: { params: Promise<{ connectionId: string }> }) {
  try {
    if (!/^application\/x-www-form-urlencoded(?:;|$)/iu.test(request.headers.get("content-type") ?? "")) return new Response(null, { status: 415 });
    const { connectionId } = await context.params;
    if (!/^[0-9a-f-]{36}$/iu.test(connectionId)) return new Response(null, { status: 404 });
    const repository = getPublishingRepository();
    const target = await repository.getMailchimpWebhookTarget(connectionId);
    if (!target) return new Response(null, { status: 404 });
    const key = getServerConfiguration().connectorTokenEncryptionKey;
    if (!key) return new Response(null, { status: 503 });
    const bundle = decodeMailchimpCredentialBundle(decryptToken(target.encryptedCredentials, key));
    if (!bundle.webhookSigningSecret) return new Response(null, { status: 503 });
    const rawBody = await readBoundedBody(request);
    const wakeup = parseMailchimpWebhookWakeup({ signingSecret: bundle.webhookSigningSecret, signatureHeader: request.headers.get("x-mailchimp-signature") ?? "", rawBody, expectedAudienceId: target.audienceId });
    if (!wakeup) return new Response(null, { status: 204 });
    const accepted = await repository.wakeMailchimpReportCollectionFromWebhook({ connectionId, ...wakeup });
    return new Response(null, { status: accepted ? 202 : 204 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Mailchimp webhook")) return new Response(null, { status: 401 });
    if (error instanceof Error && error.message === "Webhook body exceeds limit") return new Response(null, { status: 413 });
    console.error(JSON.stringify({ event: "mailchimp.webhook.failed", errorCode: error instanceof Error ? error.name : "UnknownError" }));
    return new Response(null, { status: 503 });
  }
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new Error("Webhook body exceeds limit");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("Webhook body exceeds limit"); } chunks.push(value); }
  const body = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; } return body;
}
