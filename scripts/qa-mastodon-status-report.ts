import { createServer } from "node:http";
import { MastodonAccountConnector } from "../packages/connectors/src/channels";

async function main(): Promise<void> {
  const port = 3122;
  const token = "mastodon-status-report-token-abcdefghijklmnopqrstuvwxyz";
  const observed: { method?: string; path: string; authorization?: string }[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    observed.push({ method: request.method, path: url.pathname, authorization: request.headers.authorization });
    if (request.method !== "GET" || url.pathname !== "/api/v1/statuses/status-qa") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: "status-qa",
      created_at: "2026-08-12T10:00:00Z",
      url: "https://social.example.test/@marketme/status-qa",
      replies_count: 5,
      reblogs_count: 13,
      favourites_count: 29,
      content: "Provider post content is intentionally discarded",
      account: { id: "account-qa", acct: "marketme", display_name: "Not retained" },
      media_attachments: [{ id: "not-retained" }],
    }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  try {
    const connector = new MastodonAccountConnector(
      "https://social.example.test",
      token,
      ["social.example.test"],
      async (input, init) => {
        const providerUrl = new URL(String(input));
        return fetch(`http://127.0.0.1:${port}${providerUrl.pathname}`, init);
      },
    );
    const report = await connector.getStatusReport("status-qa", "account-qa");
    const serialized = JSON.stringify(report);
    if (report.repliesCount !== 5 || report.reblogsCount !== 13 || report.favouritesCount !== 29) {
      throw new Error("Mastodon aggregate totals did not survive provider parsing");
    }
    if (serialized.includes("Provider post content") || serialized.includes("display_name") || serialized.includes("media_attachments")) {
      throw new Error("Mastodon report retained unapproved provider material");
    }
    process.stdout.write(`${JSON.stringify({
      event: "qa.mastodon-status-report.completed",
      requestCount: observed.length,
      readOnlyRequest: observed.length === 1 && observed[0]?.method === "GET",
      exactStatusBound: report.statusId === "status-qa" && observed[0]?.path === "/api/v1/statuses/status-qa",
      exactAccountBound: report.accountId === "account-qa",
      sameInstanceUrlBound: report.statusUrl === "https://social.example.test/@marketme/status-qa",
      aggregateOnly: true,
      totals: { replies: report.repliesCount, boosts: report.reblogsCount, favourites: report.favouritesCount },
      secretExposed: serialized.includes(token),
    })}\n`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "qa.mastodon-status-report.failed", errorCode: error instanceof Error ? error.name : "UnknownError" }));
  process.exitCode = 1;
});
