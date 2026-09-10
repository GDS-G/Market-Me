import "server-only";

export interface ServerConfiguration {
  databaseUrl?: string;
  appBaseUrl: string;
  developmentLoginEnabled: boolean;
  developmentUserEmail: string;
  developmentUserName: string;
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcProviderName: string;
  oidcBootstrapEmails: readonly string[];
  connectorTokenEncryptionKey?: string;
  mastodonAllowedHosts: readonly string[];
  aiProviderCredentialEncryptionKey?: string;
  aiProviderExecutionEnabled: boolean;
  aiOperationalAlertEncryptionKey?: string;
  aiOperationalAlertAllowedHosts: readonly string[];
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  microsoftTenantId: string;
  publicWebhookBaseUrl?: string;
  mediaAccessSigningKey?: string;
}

function booleanValue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function getServerConfiguration(): ServerConfiguration {
  const oidcBootstrapEmails = (process.env.OIDC_BOOTSTRAP_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return {
    databaseUrl: process.env.DATABASE_URL,
    appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
    developmentLoginEnabled:
      process.env.NODE_ENV !== "production" && booleanValue(process.env.MARKET_ME_DEV_LOGIN_ENABLED),
    developmentUserEmail: process.env.MARKET_ME_DEV_USER_EMAIL ?? "developer@market-me.local",
    developmentUserName: process.env.MARKET_ME_DEV_USER_NAME ?? "Market Me Developer",
    oidcIssuer: process.env.OIDC_ISSUER?.trim() || undefined,
    oidcClientId: process.env.OIDC_CLIENT_ID?.trim() || undefined,
    oidcClientSecret: process.env.OIDC_CLIENT_SECRET?.trim() || undefined,
    oidcProviderName: (process.env.OIDC_PROVIDER_NAME?.trim() || "Organization account").slice(0, 80),
    oidcBootstrapEmails: [...new Set(oidcBootstrapEmails)],
    connectorTokenEncryptionKey: process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY,
    mastodonAllowedHosts: (process.env.MASTODON_ALLOWED_HOSTS ?? "")
      .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean),
    aiProviderCredentialEncryptionKey:
      process.env.AI_PROVIDER_CREDENTIAL_ENCRYPTION_KEY,
    aiProviderExecutionEnabled: booleanValue(process.env.AI_PROVIDER_EXECUTION_ENABLED),
    aiOperationalAlertEncryptionKey: process.env.AI_OPERATIONAL_ALERT_ENCRYPTION_KEY,
    aiOperationalAlertAllowedHosts: (process.env.AI_OPERATIONAL_ALERT_ALLOWED_HOSTS ?? "")
      .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean),
    googleClientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    microsoftClientId: process.env.MICROSOFT_CLIENT_ID,
    microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    microsoftTenantId: process.env.MICROSOFT_TENANT_ID ?? "common",
    publicWebhookBaseUrl: process.env.PUBLIC_WEBHOOK_BASE_URL,
    mediaAccessSigningKey: process.env.MEDIA_ACCESS_SIGNING_KEY,
  };
}
