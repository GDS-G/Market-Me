import { createServer } from "node:http";
import { MailchimpEmailConnector } from "../packages/connectors/src/channels";
import { assessMailchimpWebhookHealth } from "../apps/web/src/server/mailchimp-webhook-management";

async function main(): Promise<void> {
  const port = 3118;
  const callbackUrl = "https://market.example/api/webhooks/mailchimp/connection_qa";
  const secret = "qa-one-time-signing-secret-123456";
  let providerWebhook: Record<string, unknown> | undefined;
  const operations: string[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      operations.push(`${request.method} ${url.pathname}`);
      if (url.pathname === "/3.0/lists/audience_qa/webhooks" && request.method === "GET") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ list_id: "audience_qa", total_items: providerWebhook ? 1 : 0, webhooks: providerWebhook ? [providerWebhook] : [] }));
        return;
      }
      if (url.pathname === "/3.0/lists/audience_qa/webhooks" && request.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        const events = body.events as Record<string, unknown> | undefined;
        const sources = body.sources as Record<string, unknown> | undefined;
        if (body.url !== callbackUrl || events?.campaign !== true || events?.subscribe !== false
          || events?.unsubscribe !== false || sources?.user !== false || sources?.admin !== true || sources?.api !== true) {
          response.writeHead(422).end(); return;
        }
        providerWebhook = { id: "webhook_qa", list_id: "audience_qa", url: callbackUrl, events, sources };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ...providerWebhook, signing_secret: secret }));
        return;
      }
      if (url.pathname === "/3.0/lists/audience_qa/webhooks/webhook_qa" && request.method === "DELETE") {
        providerWebhook = undefined; response.writeHead(204).end(); return;
      }
      response.writeHead(404).end();
    })().catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  try {
    const connector = new MailchimpEmailConnector(`${"a".repeat(32)}-us21`, async (input, init) => {
      const providerUrl = new URL(String(input));
      return fetch(`http://127.0.0.1:${port}${providerUrl.pathname}${providerUrl.search}`, init);
    });
    const created = await connector.createCampaignWebhook("audience_qa", callbackUrl);
    if (created.signingSecret !== secret) throw new Error("One-time signing secret was not captured");
    const inventory = await connector.listAudienceWebhooks("audience_qa");
    const active = assessMailchimpWebhookHealth({
      webhooks: inventory, callbackUrl, management: "managed", providerWebhookId: created.webhookId, signingConfigured: true,
    });
    if (active.health !== "managed_active") throw new Error("Managed webhook was not healthy");
    await connector.deleteAudienceWebhook("audience_qa", created.webhookId);
    const empty = await connector.listAudienceWebhooks("audience_qa");
    if (empty.length !== 0) throw new Error("Managed webhook was not removed");
    const output = { event: "qa.mailchimp-webhook-lifecycle.completed", operations, campaignOnly: true, recipientEventsEnabled: false, health: active.health, providerWebhookRemoved: true, signingSecretExposed: false };
    if (JSON.stringify(output).includes(secret)) throw new Error("Signing secret reached QA output");
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "qa.mailchimp-webhook-lifecycle.failed", errorCode: error instanceof Error ? error.name : "UnknownError" }));
  process.exitCode = 1;
});
