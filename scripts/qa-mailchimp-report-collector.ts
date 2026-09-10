import { randomBytes } from "node:crypto";
import { encryptToken } from "../packages/connectors/src/oauth";
import { MailchimpReportCollector } from "../apps/workflow-worker/src/report-collector";

async function main(): Promise<void> {
const encryptionKey = randomBytes(32).toString("base64");
const originalFetch = globalThis.fetch;
const observedRequests: string[] = [];
let recordedReport: Record<string, unknown> | undefined;
let completion: { delaySeconds: number; errorCode?: string } | undefined;

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  observedRequests.push(`${init?.method ?? "GET"} ${url.pathname}?${url.searchParams.toString()}`);
  if (url.hostname !== "us21.api.mailchimp.com" || url.pathname !== "/3.0/reports/campaign_collector_qa") {
    return new Response(null, { status: 404 });
  }
  const fields = url.searchParams.get("fields") ?? "";
  if (fields.includes("email-activity") || fields.includes("subscriber") || fields.includes("member")) {
    return new Response(null, { status: 422 });
  }
  return new Response(JSON.stringify({
    id: "campaign_collector_qa",
    list_id: "audience_collector_qa",
    emails_sent: 300,
    send_time: "2026-08-12T08:00:00Z",
    opens: { opens_total: 210, unique_opens: 150 },
    clicks: { clicks_total: 90, unique_clicks: 60 },
    unsubscribed: 4,
    bounces: { hard_bounces: 3, soft_bounces: 6 },
    abuse_reports: 1,
  }), { status: 200, headers: { "content-type": "application/json" } });
};

try {
  const collector = new MailchimpReportCollector({
    claimMailchimpReportCollections: async (limit: number, maxAgeSeconds: number) => {
      if (limit !== 1 || maxAgeSeconds !== 604800) throw new Error("Collector bounds were not forwarded");
      return [{
        workspaceId: "11111111-1111-4111-8111-111111111111",
        publicationActionId: "22222222-2222-4222-8222-222222222222",
        providerCampaignId: "campaign_collector_qa",
        audienceId: "audience_collector_qa",
        encryptedCredentials: encryptToken(`${"a".repeat(32)}-us21`, encryptionKey),
        actorUserId: "33333333-3333-4333-8333-333333333333",
        attemptCount: 1,
      }];
    },
    recordMailchimpCampaignReportSnapshot: async (_workspaceId, _actionId, report) => {
      recordedReport = report;
      return { snapshot: { ...report } as never, created: true, publicationReconciled: false };
    },
    completeMailchimpReportCollection: async (_actionId, result) => { completion = result; },
  } as never, encryptionKey, { batchSize: 1, refreshSeconds: 900, maxAgeSeconds: 604800 });

  const result = await collector.runOnce();
  const serialized = JSON.stringify(recordedReport);
  if (result.claimed !== 1 || result.succeeded !== 1 || result.failed !== 0) throw new Error("Collector did not complete its bounded claim");
  if (recordedReport?.audienceId !== "audience_collector_qa" || recordedReport.uniqueOpens !== 150) throw new Error("Aggregate report was not recorded intact");
  if (serialized.includes("@") || /subscriber|member|email_address/i.test(serialized)) throw new Error("Aggregate collection retained recipient material");
  if (completion?.delaySeconds !== 900 || completion.errorCode !== undefined) throw new Error("Successful collection was not rescheduled correctly");

  process.stdout.write(`${JSON.stringify({
    event: "qa.mailchimp-report-collector.completed",
    requestCount: observedRequests.length,
    boundedClaim: true,
    aggregateOnly: true,
    recipientDataPresent: false,
    nextDelaySeconds: completion.delaySeconds,
  })}\n`);
} finally {
  globalThis.fetch = originalFetch;
}
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    event: "qa.mailchimp-report-collector.failed",
    errorCode: error instanceof Error ? error.name : "UnknownError",
  }));
  process.exitCode = 1;
});
