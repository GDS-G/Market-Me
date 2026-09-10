export const STORAGE_PROVIDERS = ["google_drive", "onedrive", "sharepoint"] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

export interface ConnectorConfiguration {
  provider: StorageProvider;
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  redirectUri: string;
}

export interface ConnectorStatus {
  provider: StorageProvider;
  label: string;
  configured: boolean;
  supportsOAuth: boolean;
  supportsIncrementalChanges: boolean;
  supportsWebhooks: boolean;
  supportsSharedLibraries: boolean;
  missingVariables: readonly string[];
}

export interface NormalizedStorageEntry {
  provider: StorageProvider;
  providerItemId: string;
  providerParentId?: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  modifiedAt?: string;
  contentHash?: string;
  providerEtag?: string;
  webUrl?: string;
  isFolder: boolean;
}

export interface ChangePage {
  entries: readonly NormalizedStorageEntry[];
  deletedProviderItemIds: readonly string[];
  nextPageToken?: string;
  newCursor?: string;
}

export interface FolderPage {
  entries: readonly NormalizedStorageEntry[];
  nextPageToken?: string;
  incompleteSearch?: boolean;
}

export interface ProviderWebhookSubscription {
  providerSubscriptionId: string;
  providerResourceId?: string;
  resource: string;
  expiresAt: Date;
}

export interface CreateWebhookSubscriptionInput {
  accessToken: string;
  callbackUrl: string;
  clientState: string;
  resource: string;
}

export interface DownloadedContent {
  bytes: Uint8Array;
  mimeType: string;
}

export type ConnectorFetch = typeof fetch;

export interface OAuthAuthorizationRequest {
  provider: StorageProvider;
  authorizationUrl: string;
  state: string;
  codeVerifier: string;
  expiresAt: Date;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: readonly string[];
  tokenType: string;
  idToken?: string;
}

export interface StorageConnector {
  readonly provider: StorageProvider;
  readonly status: ConnectorStatus;
  createAuthorizationRequest(input: { state: string; codeVerifier: string }): OAuthAuthorizationRequest;
  exchangeAuthorizationCode(input: { code: string; codeVerifier: string }): Promise<OAuthTokenSet>;
  refreshAccessToken(refreshToken: string): Promise<OAuthTokenSet>;
  listFolderPage(input: { accessToken: string; providerLocationId: string; pageToken?: string }): Promise<FolderPage>;
  listChangePage(input: { accessToken: string; providerLocationId?: string; cursor?: string }): Promise<ChangePage>;
  createWebhookSubscription(input: CreateWebhookSubscriptionInput): Promise<ProviderWebhookSubscription>;
  renewWebhookSubscription(input: {
    accessToken: string;
    providerSubscriptionId: string;
  }): Promise<{ expiresAt: Date }>;
  deleteWebhookSubscription(input: {
    accessToken: string;
    providerSubscriptionId: string;
    providerResourceId?: string;
  }): Promise<void>;
  downloadContent(input: {
    accessToken: string;
    providerItemId: string;
    providerLocationId?: string;
    mimeType: string;
    maxBytes: number;
  }): Promise<DownloadedContent>;
}
