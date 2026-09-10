import "server-only";
import { StorageIngestionService, WebhookReconciliationService } from "@market-me/ingestion";
import { getServerConfiguration } from "./config";
import { getStorageConnector } from "./connectors";
import { getRepository } from "./database";

export class IngestionConfigurationError extends Error {
  constructor() {
    super("Configure CONNECTOR_TOKEN_ENCRYPTION_KEY before browsing or synchronizing storage.");
    this.name = "IngestionConfigurationError";
  }
}

export class WebhookConfigurationError extends Error {
  constructor() {
    super("Configure an HTTPS PUBLIC_WEBHOOK_BASE_URL before accepting provider notifications.");
    this.name = "WebhookConfigurationError";
  }
}

export function getIngestionService(): StorageIngestionService {
  const key = getServerConfiguration().connectorTokenEncryptionKey;
  if (!key) throw new IngestionConfigurationError();
  return new StorageIngestionService(getRepository(), {
    tokenEncryptionKey: key,
    connectorFor: getStorageConnector,
  });
}

export function getWebhookService(): WebhookReconciliationService {
  const configuration = getServerConfiguration();
  if (!configuration.publicWebhookBaseUrl) throw new WebhookConfigurationError();
  return new WebhookReconciliationService({
    repository: getRepository(),
    ingestion: getIngestionService(),
    publicBaseUrl: configuration.publicWebhookBaseUrl,
  });
}
