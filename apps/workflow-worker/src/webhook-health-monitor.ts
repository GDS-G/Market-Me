import {
  ChannelConnectorError,
  decodeMailchimpCredentialBundle,
  decryptToken,
  isExactMailchimpCampaignWebhook,
  MailchimpEmailConnector,
} from "@market-me/connectors";
import type { PublishingRepository } from "@market-me/database";

type HealthRepository = Pick<PublishingRepository, "claimMailchimpWebhookHealthChecks" | "completeMailchimpWebhookHealthCheck">;

export interface MailchimpWebhookHealthMonitorOptions {
  batchSize: number;
  checkIntervalSeconds: number;
}

export interface MailchimpWebhookHealthMonitorResult {
  claimed: number;
  active: number;
  unhealthy: number;
  failed: number;
}

type HealthCode = "managed_active" | "managed_missing" | "managed_drifted" | "managed_secret_missing";
type ErrorCode = ChannelConnectorError["kind"] | "credential_unavailable" | "unknown";

export class MailchimpWebhookHealthMonitor {
  constructor(
    private readonly repository: HealthRepository,
    private readonly encryptionKey: string,
    private readonly options: MailchimpWebhookHealthMonitorOptions,
  ) {}

  async runOnce(): Promise<MailchimpWebhookHealthMonitorResult> {
    const targets = await this.repository.claimMailchimpWebhookHealthChecks(this.options.batchSize);
    let active = 0; let unhealthy = 0; let failed = 0;
    for (const target of targets) {
      try {
        const credentials = decodeMailchimpCredentialBundle(decryptToken(target.encryptedCredentials, this.encryptionKey));
        let healthCode: HealthCode;
        if (!credentials.webhookSigningSecret) {
          healthCode = "managed_secret_missing";
        } else {
          const inventory = await new MailchimpEmailConnector(credentials.apiKey).listAudienceWebhooks(target.audienceId);
          const providerWebhook = inventory.find((webhook) => webhook.webhookId === target.providerWebhookId);
          healthCode = !providerWebhook ? "managed_missing"
            : providerWebhook.callbackUrl !== target.expectedCallbackUrl || !isExactMailchimpCampaignWebhook(providerWebhook)
              ? "managed_drifted" : "managed_active";
        }
        await this.repository.completeMailchimpWebhookHealthCheck(target.connectionId, {
          delaySeconds: this.options.checkIntervalSeconds, healthCode,
        });
        if (healthCode === "managed_active") active += 1; else unhealthy += 1;
      } catch (error) {
        const errorCode = healthErrorCode(error);
        await this.repository.completeMailchimpWebhookHealthCheck(target.connectionId, {
          delaySeconds: healthRetryDelaySeconds(error, errorCode, target.attemptCount, this.options.checkIntervalSeconds),
          errorCode,
        });
        failed += 1;
      }
    }
    return { claimed: targets.length, active, unhealthy, failed };
  }
}

function healthErrorCode(error: unknown): ErrorCode {
  if (error instanceof ChannelConnectorError) return error.kind;
  if (error instanceof Error && (
    error.message === "Unsupported token envelope"
    || error.message === "Unsupported Mailchimp credential envelope"
    || error.message.startsWith("CONNECTOR_TOKEN_ENCRYPTION_KEY")
  )) return "credential_unavailable";
  return "unknown";
}

function healthRetryDelaySeconds(error: unknown, errorCode: ErrorCode, attemptCount: number, intervalSeconds: number): number {
  if (error instanceof ChannelConnectorError && error.retryAfterMs && Number.isFinite(error.retryAfterMs)) {
    return clampDelay(Math.ceil(error.retryAfterMs / 1000));
  }
  if (["authorization", "validation", "permanent", "credential_unavailable"].includes(errorCode)) {
    return clampDelay(Math.max(intervalSeconds, 3600));
  }
  const exponent = Math.min(Math.max(attemptCount - 1, 0), 6);
  return clampDelay(Math.min(intervalSeconds, 60 * 2 ** exponent));
}

function clampDelay(seconds: number): number {
  return Math.max(60, Math.min(86400, seconds));
}
