import { randomUUID } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";
import {
  resolveCommunicationPolicy,
  validateCampaignGraph,
  validateCampaignExecution,
  campaignStepRequiresApproval,
  evaluateStepSchedule,
  type StepScheduleInput,
  type StepSchedulePredecessor,
  type CampaignStep,
  type CampaignVersion,
  type CommunicationPolicyInput,
} from "@market-me/domain";
import type { DatabaseClient } from "./client";
import { preferredWindowRouteIssue } from "./campaign-route-policy";
import { assertFinalizedCampaignPreviewInTransaction, CampaignFinalizationProofError } from "./campaign-finalization-proof";
import type {
  CampaignDraftWrite,
  CampaignWorkflowDefinition,
  CampaignWorkflowCommand,
  DestinationWrite,
  StoredCampaign,
  StoredCampaignApproval,
  StoredCampaignInstance,
  StoredCampaignStepRun,
  StoredStepScheduleState,
  StoredDestination,
} from "./models";

type CampaignRow = Omit<StoredCampaign, "currentVersion" | "draftVersion"> & {
  currentVersionId?: string;
};
type VersionRow = Omit<CampaignVersion, "steps" | "audienceProfileVersionIds">;

export class CampaignValidationError extends Error {
  constructor(
    readonly issues: readonly {
      code: string;
      stepId?: string;
      message: string;
    }[],
  ) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "CampaignValidationError";
  }
}

/** No execution was admitted; callers may persist expiry or wait using this exact evidence. */
export class CampaignScheduleNotReadyError extends CampaignValidationError {
  constructor(readonly schedule: StoredStepScheduleState) {
    super([{ code: schedule.state === "expired" ? "execution_schedule_expired" : "execution_schedule_not_ready",
      stepId: schedule.stepKey, message: schedule.state === "expired"
        ? "The campaign action has no remaining legal request-start time."
        : "The campaign action is waiting for its persisted scheduling requirements." }]);
    this.name = "CampaignScheduleNotReadyError";
  }
}

export class CampaignRepository {
  constructor(private readonly sql: DatabaseClient, private readonly options: { appBaseUrl?: string } = {}) {}

  async listDestinations(workspaceId: string): Promise<StoredDestination[]> {
    return this.sql<StoredDestination[]>`
      SELECT id, workspace_id, provider, external_id, canonical_url, known_redirects,
        title, description, content_type, owner_user_id, identifiers, topics, audiences,
        geography, language, status, available_at, expires_at, replacement_destination_id,
        tracking, created_by, created_at, updated_at
      FROM destination WHERE workspace_id = ${workspaceId}
      ORDER BY updated_at DESC
    `;
  }

  async getDestination(
    workspaceId: string,
    id: string,
  ): Promise<StoredDestination | undefined> {
    return (
      await this.sql<StoredDestination[]>`
      SELECT id, workspace_id, provider, external_id, canonical_url, known_redirects,
        title, description, content_type, owner_user_id, identifiers, topics, audiences,
        geography, language, status, available_at, expires_at, replacement_destination_id,
        tracking, created_by, created_at, updated_at
      FROM destination WHERE workspace_id = ${workspaceId} AND id = ${id}
    `
    )[0];
  }

  async saveDestination(
    input: DestinationWrite,
    actorUserId: string,
    id: string = randomUUID(),
  ): Promise<StoredDestination> {
    if (input.replacementDestinationId) {
      const replacement = await this.getDestination(
        input.workspaceId,
        input.replacementDestinationId,
      );
      if (!replacement)
        throw new Error(
          "Replacement destination does not belong to this workspace",
        );
    }
    await this.sql`
      INSERT INTO destination (
        id, workspace_id, provider, external_id, canonical_url, known_redirects,
        title, description, content_type, owner_user_id, identifiers, topics, audiences,
        geography, language, status, available_at, expires_at, replacement_destination_id,
        tracking, created_by
      ) VALUES (
        ${id}, ${input.workspaceId}, ${input.provider}, ${input.externalId ?? null}, ${input.canonicalUrl}, ${[...input.knownRedirects]},
        ${input.title}, ${input.description}, ${input.contentType}, ${input.ownerUserId ?? null},
        ${this.sql.json(input.identifiers as JSONValue)}, ${[...input.topics]}, ${[...input.audiences]},
        ${[...input.geography]}, ${input.language ?? null}, ${input.status}, ${input.availableAt ?? null},
        ${input.expiresAt ?? null}, ${input.replacementDestinationId ?? null}, ${this.sql.json(input.tracking as JSONValue)}, ${actorUserId}
      )
      ON CONFLICT (id) DO UPDATE SET
        provider = EXCLUDED.provider, external_id = EXCLUDED.external_id,
        canonical_url = EXCLUDED.canonical_url, known_redirects = EXCLUDED.known_redirects,
        title = EXCLUDED.title, description = EXCLUDED.description, content_type = EXCLUDED.content_type,
        owner_user_id = EXCLUDED.owner_user_id, identifiers = EXCLUDED.identifiers, topics = EXCLUDED.topics,
        audiences = EXCLUDED.audiences, geography = EXCLUDED.geography, language = EXCLUDED.language,
        status = EXCLUDED.status, available_at = EXCLUDED.available_at, expires_at = EXCLUDED.expires_at,
        replacement_destination_id = EXCLUDED.replacement_destination_id, tracking = EXCLUDED.tracking,
        updated_at = now()
      WHERE destination.workspace_id = EXCLUDED.workspace_id
    `;
    return (await this.getDestination(input.workspaceId, id))!;
  }

  async listCampaigns(workspaceId: string): Promise<StoredCampaign[]> {
    return this.attachCampaignVersions(
      await this.sql<CampaignRow[]>`
      SELECT id, workspace_id, name, description, status, current_version_id, created_by, created_at, updated_at
      FROM campaign WHERE workspace_id = ${workspaceId} ORDER BY updated_at DESC
    `,
    );
  }

  async getCampaign(
    workspaceId: string,
    id: string,
  ): Promise<StoredCampaign | undefined> {
    return (
      await this.attachCampaignVersions(
        await this.sql<CampaignRow[]>`
      SELECT id, workspace_id, name, description, status, current_version_id, created_by, created_at, updated_at
      FROM campaign WHERE workspace_id = ${workspaceId} AND id = ${id}
    `,
      )
    )[0];
  }

  async createCampaign(
    input: CampaignDraftWrite,
    actorUserId: string,
  ): Promise<StoredCampaign> {
    const created = await this.sql.begin((transaction) =>
      this.createCampaignDraftInTransaction(transaction, input, actorUserId));
    return (await this.getCampaign(input.workspaceId, created.campaignId))!;
  }

  /** Caller owns commit/rollback; this helper never opens or reads outside its transaction. */
  async createCampaignDraftInTransaction(
    transaction: TransactionSql,
    input: CampaignDraftWrite,
    actorUserId: string,
  ): Promise<{ campaignId: string; campaignVersionId: string }> {
    this.assertGraph(input.steps);
    const campaignId = randomUUID();
    const campaignVersionId = randomUUID();
    await this.validateReferences(transaction, input);
    await transaction`
      INSERT INTO campaign (id, workspace_id, name, description, created_by)
      VALUES (${campaignId}, ${input.workspaceId}, ${input.name}, ${input.description}, ${actorUserId})
    `;
    await this.insertVersion(transaction, campaignId, campaignVersionId, 1, input, actorUserId);
    return { campaignId, campaignVersionId };
  }

  /**
   * Insert a distinct executable draft into the prepared Campaign; never replace
   * its planning version or an editable draft. The caller owns writer/reference/
   * preview locks and the finalization receipt in this same transaction. Repeated
   * parent locks use the common Campaign -> preparation order. No nested begin,
   * publish, instance/outbox creation, or post-commit lookup occurs here.
   */
  async insertPreparedExecutableDraftInTransaction(
    transaction: TransactionSql,
    input: { workspaceId: string; campaignId: string; preparationId: string; expectedPlanningVersionId: string; definition: CampaignDraftWrite },
    actorUserId: string,
  ): Promise<{ campaignVersionId: string; versionNumber: number }> {
    const campaign = (await transaction<{ id: string; currentVersionId: string | null; status: string }[]>`
      SELECT id, current_version_id, status FROM campaign
      WHERE workspace_id = ${input.workspaceId} AND id = ${input.campaignId} FOR UPDATE
    `)[0];
    const preparation = (await transaction<{ planningVersionId: string }[]>`
      SELECT planning_version_id FROM campaign_preparation
      WHERE id = ${input.preparationId} AND workspace_id = ${input.workspaceId} AND campaign_id = ${input.campaignId} FOR SHARE
    `)[0];
    const planning = (await transaction<{ id: string }[]>`
      SELECT id FROM campaign_version WHERE id = ${input.expectedPlanningVersionId}
        AND campaign_id = ${input.campaignId} AND status = 'published' AND autonomy_mode = 'draft_only' FOR SHARE
    `)[0];
    if (!campaign || campaign.status === "archived" || !preparation || !planning
      || campaign.currentVersionId !== input.expectedPlanningVersionId
      || preparation.planningVersionId !== input.expectedPlanningVersionId
      || input.definition.workspaceId !== input.workspaceId) {
      throw new CampaignValidationError([{ code: "planning_version_conflict", message: "The original published planning version must still be current in this workspace." }]);
    }
    const finalized = await transaction<{ id: string }[]>`SELECT id FROM campaign_finalization WHERE campaign_id = ${input.campaignId}`;
    if (finalized.length) throw new CampaignValidationError([{ code: "campaign_already_finalized", message: "This Campaign already has an immutable finalization receipt." }]);
    const drafts = await transaction<{ id: string }[]>`SELECT id FROM campaign_version WHERE campaign_id = ${input.campaignId} AND status = 'draft' FOR UPDATE`;
    if (drafts.length) throw new CampaignValidationError([{ code: "editable_draft_exists", message: "This Campaign already has an editable draft. Finalization never overwrites it." }]);
    this.assertGraph(input.definition.steps);
    const issues = validateCampaignExecution(input.definition.autonomyMode,
      input.definition.steps.map((step) => ({ ...step, outputs: step.outputs ?? {} })), { allowBoundedScheduling: true });
    if (issues.length) throw new CampaignValidationError(issues);
    await this.validateReferences(transaction, input.definition);
    const versionNumber = (await transaction<{ next: number }[]>`
      SELECT COALESCE(max(version_number), 0)::integer + 1 AS next FROM campaign_version WHERE campaign_id = ${input.campaignId}
    `)[0]!.next;
    const campaignVersionId = randomUUID();
    await this.insertVersion(transaction, input.campaignId, campaignVersionId, versionNumber, input.definition, actorUserId);
    return { campaignVersionId, versionNumber };
  }

