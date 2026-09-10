import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { StorageConnector, StorageProvider } from "@market-me/connectors";
import type {
  MarketMeRepository,
  WebhookEventRecord,
  WebhookSubscriptionRecord,
} from "@market-me/database";
import type { StorageIngestionService } from "./service";

const DEFAULT_RENEWAL_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 6;

export interface WebhookServiceOptions {
  repository: MarketMeRepository;
  ingestion: StorageIngestionService;
  publicBaseUrl: string;
  renewalWindowMs?: number;
  maxAttempts?: number;
  now?: () => Date;
}

export interface GoogleNotificationInput {
  providerSubscriptionId: string;
  clientState: string;
  messageNumber: string;
  resourceState: string;
  resourceId?: string;
  resourceUri?: string;
  changed?: string;
}

export interface MicrosoftNotificationInput {
  subscriptionId: string;
  clientState: string;
  id?: string;
  changeType?: string;
  lifecycleEvent?: string;
  resource?: string;
  tenantId?: string;
}

function secretHash(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function sameHash(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function callbackUrl(baseUrl: string, provider: StorageProvider): string {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:") throw new Error("PUBLIC_WEBHOOK_BASE_URL must use HTTPS");
  const path = provider === "google_drive"
    ? "/api/webhooks/google-drive"
    : "/api/webhooks/microsoft-graph";
  return new URL(path, base).toString();
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(15 * 60 * 1000, 15_000 * 2 ** Math.max(0, attemptCount - 1));
}

export class WebhookReconciliationService {
  private readonly repository: MarketMeRepository;
  private readonly ingestion: StorageIngestionService;
  private readonly publicBaseUrl: string;
  private readonly renewalWindowMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => Date;

  constructor(options: WebhookServiceOptions) {
    this.repository = options.repository;
    this.ingestion = options.ingestion;
    this.publicBaseUrl = options.publicBaseUrl;
    this.renewalWindowMs = options.renewalWindowMs ?? DEFAULT_RENEWAL_WINDOW_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.now = options.now ?? (() => new Date());
    callbackUrl(this.publicBaseUrl, "google_drive");
  }

  async ensureSubscriptions(): Promise<{ created: number; renewed: number; failed: number }> {
    const targets = await this.repository.listWebhookSubscriptionTargets();
    const result = { created: 0, renewed: 0, failed: 0 };
    for (const target of targets) {
      const existing = await this.repository.getWebhookSubscriptionForTarget(
        target.storageConnectionId,
        target.resource,
      );
      if (existing && new Date(existing.expiresAt).getTime() > this.now().getTime() + this.renewalWindowMs) {
        continue;
      }
      try {
        const credentials = await this.ingestion.getConnectionAccessToken(
          target.workspaceId,
          target.storageConnectionId,
        );
        if (existing && target.provider !== "google_drive") {
          await this.renewMicrosoftSubscription(existing, credentials.connector, credentials.accessToken);
          result.renewed += 1;
        } else {
          await this.createSubscription(target, credentials.connector, credentials.accessToken, existing);
          result.created += 1;
        }
      } catch (error) {
        result.failed += 1;
        if (existing) {
          await this.repository.updateWebhookSubscription({
            id: existing.id,
            status: "error",
            lastError: error instanceof Error ? error.message : "Unknown webhook subscription error",
            incrementRenewalAttempt: true,
          });
        }
      }
    }
    return result;
  }

  async acceptGoogleNotification(input: GoogleNotificationInput): Promise<boolean> {
    const subscription = await this.verifiedSubscription(
      "google_drive",
      input.providerSubscriptionId,
      input.clientState,
    );
    if (!subscription || !/^\d+$/.test(input.messageNumber)) return false;
    return this.repository.enqueueWebhookEvent({
      webhookSubscriptionId: subscription.id,
      providerEventId: `google:${input.messageNumber}`,
      eventKind: input.resourceState || "change",
      payload: {
        resourceId: input.resourceId,
        resourceUri: input.resourceUri,
        changed: input.changed,
      },
    });
  }

  async acceptMicrosoftNotification(input: MicrosoftNotificationInput): Promise<boolean> {
    const subscription = await this.verifiedSubscription(
      input.resource?.startsWith("drives/") ? "sharepoint" : "onedrive",
      input.subscriptionId,
      input.clientState,
    ) ?? await this.verifiedSubscription("sharepoint", input.subscriptionId, input.clientState);
    if (!subscription) return false;
    const payload = {
      changeType: input.changeType,
      lifecycleEvent: input.lifecycleEvent,
      resource: input.resource,
      tenantId: input.tenantId,
    };
    const fallbackId = secretHash(JSON.stringify(payload));
    return this.repository.enqueueWebhookEvent({
      webhookSubscriptionId: subscription.id,
      providerEventId: `microsoft:${input.id ?? fallbackId}`,
      eventKind: input.lifecycleEvent ? `lifecycle:${input.lifecycleEvent}` : input.changeType ?? "updated",
      payload,
    });
  }

  async processReadyEvents(limit = 25): Promise<{ completed: number; retried: number; deadLettered: number }> {
    const events = await this.repository.claimWebhookEvents(Math.max(1, Math.min(limit, 100)));
    const result = { completed: 0, retried: 0, deadLettered: 0 };
    for (const event of events) {
      try {
        await this.reconcileConnection(event);
        await this.repository.completeWebhookEvent(event.id);
        result.completed += 1;
      } catch (error) {
        const deadLetter = event.attemptCount >= this.maxAttempts;
        await this.repository.failWebhookEvent({
          eventId: event.id,
          error: error instanceof Error ? error.message : "Unknown webhook reconciliation error",
          retryAt: new Date(this.now().getTime() + retryDelayMs(event.attemptCount)),
          deadLetter,
        });
        if (deadLetter) result.deadLettered += 1;
        else result.retried += 1;
      }
    }
    return result;
  }

  private async createSubscription(
    target: { workspaceId: string; storageConnectionId: string; provider: StorageProvider; resource: string },
    connector: StorageConnector,
    accessToken: string,
    previous?: WebhookSubscriptionRecord,
  ): Promise<void> {
    const clientState = randomBytes(32).toString("base64url");
    const created = await connector.createWebhookSubscription({
      accessToken,
      callbackUrl: callbackUrl(this.publicBaseUrl, target.provider),
      clientState,
      resource: target.resource,
    });
    await this.repository.saveWebhookSubscription({
      storageConnectionId: target.storageConnectionId,
      providerSubscriptionId: created.providerSubscriptionId,
      providerResourceId: created.providerResourceId,
      resource: created.resource,
      clientStateHash: secretHash(clientState),
      expiresAt: created.expiresAt,
    });
    if (previous) {
      try {
        await connector.deleteWebhookSubscription({
          accessToken,
          providerSubscriptionId: previous.providerSubscriptionId,
          providerResourceId: previous.providerResourceId,
        });
        await this.repository.updateWebhookSubscription({ id: previous.id, status: "revoked" });
      } catch (error) {
        await this.repository.updateWebhookSubscription({
          id: previous.id,
          status: "error",
          lastError: error instanceof Error ? error.message : "Failed to stop replaced channel",
        });
      }
    }
  }

  private async renewMicrosoftSubscription(
    subscription: WebhookSubscriptionRecord,
    connector: StorageConnector,
    accessToken: string,
  ): Promise<void> {
    await this.repository.updateWebhookSubscription({ id: subscription.id, status: "renewing" });
    const renewed = await connector.renewWebhookSubscription({
      accessToken,
      providerSubscriptionId: subscription.providerSubscriptionId,
    });
    await this.repository.updateWebhookSubscription({
      id: subscription.id,
      status: "active",
      expiresAt: renewed.expiresAt,
    });
  }

  private async verifiedSubscription(
    provider: "google_drive" | "onedrive" | "sharepoint",
    providerSubscriptionId: string,
    clientState: string,
  ): Promise<WebhookSubscriptionRecord | undefined> {
    if (!providerSubscriptionId || !clientState) return undefined;
    const subscription = await this.repository.getWebhookSubscriptionByProviderId(provider, providerSubscriptionId);
    if (!subscription || !sameHash(subscription.clientStateHash, secretHash(clientState))) return undefined;
    return subscription;
  }

  private async reconcileConnection(event: WebhookEventRecord): Promise<void> {
    const sources = await this.repository.listEnabledRemoteSmartSourcesByConnection(event.storageConnectionId);
    for (const source of sources) {
      await this.ingestion.syncSmartSource(source.workspaceId, source.id);
    }
  }
}
