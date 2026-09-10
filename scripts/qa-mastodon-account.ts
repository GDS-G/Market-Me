import { createServer } from "node:http";
import { MastodonAccountConnector } from "../packages/connectors/src/channels";

async function main(): Promise<void> {
  const port = 3120;
  const origin = "https://social.example.test";
  const token = "mastodon-user-token-abcdefghijklmnopqrstuvwxyz";
  const requests: { method?: string; path?: string; authorization?: string; idempotencyKey?: string; body?: unknown }[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const bodyText = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: request.method, path: request.url, authorization: request.headers.authorization,
        idempotencyKey: request.headers["idempotency-key"] as string | undefined,
        body: bodyText ? JSON.parse(bodyText) : undefined,
      });
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url === "/api/v1/accounts/verify_credentials") {
        response.writeHead(200).end(JSON.stringify({ id: "account-qa", username: "marketme", acct: "marketme", url: `${origin}/@marketme` })); return;
      }
      if (request.method === "GET" && request.url === "/api/v2/instance") {
        response.writeHead(200).end(JSON.stringify({ configuration: { statuses: { max_characters: 500, characters_reserved_per_url: 23 } } })); return;
      }
      if (request.method === "POST" && request.url === "/api/v1/statuses") {
        response.writeHead(200).end(JSON.stringify({ id: "status-qa", url: `${origin}/@marketme/status-qa` })); return;
      }
      response.writeHead(404).end(JSON.stringify({ error: "not found" }));
    })().catch(() => response.writeHead(500).end(JSON.stringify({ error: "qa failure" })));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  try {
    const connector = new MastodonAccountConnector(origin, token, ["social.example.test"], async (input, init) => {
      const providerUrl = new URL(String(input));
      return fetch(`http://127.0.0.1:${port}${providerUrl.pathname}`, { ...init, signal: undefined });
    });
    const tested = await connector.testConnection();
    const delivered = await connector.publishContent({ content: "Approved release announcement\n\nhttps://example.com/launch", idempotencyKey: "qa:mastodon:publish:1" });
    if (!tested.ok || tested.providerIdentity?.accountId !== "account-qa" || tested.capabilities?.limits.contentCharacters !== 500) throw new Error("Mastodon identity or live-limit acceptance failed");
    if (requests.length !== 3 || requests.filter((item) => item.method === "POST").length !== 1) throw new Error("Mastodon request-count acceptance failed");
    const publication = requests[2];
    if (publication?.idempotencyKey !== "qa:mastodon:publish:1" || JSON.stringify(publication.body) !== JSON.stringify({ status: "Approved release announcement\n\nhttps://example.com/launch", visibility: "public", sensitive: false })) throw new Error("Mastodon exact publication acceptance failed");
    if (delivered.externalId !== "status-qa" || delivered.externalUrl !== `${origin}/@marketme/status-qa`) throw new Error("Mastodon provider identity acceptance failed");
    const output = {
      event: "qa.mastodon-account.completed", requestCount: requests.length, readOnlyPreflightCount: 2,
      publicationWriteCount: 1, allowlistedHostBound: true, exactContentDelivered: true,
      publicVisibilityExplicit: true, providerIdempotencyApplied: true, stableIdentityReturned: true, secretExposed: false,
    };
    if (JSON.stringify(output).includes(token) || requests.some((item) => item.authorization !== `Bearer ${token}`)) throw new Error("Mastodon credential boundary acceptance failed");
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "qa.mastodon-account.failed", errorCode: error instanceof Error ? error.name : "UnknownError" }));
  process.exitCode = 1;
});
