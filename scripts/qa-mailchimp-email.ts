import { createServer } from "node:http";
import { MailchimpEmailConnector } from "../packages/connectors/src/channels";

async function main(): Promise<void> {
const port = 3115;
const requests: { method: string; path: string; body: string }[] = [];
const server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({ method: request.method ?? "", path: request.url ?? "", body });
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/3.0/lists/audience_qa?fields=id,name") {
      response.writeHead(200).end(JSON.stringify({ id: "audience_qa", name: "QA Subscribers" }));
    } else if (request.method === "POST" && request.url === "/3.0/campaigns") {
      response.writeHead(200).end(JSON.stringify({ id: "campaign_qa", web_id: 314 }));
    } else if (request.method === "PUT" && request.url === "/3.0/campaigns/campaign_qa/content") {
      response.writeHead(200).end("{}");
    } else if (request.method === "POST" && request.url === "/3.0/campaigns/campaign_qa/actions/send") {
      response.writeHead(204).end();
    } else {
      response.writeHead(404).end(JSON.stringify({ title: "Not Found" }));
    }
  });
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolve);
});

try {
  const connector = new MailchimpEmailConnector(`${"a".repeat(32)}-us21`, (input, init) => {
    const providerUrl = new URL(String(input));
    return fetch(`http://127.0.0.1:${port}${providerUrl.pathname}${providerUrl.search}`, init);
  });
  const audience = await connector.testAudience("audience_qa");
  if (!audience.ok || audience.providerIdentity?.audienceId !== "audience_qa") throw new Error("Audience acceptance failed");
  const created: string[] = [];
  const result = await connector.publishCampaign({
    audienceId: "audience_qa",
    subject: "Release acceptance",
    content: "Approved body\n\nhttps://example.com/approved",
    fromName: "Market Me QA",
    replyTo: "qa@example.com",
    title: "Market Me release acceptance",
    onCampaignCreated: async (campaignId) => { created.push(campaignId); },
  });
  const content = JSON.parse(requests.find((entry) => entry.path.endsWith("/content"))?.body ?? "{}") as Record<string, string>;
  if (result.externalId !== "campaign_qa" || created[0] !== "campaign_qa" || requests.length !== 4) throw new Error("Campaign sequence acceptance failed");
  if (!content.html?.includes("*|UNSUB|*") || !content.html.includes("&lt;") && !content.html.includes("href=\"https://example.com/approved\"")) throw new Error("Email content safety acceptance failed");
  console.log(JSON.stringify({
    event: "qa.mailchimp-email.completed",
    audienceBound: true,
    campaignIdentityPersisted: true,
    requestSequence: requests.map(({ method, path }) => `${method} ${path.split("?")[0]}`),
    unsubscribePresent: true,
  }));
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "qa.mailchimp-email.failed", errorCode: error instanceof Error ? error.name : "UnknownError" }));
  process.exitCode = 1;
});