  async saveCampaignDraft(
    campaignId: string,
    input: CampaignDraftWrite,
    actorUserId: string,
  ): Promise<StoredCampaign | undefined> {
    this.assertGraph(input.steps);
    const saved = await this.sql.begin(async (transaction) => {
      const campaigns = await transaction<
        { id: string; currentVersionId?: string }[]
      >`
        SELECT id, current_version_id FROM campaign WHERE id = ${campaignId} AND workspace_id = ${input.workspaceId} FOR UPDATE
      `;
      if (!campaigns[0]) return false;
      if ((await transaction<{ id: string }[]>`SELECT id FROM campaign_finalization WHERE campaign_id = ${campaignId}`).length) {
        throw new CampaignValidationError([{ code: "campaign_finalization_protected", message: "This finalized Campaign is read-only. Its reviewed definition cannot be changed in the advanced editor." }]);
      }
      await this.validateReferences(transaction, input);
      const drafts = await transaction<{ id: string; versionNumber: number }[]>`
        SELECT id, version_number FROM campaign_version WHERE campaign_id = ${campaignId} AND status = 'draft' FOR UPDATE
      `;
      let draft = drafts[0];
      if (!draft) {
        const numbers = await transaction<{ next: number }[]>`
          SELECT COALESCE(max(version_number), 0)::integer + 1 AS next FROM campaign_version WHERE campaign_id = ${campaignId}
        `;
        draft = { id: randomUUID(), versionNumber: numbers[0].next };
        await this.insertVersion(
          transaction,
          campaignId,
          draft.id,
          draft.versionNumber,
          input,
          actorUserId,
        );
      } else {
        await transaction`
          UPDATE campaign_version SET objective = ${input.objective}, content_package_ids = ${[...input.contentPackageIds]},
            destination_id = ${input.destinationId ?? null}, information_depth = ${input.informationDepth},
            promotional_strength = ${input.promotionalStrength}, autonomy_mode = ${input.autonomyMode},
            timezone = ${input.timezone}, context = ${transaction.json(input.context as JSONValue)},
            success_criteria = ${transaction.json((input.successCriteria ?? []) as unknown as JSONValue)},
            success_action = ${input.successAction ?? "notify_only"},
            brand_profile_version_id = ${input.brandProfileVersionId ?? null}
          WHERE id = ${draft.id} AND status = 'draft'
        `;
        await transaction`DELETE FROM campaign_version_audience_profile WHERE campaign_version_id = ${draft.id}`;
        await this.insertAudienceBindings(
          transaction,
          draft.id,
          input.audienceProfileVersionIds,
        );
        await transaction`DELETE FROM campaign_step WHERE campaign_version_id = ${draft.id}`;
        await this.insertSteps(transaction, draft.id, input.steps);
      }
      await transaction`UPDATE campaign SET name = ${input.name}, description = ${input.description}, updated_at = now() WHERE id = ${campaignId}`;
      return true;
    });
    return saved ? this.getCampaign(input.workspaceId, campaignId) : undefined;
  }

  async publishCampaign(
    workspaceId: string,
    campaignId: string,
    options: { expectedVersionId?: string } = {},
  ): Promise<StoredCampaign | undefined> {
    const published = await this.sql.begin(async (transaction) => {
      const rows = await transaction<{ id: string; currentVersionId: string | null }[]>`
        SELECT c.id, c.current_version_id FROM campaign c WHERE c.id = ${campaignId} AND c.workspace_id = ${workspaceId} FOR UPDATE
      `;
      if (!rows[0]) return false;
      const drafts = await transaction<{ id: string }[]>`
        SELECT id FROM campaign_version WHERE campaign_id = ${campaignId} AND status = 'draft' FOR UPDATE
      `;
      if (options.expectedVersionId) {
        if (drafts[0]?.id === options.expectedVersionId) {
          return this.publishExactCampaignDraftInTransaction(transaction, workspaceId, campaignId, options.expectedVersionId);
        }
        // An exact repeat after a lost publish response is harmless, but an
        // unrelated editable draft must never be published or silently ignored.
        if (!drafts[0] && rows[0].currentVersionId === options.expectedVersionId
          && (await transaction<{ id: string }[]>`
            SELECT id FROM campaign_version WHERE id = ${options.expectedVersionId}
              AND campaign_id = ${campaignId} AND status = 'published'
          `).length) return true;
        throw new CampaignValidationError([{ code: "campaign_version_changed", message: "The reviewed Campaign version changed. Reload before publishing." }]);
      }
      if (!drafts[0]) return false;
      return this.publishExactCampaignDraftInTransaction(transaction, workspaceId, campaignId, drafts[0].id);
    });
    return published ? this.getCampaign(workspaceId, campaignId) : undefined;
  }

  /**
   * Publish only the selected draft identity, never a substitute. Draft content can
   * still change in place: this is NOT a content-revision CAS for user-facing
   * finalization. Preparation calls it only for its own uncommitted new draft.
   */
  async publishExactCampaignDraftInTransaction(
    transaction: TransactionSql,
    workspaceId: string,
    campaignId: string,
    expectedDraftVersionId: string,
  ): Promise<boolean> {
    const campaigns = await transaction<{ id: string }[]>`
      SELECT id FROM campaign WHERE id = ${campaignId} AND workspace_id = ${workspaceId} FOR UPDATE
    `;
    if (!campaigns[0]) return false;
    const drafts = await transaction<{ id: string }[]>`
      SELECT id FROM campaign_version
      WHERE id = ${expectedDraftVersionId} AND campaign_id = ${campaignId} AND status = 'draft' FOR UPDATE
    `;
    if (!drafts[0]) return false;
    await transaction`UPDATE campaign_version SET status = 'superseded' WHERE campaign_id = ${campaignId} AND status = 'published'`;
    await transaction`UPDATE campaign_version SET status = 'published', published_at = now() WHERE id = ${expectedDraftVersionId} AND status = 'draft'`;
    await transaction`UPDATE campaign SET current_version_id = ${expectedDraftVersionId}, updated_at = now() WHERE id = ${campaignId} AND workspace_id = ${workspaceId}`;
    return true;
  }

