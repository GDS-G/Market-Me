import { createServer } from "node:http";
import { MailchimpEmailConnector } from "../packages/connectors/src/channels";

async function main(): Promise<void> {
const port = 3116;
const observed: string[] = [];
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  observed.push(`${request.method} ${url.pathname}?${url.searchParams.toString()}`);
  if (request.method !== "GET" || url.pathname !== "/3.0/reports/campaign_qa") {
    response.writeHead(404).end();
    return;
  }
  const fields = url.searchParams.get("fields") ?? "";
  if (!fields.includes("opens.unique_opens") || fields.includes("email-activity") || fields.includes("subscriber")) {
    response.writeHead(422).end();
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    id: "campaign_qa", list_id: "audience_qa", emails_sent: 250, abuse_reports: 1, unsubscribed: 3,
    send_time: "2026-08-12T06:00:00Z", bounces: { hard_bounces: 4, soft_bounces: 5 },
    opens: { opens_total: 160, unique_opens: 120 }, clicks: { clicks_total: 70, unique_clicks: 45 },
  }));
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolve);
});

try {
  const connector = new MailchimpEmailConnector(`${"a".repeat(32)}-us21`, async (input, init) => {
    const providerUrl = new URL(String(input));
    const localUrl = new URL(`http://127.0.0.1:${port}${providerUrl.pathname}${providerUrl.search}`);
    return fetch(localUrl, init);
  });
  const report = await connector.getCampaignReport("campaign_qa", "audience_qa");
  if (report.emailsSent !== 250 || report.uniqueOpens !== 120 || report.uniqueClicks !== 45) {
    throw new Error("Aggregate report values did not survive provider parsing");
  }
  const serialized = JSON.stringify(report);
  if (serialized.includes("@") || serialized.toLowerCase().includes("subscriber")) {
    throw new Error("Aggregate report contains recipient material");
  }
  process.stdout.write(`${JSON.stringify({
    event: "qa.mailchimp-report.completed",
    requestCount: observed.length,
    campaignBound: report.campaignId === "campaign_qa",
    audienceBound: report.audienceId === "audience_qa",
    recipientDataPresent: false,
    totals: { sent: report.emailsSent, uniqueOpens: report.uniqueOpens, uniqueClicks: report.uniqueClicks, bounces: report.hardBounces + report.softBounces, unsubscribed: report.unsubscribed, complaints: report.abuseReports },
  })}\n`);
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "qa.mailchimp-report.failed", errorCode: error instanceof Error ? error.name : "UnknownError" }));
  process.exitCode = 1;
});
