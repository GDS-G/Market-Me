import { randomUUID } from "node:crypto";
import type {
  ConnectorFetch,
  CreateWebhookSubscriptionInput,
  ProviderWebhookSubscription,
} from "./types";

type JsonObject = Record<string, unknown>;

const GOOGLE_CHANNEL_LIFETIME_MS = 6 * 24 * 60 * 60 * 1000;
const MICROSOFT_SUBSCRIPTION_LIFETIME_MS = 55 * 60 * 1000;

async function jsonRequest(
  request: ConnectorFetch,
  url: string | URL,
  accessToken: string,
  init: RequestInit = {},
): Promise<JsonObject> {
  const response = await request(url, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as JsonObject : {};
  if (!response.ok) throw new Error(`Webhook provider request failed with HTTP ${response.status}`);
  return payload;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Webhook provider response omitted ${field}`);
  }
  return value;
}

function expirationDate(value: unknown, fallback: Date): Date {
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
    const parsed = new Date(Number(value));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

export async function createGoogleWebhookSubscription(
  request: ConnectorFetch,
  input: CreateWebhookSubscriptionInput,
): Promise<ProviderWebhookSubscription> {
  if (input.resource !== "changes") throw new Error("Google Drive webhook resource must be changes");
  const start = await jsonRequest(
    request,
    "https://www.googleapis.com/drive/v3/changes/startPageToken?supportsAllDrives=true",
    input.accessToken,
  );
  const pageToken = requiredString(start.startPageToken, "startPageToken");
  const providerSubscriptionId = randomUUID();
  const requestedExpiration = new Date(Date.now() + GOOGLE_CHANNEL_LIFETIME_MS);
  const url = new URL("https://www.googleapis.com/drive/v3/changes/watch");
  url.searchParams.set("pageToken", pageToken);
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  const payload = await jsonRequest(request, url, input.accessToken, {
    method: "POST",
    body: JSON.stringify({
      id: providerSubscriptionId,
      type: "web_hook",
      address: input.callbackUrl,
      token: input.clientState,
      expiration: requestedExpiration.getTime(),
    }),
  });
  return {
    providerSubscriptionId: requiredString(payload.id, "id"),
    providerResourceId: requiredString(payload.resourceId, "resourceId"),
    resource: input.resource,
    expiresAt: expirationDate(payload.expiration, requestedExpiration),
  };
}

export async function deleteGoogleWebhookSubscription(
  request: ConnectorFetch,
  input: { accessToken: string; providerSubscriptionId: string; providerResourceId?: string },
): Promise<void> {
  if (!input.providerResourceId) throw new Error("Google Drive channel removal requires providerResourceId");
  await jsonRequest(request, "https://www.googleapis.com/drive/v3/channels/stop", input.accessToken, {
    method: "POST",
    body: JSON.stringify({ id: input.providerSubscriptionId, resourceId: input.providerResourceId }),
  });
}

function assertMicrosoftResource(resource: string): string {
  if (resource === "me/drive/root" || /^drives\/[^/]+\/root$/.test(resource)) return resource;
  throw new Error("Unsupported Microsoft drive webhook resource");
}

export async function createMicrosoftWebhookSubscription(
  request: ConnectorFetch,
  input: CreateWebhookSubscriptionInput,
): Promise<ProviderWebhookSubscription> {
  const resource = assertMicrosoftResource(input.resource);
  const requestedExpiration = new Date(Date.now() + MICROSOFT_SUBSCRIPTION_LIFETIME_MS);
  const payload = await jsonRequest(request, "https://graph.microsoft.com/v1.0/subscriptions", input.accessToken, {
    method: "POST",
    body: JSON.stringify({
      changeType: "updated",
      notificationUrl: input.callbackUrl,
      lifecycleNotificationUrl: input.callbackUrl,
      resource,
      expirationDateTime: requestedExpiration.toISOString(),
      clientState: input.clientState,
      latestSupportedTlsVersion: "v1_2",
    }),
  });
  return {
    providerSubscriptionId: requiredString(payload.id, "id"),
    resource,
    expiresAt: expirationDate(payload.expirationDateTime, requestedExpiration),
  };
}

export async function renewMicrosoftWebhookSubscription(
  request: ConnectorFetch,
  input: { accessToken: string; providerSubscriptionId: string },
): Promise<{ expiresAt: Date }> {
  const requestedExpiration = new Date(Date.now() + MICROSOFT_SUBSCRIPTION_LIFETIME_MS);
  const id = encodeURIComponent(input.providerSubscriptionId);
  const payload = await jsonRequest(
    request,
    `https://graph.microsoft.com/v1.0/subscriptions/${id}`,
    input.accessToken,
    { method: "PATCH", body: JSON.stringify({ expirationDateTime: requestedExpiration.toISOString() }) },
  );
  return { expiresAt: expirationDate(payload.expirationDateTime, requestedExpiration) };
}

export async function deleteMicrosoftWebhookSubscription(
  request: ConnectorFetch,
  input: { accessToken: string; providerSubscriptionId: string },
): Promise<void> {
  const id = encodeURIComponent(input.providerSubscriptionId);
  await jsonRequest(request, `https://graph.microsoft.com/v1.0/subscriptions/${id}`, input.accessToken, {
    method: "DELETE",
  });
}
