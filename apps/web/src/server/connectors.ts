import "server-only";
import { createStorageConnector, listConnectorStatuses, type StorageProvider } from "@market-me/connectors";
import { getServerConfiguration } from "./config";

function environment() {
  const config = getServerConfiguration();
  return {
    appBaseUrl: config.appBaseUrl,
    googleClientId: config.googleClientId,
    googleClientSecret: config.googleClientSecret,
    microsoftClientId: config.microsoftClientId,
    microsoftClientSecret: config.microsoftClientSecret,
    microsoftTenantId: config.microsoftTenantId,
  };
}

export function getStorageConnector(provider: StorageProvider) {
  return createStorageConnector(provider, environment());
}

export function getConnectorStatuses() {
  return listConnectorStatuses(environment());
}