  async activateCampaign(input: {
    workspaceId: string;
    campaignId: string;
    actorUserId: string;
    expectedVersionId?: string;
  }): Promise<StoredCampaignInstance | undefined> {
    const instanceId = randomUUID();
    const created = await this.sql.begin(async (transaction) => {
      const rows = await transaction<
        {
          versionId: string;
          autonomyMode: string;
          destinationId?: string;
          brandProfileId?: string;
        }[]
      >`
        SELECT cv.id AS version_id, cv.autonomy_mode, cv.destination_id,
          brand_version.brand_profile_id
        FROM campaign c JOIN campaign_version cv ON cv.id = c.current_version_id
        LEFT JOIN brand_profile_version brand_version ON brand_version.id = cv.brand_profile_version_id
        WHERE c.id = ${input.campaignId} AND c.workspace_id = ${input.workspaceId} AND cv.status = 'published'
        FOR UPDATE OF c
      `;
      if (!rows[0]) {
        if (input.expectedVersionId && (await transaction<{ id: string }[]>`
          SELECT id FROM campaign WHERE id = ${input.campaignId} AND workspace_id = ${input.workspaceId} FOR UPDATE
        `).length) throw new CampaignValidationError([{ code: "campaign_version_changed", message: "The reviewed Campaign version is no longer published. Reload before activation." }]);
        return false;
      }
      if (input.expectedVersionId && input.expectedVersionId !== rows[0].versionId) {
        throw new CampaignValidationError([{ code: "campaign_version_changed", message: "The reviewed Campaign version changed. Reload before activation." }]);
      }
      // The immutable receipt, not an editable step input, decides whether proof
      // is mandatory. Lock the exact content before creating any run or outbox.
      try {
        await assertFinalizedCampaignPreviewInTransaction(transaction, {
          workspaceId: input.workspaceId, campaignId: input.campaignId, campaignVersionId: rows[0].versionId,
        }, { ...this.options, lockPreview: true });
      } catch (error) {
        if (error instanceof CampaignFinalizationProofError) throw new CampaignValidationError([{ code: error.code, message: error.message }]);
        throw error;
      }
      const executionSteps = await transaction<CampaignStep[]>`
        SELECT step_key AS id, name, operation_type, desired_capability, depends_on, inputs, outputs,
          execution_methods, approval_required, schedule_type, scheduled_at, preferred_window_start,
          preferred_window_end, dependency_delay_seconds, condition, max_attempts, timeout_seconds, optional
        FROM campaign_step WHERE campaign_version_id = ${rows[0].versionId}
      `;
      const executionIssues = validateCampaignExecution(rows[0].autonomyMode, executionSteps.map(normalizeStepScheduleFields), { allowBoundedScheduling: true });
      if (executionIssues.length) throw new CampaignValidationError(executionIssues);
      if (rows[0].destinationId) {
        const destinations = await transaction<{ status: string }[]>`
          SELECT status FROM destination
          WHERE id = ${rows[0].destinationId} AND workspace_id = ${input.workspaceId}
        `;
        if (destinations[0]?.status !== "published") {
          throw new CampaignValidationError([
            {
              code: "destination_not_published",
              message:
                "The campaign destination must be published and available before activation",
            },
          ]);
        }
      }
      const packageCheck = await transaction<{ invalid: number }[]>`
        SELECT count(*)::integer AS invalid FROM unnest((SELECT content_package_ids FROM campaign_version WHERE id = ${rows[0].versionId})) package_id
        WHERE NOT EXISTS (SELECT 1 FROM content_package p WHERE p.id = package_id AND p.workspace_id = ${input.workspaceId} AND p.status = 'approved')
      `;
      if (packageCheck[0].invalid > 0)
        throw new CampaignValidationError([
          {
            code: "content_package_not_approved",
            message:
              "Every campaign Content Package must be approved before activation",
          },
        ]);
      const previewSteps = await transaction<
        {
          stepKey: string;
          previewId: string;
          channelConnectionId?: string;
          appendDestination?: string;
          useTrackedLink?: string;
        }[]
      >`
        SELECT step_key, inputs->>'draftChannelPreviewId' AS preview_id,
          COALESCE(inputs->>'channelConnectionId', inputs->>'channel_connection_id') AS channel_connection_id,
          inputs->>'appendDestination' AS append_destination, inputs->>'useTrackedLink' AS use_tracked_link
        FROM campaign_step WHERE campaign_version_id = ${rows[0].versionId}
          AND inputs ? 'draftChannelPreviewId'
      `;
      for (const step of previewSteps) {
        if (step.appendDestination === "true" || step.useTrackedLink === "true")
          throw new CampaignValidationError([
            {
              code: "draft_channel_preview_exact_content",
              message: `Campaign step ${step.stepKey} cannot append or replace links after an exact channel preview is approved`,
            },
          ]);
        const eligible = await transaction<{ id: string }[]>`
          SELECT preview.id FROM draft_channel_preview preview
          JOIN content_draft draft ON draft.id = preview.content_draft_id AND draft.current_version_id = preview.content_draft_version_id
          JOIN content_draft_version version ON version.id = preview.content_draft_version_id AND version.status = 'approved'
          JOIN draft_generation generation ON generation.id = draft.draft_generation_id
          JOIN campaign_version source_version ON source_version.id = generation.campaign_version_id AND source_version.campaign_id = ${input.campaignId}
          JOIN channel_connection connection ON connection.id = preview.channel_connection_id
          LEFT JOIN tracked_link link ON link.draft_channel_preview_id = preview.id
          WHERE preview.id::text = ${step.previewId} AND preview.workspace_id = ${input.workspaceId}
            AND preview.status = 'ready' AND connection.status = 'active'
            AND connection.capabilities_observed_at = preview.capability_observed_at
            AND connection.capabilities = preview.capability_snapshot
            AND connection.provider = preview.provider
            AND (NOT EXISTS (SELECT 1 FROM draft_channel_preview_asset asset WHERE asset.draft_channel_preview_id = preview.id)
              OR preview.capability_snapshot->'features'->>'attachments' = 'true')
            AND NOT EXISTS (
              SELECT 1
              FROM draft_channel_preview_asset snapshot
              JOIN content_asset current_asset ON current_asset.id = snapshot.content_asset_id
              LEFT JOIN content_asset rights_source ON rights_source.id = current_asset.source_asset_id
              WHERE snapshot.draft_channel_preview_id = preview.id
                AND (
                  snapshot.rights_status <> 'cleared'
                  OR snapshot.rights_channel_connection_id IS DISTINCT FROM preview.channel_connection_id
                  OR snapshot.rights_campaign_id IS DISTINCT FROM ${input.campaignId}
                  OR snapshot.rights_brand_profile_id IS DISTINCT FROM ${rows[0].brandProfileId ?? null}::uuid
                  OR snapshot.scan_status <> 'clean'
                  OR snapshot.scan_revision <> CASE WHEN rights_source.id IS NULL
                    THEN current_asset.scan_revision ELSE rights_source.scan_revision END
                  OR CASE WHEN rights_source.id IS NULL
                    THEN current_asset.scan_status ELSE rights_source.scan_status END <> 'clean'
                  OR COALESCE(rights_source.scan_scanned_at, current_asset.scan_scanned_at) IS NULL
                  OR snapshot.rights_revision <> CASE WHEN rights_source.id IS NULL
                    THEN current_asset.rights_revision ELSE rights_source.rights_revision END
                  OR CASE WHEN rights_source.id IS NULL
                    THEN current_asset.rights_status ELSE rights_source.rights_status END <> 'cleared'
                  OR COALESCE(rights_source.rights_reviewed_at, current_asset.rights_reviewed_at) IS NULL
                  OR (COALESCE(rights_source.rights_valid_from, current_asset.rights_valid_from) IS NOT NULL
                    AND COALESCE(rights_source.rights_valid_from, current_asset.rights_valid_from) > now())
                  OR (COALESCE(rights_source.rights_expires_at, current_asset.rights_expires_at) IS NOT NULL
                    AND COALESCE(rights_source.rights_expires_at, current_asset.rights_expires_at) <= now())
                  OR NOT (preview.provider = ANY(CASE WHEN rights_source.id IS NULL
                    THEN current_asset.rights_permitted_channels ELSE rights_source.rights_permitted_channels END))
                  OR NOT EXISTS (
                    SELECT 1 FROM content_asset_rights_channel_connection scope
                    WHERE scope.content_asset_id = CASE WHEN rights_source.id IS NULL
                      THEN current_asset.id ELSE rights_source.id END
                      AND scope.channel_connection_id = preview.channel_connection_id
                  )
                  OR NOT EXISTS (
                    SELECT 1 FROM content_asset_rights_campaign campaign_scope
                    WHERE campaign_scope.content_asset_id = CASE WHEN rights_source.id IS NULL
                      THEN current_asset.id ELSE rights_source.id END
                      AND campaign_scope.campaign_id = ${input.campaignId}
                  )
                  OR NOT EXISTS (
                    SELECT 1 FROM content_asset_rights_brand_profile brand_scope
                    WHERE brand_scope.content_asset_id = CASE WHEN rights_source.id IS NULL
                      THEN current_asset.id ELSE rights_source.id END
                      AND brand_scope.brand_profile_id = ${rows[0].brandProfileId ?? null}::uuid
                  )
                )
            )
            AND (preview.link_mode = 'canonical' OR (link.id IS NOT NULL AND link.status = 'active'
              AND link.workspace_id = preview.workspace_id AND link.destination_id = preview.destination_id))
            AND preview.destination_id IS NOT DISTINCT FROM ${rows[0].destinationId ?? null}::uuid
            AND (${step.channelConnectionId ?? null}::text IS NULL OR preview.channel_connection_id::text = ${step.channelConnectionId ?? null})
        `;
        if (!eligible[0])
          throw new CampaignValidationError([
            {
              code: "draft_channel_preview_invalid",
              message: `Campaign step ${step.stepKey} requires a fresh ready preview from this Campaign, exact approved Draft version, selected channel, and Campaign Destination`,
            },
          ]);
      }
      await this.validateBoundedActivationRoutes(transaction, input.workspaceId, rows[0].versionId, executionSteps);
      const assistedSteps = await transaction<
        { stepKey: string; workerId?: string }[]
      >`
        SELECT step_key, inputs->>'companionWorkerId' AS worker_id
        FROM campaign_step
        WHERE campaign_version_id = ${rows[0].versionId}
          AND desired_capability = 'open_url' AND 'user_assisted' = ANY(execution_methods)
      `;
      for (const step of assistedSteps) {
        const eligible = await transaction<{ count: number }[]>`
          SELECT count(*)::integer AS count FROM browser_worker
          WHERE workspace_id = ${input.workspaceId} AND status = 'active'
            AND last_seen_at >= now() - interval '90 seconds'
            AND health_state IN ('healthy', 'working')
            AND capabilities->>'assistedOpenUrl' = 'true'
            AND (${step.workerId ?? null}::text IS NULL OR id::text = ${step.workerId ?? null})
        `;
        if (eligible[0].count !== 1)
          throw new CampaignValidationError([
            {
              code:
                eligible[0].count === 0
                  ? "companion_unavailable"
                  : "companion_selection_required",
              message:
                eligible[0].count === 0
                  ? `Campaign step ${step.stepKey} requires one healthy active companion with assistedOpenUrl`
                  : `Campaign step ${step.stepKey} must select companionWorkerId because multiple eligible companions are online`,
            },
          ]);
      }
      const status =
        rows[0].autonomyMode === "campaign_approval"
          ? "awaiting_approval"
          : "scheduled";
      // Last activation-time check uses a fresh clock after every validation wait.
      // Runtime/connector admission still rechecks; activation does not reserve a slot.
      const closedWindows = await transaction<{ stepKey: string }[]>`
        SELECT step_key FROM campaign_step WHERE campaign_version_id = ${rows[0].versionId}
          AND schedule_type = 'preferred_window' AND preferred_window_end <= clock_timestamp()
      `;
      if (closedWindows.length) throw new CampaignValidationError(closedWindows.map((step) => ({
        code: "execution_schedule_expired", stepId: step.stepKey,
        message: "A preferred request-start window has already closed. Publish a newly reviewed plan before activation.",
      })));
      await transaction`
        INSERT INTO campaign_instance (id, workspace_id, campaign_id, campaign_version_id, status, requested_by)
        VALUES (${instanceId}, ${input.workspaceId}, ${input.campaignId}, ${rows[0].versionId}, ${status}, ${input.actorUserId})
      `;
      const steps = await transaction<
        { id: string; stepKey: string; inputs: Record<string, unknown> }[]
      >`
        SELECT id, step_key, inputs FROM campaign_step WHERE campaign_version_id = ${rows[0].versionId}
      `;
      for (const step of steps)
        await transaction`
        INSERT INTO campaign_step_run (id, campaign_instance_id, campaign_step_id, idempotency_key, input)
        VALUES (${randomUUID()}, ${instanceId}, ${step.id}, ${`campaign:${instanceId}:step:${step.stepKey}`}, ${transaction.json(step.inputs as JSONValue)})
      `;
      await transaction`
        INSERT INTO campaign_workflow_command (id, workspace_id, campaign_instance_id, command_type, idempotency_key, actor_user_id)
        VALUES (${randomUUID()}, ${input.workspaceId}, ${instanceId}, 'start', ${`campaign:${instanceId}:start`}, ${input.actorUserId})
      `;
      await transaction`UPDATE campaign SET status = ${status}, updated_at = now() WHERE id = ${input.campaignId}`;
      return true;
    });
    return created
      ? this.getCampaignInstance(input.workspaceId, instanceId)
      : undefined;
  }

