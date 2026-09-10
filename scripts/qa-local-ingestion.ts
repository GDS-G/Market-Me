import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn, type ChildProcess } from "node:child_process";
import { createPairingCode, createWorkerToken } from "@market-me/companion-protocol";
import { CompanionRepository, createDatabaseClient, MarketMeRepository } from "@market-me/database";

// Resolve as the web workspace does, whether Next is local or hoisted to the root.
const nextCli = createRequire(new URL("../apps/web/package.json", import.meta.url)).resolve("next/dist/bin/next");

function parseEnvironment(text: string): Record<string, string> {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf("=");
    return separator > 0 && !line.startsWith("#") ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
  }));
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Local web server did not become ready");
}

async function runWorker(environment: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const worker = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "apps/worker/src/index.ts"], {
      cwd: process.cwd(), env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let errors = "";
    worker.stderr?.on("data", (value) => { errors += value.toString(); });
    worker.once("error", reject);
    worker.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Ingestion worker failed (${code}): ${errors}`)));
  });
}

async function main(): Promise<void> {
const localEnvironment = parseEnvironment(await readFile("apps/web/.env.local", "utf8"));
const databaseUrl = localEnvironment.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = createDatabaseClient(databaseUrl);
const core = new MarketMeRepository(sql);
const companion = new CompanionRepository(sql);
let organizationId: string | undefined;
let userId: string | undefined;
let server: ChildProcess | undefined;

try {
  const suffix = randomUUID();
  const bootstrap = await core.bootstrapDevelopmentWorkspace({ email: `local-qa-${suffix}@market-me.local`, displayName: "Local QA" });
  organizationId = bootstrap.workspace.organizationId; userId = bootstrap.user.id;
  const pairing = createPairingCode();
  await companion.createPairingCode({ workspaceId: bootstrap.workspace.workspaceId, codeHash: pairing.codeHash, expiresAt: new Date(Date.now() + 60_000), createdBy: userId });
  const token = createWorkerToken();
  const paired = await companion.pairWorker({ codeHash: pairing.codeHash, name: "Local QA worker", platform: "windows", architecture: "x86_64", appVersion: "0.11.0", tokenPrefix: token.prefix, tokenHash: token.tokenHash });
  if (!paired) throw new Error("QA worker pairing failed");
  await companion.heartbeat({ workerId: paired.id, appVersion: "0.11.0", platform: "windows", architecture: "x86_64", healthState: "healthy", capabilities: { localFolderIngestion: true }, details: {} });
  const source = await core.createSmartSource({
    workspaceId: bootstrap.workspace.workspaceId, name: "Local QA source", provider: "local",
    locations: [{ providerLocationId: paired.id, displayPath: "Approved companion folder" }], recursive: true,
    readinessMode: "immediate", stabilizationWindowSeconds: 0, allowedMimeTypes: ["text/plain"],
    ignorePatterns: [], contextPackIds: [], autonomyMode: "approval_required", enabled: true,
  }, userId);

  server = spawn(process.execPath, [nextCli, "dev"], {
    cwd: "apps/web", env: { ...process.env, ...localEnvironment }, windowsHide: true, stdio: "ignore",
  });
  await waitForServer("http://localhost:3000/api/health");
  const relativePath = "launch.txt";
  const bytes = Buffer.from("Approved local launch copy", "utf8");
  const providerItemId = `local:${createHash("sha256").update(relativePath).digest("hex")}`;
  const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const authorization = { Authorization: `Bearer ${token.secret}` };
  const manifestResponse = await fetch("http://localhost:3000/api/v1/companion/local-sources", {
    method: "POST", headers: { ...authorization, "Content-Type": "application/json" }, body: JSON.stringify({
      smartSourceId: source.id, entries: [{ providerItemId, name: relativePath, relativePath, mimeType: "text/plain", isFolder: false, sizeBytes: bytes.byteLength, modifiedAt: new Date().toISOString(), contentHash }],
    }),
  });
  const manifest = await manifestResponse.json() as { data?: { requiredUploads: string[] }; error?: unknown };
  if (!manifestResponse.ok || !manifest.data?.requiredUploads.includes(providerItemId)) throw new Error(`Manifest failed: ${JSON.stringify(manifest)}`);
  const uploadResponse = await fetch(`http://localhost:3000/api/v1/companion/local-sources/${source.id}/items/${providerItemId}/content`, {
    method: "PUT", headers: { ...authorization, "Content-Type": "text/plain", "Content-Length": String(bytes.byteLength) }, body: bytes,
  });
  const upload = await uploadResponse.json();
  if (!uploadResponse.ok) throw new Error(`Upload failed: ${JSON.stringify(upload)}`);
  await runWorker({ ...process.env, ...localEnvironment, CONNECTOR_WORKER_RUN_ONCE: "true", MEDIA_STORAGE_ROOT: ".market-me/media" });
  const packages = await sql<{ status: string; extractedText?: string; objectKey?: string; scanStatus: string; scanEngine?: string; scanRevision: number; scanScannedAt?: string }[]>`
    SELECT package.status, asset.extracted_text, item.object_key, asset.scan_status, asset.scan_engine,
      asset.scan_revision, asset.scan_scanned_at
    FROM content_package package
    JOIN content_asset asset ON asset.content_package_id = package.id AND asset.role = 'original'
    JOIN source_item item ON item.id = package.root_source_item_id
    WHERE package.smart_source_id = ${source.id}
  `;
  if (packages.length !== 1 || packages[0].extractedText !== "Approved local launch copy" || !packages[0].objectKey) {
    throw new Error(`Unexpected local package result: ${JSON.stringify(packages)}`);
  }
  if (process.env.MALWARE_SCANNER === "clamav" && (packages[0].scanStatus !== "clean" || packages[0].scanEngine !== "clamd" || packages[0].scanRevision < 1 || !packages[0].scanScannedAt)) {
    throw new Error(`ClamAV evidence was not persisted: ${JSON.stringify(packages[0])}`);
  }
  console.log(JSON.stringify({ manifest: manifest.data, upload, package: packages[0] }));
} finally {
  server?.kill();
  if (organizationId) await sql`DELETE FROM organization WHERE id = ${organizationId}`;
  if (userId) await sql`DELETE FROM app_user WHERE id = ${userId}`;
  await sql.end();
}
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
