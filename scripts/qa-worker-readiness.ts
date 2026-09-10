import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createDatabaseClient } from "../packages/database/src/client";

// Resolve as the web workspace does, whether Next is local or hoisted to the root.
const nextCli = createRequire(new URL("../apps/web/package.json", import.meta.url)).resolve("next/dist/bin/next");

async function main(): Promise<void> {
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = createDatabaseClient(databaseUrl, { max: 1 });
const ingestionInstanceId = randomUUID();
const workflowInstanceId = randomUUID();
const packageMetadata = JSON.parse(await readFile(resolve("apps/web/package.json"), "utf8")) as { version: string };
const version = packageMetadata.version;
const port = 3114;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [nextCli, "start", "--port", String(port)],
  {
    cwd: resolve("apps/web"),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: databaseUrl,
      APP_BASE_URL: "https://market-me.example.test",
      OIDC_ISSUER: "https://identity.example.test",
      OIDC_CLIENT_ID: "market-me",
      MEDIA_OBJECT_STORE: "s3",
      MEDIA_S3_BUCKET: "market-me-production",
      MEDIA_S3_REGION: "us-east-1",
      CONNECTOR_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      MEDIA_ACCESS_SIGNING_KEY: "m".repeat(32),
      SERVICE_HEARTBEAT_MAX_AGE_SECONDS: "120",
    },
  },
);
let startupOutput = "";
for (const stream of [server.stdout, server.stderr]) {
  stream?.on("data", (chunk: Buffer) => {
    startupOutput = `${startupOutput}${chunk.toString("utf8")}`.slice(-2_000);
  });
}

try {
  await sql`
    INSERT INTO service_heartbeat (service, instance_id, version, started_at, last_seen_at)
    VALUES
      ('ingestion_worker', ${ingestionInstanceId}, ${version}, now(), now()),
      ('workflow_worker', ${workflowInstanceId}, ${version}, now(), now())
  `;
  const ready = await waitForReadiness();
  assertReadiness(ready, 200, "ready", "ready");

  await sql`
    UPDATE service_heartbeat
    SET last_seen_at = now(), stopped_at = now()
    WHERE service = 'workflow_worker' AND instance_id = ${workflowInstanceId}
  `;
  const stale = await fetchReadiness();
  assertReadiness(stale, 503, "ready", "not_ready");

  console.log(JSON.stringify({
    event: "qa.worker-readiness.completed",
    version,
    readyStatus: ready.status,
    staleStatus: stale.status,
    checkCount: Object.keys(ready.body.checks).length,
  }));
} finally {
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise((resolveExit) => server.once("exit", resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
    ]);
  }
  await sql`
    DELETE FROM service_heartbeat
    WHERE instance_id IN (${ingestionInstanceId}, ${workflowInstanceId})
  `;
  await sql.end();
}

async function waitForReadiness(): Promise<ReadinessResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (server.exitCode !== null) {
      const safeOutput = startupOutput.replaceAll(databaseUrl, "[DATABASE_URL]").replace(/\s+/gu, " ").trim();
      throw new Error(`Web process exited before readiness with code ${server.exitCode}: ${safeOutput}`);
    }
    try {
      return await fetchReadiness();
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
  }
  throw new Error(`Readiness endpoint did not start: ${lastError instanceof Error ? lastError.name : "UnknownError"}`);
}

interface ReadinessBody {
  service: string;
  status: string;
  version: string;
  checks: Record<string, string>;
}

interface ReadinessResponse {
  status: number;
  body: ReadinessBody;
}

async function fetchReadiness(): Promise<ReadinessResponse> {
  const response = await fetch(`${origin}/api/ready`, { cache: "no-store" });
  return { status: response.status, body: await response.json() as ReadinessBody };
}

function assertReadiness(
  response: ReadinessResponse,
  expectedHttpStatus: number,
  ingestionState: string,
  workflowState: string,
): void {
  if (response.status !== expectedHttpStatus
    || response.body.version !== version
    || Object.keys(response.body.checks).length !== 9
    || response.body.checks.ingestion_worker_freshness !== ingestionState
    || response.body.checks.workflow_worker_freshness !== workflowState) {
    console.error(JSON.stringify({
      event: "qa.worker-readiness.unexpected-response",
      expectedHttpStatus,
      response,
    }));
    throw new Error("Worker readiness acceptance did not return the expected closed projection");
  }
}
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    event: "qa.worker-readiness.failed",
    errorCode: error instanceof Error ? error.name : "UnknownError",
    reason: error instanceof Error ? error.message : "Unknown failure",
  }));
  process.exitCode = 1;
});
