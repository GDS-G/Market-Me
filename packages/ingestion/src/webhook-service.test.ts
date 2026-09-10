import { createHash } from "node:crypto";
import type { StorageConnector } from "@market-me/connectors";
import type { MarketMeRepository, WebhookSubscriptionRecord } from "@market-me/database";
import { describe, expect, it, vi } from "vitest";
import type { StorageIngestionService } from "./service";
import { WebhookReconciliationService } from "./webhook-service";

const secretHash = (value: string) => createHash("sha256").update(value).digest("base64url");

const subscription: WebhookSubscriptionRecord = {
  id: "webhook-1",
  workspaceId: "workspace-1",
  storageConnectionId: "connection-1",
  provider: "google_drive",
  providerSubscriptionId: "channel-1",
  providerResourceId: "resource-1",
  resource: "changes",
  clientStateHash: secretHash("client-state"),
  expiresAt: "2026-08-06T00:00:00Z",
  status: "active",
  renewalAttemptCount: 0,
};

describe("WebhookReconciliationService", () => {
  it("creates a missing provider subscription and stores only a client-state hash", async () => {
    const saveWebhookSubscription = vi.fn(async (_input: {
      clientStateHash: string;
      [key: string]: unknown;
    }) => "webhook-1");
    const repository = {
      listWebhookSubscriptionTargets: vi.fn(async () => [{
        workspaceId: "workspace-1",
        storageConnectionId: "connection-1",
        provider: "google_drive",
        resource: "changes",
      }]),
      getWebhookSubscriptionForTarget: vi.fn(async () => undefined),
      saveWebhookSubscription,
    } as unknown as MarketMeRepository;
    const connector = {
      createWebhookSubscription: vi.fn(async (input: { callbackUrl: string }) => {
        expect(input.callbackUrl).toBe("https://market.example/api/webhooks/google-drive");
        return {
          providerSubscriptionId: "channel-1",
          providerResourceId: "resource-1",
          resource: "changes",
          expiresAt: new Date("2026-08-10T00:00:00Z"),
        };
      }),
    } as unknown as StorageConnector;
    const ingestion = {
      getConnectionAccessToken: vi.fn(async () => ({ connector, accessToken: "access", connection: {} })),
    } as unknown as StorageIngestionService;
    const service = new WebhookReconciliationService({ repository, ingestion, publicBaseUrl: "https://market.example" });
    expect(await service.ensureSubscriptions()).toEqual({ created: 1, renewed: 0, failed: 0 });
    const saved = saveWebhookSubscription.mock.calls[0][0];
    expect(saved.clientStateHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(saved).not.toHaveProperty("clientState");
  });

  it("verifies and deduplicates Google channel notifications before enqueueing", async () => {
    const enqueueWebhookEvent = vi.fn(async () => true);
    const repository = {
      getWebhookSubscriptionByProviderId: vi.fn(async () => subscription),
      enqueueWebhookEvent,
    } as unknown as MarketMeRepository;
    const service = new WebhookReconciliationService({
      repository,
      ingestion: {} as StorageIngestionService,
      publicBaseUrl: "https://market.example",
    });
    expect(await service.acceptGoogleNotification({
      providerSubscriptionId: "channel-1",
      clientState: "wrong",
      messageNumber: "2",
      resourceState: "change",
    })).toBe(false);
    expect(await service.acceptGoogleNotification({
      providerSubscriptionId: "channel-1",
      clientState: "client-state",
      messageNumber: "2",
      resourceState: "change",
    })).toBe(true);
    expect(enqueueWebhookEvent).toHaveBeenCalledTimes(1);
    expect(enqueueWebhookEvent).toHaveBeenCalledWith(expect.objectContaining({ providerEventId: "google:2" }));
  });

  it("reconciles through provider cursors and retries failures with a bound", async () => {
    const completeWebhookEvent = vi.fn(async () => undefined);
    const failWebhookEvent = vi.fn(async () => undefined);
    const repository = {
      claimWebhookEvents: vi.fn(async () => [
        { id: "event-1", storageConnectionId: "connection-1", attemptCount: 1 },
        { id: "event-2", storageConnectionId: "connection-2", attemptCount: 6 },
      ]),
      listEnabledRemoteSmartSourcesByConnection: vi.fn(async (connectionId: string) => [{
        id: `source-${connectionId}`,
        workspaceId: "workspace-1",
      }]),
      completeWebhookEvent,
      failWebhookEvent,
    } as unknown as MarketMeRepository;
    const ingestion = {
      syncSmartSource: vi.fn(async (_workspaceId: string, sourceId: string) => {
        if (sourceId.endsWith("connection-2")) throw new Error("temporary provider failure");
        return {};
      }),
    } as unknown as StorageIngestionService;
    const service = new WebhookReconciliationService({ repository, ingestion, publicBaseUrl: "https://market.example" });
    expect(await service.processReadyEvents()).toEqual({ completed: 1, retried: 0, deadLettered: 1 });
    expect(completeWebhookEvent).toHaveBeenCalledWith("event-1");
    expect(failWebhookEvent).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event-2", deadLetter: true }));
  });
});
