import { createHash } from "node:crypto";
import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.QA_S3_PORT ?? "3102");
const maximumRequestBytes = 50 * 1024 * 1024;
const objects = new Map();

if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("QA_S3_PORT must be an integer from 1024 through 65535");

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    const objectPath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (!objectPath || objectPath.split("/").length < 2) return xmlError(response, 404, "NoSuchBucket");
    if (request.method === "PUT") {
      const bytes = await readBounded(request, maximumRequestBytes);
      const checksum = createHash("sha256").update(bytes).digest("base64");
      if (request.headers["x-amz-checksum-sha256"] !== checksum) return xmlError(response, 400, "BadDigest");
      if (request.headers["if-none-match"] === "*" && objects.has(objectPath)) return xmlError(response, 412, "PreconditionFailed");
      objects.set(objectPath, {
        bytes,
        checksum,
        metadataChecksum: request.headers["x-amz-meta-market-me-sha256"],
      });
      response.writeHead(200, { "x-amz-checksum-sha256": checksum, ETag: `"${createHash("md5").update(bytes).digest("hex")}"` });
      response.end();
      return;
    }
    if (request.method === "GET") {
      const object = objects.get(objectPath);
      if (!object) return xmlError(response, 404, "NoSuchKey");
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(object.bytes.byteLength),
        "x-amz-checksum-sha256": object.checksum,
        ...(object.metadataChecksum ? { "x-amz-meta-market-me-sha256": object.metadataChecksum } : {}),
      });
      response.end(object.bytes);
      return;
    }
    xmlError(response, 405, "MethodNotAllowed");
  } catch (error) {
    if (!response.headersSent) xmlError(response, 500, "InternalError");
    else response.destroy(error instanceof Error ? error : new Error("QA S3 server failed"));
  }
});

server.listen(port, host, () => console.log(JSON.stringify({ event: "qa.s3.listening", endpoint: `http://${host}:${port}` })));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => process.exit(0)));

async function readBounded(request, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.byteLength;
    if (total > limit) throw new Error("QA object exceeded request limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function xmlError(response, status, code) {
  const body = Buffer.from(`<Error><Code>${code}</Code><Message>${code}</Message></Error>`, "utf8");
  response.writeHead(status, { "content-type": "application/xml", "content-length": String(body.byteLength) });
  response.end(body);
}
