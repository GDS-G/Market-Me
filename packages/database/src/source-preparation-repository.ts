import { randomUUID } from "node:crypto";
import type { InformationDepth, PromotionalStrength } from "@market-me/domain";
import type { JSONValue, TransactionSql } from "postgres";
import type { DatabaseClient } from "./client";
import {
  compileGeneralAnnouncementPreparation,
  type NormalizedCampaignPreparationInput,
} from "./campaign-preparation-template";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PLACEHOLDER_PACKAGE_ID = "00000000-0000-4000-8000-000000000001";
const WRITER_ROLES = new Set(["owner", "admin", "editor"]);

export const SOURCE_PREPARATION_COMMAND_LIMIT = 100;
export const SOURCE_PREPARATION_DEFAULT_LEASE_SECONDS = 300;
export const SOURCE_PREPARATION_MAX_ATTEMPTS = 8;

export type SourcePreparationCommandStatus = "pending" | "processing" | "failed" | "completed" | "dead_letter";
export type SourcePreparationErrorCode = "invalid_input" | "access_denied" | "source_unavailable"
  | "writer_unavailable" | "brand_unavailable" | "audience_unavailable" | "destination_unavailable"
  | "binding_unavailable" | "binding_changed";

export class SourcePreparationError extends Error {
  constructor(readonly code: SourcePreparationErrorCode, message: string) {
    super(message);
    this.name = "SourcePreparationError";
  }
}

export interface SourcePreparationBindingWrite {
  readonly workspaceId: string;
  readonly smartSourceId: string;
  /** Required compare-and-swap revision for updates; omitted only to create. */
  readonly expectedRevision?: number;
  readonly enabled: boolean;
  readonly templateKey?: "general_announcement";
  readonly templateVersion?: 1;
  readonly name?: string;
  readonly description?: string;
  readonly brandProfileVersionId?: string;
  /** Authored order is retained in the binding and every command snapshot. */
  readonly audienceProfileVersionIds?: readonly string[];
  readonly destinationId?: string;
  readonly informationDepth?: InformationDepth;
  readonly promotionalStrength?: PromotionalStrength;
  readonly timezone?: string;
}

