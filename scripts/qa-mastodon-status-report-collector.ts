import { randomBytes } from "node:crypto";
import { encryptToken } from "../packages/connectors/src/oauth";
import { MastodonReportCollector } from "../apps/workflow-worker/src/mastodon-report-collector";

async function main(): Promise<void> {
  const encryptionKey = randomBytes(32).toString("base64");
  const token = "mastodon-collector-qa-token-abcdefghijklmnopqrstuvwxyz";
  const originalFetch = globalThis.fetch;
  const observedRequests: string[] = [];
  let recordedReport: Record<string, unknown> | undefined;
  let completion: { delaySeconds: number; errorCode?: string } | undefined;
  let snapshotAttempt: number | undefined;
  let completionAttempt: number | undefined;
  let reconcileCalls = 0;
  let claimCalls = 0;

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    observedRequests.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
    if (url.origin !== "https://social.example.test" || url.pathname !== "/api/v1/statuses/status-collector-qa") {
      return new Response(null, { status: 404 });
    }
    return new Response(JSON.stringify({
      id: "status-collector-qa",
      created_at: "2026-08-12T09:00:00Z",
      url: "https://social.example.test/@marketme/status-collector-qa",
      replies_count: 9,
      reblogs_count: 21,
      favourites_count: 55,
      content: "Provider content must not survive collection",
      account: { id: "account-collector-qa", acct: "marketme", display_name: "Not retained" },
      media_attachments: [{ id: "not-retained" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const repository: ConstructorParameters<typeof MastodonReportCollector>[0] = {
      reconcileMastodonStatusReportCollectionAlerts: async (maxAgeSeconds) => {
        if (maxAgeSeconds !== 604800) throw new Error("Alert collection horizon was not forwarded");
        reconcileCalls += 1;
        return reconcileCalls === 1 ? { active: 1, resolved: 0 } : { active: 0, resolved: 1 };
      },
      claimMastodonStatusReportCollections: async (limit: number, maxAgeSeconds: number) => {
        if (limit !== 1 || maxAgeSeconds !== 604800) throw new Error("Collector bounds were not forwarded");
        claimCalls += 1;
        if (claimCalls > 1) return [];
        return [{
          workspaceId: "11111111-1111-4111-8111-111111111111",
          publicationActionId: "22222222-2222-4222-8222-222222222222",
          providerStatusId: "status-collector-qa",
          providerAccountId: "account-collector-qa",
          providerStatusUrl: "https://social.example.test/@marketme/status-collector-qa",
          instanceOrigin: "https://social.example.test",
          encryptedCredentials: encryptToken(token, encryptionKey),
          actorUserId: "33333333-3333-4333-8333-333333333333",
          attemptCount: 1,
        }];
      },
      recordMastodonStatusReportSnapshot: async (_workspaceId, _actionId, report, _actor, expectedAttemptCount) => {
        recordedReport = { ...report };
        snapshotAttempt = expectedAttemptCount;
        return { snapshot: { ...report } as never, created: true };
      },
      completeMastodonStatusReportCollection: async (_actionId, result, expectedAttemptCount) => {
        completion = result;
        completionAttempt = expectedAttemptCount;
        return true;
      },
    };
    const collector = new MastodonReportCollector(repository, encryptionKey, ["social.example.test"], {
      batchSize: 1, refreshSeconds: 900, maxAgeSeconds: 604800,
    });

    const result = await collector.runOnce();
    const idleResult = await collector.runOnce();
    const serialized = JSON.stringify(recordedReport);
    if (result.claimed !== 1 || result.succeeded !== 1 || result.failed !== 0) throw new Error("Collector did not complete its bounded claim");
    if (result.superseded !== 0 || snapshotAttempt !== 1 || completionAttempt !== 1) throw new Error("Collector did not fence its claim writes");
    if (result.alertsActive !== 1 || result.alertReconciliationFailed || idleResult.claimed !== 0 || idleResult.alertsResolved !== 1 || idleResult.alertReconciliationFailed || reconcileCalls !== 2) throw new Error("Collector did not reconcile alerts across active and idle passes");
    if (observedRequests.length !== 1) throw new Error("Idle collection accessed the provider");
    if (recordedReport?.accountId !== "account-collector-qa" || recordedReport.favouritesCount !== 55) throw new Error("Aggregate report was not recorded intact");
    if (/Provider content|display_name|media_attachments/i.test(serialized)) throw new Error("Aggregate collection retained unapproved provider material");
    if (completion?.delaySeconds !== 900 || completion.errorCode !== undefined) throw new Error("Successful collection was not rescheduled correctly");
    if (serialized.includes(token)) throw new Error("Collector exposed credential material");

    process.stdout.write(`${JSON.stringify({
      event: "qa.mastodon-status-report-collector.completed",
      requestCount: observedRequests.length,
      boundedClaim: true,
      claimFenced: true,
      idleAlertsReconciled: true,
      readOnlyRequest: observedRequests[0]?.startsWith("GET ") === true,
      exactIdentityBound: true,
      aggregateOnly: true,
      nextDelaySeconds: completion.delaySeconds,
      secretExposed: false,
    })}\n`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    event: "qa.mastodon-status-report-collector.failed",
    errorCode: error instanceof Error ? error.name : "UnknownError",
  }));
  process.exitCode = 1;
});
