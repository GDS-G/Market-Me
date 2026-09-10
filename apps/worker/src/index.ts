import { randomUUID } from "node:crypto";
import { createStorageConnector, parseOperationalAlertAllowedHosts } from "@market-me/connectors";
import { AiRepository, createDatabaseClient, MarketMeRepository, OperationsRepository, ServiceHeartbeatLease } from "@market-me/database";
import { ContentPackageService, OperationalAlertService, StorageIngestionService, WebhookReconciliationService } from "@market-me/ingestion";
import { ClamAvInstreamScanner, createObjectStoreFromEnvironment, MediaProcessor } from "@market-me/media";
import packageMetadata from "../package.json";

const databaseUrl = process.env.DATABASE_URL;
const tokenEncryptionKey = process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!tokenEncryptionKey) throw new Error("CONNECTOR_TOKEN_ENCRYPTION_KEY is required");

const intervalSeconds = Number(process.env.CONNECTOR_POLL_INTERVAL_SECONDS ?? "60");
if (!Number.isFinite(intervalSeconds) || intervalSeconds < 15) {
  throw new Error("CONNECTOR_POLL_INTERVAL_SECONDS must be at least 15");
}
const runOnce = process.env.CONNECTOR_WORKER_RUN_ONCE?.toLowerCase() === "true";
const heartbeatIntervalSeconds = Number(process.env.SERVICE_HEARTBEAT_INTERVAL_SECONDS ?? "30");
const sql = createDatabaseClient(databaseUrl);
const repository = new MarketMeRepository(sql);
const aiRepository = new AiRepository(sql);
const connectorEnvironment = {
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  googleClientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID,
  microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  microsoftTenantId: process.env.MICROSOFT_TENANT_ID ?? "common",
};
const ingestion = new StorageIngestionService(repository, {
  tokenEncryptionKey,
  connectorFor: (provider) => createStorageConnector(provider, connectorEnvironment),
});
const publicWebhookBaseUrl = process.env.PUBLIC_WEBHOOK_BASE_URL;
const webhookBatchSize = Number(process.env.WEBHOOK_BATCH_SIZE ?? "25");
if (!Number.isInteger(webhookBatchSize) || webhookBatchSize < 1 || webhookBatchSize > 100) {
  throw new Error("WEBHOOK_BATCH_SIZE must be an integer from 1 through 100");
}
const webhooks = publicWebhookBaseUrl
  ? new WebhookReconciliationService({ repository, ingestion, publicBaseUrl: publicWebhookBaseUrl })
  : undefined;
const contentBatchSize = Number(process.env.CONTENT_INGESTION_BATCH_SIZE ?? "10");
const maxSourceDownloadBytes = Number(process.env.MAX_SOURCE_DOWNLOAD_BYTES ?? String(10 * 1024 * 1024));
const mediaProcessingVersion = process.env.MEDIA_PROCESSING_VERSION ?? "image-v1";
const malwareScannerMode = process.env.MALWARE_SCANNER ?? "unconfigured";
if (!["unconfigured", "clamav"].includes(malwareScannerMode)) throw new Error("MALWARE_SCANNER must be unconfigured or clamav");
const clamAvHost = process.env.CLAMAV_HOST ?? "127.0.0.1";
const clamAvPort = Number(process.env.CLAMAV_PORT ?? "3310");
const clamAvTimeoutMs = Number(process.env.CLAMAV_TIMEOUT_MS ?? "15000");
if (!Number.isInteger(contentBatchSize) || contentBatchSize < 1 || contentBatchSize > 100) {
  throw new Error("CONTENT_INGESTION_BATCH_SIZE must be an integer from 1 through 100");
}
if (!Number.isInteger(maxSourceDownloadBytes) || maxSourceDownloadBytes < 1024 || maxSourceDownloadBytes > 50 * 1024 * 1024) {
  throw new Error("MAX_SOURCE_DOWNLOAD_BYTES must be an integer from 1024 through 52428800");
}
const objectStore = createObjectStoreFromEnvironment();
const malwareScanner = malwareScannerMode === "clamav"
  ? new ClamAvInstreamScanner({ host: clamAvHost, port: clamAvPort, timeoutMs: clamAvTimeoutMs })
  : undefined;