export interface StoredSourcePreparationBinding {
  readonly id: string;
  readonly workspaceId: string;
  readonly smartSourceId: string;
  readonly writerUserId: string;
  readonly templateKey: "general_announcement";
  readonly templateVersion: 1;
  readonly name: string;
  readonly description: string;
  readonly brandProfileVersionId?: string;
  readonly audienceProfileVersionIds: readonly string[];
  readonly destinationId?: string;
  readonly informationDepth: InformationDepth;
  readonly promotionalStrength: PromotionalStrength;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly revision: number;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SourcePreparationBindingSnapshot {
  readonly bindingId: string;
  readonly workspaceId: string;
  readonly smartSourceId: string;
  readonly writerUserId: string;
  readonly revision: number;
  readonly enabled: boolean;
  readonly templateKey: "general_announcement";
  readonly templateVersion: 1;
  readonly name: string;
  readonly description: string;
  readonly brandProfileVersionId?: string;
  readonly audienceProfileVersionIds: readonly string[];
  readonly destinationId?: string;
  readonly informationDepth: InformationDepth;
  readonly promotionalStrength: PromotionalStrength;
  readonly timezone: string;
}

export interface ClaimedSourcePreparationCommand {
  readonly id: string;
  readonly workspaceId: string;
  readonly bindingId: string;
  readonly bindingRevision: number;
  readonly smartSourceId: string;
  readonly contentPackageId: string;
  readonly contentPackageVersion: number;
  readonly expectedApprovalId: string;
  readonly expectedReviewFingerprint: string;
  readonly preparationIdempotencyKey: string;
  readonly writerUserId: string;
  readonly configurationSnapshot: NormalizedCampaignPreparationInput;
  readonly bindingSnapshot: SourcePreparationBindingSnapshot;
  readonly attempt: number;
  readonly leaseExpiresAt: string;
  readonly createdAt: string;
}

export interface SourcePreparationClaimBatch {
  readonly commands: readonly ClaimedSourcePreparationCommand[];
  /** Expired final attempts reconciled to their exact committed receipt. */
  readonly recovered: number;
  /** Expired final attempts terminally closed because no exact receipt exists. */
  readonly deadLettered: number;
}

export interface SourcePreparationCommandSummary {
  readonly id: string;
  readonly contentPackageId: string;
  readonly contentPackageVersion: number;
  readonly expectedApprovalId: string;
  readonly bindingRevision: number;
  readonly status: SourcePreparationCommandStatus;
  readonly attemptCount: number;
  readonly nextAttemptAt?: string;
  readonly leaseExpiresAt?: string;
  readonly lastErrorCode?: string;
  readonly safeError?: string;
  readonly preparationId?: string;
  readonly campaignId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

interface BindingRow extends Omit<StoredSourcePreparationBinding, "createdAt" | "updatedAt" | "brandProfileVersionId" | "destinationId"> {
  brandProfileVersionId: string | null;
  destinationId: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface CommandRow {
  id: string;
  workspaceId: string;
  bindingId: string;
  bindingRevision: number;
  smartSourceId: string;
  contentPackageId: string;
  contentPackageVersion: number;
  expectedApprovalId: string;
  expectedReviewFingerprint: string;
  preparationIdempotencyKey: string;
  writerUserId: string;
  configurationSnapshot: NormalizedCampaignPreparationInput;
  bindingSnapshot: SourcePreparationBindingSnapshot;
  status: SourcePreparationCommandStatus;
  attemptCount: number;
  nextAttemptAt: string | Date | null;
  leaseExpiresAt: string | Date | null;
  lastErrorCode: string | null;
  safeError: string | null;
  preparationId: string | null;
  campaignId: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  completedAt: string | Date | null;
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value.trim().toLowerCase())) {
    throw new SourcePreparationError("invalid_input", `${field} must be a UUID.`);
  }
  return value.trim().toLowerCase();
}

function instant(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function publicBinding(row: BindingRow): StoredSourcePreparationBinding {
  const { brandProfileVersionId, destinationId, createdAt, updatedAt, ...required } = row;
  return {
    ...required,
    ...(brandProfileVersionId ? { brandProfileVersionId } : {}),
    ...(destinationId ? { destinationId } : {}),
    createdAt: instant(createdAt),
    updatedAt: instant(updatedAt),
  };
}

function publicCommand(row: CommandRow): ClaimedSourcePreparationCommand {
  if (!row.leaseExpiresAt) throw new Error("Claimed source preparation command is missing its lease.");
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    bindingId: row.bindingId,
    bindingRevision: row.bindingRevision,
    smartSourceId: row.smartSourceId,
    contentPackageId: row.contentPackageId,
    contentPackageVersion: row.contentPackageVersion,
    expectedApprovalId: row.expectedApprovalId,
    expectedReviewFingerprint: row.expectedReviewFingerprint,
    preparationIdempotencyKey: row.preparationIdempotencyKey,
    writerUserId: row.writerUserId,
    configurationSnapshot: row.configurationSnapshot,
    bindingSnapshot: row.bindingSnapshot,
    attempt: row.attemptCount,
    leaseExpiresAt: instant(row.leaseExpiresAt),
    createdAt: instant(row.createdAt),
  };
}

function publicSummary(row: CommandRow): SourcePreparationCommandSummary {
  return {
    id: row.id,
    contentPackageId: row.contentPackageId,
    contentPackageVersion: row.contentPackageVersion,
    expectedApprovalId: row.expectedApprovalId,
    bindingRevision: row.bindingRevision,
    status: row.status,
    attemptCount: row.attemptCount,
    ...(row.nextAttemptAt ? { nextAttemptAt: instant(row.nextAttemptAt) } : {}),
    ...(row.leaseExpiresAt ? { leaseExpiresAt: instant(row.leaseExpiresAt) } : {}),
    ...(row.lastErrorCode ? { lastErrorCode: row.lastErrorCode } : {}),
    ...(row.safeError ? { safeError: row.safeError } : {}),
    ...(row.preparationId ? { preparationId: row.preparationId } : {}),
    ...(row.campaignId ? { campaignId: row.campaignId } : {}),
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
    ...(row.completedAt ? { completedAt: instant(row.completedAt) } : {}),
  };
}

function normalizeBinding(input: SourcePreparationBindingWrite) {
  if (typeof input.enabled !== "boolean") throw new SourcePreparationError("invalid_input", "Binding enabled must be boolean.");
  if (input.expectedRevision !== undefined
    && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)) {
    throw new SourcePreparationError("invalid_input", "Binding expectedRevision must be a positive safe integer.");
  }
  const smartSourceId = identifier(input.smartSourceId, "smartSourceId");
  const normalized = compileGeneralAnnouncementPreparation({
    workspaceId: input.workspaceId,
    contentPackageId: PLACEHOLDER_PACKAGE_ID,
    expectedPackageVersion: 1,
    templateKey: input.templateKey,
    templateVersion: input.templateVersion,
    name: input.name,
    description: input.description,
    brandProfileVersionId: input.brandProfileVersionId,
    audienceProfileVersionIds: input.audienceProfileVersionIds,
    destinationId: input.destinationId,
    informationDepth: input.informationDepth,
    promotionalStrength: input.promotionalStrength,
    timezone: input.timezone,
  }).normalizedInput;
  return { ...normalized, smartSourceId, enabled: input.enabled, expectedRevision: input.expectedRevision };
}

function validatedLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > SOURCE_PREPARATION_COMMAND_LIMIT) {
    throw new SourcePreparationError("invalid_input", `Command limit must be from 1 through ${SOURCE_PREPARATION_COMMAND_LIMIT}.`);
  }
  return value;
}

function sameOrderedIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function readBinding(tx: TransactionSql, workspaceId: string, predicate: { id: string } | { smartSourceId: string }): Promise<BindingRow | undefined> {
  const selected = "id" in predicate ? tx`binding.id = ${predicate.id}` : tx`binding.smart_source_id = ${predicate.smartSourceId}`;
  return (await tx<BindingRow[]>`
    SELECT binding.*,
      ARRAY(SELECT audience_profile_version_id FROM smart_source_preparation_binding_audience audience
        WHERE audience.binding_id = binding.id ORDER BY audience.sort_order) AS audience_profile_version_ids
    FROM smart_source_preparation_binding binding
    WHERE binding.workspace_id = ${workspaceId} AND ${selected}
  `)[0];
}

export class SourcePreparationRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async saveSourcePreparationBinding(input: SourcePreparationBindingWrite, actorUserId: string): Promise<StoredSourcePreparationBinding> {
    const normalized = normalizeBinding(input);
    const actorId = identifier(actorUserId, "actorUserId");
    return this.sql.begin(async (tx) => {
      await this.lockWriters(tx, normalized.workspaceId, actorId);
      const source = await tx`SELECT id FROM smart_source WHERE id = ${normalized.smartSourceId}
        AND workspace_id = ${normalized.workspaceId} FOR SHARE`;
      if (!source[0]) throw new SourcePreparationError("source_unavailable", "Choose a Smart Source in this workspace.");
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`source-preparation-binding:${normalized.workspaceId}:${normalized.smartSourceId}`}, 0))`;
      const prior = await readBinding(tx, normalized.workspaceId, { smartSourceId: normalized.smartSourceId });
      if ((prior && normalized.expectedRevision !== prior.revision)
        || (!prior && normalized.expectedRevision !== undefined)) {
        throw new SourcePreparationError("binding_changed", "The preparation binding changed. Reload it before saving.");
      }
      const preservesDisabledReferences = Boolean(prior && !normalized.enabled
        && (prior.brandProfileVersionId ?? undefined) === normalized.brandProfileVersionId
        && (prior.destinationId ?? undefined) === normalized.destinationId
        && sameOrderedIds(prior.audienceProfileVersionIds, normalized.audienceProfileVersionIds));
      if (!preservesDisabledReferences) {
        await this.lockReferences(tx, normalized.workspaceId, normalized.brandProfileVersionId,
          normalized.audienceProfileVersionIds, normalized.destinationId);
      }
      const id = randomUUID();
      const row = prior ? (await tx<{ id: string; revision: number }[]>`
        UPDATE smart_source_preparation_binding SET writer_user_id = ${actorId},
          template_key = ${normalized.templateKey}, template_version = ${normalized.templateVersion},
          name = ${normalized.name}, description = ${normalized.description},
          brand_profile_version_id = ${normalized.brandProfileVersionId ?? null},
          destination_id = ${normalized.destinationId ?? null}, information_depth = ${normalized.informationDepth},
          promotional_strength = ${normalized.promotionalStrength}, timezone = ${normalized.timezone},
          enabled = ${normalized.enabled}, revision = revision + 1,
          updated_by = ${actorId}, updated_at = clock_timestamp()
        WHERE id = ${prior.id} AND workspace_id = ${normalized.workspaceId}
          AND revision = ${normalized.expectedRevision!}
        RETURNING id, revision
      `)[0] : (await tx<{ id: string; revision: number }[]>`
        INSERT INTO smart_source_preparation_binding (
          id, workspace_id, smart_source_id, writer_user_id, template_key, template_version,
          name, description, brand_profile_version_id, destination_id, information_depth,
          promotional_strength, timezone, enabled, created_by, updated_by
        ) VALUES (
          ${id}, ${normalized.workspaceId}, ${normalized.smartSourceId}, ${actorId},
          ${normalized.templateKey}, ${normalized.templateVersion}, ${normalized.name}, ${normalized.description},
          ${normalized.brandProfileVersionId ?? null}, ${normalized.destinationId ?? null},
          ${normalized.informationDepth}, ${normalized.promotionalStrength}, ${normalized.timezone},
          ${normalized.enabled}, ${actorId}, ${actorId}
        ) ON CONFLICT (smart_source_id) DO NOTHING RETURNING id, revision
      `)[0];
      if (!row) throw new SourcePreparationError("binding_changed", "The preparation binding changed. Reload it before saving.");
      if (!preservesDisabledReferences) {
        await tx`SELECT set_config('market_me.source_preparation_audience_admission', ${JSON.stringify({
          bindingId: row.id, revision: row.revision, updatedBy: actorId,
        })}, true)`;
        await tx`DELETE FROM smart_source_preparation_binding_audience WHERE binding_id = ${row.id}`;
        for (const [sortOrder, audienceId] of normalized.audienceProfileVersionIds.entries()) {
          await tx`INSERT INTO smart_source_preparation_binding_audience(binding_id, audience_profile_version_id, sort_order)
            VALUES (${row.id}, ${audienceId}, ${sortOrder})`;
        }
      }
      await tx`INSERT INTO audit_event(id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
        VALUES (${randomUUID()}, ${normalized.workspaceId}, ${actorId},
          ${row.revision === 1 ? "source_preparation.binding_created" : "source_preparation.binding_updated"},
          'smart_source_preparation_binding', ${row.id},
          ${tx.json({ smartSourceId: normalized.smartSourceId, revision: row.revision, enabled: normalized.enabled,
            templateKey: normalized.templateKey, templateVersion: normalized.templateVersion,
            audienceCount: normalized.audienceProfileVersionIds.length } as JSONValue)})`;
      return publicBinding((await readBinding(tx, normalized.workspaceId, { id: row.id }))!);
    });
  }

  async getSourcePreparationBinding(workspaceId: string, bindingId: string, actorUserId: string): Promise<StoredSourcePreparationBinding | undefined> {
    const scope = identifier(workspaceId, "workspaceId");
    const id = identifier(bindingId, "bindingId");
    const actor = identifier(actorUserId, "actorUserId");
    return this.sql.begin(async (tx) => {
      if (!await this.canRead(tx, scope, actor)) return undefined;
      const row = await readBinding(tx, scope, { id });
      return row ? publicBinding(row) : undefined;
    });
  }

  async getSourcePreparationBindingForSource(workspaceId: string, smartSourceId: string, actorUserId: string): Promise<StoredSourcePreparationBinding | undefined> {
    const scope = identifier(workspaceId, "workspaceId");
    const sourceId = identifier(smartSourceId, "smartSourceId");
    const actor = identifier(actorUserId, "actorUserId");
    return this.sql.begin(async (tx) => {
      if (!await this.canRead(tx, scope, actor)) return undefined;
      const row = await readBinding(tx, scope, { smartSourceId: sourceId });
      return row ? publicBinding(row) : undefined;
    });
  }

  async listSourcePreparationBindings(workspaceId: string, actorUserId: string): Promise<readonly StoredSourcePreparationBinding[]> {
    const scope = identifier(workspaceId, "workspaceId");
    const actor = identifier(actorUserId, "actorUserId");
    return this.sql.begin(async (tx) => {
      if (!await this.canRead(tx, scope, actor)) return [];
      const rows = await tx<BindingRow[]>`
        SELECT binding.*,
          ARRAY(SELECT audience_profile_version_id FROM smart_source_preparation_binding_audience audience
            WHERE audience.binding_id = binding.id ORDER BY audience.sort_order) AS audience_profile_version_ids
        FROM smart_source_preparation_binding binding WHERE binding.workspace_id = ${scope}
        ORDER BY binding.updated_at DESC, binding.id
      `;
      return rows.map(publicBinding);
    });
  }

  async setSourcePreparationBindingEnabled(input: { workspaceId: string; bindingId: string; enabled: boolean }, actorUserId: string): Promise<StoredSourcePreparationBinding | undefined> {
    const workspaceId = identifier(input.workspaceId, "workspaceId");
    const bindingId = identifier(input.bindingId, "bindingId");
    const actorId = identifier(actorUserId, "actorUserId");
    if (typeof input.enabled !== "boolean") throw new SourcePreparationError("invalid_input", "Binding enabled must be boolean.");
    return this.sql.begin(async (tx) => {
      await this.lockWriters(tx, workspaceId, actorId);
      const prior = await readBinding(tx, workspaceId, { id: bindingId });
      if (!prior) return undefined;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`source-preparation-binding:${workspaceId}:${prior.smartSourceId}`}, 0))`;
      const current = await readBinding(tx, workspaceId, { id: bindingId });
      if (!current) return undefined;
      if (input.enabled) {
        await this.lockReferences(tx, workspaceId, current.brandProfileVersionId ?? undefined,
          current.audienceProfileVersionIds, current.destinationId ?? undefined);
      }
      await tx`UPDATE smart_source_preparation_binding SET enabled = ${input.enabled}, writer_user_id = ${actorId}, revision = revision + 1,
        updated_by = ${actorId}, updated_at = clock_timestamp()
        WHERE id = ${bindingId} AND workspace_id = ${workspaceId}`;
      const updated = publicBinding((await readBinding(tx, workspaceId, { id: bindingId }))!);
      await tx`INSERT INTO audit_event(id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
        VALUES (${randomUUID()}, ${workspaceId}, ${actorId},
          ${input.enabled ? "source_preparation.binding_enabled" : "source_preparation.binding_disabled"},
          'smart_source_preparation_binding', ${bindingId},
          ${tx.json({ smartSourceId: updated.smartSourceId, revision: updated.revision, enabled: updated.enabled } as JSONValue)})`;
      return updated;
    });
  }

  async claimSourcePreparationCommands(limit: number,
    leaseSeconds = SOURCE_PREPARATION_DEFAULT_LEASE_SECONDS): Promise<SourcePreparationClaimBatch> {
    const boundedLimit = validatedLimit(limit);
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) {
      throw new SourcePreparationError("invalid_input", "Command lease must be from 1 through 3600 seconds.");
    }
    return this.sql.begin(async (tx) => {
      // Lock cap-expired commands before looking for receipts. A receipt insert
      // holds SHARE on its command, so SKIP LOCKED leaves in-flight work for a
      // later poll; after we hold UPDATE, no receipt can race between the
      // recovery lookup and terminal settlement.
      const finalCandidates = await tx<{ id: string }[]>`
        SELECT id FROM source_preparation_command
        WHERE status = 'processing' AND attempt_count >= ${SOURCE_PREPARATION_MAX_ATTEMPTS}
          AND lease_expires_at <= clock_timestamp()
        ORDER BY lease_expires_at, created_at, id
        LIMIT ${boundedLimit} FOR UPDATE SKIP LOCKED
      `;
      const finalCandidateIds = finalCandidates.map((command) => command.id);
      const recovered = finalCandidateIds.length ? await tx<{ id: string; workspaceId: string; writerUserId: string;
        contentPackageId: string; attemptCount: number; preparationId: string; campaignId: string }[]>`
        UPDATE source_preparation_command command SET status = 'completed', next_attempt_at = NULL,
          claimed_at = NULL, lease_expires_at = NULL, last_error_code = NULL, safe_error = NULL,
          preparation_id = preparation.id, campaign_id = preparation.campaign_id,
          completed_at = clock_timestamp(), updated_at = clock_timestamp()
        FROM campaign_preparation preparation
        WHERE command.id IN ${tx(finalCandidateIds)}
          AND command.status = 'processing'
          AND preparation.workspace_id = command.workspace_id
          AND preparation.idempotency_key = command.preparation_idempotency_key
          AND preparation.content_package_id = command.content_package_id
          AND preparation.content_package_version = command.content_package_version
          AND preparation.configuration_snapshot = command.configuration_snapshot
          AND preparation.created_by = command.writer_user_id
          AND preparation.reference_snapshot->'contentPackage'->>'approvalId' = command.expected_approval_id::text
          AND preparation.reference_snapshot->'contentPackage'->>'reviewFingerprint' = command.expected_review_fingerprint
        RETURNING command.id, command.workspace_id, command.writer_user_id,
          command.content_package_id, command.attempt_count,
          command.preparation_id, command.campaign_id
      ` : [];
      for (const command of recovered) {
        await tx`INSERT INTO audit_event(id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
          VALUES (${randomUUID()}, ${command.workspaceId}, ${command.writerUserId},
            'source_preparation.command_completed', 'source_preparation_command', ${command.id},
            ${tx.json({ contentPackageId: command.contentPackageId, preparationId: command.preparationId,
              campaignId: command.campaignId, attempt: command.attemptCount,
              recoveredFromExpiredLease: true } as JSONValue)})`;
      }

      const exhausted = finalCandidateIds.length ? await tx<{ id: string; workspaceId: string; writerUserId: string;
        contentPackageId: string; attemptCount: number }[]>`
        UPDATE source_preparation_command command SET status = 'dead_letter', next_attempt_at = NULL,
          claimed_at = NULL, lease_expires_at = NULL, last_error_code = 'attempt_limit_exhausted',
          safe_error = 'The preparation worker did not settle the final allowed attempt.',
          completed_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE command.id IN ${tx(finalCandidateIds)} AND command.status = 'processing'
        RETURNING command.id, command.workspace_id, command.writer_user_id,
          command.content_package_id, command.attempt_count
      ` : [];
      for (const command of exhausted) {
        await tx`INSERT INTO audit_event(id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
          VALUES (${randomUUID()}, ${command.workspaceId}, ${command.writerUserId},
            'source_preparation.command_dead_lettered', 'source_preparation_command', ${command.id},
            ${tx.json({ contentPackageId: command.contentPackageId, attempt: command.attemptCount,
              errorCode: "attempt_limit_exhausted", retryable: false, status: "dead_letter" } as JSONValue)})`;
      }
      const remainingLimit = boundedLimit - recovered.length - exhausted.length;
      const rows = remainingLimit > 0 ? await tx<CommandRow[]>`
        WITH candidates AS (
          SELECT id FROM source_preparation_command
          WHERE attempt_count < ${SOURCE_PREPARATION_MAX_ATTEMPTS} AND (
            (status IN ('pending', 'failed') AND next_attempt_at <= clock_timestamp())
            OR (status = 'processing' AND lease_expires_at <= clock_timestamp())
          )
          ORDER BY COALESCE(next_attempt_at, lease_expires_at), created_at, id
          LIMIT ${remainingLimit} FOR UPDATE SKIP LOCKED
        )
        UPDATE source_preparation_command command SET status = 'processing',
          attempt_count = command.attempt_count + 1, next_attempt_at = NULL,
          claimed_at = statement_timestamp(),
          lease_expires_at = statement_timestamp() + (${leaseSeconds} * interval '1 second'),
          last_error_code = NULL, safe_error = NULL, updated_at = clock_timestamp()
        FROM candidates WHERE command.id = candidates.id
        RETURNING command.*
      ` : [];
      return { commands: rows.map(publicCommand), recovered: recovered.length, deadLettered: exhausted.length };
    });
  }

  async completeSourcePreparationCommand(input: {
    commandId: string; attempt: number; preparationId: string; campaignId: string;
  }): Promise<boolean> {
    const commandId = identifier(input.commandId, "commandId");
    const preparationId = identifier(input.preparationId, "preparationId");
    const campaignId = identifier(input.campaignId, "campaignId");
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
      throw new SourcePreparationError("invalid_input", "Command attempt must be a positive safe integer.");
    }
    return this.sql.begin(async (tx) => {
      // The attempt predicate distinguishes a stale worker (false). Current-attempt
      // lineage is intentionally left to the database guard, which raises 23514
      // rather than masquerading as a lost lease and retrying forever.
      const rows = await tx<{ id: string; workspaceId: string; writerUserId: string; contentPackageId: string }[]>`
        UPDATE source_preparation_command command SET status = 'completed', next_attempt_at = NULL,
          claimed_at = NULL, lease_expires_at = NULL, last_error_code = NULL, safe_error = NULL,
          preparation_id = ${preparationId}, campaign_id = ${campaignId},
          completed_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE command.id = ${commandId} AND command.status = 'processing'
          AND command.attempt_count = ${input.attempt}
        RETURNING command.id, command.workspace_id, command.writer_user_id, command.content_package_id
      `;
      const completed = rows[0];
      if (!completed) return false;
      await tx`INSERT INTO audit_event(id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
        VALUES (${randomUUID()}, ${completed.workspaceId}, ${completed.writerUserId},
          'source_preparation.command_completed', 'source_preparation_command', ${completed.id},
          ${tx.json({ contentPackageId: completed.contentPackageId, preparationId, campaignId,
            attempt: input.attempt } as JSONValue)})`;
      return true;
    });
  }

  async failSourcePreparationCommand(input: {
    commandId: string; attempt: number; errorCode: string; retryable: boolean; safeError: string;
  }): Promise<"completed" | "failed" | "dead_letter" | undefined> {
    const commandId = identifier(input.commandId, "commandId");
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
      throw new SourcePreparationError("invalid_input", "Command attempt must be a positive safe integer.");
    }
    if (typeof input.retryable !== "boolean" || typeof input.errorCode !== "string"
      || !/^[a-z0-9][a-z0-9_.-]{0,99}$/.test(input.errorCode)
      || typeof input.safeError !== "string" || !input.safeError.trim() || input.safeError.trim().length > 2000) {
      throw new SourcePreparationError("invalid_input", "Provide a bounded safe command error and code.");
    }
    return this.sql.begin(async (tx) => {
      // Lock the current attempt before receipt lookup. If an in-flight receipt
      // already holds SHARE, this waits for its commit and the following query
      // sees it; if failure wins the lock, a later receipt insert is rejected.
      const locked = (await tx<{ id: string }[]>`SELECT id FROM source_preparation_command
        WHERE id = ${commandId} AND status = 'processing' AND attempt_count = ${input.attempt}
        FOR UPDATE`)[0];
      if (!locked) return undefined;
      // Any exact committed receipt is authoritative success, even when the
      // caller observed a deterministic-looking error after commit.
      const recovered = (await tx<{ id: string; workspaceId: string; writerUserId: string;
        contentPackageId: string; preparationId: string; campaignId: string }[]>`
        UPDATE source_preparation_command command SET status = 'completed', next_attempt_at = NULL,
          claimed_at = NULL, lease_expires_at = NULL, last_error_code = NULL, safe_error = NULL,
          preparation_id = preparation.id, campaign_id = preparation.campaign_id,
          completed_at = clock_timestamp(), updated_at = clock_timestamp()
        FROM campaign_preparation preparation
        WHERE command.id = ${commandId} AND command.status = 'processing'
          AND command.attempt_count = ${input.attempt}
          AND preparation.workspace_id = command.workspace_id
          AND preparation.idempotency_key = command.preparation_idempotency_key
          AND preparation.content_package_id = command.content_package_id
          AND preparation.content_package_version = command.content_package_version
          AND preparation.configuration_snapshot = command.configuration_snapshot
          AND preparation.created_by = command.writer_user_id
          AND preparation.reference_snapshot->'contentPackage'->>'approvalId' = command.expected_approval_id::text
          AND preparation.reference_snapshot->'contentPackage'->>'reviewFingerprint' = command.expected_review_fingerprint
        RETURNING command.id, command.workspace_id, command.writer_user_id,
          command.content_package_id, command.preparation_id, command.campaign_id
      `)[0];
      if (recovered) {
        await tx`INSERT INTO audit_event(id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
          VALUES (${randomUUID()}, ${recovered.workspaceId}, ${recovered.writerUserId},
            'source_preparation.command_completed', 'source_preparation_command', ${recovered.id},
            ${tx.json({ contentPackageId: recovered.contentPackageId, preparationId: recovered.preparationId,
              campaignId: recovered.campaignId, attempt: input.attempt,
              recoveredFromSettlementFailure: true } as JSONValue)})`;
        return "completed";
      }
      const rows = await tx<{ id: string; status: "failed" | "dead_letter"; workspaceId: string;
        writerUserId: string; contentPackageId: string }[]>`
        UPDATE source_preparation_command command SET
          status = CASE WHEN ${input.retryable} AND command.attempt_count < ${SOURCE_PREPARATION_MAX_ATTEMPTS}
            THEN 'failed' ELSE 'dead_letter' END,
          next_attempt_at = CASE WHEN ${input.retryable} AND command.attempt_count < ${SOURCE_PREPARATION_MAX_ATTEMPTS}
            THEN clock_timestamp() + make_interval(secs => LEAST(3600,
              (5 * power(2, LEAST(command.attempt_count - 1, 10)))::integer)) ELSE NULL END,
          claimed_at = NULL, lease_expires_at = NULL, last_error_code = ${input.errorCode},
          safe_error = ${input.safeError.trim()},
          completed_at = CASE WHEN ${input.retryable} AND command.attempt_count < ${SOURCE_PREPARATION_MAX_ATTEMPTS}
            THEN NULL ELSE clock_timestamp() END,
          updated_at = clock_timestamp()
        WHERE command.id = ${commandId} AND command.status = 'processing'
          AND command.attempt_count = ${input.attempt}
        RETURNING command.id, command.status, command.workspace_id, command.writer_user_id, command.content_package_id
      `;
      const failed = rows[0];
      if (!failed) return undefined;
      await tx`INSERT INTO audit_event(id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
        VALUES (${randomUUID()}, ${failed.workspaceId}, ${failed.writerUserId},
          ${failed.status === "failed" ? "source_preparation.command_failed" : "source_preparation.command_dead_lettered"},
          'source_preparation_command', ${failed.id},
          ${tx.json({ contentPackageId: failed.contentPackageId, attempt: input.attempt,
            errorCode: input.errorCode, retryable: input.retryable, status: failed.status } as JSONValue)})`;
      return failed.status;
    });
  }

  /**
   * Finds the one durable command created by an exact Content Package approval.
   * The approval identifier is lookup scope only: callers must minimize the
   * returned summary before it crosses a browser boundary.
   */
  async getSourcePreparationCommandForApproval(workspaceId: string, contentPackageId: string,
    approvalId: string, actorUserId: string): Promise<SourcePreparationCommandSummary | undefined> {
    const scope = identifier(workspaceId, "workspaceId");
    const contentPackage = identifier(contentPackageId, "contentPackageId");
    const approval = identifier(approvalId, "approvalId");
    const actor = identifier(actorUserId, "actorUserId");
    const row = (await this.sql<CommandRow[]>`
      SELECT command.id, command.content_package_id, command.content_package_version,
        command.expected_approval_id, command.binding_revision, command.status, command.attempt_count,
        command.next_attempt_at, command.lease_expires_at, command.last_error_code, command.safe_error,
        command.preparation_id, command.campaign_id, command.created_at, command.updated_at, command.completed_at
      FROM source_preparation_command command
      JOIN workspace_membership member ON member.workspace_id = command.workspace_id AND member.user_id = ${actor}
      WHERE command.workspace_id = ${scope} AND command.content_package_id = ${contentPackage}
        AND command.expected_approval_id = ${approval}
      LIMIT 1
    `)[0];
    return row ? publicSummary(row) : undefined;
  }

  async listSourcePreparationCommands(workspaceId: string, smartSourceId: string, actorUserId: string,
    limit = 20): Promise<readonly SourcePreparationCommandSummary[]> {
    const scope = identifier(workspaceId, "workspaceId");
    const source = identifier(smartSourceId, "smartSourceId");
    const actor = identifier(actorUserId, "actorUserId");
    const boundedLimit = validatedLimit(limit);
    const rows = await this.sql<CommandRow[]>`
      SELECT command.id, command.content_package_id, command.content_package_version,
        command.expected_approval_id, command.binding_revision, command.status, command.attempt_count,
        command.next_attempt_at, command.lease_expires_at, command.last_error_code, command.safe_error,
        command.preparation_id, command.campaign_id, command.created_at, command.updated_at, command.completed_at
      FROM source_preparation_command command
      JOIN workspace_membership member ON member.workspace_id = command.workspace_id AND member.user_id = ${actor}
      WHERE command.workspace_id = ${scope} AND command.smart_source_id = ${source}
      ORDER BY command.created_at DESC, command.id DESC LIMIT ${boundedLimit}
    `;
    return rows.map(publicSummary);
  }

  private async canRead(tx: TransactionSql, workspaceId: string, actorUserId: string): Promise<boolean> {
    return Boolean((await tx`SELECT true FROM workspace_membership
      WHERE workspace_id = ${workspaceId} AND user_id = ${actorUserId}`)[0]);
  }

  private async lockWriters(tx: TransactionSql, workspaceId: string, actorUserId: string, writerUserId?: string): Promise<void> {
    const organization = await tx`SELECT id FROM organization
      WHERE id = (SELECT organization_id FROM workspace WHERE id = ${workspaceId}) FOR KEY SHARE`;
    const workspace = await tx<{ id: string }[]>`SELECT id FROM workspace WHERE id = ${workspaceId} FOR SHARE`;
    if (!organization[0] || !workspace[0]) throw new SourcePreparationError("access_denied", "Current workspace writer access is required.");
    const users = [...new Set([actorUserId, ...(writerUserId ? [writerUserId] : [])])].sort();
    const lockedUsers = await tx<{ id: string }[]>`SELECT id FROM app_user WHERE id IN ${tx(users)} ORDER BY id FOR KEY SHARE`;
    const memberships = await tx<{ userId: string; role: string }[]>`
      SELECT user_id, role FROM workspace_membership WHERE workspace_id = ${workspaceId}
        AND user_id IN ${tx(users)} ORDER BY user_id FOR SHARE
    `;
    const roles = new Map(memberships.map((member) => [member.userId, member.role]));
    if (lockedUsers.length !== users.length || !WRITER_ROLES.has(roles.get(actorUserId) ?? "")) {
      throw new SourcePreparationError("access_denied", "Current workspace writer access is required.");
    }
    if (writerUserId && !WRITER_ROLES.has(roles.get(writerUserId) ?? "")) {
      throw new SourcePreparationError("writer_unavailable", "Choose a current owner, administrator, or editor as preparation writer.");
    }
  }

  private async lockReferences(tx: TransactionSql, workspaceId: string, brandProfileVersionId: string | undefined,
    audienceProfileVersionIds: readonly string[], destinationId: string | undefined): Promise<void> {
    if (brandProfileVersionId) {
      const roots = await tx<{ id: string }[]>`SELECT id FROM brand_profile
        WHERE workspace_id = ${workspaceId}
          AND id = (SELECT brand_profile_id FROM brand_profile_version WHERE id = ${brandProfileVersionId})
        FOR SHARE`;
      if (!roots[0]) throw new SourcePreparationError("brand_unavailable", "Choose a current published Brand Profile version.");
      const versions = await tx`SELECT version.id FROM brand_profile_version version
        JOIN brand_profile profile ON profile.id = version.brand_profile_id
        WHERE version.id = ${brandProfileVersionId} AND version.brand_profile_id = ${roots[0].id}
          AND version.status = 'published' AND profile.status = 'published'
          AND profile.current_version_id = version.id FOR SHARE OF version`;
      if (!versions[0]) throw new SourcePreparationError("brand_unavailable", "Choose a current published Brand Profile version.");
    }
    if (audienceProfileVersionIds.length) {
      const roots = await tx<{ id: string }[]>`
        SELECT profile.id FROM audience_profile profile
        WHERE profile.workspace_id = ${workspaceId}
          AND profile.id IN (SELECT audience_profile_id FROM audience_profile_version
            WHERE id IN ${tx([...audienceProfileVersionIds])})
        ORDER BY profile.id FOR SHARE
      `;
      const versions = await tx<{ id: string }[]>`
        SELECT version.id FROM audience_profile_version version
        JOIN audience_profile profile ON profile.id = version.audience_profile_id
        WHERE version.id IN ${tx([...audienceProfileVersionIds])}
          AND profile.id IN ${tx(roots.map((root) => root.id))}
          AND profile.workspace_id = ${workspaceId} AND profile.status = 'published'
          AND profile.current_version_id = version.id AND version.status = 'published'
        ORDER BY version.id FOR SHARE OF version
      `;
      if (roots.length !== audienceProfileVersionIds.length || versions.length !== audienceProfileVersionIds.length) {
        throw new SourcePreparationError("audience_unavailable", "Choose current published Audience Profile versions.");
      }
    }
    if (destinationId) {
      const rows = await tx`SELECT id FROM destination WHERE id = ${destinationId}
        AND workspace_id = ${workspaceId} AND status = 'published' FOR SHARE`;
      if (!rows[0]) throw new SourcePreparationError("destination_unavailable", "Choose a published Destination in this workspace.");
    }
  }
}