  async listCampaignInstances(
    workspaceId: string,
    campaignId?: string,
  ): Promise<StoredCampaignInstance[]> {
    const rows = campaignId
      ? await this.sql<
          Omit<StoredCampaignInstance, "stepRuns" | "approvals">[]
        >`
          SELECT id, workspace_id, campaign_id, campaign_version_id, status, temporal_workflow_id,
            temporal_run_id, context, requested_by, started_at, completed_at, created_at, updated_at
          FROM campaign_instance WHERE workspace_id = ${workspaceId} AND campaign_id = ${campaignId} ORDER BY created_at DESC`
      : await this.sql<
          Omit<StoredCampaignInstance, "stepRuns" | "approvals">[]
        >`
          SELECT id, workspace_id, campaign_id, campaign_version_id, status, temporal_workflow_id,
            temporal_run_id, context, requested_by, started_at, completed_at, created_at, updated_at
          FROM campaign_instance WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC`;
    return this.attachInstanceDetails(rows);
  }

  async getCampaignInstance(
    workspaceId: string,
    id: string,
  ): Promise<StoredCampaignInstance | undefined> {
    return (
      await this.attachInstanceDetails(
        await this.sql<
          Omit<StoredCampaignInstance, "stepRuns" | "approvals">[]
        >`
      SELECT id, workspace_id, campaign_id, campaign_version_id, status, temporal_workflow_id,
        temporal_run_id, context, requested_by, started_at, completed_at, created_at, updated_at
      FROM campaign_instance WHERE workspace_id = ${workspaceId} AND id = ${id}
    `,
      )
    )[0];
  }

  async queueInstanceCommand(input: {
    workspaceId: string;
    instanceId: string;
    commandType: CampaignWorkflowCommand["commandType"];
    payload?: Record<string, unknown>;
    idempotencyKey: string;
    actorUserId: string;
  }): Promise<boolean> {
    return this.sql.begin(async (transaction) => {
      const instances = await transaction<{ id: string; status: StoredCampaignInstance["status"] }[]>`
        SELECT id, status FROM campaign_instance WHERE id = ${input.instanceId} AND workspace_id = ${input.workspaceId} FOR NO KEY UPDATE
      `;
      if (!instances[0]) return false;
      if (input.commandType === "resume" || input.commandType === "manual_step_completed") {
        // Serialize control admission with status writes to the exact pinned runs.
        // A command admitted before a later block must still be checked by the workflow.
        const runs = await transaction<{ stepKey: string; status: StoredCampaignStepRun["status"] }[]>`
          SELECT step.step_key, run.status FROM campaign_step_run run
          JOIN campaign_instance instance ON instance.id = run.campaign_instance_id
          JOIN campaign_step step ON step.id = run.campaign_step_id AND step.campaign_version_id = instance.campaign_version_id
          WHERE instance.id = ${input.instanceId} AND instance.workspace_id = ${input.workspaceId}
          ORDER BY run.id FOR UPDATE OF run
        `;
        if (runs.some((run) => run.status === "schedule_blocked")) {
          throw new CampaignValidationError([{ code: "schedule_blocked", message: "This run contains schedule-blocked work. Cancel it and publish a newly reviewed plan; resume and manual completion cannot bypass the closed schedule." }]);
        }
        if (input.commandType === "manual_step_completed"
          && (!["active", "paused"].includes(instances[0].status)
            || typeof input.payload?.stepKey !== "string"
            || !runs.some((run) => run.stepKey === input.payload?.stepKey && run.status === "manual_resolution"))) {
          throw new CampaignValidationError([{ code: "manual_completion_unavailable", message: "Manual completion requires an active or paused run and its exact step awaiting manual resolution." }]);
        }
      }
      const rows = await transaction<{ id: string }[]>`
        INSERT INTO campaign_workflow_command (id, workspace_id, campaign_instance_id, command_type, idempotency_key, payload, actor_user_id)
        VALUES (${randomUUID()}, ${input.workspaceId}, ${input.instanceId}, ${input.commandType}, ${input.idempotencyKey}, ${transaction.json((input.payload ?? {}) as JSONValue)}, ${input.actorUserId})
        ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
      `;
      return Boolean(rows[0]);
    });
  }

  async claimWorkflowCommands(
    limit: number,
  ): Promise<CampaignWorkflowCommand[]> {
    return this.sql.begin(
      async (transaction) => transaction<CampaignWorkflowCommand[]>`
      WITH ready AS (
        SELECT id FROM campaign_workflow_command
        WHERE (status IN ('pending', 'failed') AND next_attempt_at <= now())
           OR (status = 'processing' AND claimed_at < now() - interval '5 minutes')
        ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
      )
      UPDATE campaign_workflow_command c SET status = 'processing', claimed_at = now(), attempt_count = attempt_count + 1
      FROM ready WHERE c.id = ready.id
      RETURNING c.id, c.workspace_id, c.campaign_instance_id, c.command_type, c.idempotency_key, c.payload, c.attempt_count
    `,
    );
  }

  async finishWorkflowCommand(id: string, error?: string): Promise<void> {
    if (!error) {
      await this
        .sql`UPDATE campaign_workflow_command SET status = 'completed', completed_at = now(), claimed_at = null, last_error = null WHERE id = ${id}`;
      return;
    }
    await this.sql`
      UPDATE campaign_workflow_command SET
        status = CASE WHEN attempt_count >= 6 THEN 'dead_letter' ELSE 'failed' END,
        next_attempt_at = now() + make_interval(secs => LEAST(900, 5 * power(2, attempt_count - 1))::integer),
        claimed_at = null, last_error = ${error.slice(0, 2000)}
      WHERE id = ${id}
    `;
  }

  async markWorkflowStarted(
    instanceId: string,
    workflowId: string,
    runId?: string,
  ): Promise<void> {
    await this.sql`
      UPDATE campaign_instance SET temporal_workflow_id = ${workflowId}, temporal_run_id = ${runId ?? null},
        status = CASE WHEN status = 'scheduled' THEN 'active' ELSE status END,
        started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = ${instanceId}
    `;
    await this
      .sql`UPDATE campaign SET status = (SELECT status FROM campaign_instance WHERE id = ${instanceId}), updated_at = now() WHERE id = (SELECT campaign_id FROM campaign_instance WHERE id = ${instanceId})`;
  }

