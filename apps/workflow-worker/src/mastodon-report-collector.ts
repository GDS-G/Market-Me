import {
  ChannelConnectorError,
  decryptToken,
  MastodonAccountConnector,
} from "@market-me/connectors";
import { MastodonReportCollectionClaimLostError, type PublishingRepository } from "@market-me/database";

type ReportRepository = Pick<
  PublishingRepository,
  | "claimMastodonStatusReportCollections"
  | "recordMastodonStatusReportSnapshot"
  | "completeMastodonStatusReportCollection"
  | "reconcileMastodonStatusReportCollectionAlerts"
>;

export interface MastodonReportCollectorOptions {
  batchSize: number;
  refreshSeconds: number;
  maxAgeSeconds: number;
}

export interface MastodonReportCollectionResult {
  claimed: number;
  succeeded: number;
  failed: number;
  superseded: number;
  alertsActive: number;
  alertsResolved: number;
  alertReconciliationFailed: boolean;
}

export class MastodonReportCollector {
  constructor(
    private readonly repository: ReportRepository,
    private readonly encryptionKey: string,
    private readonly allowedHosts: readonly string[],
    private readonly options: MastodonReportCollectorOptions,
  ) {}

  async runOnce(): Promise<MastodonReportCollectionResult> {
    let alerts = { active: 0, resolved: 0 };
    let alertReconciliationFailed = false;
    try {
      alerts = await this.repository.reconcileMastodonStatusReportCollectionAlerts(this.options.maxAgeSeconds);
    } catch {
      // An unavailable monitor must not prevent the collector from draining its backlog.
      alertReconciliationFailed = true;
    }
    const targets = await this.repository.claimMastodonStatusReportCollections(
      this.options.batchSize,
      this.options.maxAgeSeconds,
    );
    let succeeded = 0;
    let failed = 0;
    let superseded = 0;
    for (const target of targets) {
      let completion: { delaySeconds: number; errorCode?: CollectionErrorCode };
      try {
        const token = decryptToken(target.encryptedCredentials, this.encryptionKey);
        const report = await new MastodonAccountConnector(
          target.instanceOrigin,
          token,
          this.allowedHosts,
        ).getStatusReport(target.providerStatusId, target.providerAccountId);
        if (report.statusUrl !== target.providerStatusUrl) {
          throw new ChannelConnectorError("Mastodon status report URL changed after publication", "permanent");
        }
        await this.repository.recordMastodonStatusReportSnapshot(
          target.workspaceId,
          target.publicationActionId,
          report,
          target.actorUserId,
          target.attemptCount,
        );
        completion = { delaySeconds: this.options.refreshSeconds };
      } catch (error) {
        if (error instanceof MastodonReportCollectionClaimLostError) {
          superseded += 1;
          continue;
        }
        const errorCode = collectionErrorCode(error);
        completion = {
          delaySeconds: retryDelaySeconds(
            error,
            errorCode,
            target.attemptCount,
            this.options.refreshSeconds,
          ),
          errorCode,
        };
      }
      // Fence both success and failure; an old worker cannot complete a recovered claim.
      const completed = await this.repository.completeMastodonStatusReportCollection(
        target.publicationActionId, completion, target.attemptCount,
      );
      if (!completed) superseded += 1;
      else if (completion.errorCode) failed += 1;
      else succeeded += 1;
    }
    return {
      claimed: targets.length, succeeded, failed, superseded,
      alertsActive: alerts.active, alertsResolved: alerts.resolved, alertReconciliationFailed,
    };
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
      error.message.startsWith("CONNECTOR_TOKEN_ENCRYPTION_KEY"))
  ) return "credential_unavailable";
  return "unknown";
}

function retryDelaySeconds(
  error: unknown,
  errorCode: CollectionErrorCode,
  attemptCount: number,
  refreshSeconds: number,
): number {
  if (error instanceof ChannelConnectorError && error.retryAfterMs && Number.isFinite(error.retryAfterMs)) {
    return clampDelay(Math.ceil(error.retryAfterMs / 1000));
  }
  if (
    errorCode === "authorization" ||
    errorCode === "validation" ||
    errorCode === "permanent" ||
    errorCode === "credential_unavailable"
  ) return clampDelay(Math.max(refreshSeconds, 3600));
  const exponent = Math.min(Math.max(attemptCount - 1, 0), 6);
  return clampDelay(Math.min(refreshSeconds, 60 * 2 ** exponent));
}

function clampDelay(seconds: number): number {
  return Math.max(60, Math.min(86400, seconds));
}
