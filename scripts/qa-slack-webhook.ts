import { createServer } from "node:http";
import { SlackWebhookConnector } from "../packages/connectors/src/channels";

async function main(): Promise<void> {
  const port = 3120;
  const webhookUrl = "https://hooks.slack.com/services/T01234567/B01234567/abcdefghijklmnopqrstuvwxyz123456";
  const messages: Record<string, unknown>[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "POST" || request.url !== "/services/T01234567/B01234567/abcdefghijklmnopqrstuvwxyz123456") {
        response.writeHead(404).end(); return;
      }
      if (request.headers["content-type"] !== "application/json; charset=utf-8") {
        response.writeHead(400).end("invalid_payload"); return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      if (typeof payload.text !== "string" || payload.mrkdwn !== false || payload.link_names !== false
        || payload.unfurl_links !== false || payload.unfurl_media !== false) {
        response.writeHead(400).end("invalid_payload"); return;
      }
      messages.push(payload);
      response.writeHead(200, { "content-type": "text/plain" }).end("ok");
    })().catch(() => response.writeHead(500).end("rollup_error"));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  try {
    const connector = new SlackWebhookConnector(webhookUrl, async (input, init) => {
      const providerUrl = new URL(String(input));
      return fetch(`http://127.0.0.1:${port}${providerUrl.pathname}`, { ...init, signal: undefined });
    });
    const tested = await connector.testConnection();
    const delivered = await connector.publishContent({ content: "Approved release announcement\n\nhttps://example.com/launch" });
    if (!tested.ok || tested.providerIdentity?.teamId !== "T01234567" || messages.length !== 2) {
      throw new Error("Slack target/test acceptance failed");
    }
    if (messages[0]?.text !== "Market Me connection test — no Campaign content was published."
      || messages[1]?.text !== "Approved release announcement\n\nhttps://example.com/launch") {
      throw new Error("Slack exact-content acceptance failed");
    }
    if (delivered.externalId || delivered.externalUrl || delivered.metadata.providerMessageIdAvailable !== false) {
      throw new Error("Slack acknowledgement identity was overstated");
    }
    const output = {
      event: "qa.slack-webhook.completed",
      requestCount: messages.length,
      targetIdentityBound: true,
      exactContentDelivered: true,
      markupAndMentionsDisabled: true,
      unfurlsDisabled: true,
      providerMessageIdentityClaimed: false,
      secretExposed: false,
    };
    if (JSON.stringify(output).includes("abcdefghijklmnopqrstuvwxyz123456")) throw new Error("Webhook secret reached QA output");
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "qa.slack-webhook.failed", errorCode: error instanceof Error ? error.name : "UnknownError" }));
  process.exitCode = 1;
});
