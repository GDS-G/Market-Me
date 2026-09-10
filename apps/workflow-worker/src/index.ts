import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { CampaignRepository, CompanionRepository, createDatabaseClient, OperationsRepository, PublishingRepository, ServiceHeartbeatLease } from "@market-me/database";
import { CampaignWorkflowDispatcher, createCampaignActivities } from "@market-me/workflows";
import { createObjectStoreFromEnvironment } from "@market-me/media";
import { NativeConnection, Worker } from "@temporalio/worker";
import { CampaignExecutionRouter } from "./execution";
import { MailchimpReportCollector } from "./report-collector";
import { MastodonReportCollector } from "./mastodon-report-collector";
import { MailchimpWebhookHealthMonitor } from "./webhook-health-monitor";
import packageMetadata from "../package.json";

const databaseUrl = process.env.DATABASE_URL;
const temporalAddress = process.env.TEMPORAL_ADDRESS;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!temporalAddress) throw new Error("TEMPORAL_ADDRESS is required");
const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";
const taskQueue = process.env.TEMPORAL_CAMPAIGN_TASK_QUEUE ?? "market-me-campaigns";
const commandBatchSize = Number(process.env.CAMPAIGN_COMMAND_BATCH_SIZE ?? "25");
const pollIntervalMs = Number(process.env.CAMPAIGN_COMMAND_POLL_INTERVAL_MS ?? "2000");
const heartbeatIntervalSeconds = Number(process.env.SERVICE_HEARTBEAT_INTERVAL_SECONDS ?? "30");
const reportCollectionEnabledValue = process.env.MAILCHIMP_REPORT_COLLECTION_ENABLED ?? "false";
const reportCollectionLoopMs = Number(process.env.MAILCHIMP_REPORT_COLLECTION_LOOP_MS ?? "30000");
const reportCollectionBatchSize = Number(process.env.MAILCHIMP_REPORT_COLLECTION_BATCH_SIZE ?? "10");
const reportCollectionRefreshSeconds = Number(process.env.MAILCHIMP_REPORT_COLLECTION_REFRESH_SECONDS ?? "900");
const reportCollectionMaxAgeSeconds = Number(process.env.MAILCHIMP_REPORT_COLLECTION_MAX_AGE_SECONDS ?? "604800");
const mastodonReportCollectionEnabledValue = process.env.MASTODON_STATUS_REPORT_COLLECTION_ENABLED ?? "false";
const mastodonReportCollectionLoopMs = Number(process.env.MASTODON_STATUS_REPORT_COLLECTION_LOOP_MS ?? "30000");
const mastodonReportCollectionBatchSize = Number(process.env.MASTODON_STATUS_REPORT_COLLECTION_BATCH_SIZE ?? "10");
const mastodonReportCollectionRefreshSeconds = Number(process.env.MASTODON_STATUS_REPORT_COLLECTION_REFRESH_SECONDS ?? "900");
const mastodonReportCollectionMaxAgeSeconds = Number(process.env.MASTODON_STATUS_REPORT_COLLECTION_MAX_AGE_SECONDS ?? "604800");
const webhookHealthEnabledValue = process.env.MAILCHIMP_WEBHOOK_HEALTH_MONITOR_ENABLED ?? "false";
const webhookHealthLoopMs = Number(process.env.MAILCHIMP_WEBHOOK_HEALTH_MONITOR_LOOP_MS ?? "30000");
const webhookHealthBatchSize = Number(process.env.MAILCHIMP_WEBHOOK_HEALTH_MONITOR_BATCH_SIZE ?? "10");
const webhookHealthIntervalSeconds = Number(process.env.MAILCHIMP_WEBHOOK_HEALTH_MONITOR_INTERVAL_SECONDS ?? "3600");
if (!Number.isInteger(commandBatchSize) || commandBatchSize < 1 || commandBatchSize > 100) throw new Error("CAMPAIGN_COMMAND_BATCH_SIZE must be an integer from 1 through 100");
if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 250 || pollIntervalMs > 60000) throw new Error("CAMPAIGN_COMMAND_POLL_INTERVAL_MS must be an integer from 250 through 60000");
if (reportCollectionEnabledValue !== "true" && reportCollectionEnabledValue !== "false") throw new Error("MAILCHIMP_REPORT_COLLECTION_ENABLED must be true or false");
const reportCollectionEnabled = reportCollectionEnabledValue === "true";
if (!Number.isInteger(reportCollectionLoopMs) || reportCollectionLoopMs < 5000 || reportCollectionLoopMs > 60000) throw new Error("MAILCHIMP_REPORT_COLLECTION_LOOP_MS must be an integer from 5000 through 60000");
if (!Number.isInteger(reportCollectionBatchSize) || reportCollectionBatchSize < 1 || reportCollectionBatchSize > 50) throw new Error("MAILCHIMP_REPORT_COLLECTION_BATCH_SIZE must be an integer from 1 through 50");
if (!Number.isInteger(reportCollectionRefreshSeconds) || reportCollectionRefreshSeconds < 300 || reportCollectionRefreshSeconds > 86400) throw new Error("MAILCHIMP_REPORT_COLLECTION_REFRESH_SECONDS must be an integer from 300 through 86400");
if (!Number.isInteger(reportCollectionMaxAgeSeconds) || reportCollectionMaxAgeSeconds < 3600 || reportCollectionMaxAgeSeconds > 2592000) throw new Error("MAILCHIMP_REPORT_COLLECTION_MAX_AGE_SECONDS must be an integer from 3600 through 2592000");
if (mastodonReportCollectionEnabledValue !== "true" && mastodonReportCollectionEnabledValue !== "false") throw new Error("MASTODON_STATUS_REPORT_COLLECTION_ENABLED must be true or false");
const mastodonReportCollectionEnabled = mastodonReportCollectionEnabledValue === "true";
if (!Number.isInteger(mastodonReportCollectionLoopMs) || mastodonReportCollectionLoopMs < 5000 || mastodonReportCollectionLoopMs > 60000) throw new Error("MASTODON_STATUS_REPORT_COLLECTION_LOOP_MS must be an integer from 5000 through 60000");
if (!Number.isInteger(mastodonReportCollectionBatchSize) || mastodonReportCollectionBatchSize < 1 || mastodonReportCollectionBatchSize > 50) throw new Error("MASTODON_STATUS_REPORT_COLLECTION_BATCH_SIZE must be an integer from 1 through 50");
if (!Number.isInteger(mastodonReportCollectionRefreshSeconds) || mastodonReportCollectionRefreshSeconds < 300 || mastodonReportCollectionRefreshSeconds > 86400) throw new Error("MASTODON_STATUS_REPORT_COLLECTION_REFRESH_SECONDS must be an integer from 300 through 86400");
if (!Number.isInteger(mastodonReportCollectionMaxAgeSeconds) || mastodonReportCollectionMaxAgeSeconds < 3600 || mastodonReportCollectionMaxAgeSeconds > 2592000) throw new Error("MASTODON_STATUS_REPORT_COLLECTION_MAX_AGE_SECONDS must be an integer from 3600 through 2592000");
if (webhookHealthEnabledValue !== "true" && webhookHealthEnabledValue !== "false") throw new Error("MAILCHIMP_WEBHOOK_HEALTH_MONITOR_ENABLED must be true or false");
const webhookHealthEnabled = webhookHealthEnabledValue === "true";
if (!Number.isInteger(webhookHealthLoopMs) || webhookHealthLoopMs < 5000 || webhookHealthLoopMs > 60000) throw new Error("MAILCHIMP_WEBHOOK_HEALTH_MONITOR_LOOP_MS must be an integer from 5000 through 60000");
if (!Number.isInteger(webhookHealthBatchSize) || webhookHealthBatchSize < 1 || webhookHealthBatchSize > 50) throw new Error("MAILCHIMP_WEBHOOK_HEALTH_MONITOR_BATCH_SIZE must be an integer from 1 through 50");
if (!Number.isInteger(webhookHealthIntervalSeconds) || webhookHealthIntervalSeconds < 300 || webhookHealthIntervalSeconds > 86400) throw new Error("MAILCHIMP_WEBHOOK_HEALTH_MONITOR_INTERVAL_SECONDS must be an integer from 300 through 86400");
if ((reportCollectionEnabled || webhookHealthEnabled || mastodonReportCollectionEnabled) && !process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY) throw new Error("CONNECTOR_TOKEN_ENCRYPTION_KEY is required when provider automation is enabled");

