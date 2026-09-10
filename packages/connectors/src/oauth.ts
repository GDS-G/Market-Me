import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type {
  ConnectorConfiguration,
  OAuthAuthorizationRequest,
  OAuthTokenSet,
  ConnectorFetch,
  StorageConnector,
  StorageProvider,
} from "./types";
import {
  listGoogleChangePage,
  listGoogleFolderPage,
  listMicrosoftChangePage,
  listMicrosoftFolderPage,
} from "./storage";
import {
  createGoogleWebhookSubscription,
  createMicrosoftWebhookSubscription,
  deleteGoogleWebhookSubscription,
  deleteMicrosoftWebhookSubscription,
  renewMicrosoftWebhookSubscription,
} from "./webhooks";
import { downloadGoogleContent, downloadMicrosoftContent } from "./content";

const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"] as const;
const MICROSOFT_ONEDRIVE_SCOPES = ["offline_access", "User.Read", "Files.Read"] as const;
const MICROSOFT_SHAREPOINT_SCOPES = ["offline_access", "User.Read", "Sites.Read.All"] as const;

export function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function createOAuthEntropy(): { state: string; codeVerifier: string } {
  return {
    state: base64Url(randomBytes(32)),
    codeVerifier: base64Url(randomBytes(64)),
  };
}

function requireConfigured(config: ConnectorConfiguration): asserts config is ConnectorConfiguration & {
  clientId: string;
  clientSecret: string;
} {
  if (!config.clientId || !config.clientSecret) {
    throw new Error(`${config.provider} OAuth is not configured`);
  }
}

function parseTokenResponse(payload: Record<string, unknown>, requestedScopes: readonly string[]): OAuthTokenSet {
  if (typeof payload.access_token !== "string") {
    throw new Error("OAuth token endpoint did not return an access token");
  }
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : undefined;
  const scope = typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [...requestedScopes];
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
    scopes: scope,
    tokenType: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
    idToken: typeof payload.id_token === "string" ? payload.id_token : undefined,
  };
}

async function exchangeToken(
  endpoint: string,
  body: URLSearchParams,
  requestedScopes: readonly string[],
  request: ConnectorFetch,
): Promise<OAuthTokenSet> {
  const response = await request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof payload.error === "string" ? payload.error : "oauth_exchange_failed";
    throw new Error(`OAuth token exchange failed: ${code}`);
  }
  return parseTokenResponse(payload, requestedScopes);
}

abstract class OAuthStorageConnector implements StorageConnector {
  abstract readonly provider: StorageProvider;
  abstract readonly status: StorageConnector["status"];
  constructor(protected readonly config: ConnectorConfiguration, protected readonly request: ConnectorFetch = fetch) {}
  abstract createAuthorizationRequest(input: { state: string; codeVerifier: string }): OAuthAuthorizationRequest;
  abstract exchangeAuthorizationCode(input: { code: string; codeVerifier: string }): Promise<OAuthTokenSet>;
  abstract refreshAccessToken(refreshToken: string): Promise<OAuthTokenSet>;
  abstract listFolderPage(input: { accessToken: string; providerLocationId: string; pageToken?: string }): Promise<import("./types").FolderPage>;
  abstract listChangePage(input: { accessToken: string; providerLocationId?: string; cursor?: string }): Promise<import("./types").ChangePage>;
  abstract createWebhookSubscription(input: import("./types").CreateWebhookSubscriptionInput): Promise<import("./types").ProviderWebhookSubscription>;
  abstract renewWebhookSubscription(input: { accessToken: string; providerSubscriptionId: string }): Promise<{ expiresAt: Date }>;
  abstract deleteWebhookSubscription(input: { accessToken: string; providerSubscriptionId: string; providerResourceId?: string }): Promise<void>;
  abstract downloadContent(input: { accessToken: string; providerItemId: string; providerLocationId?: string; mimeType: string; maxBytes: number }): Promise<import("./types").DownloadedContent>;
}

export class GoogleDriveConnector extends OAuthStorageConnector {
  readonly provider = "google_drive" as const;
  readonly status = {
    provider: this.provider,
    label: "Google Drive",
    configured: Boolean(this.config.clientId && this.config.clientSecret),
    supportsOAuth: true,
    supportsIncrementalChanges: true,
    supportsWebhooks: true,
    supportsSharedLibraries: true,
    missingVariables: [
      ...(!this.config.clientId ? ["GOOGLE_DRIVE_CLIENT_ID"] : []),
      ...(!this.config.clientSecret ? ["GOOGLE_DRIVE_CLIENT_SECRET"] : []),
    ],
  };

