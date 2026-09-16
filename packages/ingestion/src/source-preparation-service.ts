import {
  CampaignPreparationError,
  CampaignPreparationTemplateValidationError,
  CampaignValidationError,
  DraftValidationError,
  SOURCE_PREPARATION_COMMAND_LIMIT,
  type CampaignPreparationRepository,
  type SourcePreparationRepository,
  type StoredCampaignPreparation,
} from "@market-me/database";

type CommandStore = Pick<SourcePreparationRepository,
  "claimSourcePreparationCommands" | "completeSourcePreparationCommand" | "failSourcePreparationCommand">;
type PreparationStore = {
  prepare: (...parameters: Parameters<CampaignPreparationRepository["prepare"]>) => Promise<{
    preparation: Pick<StoredCampaignPreparation, "id" | "campaignId">;
    replayed: boolean;
  }>;
};

export interface SourcePreparationBatchResult {
  readonly claimed: number;
  readonly completed: number;
  readonly retried: number;
  readonly deadLettered: number;
  /** A stale attempt must never complete or overwrite the recovered attempt. */
  readonly lost: number;
  /** Storage was unavailable while settling; the lease is left to expire safely. */
  readonly settlementFailed: number;
}

export class SourcePreparationServiceError extends Error {
  readonly code = "source_preparation_store_unavailable";

  constructor() {
    super("The source preparation command store is temporarily unavailable.");
    this.name = "SourcePreparationServiceError";
  }
}

export class SourcePreparationServiceConfigurationError extends Error {
  readonly code = "source_preparation_configuration_invalid";

  constructor(message: string) {
    super(message);
    this.name = "SourcePreparationServiceConfigurationError";
  }
}

interface SafeFailure {
  readonly errorCode: string;
  readonly retryable: boolean;
  readonly safeError: string;
}

const TRANSIENT_DATABASE_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "55P03", // lock_not_available
  "53300", // too_many_connections
  "57014", // query_canceled / bounded statement timeout
  "57P03", // cannot_connect_now
]);

function databaseCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code) ? code : undefined;
}

/**
 * Store only bounded operational categories. Raw driver/provider messages can
 * contain SQL, identifiers or connection details and must not enter the durable
 * command row or logs emitted by the worker.
 */
export function classifySourcePreparationFailure(error: unknown): SafeFailure {
  if (error instanceof CampaignPreparationError) {
    return {
      errorCode: error.code,
      retryable: false,
      safeError: "The approved package or a configured preparation reference is no longer eligible.",
    };
  }
  if (
    error instanceof CampaignPreparationTemplateValidationError
    || error instanceof CampaignValidationError
    || error instanceof DraftValidationError
  ) {
    return {
      errorCode: "preparation_configuration_invalid",
      retryable: false,
      safeError: "The configured draft preparation no longer satisfies the supported template or campaign policy.",
    };
  }
  const code = databaseCode(error);
  if (code && (code.startsWith("08") || TRANSIENT_DATABASE_CODES.has(code))) {
    return {
      errorCode: `database_${code.toLowerCase()}`,
      retryable: true,
      safeError: "A temporary database condition interrupted draft preparation.",
    };
  }
  if (code && (code.startsWith("22") || code.startsWith("23"))) {
    return {
      errorCode: `database_${code.toLowerCase()}`,
      retryable: false,
      safeError: "The database rejected this preparation command.",
    };
  }
  return {
    errorCode: "preparation_unexpected",
    retryable: true,
    safeError: "An unexpected internal condition interrupted draft preparation.",
  };
}

/**
 * Consumes only the immutable command snapshot captured by the approval
 * transaction. Binding edits or disablement after enqueue affect future
 * approvals, never this durable command. CampaignPreparationRepository remains
 * the authority for current writer access and every package/profile reference.
 */
export class SourcePreparationService {
  constructor(private readonly dependencies: {
    commands: CommandStore;
    preparations: PreparationStore;
  }) {}

  async processReadyCommands(limit = 10, leaseSeconds = 300): Promise<SourcePreparationBatchResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > SOURCE_PREPARATION_COMMAND_LIMIT) {
      throw new SourcePreparationServiceConfigurationError(
        `Source preparation batch size must be from 1 through ${SOURCE_PREPARATION_COMMAND_LIMIT}.`,
      );
    }
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3600) {
      throw new SourcePreparationServiceConfigurationError("Source preparation lease must be from 30 through 3600 seconds.");
    }
    let completed = 0;
    let retried = 0;
    let deadLettered = 0;
    let lost = 0;
    let settlementFailed = 0;
    let claimed = 0;
    let handled = 0;

    while (handled < limit) {
      // Claim immediately before work so later items do not spend earlier
      // preparation time under their own leases.
      const batch = await this.dependencies.commands.claimSourcePreparationCommands(1, leaseSeconds).catch(() => {
        // Do not allow a driver error (which may contain connection/SQL details)
        // to escape to a process-level unhandled-rejection renderer.
        throw new SourcePreparationServiceError();
      });
      completed += batch.recovered;
      deadLettered += batch.deadLettered;
      handled += batch.recovered + batch.deadLettered;
      const command = batch.commands[0];
      if (!command) {
        // Recovery-only batches consume the same public work limit while still
        // allowing another bounded cleanup pass during this poll.
        if (batch.recovered || batch.deadLettered) continue;
        break;
      }
      handled += 1;
      claimed += 1;
      const settleFailure = async (error: unknown) => {
        const failure = classifySourcePreparationFailure(error);
        try {
          const recorded = await this.dependencies.commands.failSourcePreparationCommand({
            commandId: command.id,
            attempt: command.attempt,
            ...failure,
          });
          if (recorded === undefined) lost += 1;
          else if (recorded === "completed") completed += 1;
          else if (recorded === "failed") retried += 1;
          else deadLettered += 1;
        } catch {
          // The attempt remains processing and can be recovered after its lease.
          settlementFailed += 1;
        }
      };

      let result;
      try {
        result = await this.dependencies.preparations.prepare(
          {
            ...command.configurationSnapshot,
            // Dedicated relational columns are the command authority. The JSON
            // snapshot carries authored choices but cannot redirect the worker.
            workspaceId: command.workspaceId,
            contentPackageId: command.contentPackageId,
            expectedPackageVersion: command.contentPackageVersion,
          },
          command.id,
          command.writerUserId,
          {
            expectedReviewFingerprint: command.expectedReviewFingerprint,
            expectedApprovalId: command.expectedApprovalId,
          },
        );
      } catch (error) {
        await settleFailure(error);
        continue;
      }

      try {
        const recorded = await this.dependencies.commands.completeSourcePreparationCommand({
          commandId: command.id,
          attempt: command.attempt,
          preparationId: result.preparation.id,
          campaignId: result.preparation.campaignId,
        });
        if (recorded) completed += 1;
        else lost += 1;
      } catch (error) {
        // A deterministic lineage guard must dead-letter instead of looping.
        // Transient completion failures become bounded retries when settlement
        // storage remains available, or lease recovery when it does not.
        await settleFailure(error);
      }
    }

    return { claimed, completed, retried, deadLettered, lost, settlementFailed };
  }
}
