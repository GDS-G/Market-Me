import { describe, expect, it, vi } from "vitest";
import type { AiRepository } from "@market-me/database";
import { OperationalAlertService } from "./operational-alert-service";

const target = {
  id: "delivery-1",
  workspaceId: "workspace-1",
  endpointUrl: "https://alerts.example.test/hook",
  encryptedSigningSecret: "encrypted",
  secretFingerprint: "a".repeat(64),
  encryptionKeyVersion: "v1" as const,
  eventType: "incident_opened" as const,
  payload: { version: "1" },
  occurredAt: "2026-08-11T12:00:00.000Z",
  attemptCount: 1,
};

describe("OperationalAlertService", () => {
  it("enqueues, decrypts, delivers, and records the durable claim", async () => {
    const record = vi.fn(async () => undefined);
    const repository = {
      enqueueAiOperationalAlertEvents: vi.fn(async () => 2),
      claimAiOperationalAlertDeliveries: vi.fn(async () => [target]),
      recordAiOperationalAlertDeliveryOutcome: record,
    } as unknown as AiRepository;
    const deliver = vi.fn(async () => ({ status: "delivered" as const, responseStatus: 204 }));
    const service = new OperationalAlertService({
      repository,
      encryptionKey: "key",
      allowedHosts: ["alerts.example.test"],
      decrypt: vi.fn(() => "secret"),
      deliver,
    });
    await expect(service.processReadyEvents()).resolves.toEqual({
      enqueued: 2, delivered: 1, retried: 0, deadLettered: 0,
    });
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ eventId: target.id }), {
      allowedHosts: ["alerts.example.test"],
    });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: target.id,
      attemptCount: 1,
      outcome: { status: "delivered", responseStatus: 204 },
    }), expect.any(Date));
  });

  it("dead-letters a secret that cannot be opened without exposing the exception", async () => {
    const record = vi.fn(async () => undefined);
    const repository = {
      enqueueAiOperationalAlertEvents: vi.fn(async () => 0),
      claimAiOperationalAlertDeliveries: vi.fn(async () => [target]),
      recordAiOperationalAlertDeliveryOutcome: record,
    } as unknown as AiRepository;
    const service = new OperationalAlertService({
      repository, encryptionKey: "key", allowedHosts: ["alerts.example.test"],
      decrypt: vi.fn(() => { throw new Error("sensitive cipher detail"); }),
    });
    await expect(service.processReadyEvents()).resolves.toEqual({
      enqueued: 0, delivered: 0, retried: 0, deadLettered: 1,
    });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: {
        status: "failed", retryable: false,
        safeError: "The stored webhook signing secret could not be opened.",
      },
    }), expect.any(Date));
  });
});
