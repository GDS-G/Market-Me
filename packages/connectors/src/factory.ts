import { GoogleDriveConnector, MicrosoftStorageConnector } from "./oauth";
import type { ConnectorConfiguration, StorageConnector, StorageProvider } from "./types";

export interface ConnectorEnvironment {
  appBaseUrl: string;
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  microsoftTenantId?: string;
}

export function createStorageConnector(
  provider: StorageProvider,
  environment: ConnectorEnvironment,
): StorageConnector {
  const redirectUri = `${environment.appBaseUrl}/api/v1/connectors/${provider}/oauth/callback`;
  const config: ConnectorConfiguration = provider === "google_drive"
    ? {
        provider,
        clientId: environment.googleClientId,
        clientSecret: environment.googleClientSecret,
        redirectUri,
      }
    : {
        provider,
        clientId: environment.microsoftClientId,
        clientSecret: environment.microsoftClientSecret,
        tenantId: environment.microsoftTenantId,
        redirectUri,
      };

  return provider === "google_drive"
    ? new GoogleDriveConnector(config)
    : new MicrosoftStorageConnector(config);
}

export function listConnectorStatuses(environment: ConnectorEnvironment) {
  return (["google_drive", "onedrive", "sharepoint"] as const).map(
    (provider) => createStorageConnector(provider, environment).status,
  );
}