  createAuthorizationRequest(input: { state: string; codeVerifier: string }): OAuthAuthorizationRequest {
    requireConfigured(this.config);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      state: input.state,
      code_challenge: sha256(input.codeVerifier),
      code_challenge_method: "S256",
    }).toString();
    return {
      provider: this.provider,
      authorizationUrl: url.toString(),
      state: input.state,
      codeVerifier: input.codeVerifier,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    };
  }

  async exchangeAuthorizationCode(input: { code: string; codeVerifier: string }): Promise<OAuthTokenSet> {
    requireConfigured(this.config);
    return exchangeToken(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: input.code,
        code_verifier: input.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: this.config.redirectUri,
      }),
      GOOGLE_SCOPES,
      this.request,
    );
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenSet> {
    requireConfigured(this.config);
    return exchangeToken(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      GOOGLE_SCOPES,
      this.request,
    );
  }

  listFolderPage(input: { accessToken: string; providerLocationId: string; pageToken?: string }) {
    return listGoogleFolderPage(this.request, input);
  }

  listChangePage(input: { accessToken: string; cursor?: string }) {
    return listGoogleChangePage(this.request, input);
  }

  createWebhookSubscription(input: import("./types").CreateWebhookSubscriptionInput) {
    return createGoogleWebhookSubscription(this.request, input);
  }

  async renewWebhookSubscription(): Promise<{ expiresAt: Date }> {
    throw new Error("Google Drive channels are renewed by replacement");
  }

  deleteWebhookSubscription(input: { accessToken: string; providerSubscriptionId: string; providerResourceId?: string }) {
    return deleteGoogleWebhookSubscription(this.request, input);
  }

  downloadContent(input: { accessToken: string; providerItemId: string; mimeType: string; maxBytes: number }) {
    return downloadGoogleContent(this.request, input);
  }
}

export class MicrosoftStorageConnector extends OAuthStorageConnector {
  readonly provider: "onedrive" | "sharepoint";
  readonly status: StorageConnector["status"];

  constructor(config: ConnectorConfiguration, request: ConnectorFetch = fetch) {
    super(config, request);
    this.provider = config.provider === "sharepoint" ? "sharepoint" : "onedrive";
    this.status = {
      provider: this.provider,
      label: this.provider === "sharepoint" ? "SharePoint" : "OneDrive",
      configured: Boolean(config.clientId && config.clientSecret),
      supportsOAuth: true,
      supportsIncrementalChanges: true,
      supportsWebhooks: true,
      supportsSharedLibraries: true,
      missingVariables: [
        ...(!config.clientId ? ["MICROSOFT_CLIENT_ID"] : []),
        ...(!config.clientSecret ? ["MICROSOFT_CLIENT_SECRET"] : []),
      ],
    };
  }

  private get tenantId(): string {
    return this.config.tenantId || "common";
  }

  private get scopes(): readonly string[] {
    return this.provider === "sharepoint" ? MICROSOFT_SHAREPOINT_SCOPES : MICROSOFT_ONEDRIVE_SCOPES;
  }

  createAuthorizationRequest(input: { state: string; codeVerifier: string }): OAuthAuthorizationRequest {
    requireConfigured(this.config);
    const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/authorize`);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: this.scopes.join(" "),
      state: input.state,
      code_challenge: sha256(input.codeVerifier),
      code_challenge_method: "S256",
    }).toString();
    return {
      provider: this.provider,
      authorizationUrl: url.toString(),
      state: input.state,
      codeVerifier: input.codeVerifier,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    };
  }

  async exchangeAuthorizationCode(input: { code: string; codeVerifier: string }): Promise<OAuthTokenSet> {
    requireConfigured(this.config);
    return exchangeToken(
      `https://login.microsoftonline.com/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`,
      new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: input.code,
        code_verifier: input.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: this.config.redirectUri,
        scope: this.scopes.join(" "),
      }),
      this.scopes,
      this.request,
    );
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenSet> {
    requireConfigured(this.config);
    return exchangeToken(
      `https://login.microsoftonline.com/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`,
      new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope: this.scopes.join(" "),
      }),
      this.scopes,
      this.request,
    );
  }

  listFolderPage(input: { accessToken: string; providerLocationId: string; pageToken?: string }) {
    return listMicrosoftFolderPage(this.request, this.provider, input);
  }

  listChangePage(input: { accessToken: string; providerLocationId?: string; cursor?: string }) {
    return listMicrosoftChangePage(this.request, this.provider, input);
  }

  createWebhookSubscription(input: import("./types").CreateWebhookSubscriptionInput) {
    return createMicrosoftWebhookSubscription(this.request, input);
  }

  renewWebhookSubscription(input: { accessToken: string; providerSubscriptionId: string }) {
    return renewMicrosoftWebhookSubscription(this.request, input);
  }

  deleteWebhookSubscription(input: { accessToken: string; providerSubscriptionId: string }) {
    return deleteMicrosoftWebhookSubscription(this.request, input);
  }

  downloadContent(input: { accessToken: string; providerItemId: string; providerLocationId?: string; mimeType: string; maxBytes: number }) {
    return downloadMicrosoftContent(this.request, this.provider, input);
  }
}

export function encryptToken(plaintext: string, base64Key: string): string {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("CONNECTOR_TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", base64Url(iv), base64Url(cipher.getAuthTag()), base64Url(ciphertext)].join(".");
}

export function decryptToken(envelope: string, base64Key: string): string {
  const [version, ivValue, tagValue, ciphertextValue] = envelope.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) throw new Error("Unsupported token envelope");
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("CONNECTOR_TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
