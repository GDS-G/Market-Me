import {
  ChannelConnectorError,
  decodeMailchimpCredentialBundle,
  MailchimpEmailConnector,
  decryptToken,
} from "@market-me/connectors";
import type { PublishingRepository } from "@market-me/database";

type ReportRepository = Pick<
  PublishingRepository,
  | "claimMailchimpReportCollections"
  | "recordMailchimpCampaignReportSnapshot"
  | "completeMailchimpReportCollection"
>;

export interface MailchimpReportCollectorOptions {
  batchSize: number;
  refreshSeconds: number;
  maxAgeSeconds: number;
}

export interface MailchimpReportCollectionResult {
  claimed: number;
  succeeded: number;
  failed: number;
}

export class MailchimpReportCollector {
  constructor(
    private readonly repository: ReportRepository,
    private readonly encryptionKey: string,
    private readonly options: MailchimpReportCollectorOptions,
  ) {}

  async runOnce(): Promise<MailchimpReportCollectionResult> {
    const targets = await this.repository.claimMailchimpReportCollections(
      this.options.batchSize,
      this.options.maxAgeSeconds,
    );
    let succeeded = 0;
    let failed = 0;
    for (const target of targets) {
      try {
        const credential = decodeMailchimpCredentialBundle(decryptToken(
          target.encryptedCredentials,
          this.encryptionKey,
        )).apiKey;
        const report = await new MailchimpEmailConnector(
          credential,
        ).getCampaignReport(target.providerCampaignId, target.audienceId);
        await this.repository.recordMailchimpCampaignReportSnapshot(
          target.workspaceId,
          target.publicationActionId,
          report,
          target.actorUserId,
        );
        await this.repository.completeMailchimpReportCollection(
          target.publicationActionId,
          { delaySeconds: this.options.refreshSeconds },
        );
        succeeded += 1;
      } catch (error) {
        const errorCode = collectionErrorCode(error);
        await this.repository.completeMailchimpReportCollection(
          target.publicationActionId,
          {
            delaySeconds: retryDelaySeconds(
              error,
              errorCode,
              target.attemptCount,
              this.options.refreshSeconds,
            ),
            errorCode,
          },
        );
        failed += 1;
      }
    }
    return { claimed: targets.length, succeeded, failed };
  }
}

type CollectionErrorCode =
  | ChannelConnectorError["kind"]
  | "credential_unavailable"
  | "unknown";

function collectionErrorCode(error: unknown): CollectionErrorCode {
  if (error instanceof ChannelConnectorError) return error.kind;
  if (
    error instanceof Error &&
    (error.message === "Unsupported token envelope" ||
      error.message === "Unsupported Mailchimp credential envelope" ||
      error.message.startsWith("CONNECTOR_TOKEN_ENCRYPTION_KEY"))
  )
    return "credential_unavailable";
  return "unknown";
}

function retryDelaySeconds(
  error: unknown,
  errorCode: CollectionErrorCode,
  attemptCount: number,
  refreshSeconds: number,
): number {
  if (
    error instanceof ChannelConnectorError &&
    error.retryAfterMs &&
    Number.isFinite(error.retryAfterMs)
  )
    return clampDelay(Math.ceil(error.retryAfterMs / 1000));
  if (
    errorCode === "authorization" ||
    errorCode === "validation" ||
    errorCode === "permanent" ||
    errorCode === "credential_unavailable"
  )
    return clampDelay(Math.max(refreshSeconds, 3600));
  const exponent = Math.min(Math.max(attemptCount - 1, 0), 6);
  return clampDelay(Math.min(refreshSeconds, 60 * 2 ** exponent));
}

function clampDelay(seconds: number): number {
  return Math.max(60, Math.min(86400, seconds));
}
