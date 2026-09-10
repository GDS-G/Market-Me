import { createServer } from "node:http";
import { MastodonAccountConnector } from "../packages/connectors/src/channels";

async function main(): Promise<void> {
  const port = 3120;
  const origin = "https://social.example.test";
  const token = "mastodon-user-token-abcdefghijklmnopqrstuvwxyz";
  const requests: { method?: string; path?: string; authorization?: string; idempotencyKey?: string; contentType?: string; body: Buffer }[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({
        method: request.method, path: request.url, authorization: request.headers.authorization,
        idempotencyKey: request.headers["idempotency-key"] as string | undefined,
        contentType: request.headers["content-type"], body: Buffer.concat(chunks),
      });
      response.setHeader("content-type", "application/json");
      if (request.method === "GET" && request.url === "/api/v1/accounts/verify_credentials") {
        response.writeHead(200).end(JSON.stringify({ id: "account-qa", username: "marketme", acct: "marketme", url: `${origin}/@marketme` })); return;
      }
      if (request.method === "GET" && request.url === "/api/v2/instance") {
        response.writeHead(200).end(JSON.stringify({ configuration: {
          statuses: { max_characters: 500, characters_reserved_per_url: 23, max_media_attachments: 4 },
          media_attachments: {
            supported_mime_types: ["image/jpeg", "image/png", "image/webp"],
            image_size_limit: 10 * 1024 * 1024, image_matrix_limit: 100_000_000, description_limit: 1_500,
          },
        } })); return;
      }
      if (request.method === "POST" && request.url === "/api/v2/media") {
        response.writeHead(202).end(JSON.stringify({ id: "media-qa", url: null })); return;
      }
      if (request.method === "GET" && request.url === "/api/v1/media/media-qa") {
        response.writeHead(200).end(JSON.stringify({ id: "media-qa", url: `${origin}/media/media-qa.png` })); return;
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
    if (!tested.ok || !tested.capabilities?.features.attachments || tested.capabilities.limits.attachmentsPerMessage !== 4)
      throw new Error("Mastodon reviewed-image capability discovery failed");
    const uploaded = await connector.uploadMedia({
      fileName: "approved.png", mimeType: "image/png", description: "Approved blue launch graphic", data: new Uint8Array([137, 80, 78, 71]),
    }, tested.capabilities);
    if (uploaded.mediaId !== "media-qa" || uploaded.ready) throw new Error("Mastodon async media identity acceptance failed");
    if (!await connector.mediaReady(uploaded.mediaId)) throw new Error("Mastodon media readiness acceptance failed");
    const delivered = await connector.publishContent({
      content: "Approved reviewed-image launch", idempotencyKey: "qa:mastodon:image:1", providerAttachmentIds: [uploaded.mediaId],
    });
    const upload = requests.find((item) => item.path === "/api/v2/media")!;
    if (!upload.contentType?.startsWith("multipart/form-data; boundary=")
      || !upload.body.includes(Buffer.from('name="description"'))
      || !upload.body.includes(Buffer.from("Approved blue launch graphic"))
      || !upload.body.includes(Buffer.from('filename="approved.png"')))
      throw new Error("Mastodon exact multipart media acceptance failed");
    const status = requests.find((item) => item.path === "/api/v1/statuses")!;
    if (status.idempotencyKey !== "qa:mastodon:image:1" || JSON.stringify(JSON.parse(status.body.toString("utf8"))) !== JSON.stringify({
      status: "Approved reviewed-image launch", visibility: "public", sensitive: false, media_ids: ["media-qa"],
    })) throw new Error("Mastodon exact attachment status acceptance failed");
    if (delivered.externalId !== "status-qa" || delivered.externalUrl !== `${origin}/@marketme/status-qa`) throw new Error("Mastodon attached status identity acceptance failed");
    const output = {
      event: "qa.mastodon-reviewed-images.completed", requestCount: requests.length, readOnlyPreflightCount: 2,
      mediaUploadWriteCount: 1, mediaReadinessReadCount: 1, publicationWriteCount: 1,
      liveLimitsBound: true, approvedAltTextDelivered: true, orderedMediaIdsAttached: true,
      publicVisibilityExplicit: true, providerIdempotencyApplied: true, secretExposed: false,
    };
    if (requests.length !== 5 || JSON.stringify(output).includes(token)
      || requests.some((item) => item.authorization !== `Bearer ${token}`)) throw new Error("Mastodon reviewed-image boundary acceptance failed");
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "qa.mastodon-reviewed-images.failed", errorCode: error instanceof Error ? error.name : "UnknownError" }));
  process.exitCode = 1;
});