const sql = createDatabaseClient(databaseUrl);
const repository = new CampaignRepository(sql);
const publishingRepository = new PublishingRepository(sql);
const companionRepository = new CompanionRepository(sql);
const mediaStore = createObjectStoreFromEnvironment();
const mastodonAllowedHosts = (process.env.MASTODON_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
if (mastodonReportCollectionEnabled && !mastodonAllowedHosts.length) throw new Error("MASTODON_ALLOWED_HOSTS is required when Mastodon report collection is enabled");
const executionRouter = new CampaignExecutionRouter(publishingRepository, process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY, process.env.APP_BASE_URL, companionRepository, mediaStore, mastodonAllowedHosts);
const reportCollector = reportCollectionEnabled ? new MailchimpReportCollector(
  publishingRepository,
  process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY!,
  { batchSize: reportCollectionBatchSize, refreshSeconds: reportCollectionRefreshSeconds, maxAgeSeconds: reportCollectionMaxAgeSeconds },
) : undefined;
const mastodonReportCollector = mastodonReportCollectionEnabled ? new MastodonReportCollector(
  publishingRepository,
  process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY!,
  mastodonAllowedHosts,
  {
    batchSize: mastodonReportCollectionBatchSize,
    refreshSeconds: mastodonReportCollectionRefreshSeconds,
    maxAgeSeconds: mastodonReportCollectionMaxAgeSeconds,
  },
) : undefined;
const webhookHealthMonitor = webhookHealthEnabled ? new MailchimpWebhookHealthMonitor(
  publishingRepository,
  process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY!,
  { batchSize: webhookHealthBatchSize, checkIntervalSeconds: webhookHealthIntervalSeconds },
) : undefined;
const temporalConnection = await NativeConnection.connect({ address: temporalAddress });
const dispatcher = await CampaignWorkflowDispatcher.connect(repository, { address: temporalAddress, namespace, taskQueue });
const require = createRequire(import.meta.url);
const worker = await Worker.create({
  connection: temporalConnection,
  namespace,
  taskQueue,
  workflowsPath: require.resolve("@market-me/workflows/workflows"),
  activities: createCampaignActivities(repository, executionRouter),
});
const heartbeat = new ServiceHeartbeatLease(new OperationsRepository(sql), {
  service: "workflow_worker",
  instanceId: randomUUID(),
  version: packageMetadata.version,
  intervalSeconds: heartbeatIntervalSeconds,
  onError: (error) => console.error(JSON.stringify({
    event: "service.heartbeat.failed",
    service: "workflow_worker",
    errorCode: error instanceof Error ? error.name : "UnknownError",
  })),
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { stopping = true; worker.shutdown(); });

async function dispatchLoop(): Promise<void> {
  while (!stopping) {
    const result = await dispatcher.processReadyCommands(commandBatchSize);
    if (result.completed || result.failed) console.log(JSON.stringify({ event: "campaign.commands.dispatched", ...result }));
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

async function reportCollectionLoop(): Promise<void> {
  while (!stopping && reportCollector) {
    try {
      const result = await reportCollector.runOnce();
      if (result.claimed) console.log(JSON.stringify({ event: "mailchimp.reports.collected", ...result }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "mailchimp.report-collection.failed",
        errorCode: error instanceof Error ? error.name : "UnknownError",
      }));
    }
    await new Promise((resolve) => setTimeout(resolve, reportCollectionLoopMs));
  }
}

async function mastodonReportCollectionLoop(): Promise<void> {
  while (!stopping && mastodonReportCollector) {
    try {
      const result = await mastodonReportCollector.runOnce();
      if (result.claimed || result.alertsActive || result.alertsResolved || result.alertReconciliationFailed) {
        console.log(JSON.stringify({ event: "mastodon.status-reports.collected", ...result }));
      }
    } catch {
      console.error(JSON.stringify({
        event: "mastodon.status-report-collection.failed",
        errorCode: "collection_unavailable",
      }));
    }
    await new Promise((resolve) => setTimeout(resolve, mastodonReportCollectionLoopMs));
  }
}

async function webhookHealthLoop(): Promise<void> {
  while (!stopping && webhookHealthMonitor) {
    try {
      const result = await webhookHealthMonitor.runOnce();
      if (result.claimed) console.log(JSON.stringify({ event: "mailchimp.webhook-health.checked", ...result }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "mailchimp.webhook-health.failed",
        errorCode: error instanceof Error ? error.name : "UnknownError",
      }));
    }
    await new Promise((resolve) => setTimeout(resolve, webhookHealthLoopMs));
  }
}

try {
  await heartbeat.start();
  await Promise.all([worker.run(), dispatchLoop(), reportCollectionLoop(), mastodonReportCollectionLoop(), webhookHealthLoop()]);
} finally {
  try {
    await heartbeat.stop();
  } finally {
    try {
      await dispatcher.close();
    } finally {
      try {
        await temporalConnection.close();
      } finally {
        await sql.end();
      }
    }
  }
}
