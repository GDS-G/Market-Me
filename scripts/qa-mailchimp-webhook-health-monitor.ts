import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { encodeMailchimpCredentialBundle } from "../packages/connectors/src/mailchimp-webhook";
import { encryptToken } from "../packages/connectors/src/oauth";
import { MailchimpWebhookHealthMonitor } from "../apps/workflow-worker/src/webhook-health-monitor";

async function main(): Promise<void> {
  const port = 3119;
  const key = randomBytes(32).toString("base64");
  const apiKey = `${"a".repeat(32)}-us21`;
  const callback = (connection: string) => `https://market.example/api/webhooks/mailchimp/${connection}`;
  const targets = [
    { workspaceId: "11111111-1111-4111-8111-111111111111", connectionId: "22222222-2222-4222-8222-222222222222", audienceId: "audience_active", expectedCallbackUrl: callback("active"), providerWebhookId: "webhook_active" },
    { workspaceId: "11111111-1111-4111-8111-111111111111", connectionId: "33333333-3333-4333-8333-333333333333", audienceId: "audience_drift", expectedCallbackUrl: callback("drift"), providerWebhookId: "webhook_drift" },
  ].map((target) => ({ ...target, encryptedCredentials: encryptToken(encodeMailchimpCredentialBundle({ apiKey, webhookSigningSecret: "s".repeat(32) }), key), attemptCount: 1 }));
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    requests.push(`${request.method} ${url.pathname}`);
    const target = targets.find((candidate) => url.pathname === `/3.0/lists/${candidate.audienceId}/webhooks`);
    if (!target || request.method !== "GET") { response.writeHead(405).end(); return; }
    const drift = target.audienceId === "audience_drift";
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      list_id: target.audienceId, total_items: 1, webhooks: [{
        id: target.providerWebhookId, list_id: target.audienceId, url: target.expectedCallbackUrl,
        events: { subscribe: false, unsubscribe: drift, profile: false, cleaned: false, upemail: false, campaign: true, sms_subscribe: false, sms_unsubscribe: false, upsms: false, sms_campaign: false },
        sources: { user: false, admin: true, api: true },
      }],
    }));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const nativeFetch = globalThis.fetch;
  const completions: { connectionId: string; result: Record<string, unknown> }[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      const providerUrl = new URL(String(input));
      return nativeFetch(`http://127.0.0.1:${port}${providerUrl.pathname}${providerUrl.search}`, init);
    };
    const monitor = new MailchimpWebhookHealthMonitor({
      claimMailchimpWebhookHealthChecks: async () => targets,
      completeMailchimpWebhookHealthCheck: async (connectionId, result) => { completions.push({ connectionId, result }); },
    } as never, key, { batchSize: 10, checkIntervalSeconds: 3600 });
    const outcome = await monitor.runOnce();
    if (outcome.active !== 1 || outcome.unhealthy !== 1 || outcome.failed !== 0) throw new Error("Unexpected monitor outcome");
    if (requests.length !== 2 || requests.some((value) => !value.startsWith("GET "))) throw new Error("Monitor performed a provider mutation");
    if (!completions.some((entry) => entry.result.healthCode === "managed_active") || !completions.some((entry) => entry.result.healthCode === "managed_drifted")) throw new Error("Monitor did not retain closed health states");
    process.stdout.write(`${JSON.stringify({ event: "qa.mailchimp-webhook-health-monitor.completed", ...outcome, requestMethods: requests.map((value) => value.split(" ")[0]), providerMutation: false, storedHealthCodes: completions.map((entry) => entry.result.healthCode), secretExposed: false })}\n`);
  } finally {
    globalThis.fetch = nativeFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "qa.mailchimp-webhook-health-monitor.failed", errorCode: error instanceof Error ? error.name : "UnknownError" }));
  process.exitCode = 1;
});
