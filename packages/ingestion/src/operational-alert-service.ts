import {
  decryptToken,
  deliverOperationalAlertWebhook,
  type OperationalAlertWebhookResult,
} from "@market-me/connectors";
import type { AiRepository } from "@market-me/database";

export class OperationalAlertService {
  constructor(private readonly dependencies: {
    repository: Pick<AiRepository,
      "enqueueAiOperationalAlertEvents" |
      "claimAiOperationalAlertDeliveries" |
      "recordAiOperationalAlertDeliveryOutcome">;
    encryptionKey: string;
    allowedHosts: readonly string[];
    decrypt?: typeof decryptToken;
    deliver?: typeof deliverOperationalAlertWebhook;
  }) {}

  async processReadyEvents(
    limit = 25,
    asOf: Date = new Date(),
  ): Promise<{ enqueued: number; delivered: number; retried: number; deadLettered: number }> {
    const enqueued = await this.dependencies.repository.enqueueAiOperationalAlertEvents(asOf);
    const targets = await this.dependencies.repository.claimAiOperationalAlertDeliveries(limit, asOf);
    let delivered = 0;
    let retried = 0;
    let deadLettered = 0;
    for (const target of targets) {
      let outcome: OperationalAlertWebhookResult;
      let signingSecret: string;
      try {
        signingSecret = (this.dependencies.decrypt ?? decryptToken)(
          target.encryptedSigningSecret, this.dependencies.encryptionKey,
        );
      } catch {
        outcome = {
          status: "failed",
          retryable: false,
          safeError: "The stored webhook signing secret could not be opened.",
        };
        await this.dependencies.repository.recordAiOperationalAlertDeliveryOutcome({
          deliveryId: target.id, workspaceId: target.workspaceId,
          attemptCount: target.attemptCount, outcome,
        }, asOf);
        deadLettered += 1;
        continue;
      }
      try {
        outcome = await (this.dependencies.deliver ?? deliverOperationalAlertWebhook)({
          endpointUrl: target.endpointUrl,
          signingSecret,
          eventId: target.id,
          occurredAt: target.occurredAt,
          payload: target.payload,
        }, { allowedHosts: this.dependencies.allowedHosts });
      } catch {
        outcome = {
          status: "failed",
          retryable: false,
          safeError: "The configured webhook endpoint is no longer permitted by this deployment.",
        };
      }
      signingSecret = "";
      await this.dependencies.repository.recordAiOperationalAlertDeliveryOutcome({
        deliveryId: target.id,
        workspaceId: target.workspaceId,
        attemptCount: target.attemptCount,
        outcome,
      }, asOf);
      if (outcome.status === "delivered") delivered += 1;
      else if (outcome.retryable && target.attemptCount < 5) retried += 1;
      else deadLettered += 1;
    }
    return { enqueued, delivered, retried, deadLettered };
  }
}