const contentPackages = new ContentPackageService({
  repository,
  ingestion,
  batchSize: contentBatchSize,
  maxDownloadBytes: maxSourceDownloadBytes,
  mediaProcessor: new MediaProcessor({
    objectStore,
    maxSourceBytes: maxSourceDownloadBytes,
    processingVersion: mediaProcessingVersion,
    malwareScanner,
  }),
  objectStore,
});
const operationalAlertEncryptionKey = process.env.AI_OPERATIONAL_ALERT_ENCRYPTION_KEY;
const operationalAlertAllowedHosts = parseOperationalAlertAllowedHosts(
  process.env.AI_OPERATIONAL_ALERT_ALLOWED_HOSTS,
);
if (Boolean(operationalAlertEncryptionKey) !== Boolean(operationalAlertAllowedHosts.length))
  throw new Error("AI operational alerts require both AI_OPERATIONAL_ALERT_ENCRYPTION_KEY and AI_OPERATIONAL_ALERT_ALLOWED_HOSTS");
if (operationalAlertEncryptionKey && Buffer.from(operationalAlertEncryptionKey, "base64").length !== 32)
  throw new Error("AI_OPERATIONAL_ALERT_ENCRYPTION_KEY must decode to exactly 32 bytes");
const operationalAlertBatchSize = Number(process.env.AI_OPERATIONAL_ALERT_BATCH_SIZE ?? "25");
if (!Number.isInteger(operationalAlertBatchSize) || operationalAlertBatchSize < 1 || operationalAlertBatchSize > 100)
  throw new Error("AI_OPERATIONAL_ALERT_BATCH_SIZE must be an integer from 1 through 100");
const operationalAlerts = operationalAlertEncryptionKey
  ? new OperationalAlertService({
      repository: aiRepository,
      encryptionKey: operationalAlertEncryptionKey,
      allowedHosts: operationalAlertAllowedHosts,
    })
  : undefined;
const heartbeat = new ServiceHeartbeatLease(new OperationsRepository(sql), {
  service: "ingestion_worker",
  instanceId: randomUUID(),
  version: packageMetadata.version,
  intervalSeconds: heartbeatIntervalSeconds,
  onError: (error) => console.error(JSON.stringify({
    event: "service.heartbeat.failed",
    service: "ingestion_worker",
    errorCode: error instanceof Error ? error.name : "UnknownError",
  })),
});

async function poll(): Promise<void> {
  if (webhooks) {
    const subscriptions = await webhooks.ensureSubscriptions();
    if (subscriptions.created || subscriptions.renewed || subscriptions.failed) {
      console.log(JSON.stringify({ event: "connector.webhooks.maintained", ...subscriptions }));
    }
    const reconciliation = await webhooks.processReadyEvents(webhookBatchSize);
    if (reconciliation.completed || reconciliation.retried || reconciliation.deadLettered) {
      console.log(JSON.stringify({ event: "connector.webhooks.reconciled", ...reconciliation }));
    }
  }
  const sources = await repository.listEnabledRemoteSmartSources();
  for (const source of sources) {
    try {
      const result = await ingestion.syncSmartSource(source.workspaceId, source.id);
      console.log(JSON.stringify({ event: "connector.sync.completed", smartSourceId: source.id, ...result }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "connector.sync.failed",
        smartSourceId: source.id,
        errorCode: error instanceof Error ? error.name : "UnknownError",
      }));
    }
  }
  const packageResult = await contentPackages.processReadyEvents();
  if (packageResult.processed || packageResult.deferred || packageResult.ignored || packageResult.failed) {
    console.log(JSON.stringify({ event: "content-packages.processed", ...packageResult }));
  }
  if (operationalAlerts) {
    const alertResult = await operationalAlerts.processReadyEvents(operationalAlertBatchSize);
    if (alertResult.enqueued || alertResult.delivered || alertResult.retried || alertResult.deadLettered)
      console.log(JSON.stringify({ event: "ai.operational_alerts.processed", ...alertResult }));
  }
}

try {
  await heartbeat.start();
  do {
    await poll();
    if (!runOnce) await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  } while (!runOnce);
} finally {
  try {
    await heartbeat.stop();
  } finally {
    await sql.end();
  }
}