  async setInstanceStatus(
    instanceId: string,
    status: StoredCampaignInstance["status"],
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      // Acquire the row first, then evaluate sibling blocks in a fresh statement
      // snapshot. A resume waiting behind a pause must not use pre-wait evidence.
      await transaction`SELECT id FROM campaign_instance WHERE id = ${instanceId} FOR NO KEY UPDATE`;
      await transaction`
      UPDATE campaign_instance SET status = ${status}, updated_at = now(),
        completed_at = CASE WHEN ${status} IN ('completed', 'failed', 'canceled') THEN COALESCE(completed_at, now()) ELSE completed_at END
      WHERE id = ${instanceId} AND status NOT IN ('completed', 'failed', 'canceled')
        AND (${!["scheduled", "active", "awaiting_approval"].includes(status)} OR NOT EXISTS (
          SELECT 1 FROM campaign_step_run blocked
          JOIN campaign_step step ON step.id = blocked.campaign_step_id
          WHERE blocked.campaign_instance_id = campaign_instance.id
            AND step.campaign_version_id = campaign_instance.campaign_version_id AND blocked.status = 'schedule_blocked'
        ))
      `;
    });
    await this
      .sql`UPDATE campaign SET status = (SELECT status FROM campaign_instance WHERE id = ${instanceId}), updated_at = now() WHERE id = (SELECT campaign_id FROM campaign_instance WHERE id = ${instanceId})`;
  }

  async getWorkflowDefinition(
    instanceId: string,
  ): Promise<CampaignWorkflowDefinition | undefined> {
    const rows = await this.sql<Omit<CampaignWorkflowDefinition, "steps">[]>`
      SELECT ci.id AS instance_id, ci.workspace_id, ci.campaign_id, ci.campaign_version_id,
        cv.timezone, cv.autonomy_mode, ci.context
      FROM campaign_instance ci JOIN campaign_version cv ON cv.id = ci.campaign_version_id
      WHERE ci.id = ${instanceId}
    `;
    if (!rows[0]) return undefined;
    const steps = await this.sql<(CampaignStep & { sortOrder: number })[]>`
      SELECT step_key AS id, name, operation_type, desired_capability, depends_on, inputs, outputs,
        execution_methods, approval_required, schedule_type, scheduled_at, preferred_window_start,
        preferred_window_end, dependency_delay_seconds, condition, max_attempts, timeout_seconds, optional, sort_order
      FROM campaign_step WHERE campaign_version_id = ${rows[0].campaignVersionId} ORDER BY sort_order
    `;
    return { ...rows[0], steps: steps.map(normalizeStepScheduleFields) };
  }

  /** Read the pinned step, same-instance predecessor evidence and one authoritative clock in one snapshot. */
  async getStepScheduleState(instanceId: string, stepKey: string): Promise<StoredStepScheduleState | undefined> {
    type ScheduleRow = {
      nowMs: number;
      workspaceId: string;
      campaignId: string;
      campaignInstanceId: string;
      campaignVersionId: string;
      campaignStepRunId: string;
      stepKey: string;
      scheduleType: StepScheduleInput["scheduleType"];
      dependsOn: string[];
      dependencyDelaySeconds: number;
      scheduledAtMs: number | null;
      preferredWindowStartMs: number | null;
      preferredWindowEndMs: number | null;
      predecessors: { stepKey: string; status: StepSchedulePredecessor["status"]; completedAtMs: number | null }[];
    };
    const rows = await this.sql<ScheduleRow[]>`
      WITH evaluation_clock AS MATERIALIZED (SELECT clock_timestamp() AS evaluated_at)
      SELECT (extract(epoch FROM evaluation_clock.evaluated_at) * 1000)::double precision AS now_ms,
        instance.workspace_id, instance.campaign_id, instance.id AS campaign_instance_id, instance.campaign_version_id, run.id AS campaign_step_run_id,
        step.step_key, step.schedule_type, step.depends_on, step.dependency_delay_seconds,
        ceil(extract(epoch FROM step.scheduled_at) * 1000)::double precision AS scheduled_at_ms,
        ceil(extract(epoch FROM step.preferred_window_start) * 1000)::double precision AS preferred_window_start_ms,
        floor(extract(epoch FROM step.preferred_window_end) * 1000)::double precision AS preferred_window_end_ms,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'stepKey', predecessor.step_key, 'status', COALESCE(completed.status, 'planned'),
            'completedAtMs', ceil(extract(epoch FROM completed.completed_at) * 1000)
          ) ORDER BY predecessor.step_key)
          FROM campaign_step predecessor
          LEFT JOIN campaign_step_run completed ON completed.campaign_step_id = predecessor.id
            AND completed.campaign_instance_id = instance.id
          WHERE predecessor.campaign_version_id = instance.campaign_version_id AND predecessor.step_key = ANY(step.depends_on)
        ), '[]'::jsonb) AS predecessors
      FROM campaign_instance instance
      JOIN campaign_step step ON step.campaign_version_id = instance.campaign_version_id AND step.step_key = ${stepKey}
      JOIN campaign_step_run run ON run.campaign_instance_id = instance.id AND run.campaign_step_id = step.id
      CROSS JOIN evaluation_clock
      WHERE instance.id = ${instanceId}
    `;
    const row = rows[0];
    if (!row) return undefined;
    // JavaScript supports milliseconds. Round lower bounds up and upper bounds
    // down, so historical PostgreSQL microseconds cannot authorize early/late I/O.
    const toIso = (value: number | null): string | undefined => value === null ? undefined : new Date(value).toISOString();
    const predecessors: StepSchedulePredecessor[] = row.predecessors.map((entry) => ({
      stepKey: entry.stepKey, status: entry.status, ...(entry.completedAtMs === null ? {} : { completedAt: toIso(entry.completedAtMs)! }),
    }));
    // A database-valid sub-millisecond window can disappear under inward
    // quantization. That is a proven empty executable interval, not malformed
    // authoring (the pure authoring validator must still reject reversed ranges).
    const collapsedWindow = row.scheduleType === "preferred_window" && row.preferredWindowStartMs !== null
      && row.preferredWindowEndMs !== null && row.preferredWindowStartMs >= row.preferredWindowEndMs;
    const state = collapsedWindow ? {
      state: "expired" as const, reason: "no_legal_time" as const,
      notBefore: toIso(row.preferredWindowStartMs)!, deadline: toIso(row.preferredWindowEndMs)!,
    } : evaluateStepSchedule({
      scheduleType: row.scheduleType, dependsOn: row.dependsOn, dependencyDelaySeconds: row.dependencyDelaySeconds,
      scheduledAt: toIso(row.scheduledAtMs), preferredWindowStart: toIso(row.preferredWindowStartMs), preferredWindowEnd: toIso(row.preferredWindowEndMs),
    }, predecessors, row.nowMs);
    return { ...state, evaluatedAt: new Date(row.nowMs).toISOString(), workspaceId: row.workspaceId, campaignId: row.campaignId, campaignInstanceId: row.campaignInstanceId,
      campaignVersionId: row.campaignVersionId, campaignStepRunId: row.campaignStepRunId, stepKey: row.stepKey, predecessors };
  }

  /** Recheck persisted policy and decisions for each activity, including activities queued by older workers. */
  async assertStepExecutionAuthorized(
    instanceId: string,
    stepKey: string,
    options: { allowBoundedScheduling?: boolean } = {},
  ): Promise<void> {
    const definition = await this.getWorkflowDefinition(instanceId);
    const step = definition?.steps.find((candidate) => candidate.id === stepKey);
    if (!definition || !step) throw new CampaignValidationError([{ code: "execution_target_missing", message: "Campaign execution target is unavailable." }]);
    const issues = validateCampaignExecution(definition.autonomyMode, definition.steps, options);
    if (issues.length) throw new CampaignValidationError(issues);
    // This read is an activity gate, not the transactional last-mile admission.
    // Publishing rechecks under its locks; both derive protection from provenance.
    // Keep it before the bounded-scheduling early return and legacy due checks.
    try {
      await assertFinalizedCampaignPreviewInTransaction(this.sql, {
        workspaceId: definition.workspaceId, campaignId: definition.campaignId,
        campaignVersionId: definition.campaignVersionId, stepKey,
      }, { ...this.options, lockPreview: false });
    } catch (error) {
      if (error instanceof CampaignFinalizationProofError) throw new CampaignValidationError([{ code: error.code, stepId: stepKey, message: error.message }]);
      throw error;
    }
    const authority = await this.sql<{ active: boolean; stepRunning: boolean; campaignApproved: boolean; stepApproved: boolean; scheduleDue: boolean; dependenciesReady: boolean }[]>`
      SELECT (i.status = 'active' AND NOT EXISTS (
          SELECT 1 FROM campaign_step_run blocked JOIN campaign_step blocked_step ON blocked_step.id = blocked.campaign_step_id
          WHERE blocked.campaign_instance_id = i.id AND blocked_step.campaign_version_id = i.campaign_version_id
            AND blocked.status = 'schedule_blocked'
        )) AS active, r.status = 'running' AS step_running,
        (s.schedule_type <> 'exact_time' OR s.scheduled_at <= clock_timestamp()) AS schedule_due,
        NOT EXISTS (
          SELECT 1 FROM unnest(s.depends_on) dependency(step_key) WHERE NOT EXISTS (
            SELECT 1 FROM campaign_step predecessor JOIN campaign_step_run completed ON completed.campaign_step_id = predecessor.id
            WHERE predecessor.campaign_version_id = i.campaign_version_id AND predecessor.step_key = dependency.step_key
              AND completed.campaign_instance_id = i.id AND completed.status IN ('succeeded', 'partially_succeeded')
          )
        ) AS dependencies_ready,
        EXISTS (SELECT 1 FROM campaign_approval a WHERE a.campaign_instance_id = i.id
          AND a.workspace_id = i.workspace_id AND a.campaign_step_run_id IS NULL AND a.status = 'approved'
          AND a.request_snapshot->>'campaignVersionId' = i.campaign_version_id::text) AS campaign_approved,
        EXISTS (SELECT 1 FROM campaign_approval a WHERE a.campaign_instance_id = i.id
          AND a.workspace_id = i.workspace_id AND a.campaign_step_run_id = r.id AND a.status = 'approved') AS step_approved
      FROM campaign_instance i JOIN campaign_step_run r ON r.campaign_instance_id = i.id
        JOIN campaign_step s ON s.id = r.campaign_step_id AND s.campaign_version_id = i.campaign_version_id
      WHERE i.id = ${instanceId} AND i.workspace_id = ${definition.workspaceId} AND s.step_key = ${stepKey}
    `;
    if (!authority[0]?.active || !authority[0].stepRunning) {
      throw new CampaignValidationError([{ code: "execution_not_active", stepId: stepKey, message: "Campaign and step must be actively running before execution." }]);
    }
    if (definition.autonomyMode === "campaign_approval" && !authority[0].campaignApproved) {
      throw new CampaignValidationError([{ code: "campaign_approval_required", message: "This campaign has not been approved for execution." }]);
    }
    if (campaignStepRequiresApproval(definition.autonomyMode, step) && !authority[0].stepApproved) {
      throw new CampaignValidationError([{ code: "step_approval_required", stepId: stepKey, message: "This campaign action has not been approved for execution." }]);
    }
    if (options.allowBoundedScheduling) {
      const schedule = await this.getStepScheduleState(instanceId, stepKey);
      if (!schedule) throw new CampaignValidationError([{ code: "execution_target_missing", stepId: stepKey, message: "Campaign execution schedule is unavailable." }]);
      if (schedule.state !== "ready") throw new CampaignScheduleNotReadyError(schedule);
      return;
    }
    if (!authority[0].scheduleDue) {
      throw new CampaignValidationError([{ code: "execution_not_due", stepId: stepKey, message: "This action's scheduled time has not arrived." }]);
    }
    if (!authority[0].dependenciesReady) {
      throw new CampaignValidationError([{ code: "execution_dependencies_incomplete", stepId: stepKey, message: "Required preceding campaign actions have not completed." }]);
    }
  }

  async setStepRunState(input: {
    instanceId: string;
    stepKey: string;
    status: StoredCampaignStepRun["status"];
    output?: Record<string, unknown>;
    error?: string;
  }): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const runs = await transaction<
        { id: string; attemptCount: number; input: Record<string, unknown> }[]
      >`
        UPDATE campaign_step_run r SET status = ${input.status},
          output = CASE WHEN r.status = 'schedule_blocked' THEN r.output WHEN ${input.output ? true : false} THEN ${transaction.json((input.output ?? {}) as JSONValue)} ELSE output END,
          last_error = CASE WHEN r.status = 'schedule_blocked' THEN r.last_error ELSE ${input.error ?? null} END,
          attempt_count = CASE WHEN ${input.status} = 'running' AND r.status <> 'running' THEN attempt_count + 1 ELSE attempt_count END,
          started_at = CASE WHEN ${input.status} = 'running' THEN COALESCE(started_at, now()) ELSE started_at END,
          completed_at = CASE WHEN ${input.status} IN ('succeeded', 'partially_succeeded', 'permanently_failed', 'canceled', 'rolled_back', 'schedule_blocked') THEN COALESCE(completed_at, clock_timestamp()) ELSE completed_at END,
          updated_at = now()
        FROM campaign_step s
        WHERE r.campaign_step_id = s.id AND r.campaign_instance_id = ${input.instanceId} AND s.step_key = ${input.stepKey}
          AND EXISTS (SELECT 1 FROM campaign_instance instance WHERE instance.id = r.campaign_instance_id AND instance.campaign_version_id = s.campaign_version_id)
          AND (r.status NOT IN ('succeeded', 'partially_succeeded', 'permanently_failed', 'canceled', 'rolled_back', 'schedule_blocked')
            OR (r.status = 'schedule_blocked' AND ${input.status} = 'canceled'))
        RETURNING r.id, r.attempt_count, r.input
      `;
      const run = runs[0];
      if (!run || run.attemptCount === 0) return;
      if (input.status === "running") {
        await transaction`
          INSERT INTO campaign_step_attempt (id, campaign_step_run_id, attempt_number, status, input)
          VALUES (${randomUUID()}, ${run.id}, ${run.attemptCount}, 'running', ${transaction.json(run.input as JSONValue)})
          ON CONFLICT (campaign_step_run_id, attempt_number) DO NOTHING
        `;
        return;
      }
      const attemptStatus =
        input.status === "succeeded" || input.status === "partially_succeeded"
          ? "succeeded"
          : input.status === "temporarily_failed"
            ? "temporarily_failed"
            : input.status === "permanently_failed" || input.status === "schedule_blocked"
              ? "permanently_failed"
              : input.status === "canceled"
                ? "canceled"
                : undefined;
      if (!attemptStatus) return;
      await transaction`
        UPDATE campaign_step_attempt SET status = ${attemptStatus},
          output = CASE WHEN ${input.output ? true : false} THEN ${transaction.json((input.output ?? {}) as JSONValue)} ELSE output END,
          error_code = CASE WHEN ${input.status} = 'schedule_blocked' THEN 'CAMPAIGN_SCHEDULE_BLOCKED' WHEN ${input.error ? true : false} THEN 'CAMPAIGN_STEP_ERROR' ELSE null END,
          error_message = ${input.error ?? null}, completed_at = COALESCE(completed_at, now())
        WHERE campaign_step_run_id = ${run.id} AND attempt_number = ${run.attemptCount}
          AND status = 'running'
      `;
    });
  }

  async ensureStepApproval(input: {
    instanceId: string;
    stepKey: string;
    snapshot: Record<string, unknown>;
  }): Promise<string> {
    return this.sql.begin(async (transaction) => {
      if (input.stepKey === "__campaign__") {
        const instances = await transaction<{ workspaceId: string; requestedBy: string }[]>`
          SELECT workspace_id, requested_by FROM campaign_instance WHERE id = ${input.instanceId} FOR UPDATE
        `;
        if (!instances[0]) throw new Error("Campaign instance not found");
        const existing = await transaction<{ id: string }[]>`
          SELECT id FROM campaign_approval WHERE campaign_instance_id = ${input.instanceId}
            AND campaign_step_run_id IS NULL ORDER BY created_at DESC LIMIT 1
        `;
        if (existing[0]) return existing[0].id;
        const id = randomUUID();
        await transaction`
          INSERT INTO campaign_approval (id, workspace_id, campaign_instance_id, request_snapshot, requested_by)
          VALUES (${id}, ${instances[0].workspaceId}, ${input.instanceId},
            ${transaction.json(input.snapshot as JSONValue)}, ${instances[0].requestedBy})
        `;
        return id;
      }
      const rows = await transaction<
        { runId: string; workspaceId: string; requestedBy: string; status: StoredCampaignStepRun["status"] }[]
      >`
        SELECT r.id AS run_id, i.workspace_id, i.requested_by, r.status
        FROM campaign_step_run r
        JOIN campaign_step s ON s.id = r.campaign_step_id
        JOIN campaign_instance i ON i.id = r.campaign_instance_id
        WHERE i.id = ${input.instanceId} AND s.step_key = ${input.stepKey}
        FOR UPDATE OF r
      `;
      if (!rows[0]) throw new Error("Campaign step run not found");
      const existing = await transaction<{ id: string }[]>`
        SELECT id FROM campaign_approval WHERE campaign_instance_id = ${input.instanceId}
          AND campaign_step_run_id = ${rows[0].runId} ORDER BY created_at DESC LIMIT 1
      `;
      if (existing[0]) return existing[0].id;
      if (["succeeded", "partially_succeeded", "permanently_failed", "canceled", "rolled_back", "schedule_blocked"].includes(rows[0].status)) {
        throw new CampaignValidationError([{ code: "execution_terminal", stepId: input.stepKey, message: "A terminal campaign step cannot be returned to approval waiting." }]);
      }
      const id = randomUUID();
      await transaction`
        INSERT INTO campaign_approval (
          id, workspace_id, campaign_instance_id, campaign_step_run_id, request_snapshot, requested_by
        ) VALUES (
          ${id}, ${rows[0].workspaceId}, ${input.instanceId}, ${rows[0].runId},
          ${transaction.json(input.snapshot as JSONValue)}, ${rows[0].requestedBy}
        )
      `;
      await transaction`UPDATE campaign_step_run SET status = 'waiting', updated_at = now() WHERE id = ${rows[0].runId}`;
      return id;
    });
  }

  async decideApproval(input: {
    workspaceId: string;
    approvalId: string;
    decision: "approved" | "rejected" | "changes_requested";
    notes?: string;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<boolean> {
    return this.sql.begin(async (transaction) => {
      const rows = await transaction<{ instanceId: string; stepKey: string }[]>`
        WITH decided AS (
          UPDATE campaign_approval SET status = ${input.decision}, decided_by = ${input.actorUserId},
            decision_notes = ${input.notes ?? null}, decided_at = now()
          WHERE id = ${input.approvalId} AND workspace_id = ${input.workspaceId} AND status = 'pending'
          RETURNING campaign_instance_id, campaign_step_run_id
        )
        SELECT decided.campaign_instance_id AS instance_id,
          CASE WHEN decided.campaign_step_run_id IS NULL THEN '__campaign__' ELSE s.step_key END AS step_key
        FROM decided LEFT JOIN campaign_step_run r ON r.id = decided.campaign_step_run_id
          LEFT JOIN campaign_step s ON s.id = r.campaign_step_id
      `;
      if (!rows[0]) return false;
      await transaction`
        INSERT INTO campaign_workflow_command (
          id, workspace_id, campaign_instance_id, command_type, idempotency_key, payload, actor_user_id
        ) VALUES (
          ${randomUUID()}, ${input.workspaceId}, ${rows[0].instanceId}, 'approval_decision', ${input.idempotencyKey},
          ${transaction.json({ stepKey: rows[0].stepKey, decision: input.decision, approvalId: input.approvalId } as JSONValue)}, ${input.actorUserId}
        ) ON CONFLICT (idempotency_key) DO NOTHING
      `;
      return true;
    });
  }

  async listApprovals(
    workspaceId: string,
    status?: StoredCampaignApproval["status"],
  ): Promise<StoredCampaignApproval[]> {
    return status
      ? this.sql<StoredCampaignApproval[]>`
          SELECT id, campaign_instance_id, campaign_step_run_id, status, request_snapshot, conditions,
            requested_by, assigned_reviewer_id, decided_by, decision_notes, due_at, created_at, decided_at
          FROM campaign_approval WHERE workspace_id = ${workspaceId} AND status = ${status} ORDER BY created_at`
      : this.sql<StoredCampaignApproval[]>`
          SELECT id, campaign_instance_id, campaign_step_run_id, status, request_snapshot, conditions,
            requested_by, assigned_reviewer_id, decided_by, decision_notes, due_at, created_at, decided_at
          FROM campaign_approval WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC`;
  }

  private assertGraph(steps: CampaignDraftWrite["steps"]): void {
    const result = validateCampaignGraph(
      steps.map((step) => ({ ...step, outputs: step.outputs ?? {} })),
    );
    if (!result.valid) throw new CampaignValidationError(result.issues);
  }

  private async validateBoundedActivationRoutes(
    transaction: TransactionSql, workspaceId: string, versionId: string, steps: readonly CampaignStep[],
  ): Promise<void> {
    const bounded = steps.some((step) => step.scheduleType === "preferred_window" || (step.dependencyDelaySeconds ?? 0) > 0);
    if (!bounded) return;
    // The companion queue still uses the legacy whole-definition authority gate.
    // Reject the mixed campaign too, not merely a delayed companion step, so a
    // required immediate companion predecessor cannot become a runtime dead end.
    const companionSteps = steps.filter((step) => step.executionMethods.includes("user_assisted"));
    if (companionSteps.length) throw new CampaignValidationError(companionSteps.map((step) => ({
      code: "bounded_companion_unsupported", stepId: step.id,
      message: "Campaigns with preferred windows or positive dependency delays cannot include companion execution yet. Keep this plan saved until companion queue timing is supported.",
    })));
    for (const step of steps.filter((candidate) => candidate.scheduleType === "preferred_window")) {
      const selected = (await transaction<{
        provider?: string; status?: string; capabilities?: Record<string, unknown>; attachmentCount: number;
      }[]>`
        SELECT connection.provider, connection.status, connection.capabilities,
          (SELECT count(*)::integer FROM draft_channel_preview_asset asset WHERE asset.draft_channel_preview_id = preview.id) AS attachment_count
        FROM campaign_step step
        LEFT JOIN draft_channel_preview preview ON preview.id::text = step.inputs->>'draftChannelPreviewId' AND preview.workspace_id = ${workspaceId}
        LEFT JOIN channel_connection connection ON connection.id::text = COALESCE(step.inputs->>'channelConnectionId', step.inputs->>'channel_connection_id', preview.channel_connection_id::text)
          AND connection.workspace_id = ${workspaceId}
        WHERE step.campaign_version_id = ${versionId} AND step.step_key = ${step.id}
      `)[0];
      const issue = preferredWindowRouteIssue({
        operationType: step.operationType ?? "manual_handoff", executionMethods: step.executionMethods,
        provider: selected?.provider, attachmentCount: selected?.attachmentCount ?? 0,
      });
      if (issue) throw new CampaignValidationError([{ code: "preferred_window_route_unsupported", stepId: step.id, message: issue }]);
      const supportedActions = selected?.capabilities?.supportedActions as Record<string, unknown> | undefined;
      const supportedMethods = selected?.capabilities?.executionMethods;
      if (selected?.status !== "active" || (supportedActions?.publish_content ?? supportedActions?.publishContent) !== true
        || !Array.isArray(supportedMethods) || !supportedMethods.includes("official_api")) throw new CampaignValidationError([{
        code: "preferred_window_connection_unavailable", stepId: step.id,
        message: "Preferred-window activation requires an active workspace channel with verified publishing capability.",
      }]);
      if (selected.provider !== "discord_webhook" && typeof step.inputs.draftChannelPreviewId !== "string") throw new CampaignValidationError([{
        code: "draft_channel_preview_required", stepId: step.id, message: "This preferred-window provider requires an exact approved Draft preview.",
      }]);
      if (typeof step.inputs.draftChannelPreviewId !== "string" && (typeof step.inputs.content !== "string" || !step.inputs.content.trim())) throw new CampaignValidationError([{
        code: "publication_content_required", stepId: step.id, message: "Preferred-window publication requires nonempty exact content.",
      }]);
    }
  }

  private async validateReferences(
    transaction: TransactionSql,
    input: CampaignDraftWrite,
  ): Promise<void> {
    if (input.destinationId) {
      const destinations = await transaction<
        { id: string }[]
      >`SELECT id FROM destination WHERE id = ${input.destinationId} AND workspace_id = ${input.workspaceId}`;
      if (!destinations[0])
        throw new Error(
          "Campaign destination does not belong to this workspace",
        );
    }
    if (input.contentPackageIds.length) {
      const packages = await transaction<{ count: number }[]>`
        SELECT count(*)::integer AS count FROM content_package WHERE workspace_id = ${input.workspaceId} AND id IN ${transaction([...input.contentPackageIds])}
      `;
      if (packages[0].count !== new Set(input.contentPackageIds).size)
        throw new Error("A Content Package does not belong to this workspace");
    }
    const policyInputs: CommunicationPolicyInput[] = [];
    if (input.brandProfileVersionId) {
      const versions = await transaction<
        {
          id: string;
          name: string;
          informationDepthDefault?: CampaignDraftWrite["informationDepth"];
          informationDepthCeiling?: Exclude<
            CampaignDraftWrite["informationDepth"],
            "custom"
          >;
          promotionalStrengthDefault?: CampaignDraftWrite["promotionalStrength"];
          promotionalStrengthCeiling?: Exclude<
            CampaignDraftWrite["promotionalStrength"],
            "custom"
          >;
        }[]
      >`
        SELECT v.id, p.name, v.information_depth_default, v.information_depth_ceiling, v.promotional_strength_default, v.promotional_strength_ceiling
        FROM brand_profile_version v JOIN brand_profile p ON p.id = v.brand_profile_id
        WHERE v.id = ${input.brandProfileVersionId} AND p.workspace_id = ${input.workspaceId} AND v.status IN ('published', 'superseded')
      `;
      if (!versions[0])
        throw new CampaignValidationError([
          {
            code: "brand_profile_version_invalid",
            message:
              "The pinned Brand Profile version must be published and belong to this workspace.",
          },
        ]);
      policyInputs.push({
        source: `${versions[0].name} Brand Profile`,
        level: "brand",
        informationDepth: versions[0].informationDepthDefault,
        informationDepthCeiling: versions[0].informationDepthCeiling,
        promotionalStrength: versions[0].promotionalStrengthDefault,
        promotionalStrengthCeiling: versions[0].promotionalStrengthCeiling,
      });
    }
    if (input.audienceProfileVersionIds.length) {
      if (
        new Set(input.audienceProfileVersionIds).size !==
        input.audienceProfileVersionIds.length
      )
        throw new CampaignValidationError([
          {
            code: "audience_profile_duplicate",
            message:
              "A Campaign cannot pin the same Audience Profile version more than once.",
          },
        ]);
      const versions = await transaction<
        {
          id: string;
          name: string;
          informationDepthDefault?: CampaignDraftWrite["informationDepth"];
          informationDepthCeiling?: Exclude<
            CampaignDraftWrite["informationDepth"],
            "custom"
          >;
          promotionalStrengthDefault?: CampaignDraftWrite["promotionalStrength"];
          promotionalStrengthCeiling?: Exclude<
            CampaignDraftWrite["promotionalStrength"],
            "custom"
          >;
        }[]
      >`
        SELECT v.id, p.name, v.information_depth_default, v.information_depth_ceiling, v.promotional_strength_default, v.promotional_strength_ceiling
        FROM audience_profile_version v JOIN audience_profile p ON p.id = v.audience_profile_id
        WHERE p.workspace_id = ${input.workspaceId} AND v.status IN ('published', 'superseded') AND v.id IN ${transaction([...input.audienceProfileVersionIds])}
      `;
      if (versions.length !== input.audienceProfileVersionIds.length)
        throw new CampaignValidationError([
          {
            code: "audience_profile_version_invalid",
            message:
              "Every pinned Audience Profile version must be published and belong to this workspace.",
          },
        ]);
      for (const version of versions)
        policyInputs.push({
          source: `${version.name} Audience Profile`,
          level: "audience",
          informationDepth: version.informationDepthDefault,
          informationDepthCeiling: version.informationDepthCeiling,
          promotionalStrength: version.promotionalStrengthDefault,
          promotionalStrengthCeiling: version.promotionalStrengthCeiling,
        });
    }
    const resolved = resolveCommunicationPolicy([
      ...policyInputs,
      {
        source: "Campaign",
        level: "campaign",
        informationDepth: input.informationDepth,
        promotionalStrength: input.promotionalStrength,
      },
    ]);
    if (resolved.issues.length)
      throw new CampaignValidationError(
        resolved.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
        })),
      );
  }

  private async insertVersion(
    transaction: TransactionSql,
    campaignId: string,
    versionId: string,
    versionNumber: number,
    input: CampaignDraftWrite,
    actorUserId: string,
  ): Promise<void> {
    await transaction`
      INSERT INTO campaign_version (
        id, campaign_id, version_number, objective, content_package_ids, destination_id,
        information_depth, promotional_strength, autonomy_mode, timezone, context, created_by
      ) VALUES (
        ${versionId}, ${campaignId}, ${versionNumber}, ${input.objective}, ${[...input.contentPackageIds]}, ${input.destinationId ?? null},
        ${input.informationDepth}, ${input.promotionalStrength}, ${input.autonomyMode}, ${input.timezone},
        ${transaction.json(input.context as JSONValue)}, ${actorUserId}
      )
    `;
    await transaction`
      UPDATE campaign_version SET
        success_criteria = ${transaction.json((input.successCriteria ?? []) as unknown as JSONValue)},
        success_action = ${input.successAction ?? "notify_only"}
      WHERE id = ${versionId}
    `;
    if (input.brandProfileVersionId)
      await transaction`UPDATE campaign_version SET brand_profile_version_id = ${input.brandProfileVersionId} WHERE id = ${versionId}`;
    await this.insertAudienceBindings(
      transaction,
      versionId,
      input.audienceProfileVersionIds,
    );
    await this.insertSteps(transaction, versionId, input.steps);
  }

  private async insertAudienceBindings(
    transaction: TransactionSql,
    versionId: string,
    audienceProfileVersionIds: readonly string[],
  ): Promise<void> {
    for (const [
      sortOrder,
      profileVersionId,
    ] of audienceProfileVersionIds.entries())
      await transaction`
      INSERT INTO campaign_version_audience_profile (campaign_version_id, audience_profile_version_id, sort_order)
      VALUES (${versionId}, ${profileVersionId}, ${sortOrder})
    `;
  }

  private async insertSteps(
    transaction: TransactionSql,
    versionId: string,
    steps: CampaignDraftWrite["steps"],
  ): Promise<void> {
    for (const [sortOrder, step] of steps.entries())
      await transaction`
      INSERT INTO campaign_step (
        id, campaign_version_id, step_key, name, operation_type, desired_capability,
        depends_on, inputs, outputs, execution_methods, approval_required, schedule_type,
        scheduled_at, preferred_window_start, preferred_window_end, dependency_delay_seconds, condition,
        max_attempts, timeout_seconds, optional, sort_order
      ) VALUES (
        ${randomUUID()}, ${versionId}, ${step.id}, ${step.name}, ${step.operationType ?? "manual_handoff"}, ${step.desiredCapability},
        ${[...step.dependsOn]}, ${transaction.json(step.inputs as JSONValue)}, ${transaction.json((step.outputs ?? {}) as JSONValue)},
        ${[...step.executionMethods]}, ${step.approvalRequired}, ${step.scheduleType ?? "immediate"},
        ${step.scheduledAt ?? null}, ${step.preferredWindowStart ?? null}, ${step.preferredWindowEnd ?? null},
        ${step.dependencyDelaySeconds ?? 0},
        ${transaction.json((step.condition ?? {}) as JSONValue)}, ${step.maxAttempts ?? 3}, ${step.timeoutSeconds ?? 300},
        ${step.optional ?? false}, ${sortOrder}
      )
    `;
  }

  private async attachCampaignVersions(
    rows: readonly CampaignRow[],
  ): Promise<StoredCampaign[]> {
    if (!rows.length) return [];
    const campaignIds = rows.map((row) => row.id);
    const versions = await this.sql<VersionRow[]>`
      SELECT id, campaign_id, version_number, status, objective, content_package_ids, destination_id,
        brand_profile_version_id, information_depth, promotional_strength, autonomy_mode, timezone, context,
        success_criteria, success_action, created_at, published_at
      FROM campaign_version WHERE campaign_id IN ${this.sql(campaignIds)} AND status IN ('draft', 'published') ORDER BY version_number
    `;
    const versionIds = versions.map((version) => version.id);
    const steps = versionIds.length
      ? await this.sql<
          (CampaignStep & { campaignVersionId: string; sortOrder: number })[]
        >`
      SELECT step_key AS id, campaign_version_id, name, operation_type, desired_capability, depends_on,
        inputs, outputs, execution_methods, approval_required, schedule_type, scheduled_at,
        preferred_window_start, preferred_window_end, dependency_delay_seconds, condition, max_attempts, timeout_seconds, optional, sort_order
      FROM campaign_step WHERE campaign_version_id IN ${this.sql(versionIds)} ORDER BY sort_order
    `
      : [];
    const audienceBindings = versionIds.length
      ? await this.sql<
          { campaignVersionId: string; audienceProfileVersionId: string }[]
        >`
      SELECT campaign_version_id, audience_profile_version_id FROM campaign_version_audience_profile
      WHERE campaign_version_id IN ${this.sql(versionIds)} ORDER BY campaign_version_id, sort_order
    `
      : [];
    const hydrated = versions.map((version) => ({
      ...version,
      audienceProfileVersionIds: audienceBindings
        .filter((binding) => binding.campaignVersionId === version.id)
        .map((binding) => binding.audienceProfileVersionId),
      steps: steps.filter((step) => step.campaignVersionId === version.id).map(normalizeStepScheduleFields),
    }));
    return rows.map(({ currentVersionId, ...row }) => ({
      ...row,
      currentVersion: hydrated.find(
        (version) => version.id === currentVersionId,
      ),
      draftVersion: hydrated.find(
        (version) =>
          version.campaignId === row.id && version.status === "draft",
      ),
    }));
  }

  private async attachInstanceDetails(
    rows: readonly Omit<StoredCampaignInstance, "stepRuns" | "approvals">[],
  ): Promise<StoredCampaignInstance[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const stepRuns = await this.sql<StoredCampaignStepRun[]>`
      SELECT r.id, r.campaign_instance_id, r.campaign_step_id, s.step_key, s.name AS step_name,
        r.status, r.idempotency_key, r.input, r.output, r.attempt_count, r.last_error, r.started_at, r.completed_at
      FROM campaign_step_run r JOIN campaign_step s ON s.id = r.campaign_step_id
      WHERE r.campaign_instance_id IN ${this.sql(ids)} ORDER BY s.sort_order
    `;
    const approvals = await this.sql<StoredCampaignApproval[]>`
      SELECT id, campaign_instance_id, campaign_step_run_id, status, request_snapshot, conditions,
        requested_by, assigned_reviewer_id, decided_by, decision_notes, due_at, created_at, decided_at
      FROM campaign_approval WHERE campaign_instance_id IN ${this.sql(ids)} ORDER BY created_at
    `;
    return rows.map((row) => ({
      ...row,
      stepRuns: stepRuns.filter((run) => run.campaignInstanceId === row.id),
      approvals: approvals.filter(
        (approval) => approval.campaignInstanceId === row.id,
      ),
    }));
  }
}

function normalizeStepScheduleFields<T extends CampaignStep>(step: T): T {
  return {
    ...step,
    dependencyDelaySeconds: step.dependencyDelaySeconds ?? 0,
    scheduledAt: step.scheduledAt ? new Date(step.scheduledAt).toISOString() : undefined,
    preferredWindowStart: step.preferredWindowStart ? new Date(step.preferredWindowStart).toISOString() : undefined,
    preferredWindowEnd: step.preferredWindowEnd ? new Date(step.preferredWindowEnd).toISOString() : undefined,
  };
}
