import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { JSONValue } from "postgres";
import {
  evaluateCampaignSuccess,
  MEASUREMENT_EVENT_TYPES,
  type CampaignSuccessCriterion,
  type CampaignSuccessEvaluation,
  type ProviderAggregateMetricType,
  type MeasurementEventType,
} from "@market-me/domain";
import type { DatabaseClient } from "./client";
import type { StoredDraftPreviewAsset } from "./models";
import { CampaignRepository, CampaignValidationError } from "./campaign-repository";

export type ChannelProvider = "discord_webhook" | "mailchimp_email" | "slack_webhook" | "mastodon_account";
export type { MeasurementEventType } from "@market-me/domain";

export interface StoredChannelConnection {
  id: string;
  workspaceId: string;
  provider: ChannelProvider;
  name: string;
  status: "active" | "error" | "revoked";
  encryptedCredentials: string;
  configuration: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  capabilitiesObservedAt?: string;
  lastTestedAt?: string;
  lastError?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredPublicationAction {
  id: string;
  workspaceId: string;
  campaignInstanceId: string;
  campaignStepRunId: string;
  channelConnectionId: string;
  provider?: ChannelProvider;
  actionType: "publish_content";
  status: "dispatching" | "succeeded" | "failed" | "ambiguous";
  idempotencyKey: string;
  requestSnapshot: Record<string, unknown>;
  providerExternalId?: string;
  providerUrl?: string;
  responseMetadata: Record<string, unknown>;
  lastError?: string;
}

export interface StoredMastodonPublicationMedia {
  publicationActionId: string;
  ordinal: number;
  contentAssetId: string;
  contentHash: string;
  providerMediaId: string;
  createdAt: string;
}

export interface MastodonStatusReportInput {
  statusId: string;
  accountId: string;
  statusUrl: string;
  repliesCount: number;
  reblogsCount: number;
  favouritesCount: number;
  statusCreatedAt: string;
}

export interface StoredMastodonStatusReportSnapshot extends MastodonStatusReportInput {
  id: string;
  workspaceId: string;
  publicationActionId: string;
  snapshotHash: string;
  observedAt: string;
}

export interface MastodonStatusReportCollectionTarget {
  workspaceId: string;
  publicationActionId: string;
  providerStatusId: string;
  providerAccountId: string;
  providerStatusUrl: string;
  instanceOrigin: string;
  encryptedCredentials: string;
  actorUserId: string;
  attemptCount: number;
}

export class MastodonReportCollectionClaimLostError extends Error {
  constructor() {
    super("Mastodon report collection claim was superseded");
    this.name = "MastodonReportCollectionClaimLostError";
  }
}

export interface StoredMastodonStatusReportCollectionState {
  publicationActionId: string;
  nextAttemptAt: string;
  attemptCount: number;
  claimedAt?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastErrorCode?: string;
  operationalStatus: "pending" | "scheduled" | "retrying" | "overdue" | "collecting" | "abandoned";
}

export interface MastodonStatusReportCollectionOperationsSummary {
  total: number;
  pending: number;
  scheduled: number;
  retrying: number;
  overdue: number;
  collecting: number;
  abandoned: number;
  oldestOverdueAt?: string;
  oldestAbandonedClaimAt?: string;
}

export interface StoredMastodonStatusReportCollectionAlert {
  id: string;
  alertType: "overdue" | "abandoned";
  status: "active" | "resolved";
  affectedCount: number;
  oldestAt: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt?: string;
}

export interface MastodonStatusReportCollectionAlertReconciliationResult {
  active: number;
  resolved: number;
}

export interface MailchimpCampaignReportInput {
  campaignId: string;
  audienceId: string;
  emailsSent: number;
  opensTotal: number;
  uniqueOpens: number;
  clicksTotal: number;
  uniqueClicks: number;
  unsubscribed: number;
  hardBounces: number;
  softBounces: number;
  abuseReports: number;
  sendTime: string;
}

export interface StoredMailchimpCampaignReportSnapshot extends MailchimpCampaignReportInput {
  id: string;
  workspaceId: string;
  publicationActionId: string;
  snapshotHash: string;
  observedAt: string;
}

export interface MailchimpReportCollectionTarget {
  workspaceId: string;
  publicationActionId: string;
  providerCampaignId: string;
  audienceId: string;
  encryptedCredentials: string;
  actorUserId: string;
  attemptCount: number;
}

export interface StoredMailchimpReportCollectionState {
  publicationActionId: string;
  nextAttemptAt: string;
  attemptCount: number;
  claimedAt?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastErrorCode?: string;
  lastWebhookReceivedAt?: string;
  webhookWakeupCount: string;
}

export interface MailchimpWebhookTarget {
  workspaceId: string;
  connectionId: string;
  audienceId: string;
  encryptedCredentials: string;
}

export interface MailchimpWebhookHealthCheckTarget {
  workspaceId: string;
  connectionId: string;
  audienceId: string;
  expectedCallbackUrl: string;
  providerWebhookId: string;
  encryptedCredentials: string;
  attemptCount: number;
}

export interface StoredMailchimpWebhookHealthState {
  connectionId: string;
  nextCheckAt: string;
  attemptCount: string;
  claimedAt?: string;
  lastCheckedAt?: string;
  lastHealthCode?: "managed_active" | "managed_missing" | "managed_drifted" | "managed_secret_missing";
  consecutiveFailureCount: string;
  lastErrorCode?: string;
}

export interface CampaignExecutionTarget {
  workspaceId: string;
  campaignId: string;
  campaignInstanceId: string;
  campaignStepRunId: string;
  brandProfileId?: string;
  requestedBy: string;
  stepKey: string;
  operationType: string;
  channelConnectionId?: string;
  destinationId?: string;
  desiredCapability: string;
  approvalRequired: boolean;
  humanApprovalGranted: boolean;
  executionMethods: string[];
  destinationUrl?: string;
  input: Record<string, unknown>;
  connection?: StoredChannelConnection;
  draftPreviewContent?: string;
  draftPreviewSubject?: string;
  draftPreviewVersionId?: string;
  draftPreviewEligible?: boolean;
  draftPreviewTrackedLinkId?: string;
  draftPreviewAssets?: readonly StoredDraftPreviewAsset[];
}

export interface StoredTrackedLink {
  id: string;
  workspaceId: string;
  destinationId: string;
  campaignInstanceId?: string;
  campaignStepRunId?: string;
  draftChannelPreviewId?: string;
  slug: string;
  canonicalUrl: string;
  utmParameters: Record<string, string>;
  status: "active" | "disabled" | "expired";
  expiresAt?: string;
  createdAt: string;
}

export interface CampaignSuccessTransition {
  status: "pending" | "processing" | "completed" | "failed" | "dead_letter";
  queuedAt: string;
  deliveredAt?: string;
}

export interface MeasurementSummary {
  campaignInstanceId: string;
  totals: Readonly<Record<string, { count: number; value: number }>>;
  providerTotals: Readonly<Record<string, number>>;
  currencyTotals: Readonly<Record<string, Readonly<Record<string, number>>>>;
  criteria: readonly CampaignSuccessEvaluation[];
  allCriteriaMet: boolean;
  successTransition?: CampaignSuccessTransition;
  firstEventAt?: string;
  lastEventAt?: string;
  lastProviderObservedAt?: string;
}

export type MeasurementKeyStatus = "active" | "expired" | "revoked";

export interface StoredMeasurementKey {
  id: string;
  name: string;
  keyPrefix: string;
  status: MeasurementKeyStatus;
  allowedEventTypes: readonly MeasurementEventType[];
  campaignScopeMode: "all" | "restricted";
  allowedCampaignIds: readonly string[];
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
}

export interface MeasurementKeyPrincipal {
  id: string;
  workspaceId: string;
  allowedEventTypes: readonly MeasurementEventType[];
  campaignScopeMode: "all" | "restricted";
  allowedCampaignIds: readonly string[];
}

export class PublishingRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async listChannelConnections(
    workspaceId: string,
  ): Promise<StoredChannelConnection[]> {
    return this.sql<StoredChannelConnection[]>`
      SELECT id, workspace_id, provider, name, status, encrypted_credentials, configuration,
        capabilities, capabilities_observed_at, last_tested_at, last_error, created_by, created_at, updated_at
      FROM channel_connection WHERE workspace_id = ${workspaceId} ORDER BY updated_at DESC
    `;
  }

  async getChannelConnection(
    workspaceId: string,
    id: string,
  ): Promise<StoredChannelConnection | undefined> {
    return (
      await this.sql<StoredChannelConnection[]>`
      SELECT id, workspace_id, provider, name, status, encrypted_credentials, configuration,
        capabilities, capabilities_observed_at, last_tested_at, last_error, created_by, created_at, updated_at
      FROM channel_connection WHERE workspace_id = ${workspaceId} AND id = ${id}
    `
    )[0];
  }

  async saveChannelConnection(
    input: {
      workspaceId: string;
      provider: ChannelProvider;
      name: string;
      encryptedCredentials: string;
      configuration?: Record<string, unknown>;
      capabilities: Record<string, unknown>;
    },
    actorUserId: string,
    id = randomUUID(),
  ): Promise<StoredChannelConnection> {
    await this.sql`
      INSERT INTO channel_connection (id, workspace_id, provider, name, encrypted_credentials, configuration, capabilities, capabilities_observed_at, created_by)
      VALUES (${id}, ${input.workspaceId}, ${input.provider}, ${input.name}, ${input.encryptedCredentials},
        ${this.sql.json((input.configuration ?? {}) as JSONValue)}, ${this.sql.json(input.capabilities as JSONValue)}, now(), ${actorUserId})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, encrypted_credentials = EXCLUDED.encrypted_credentials,
        configuration = EXCLUDED.configuration, capabilities = EXCLUDED.capabilities, capabilities_observed_at = now(),
        status = 'active', last_error = null, updated_at = now()
      WHERE channel_connection.workspace_id = EXCLUDED.workspace_id
    `;
    return (await this.getChannelConnection(input.workspaceId, id))!;
  }

  async recordConnectionTest(
    workspaceId: string,
    id: string,
    result: {
      ok: boolean;
      configuration?: Record<string, unknown>;
      error?: string;
    },
  ): Promise<void> {
    await this.sql`
      UPDATE channel_connection SET status = ${result.ok ? "active" : "error"},
        configuration = configuration || ${this.sql.json((result.configuration ?? {}) as JSONValue)},
        last_tested_at = now(), last_error = ${result.error ?? null}, updated_at = now()
      WHERE workspace_id = ${workspaceId} AND id = ${id}
    `;
  }

  async configureMailchimpWebhook(workspaceId: string, connectionId: string, encryptedCredentials: string, actorUserId: string): Promise<boolean> {
    return this.sql.begin(async (transaction) => {
      const updated = await transaction<{ id: string }[]>`
        UPDATE channel_connection SET encrypted_credentials = ${encryptedCredentials},
          configuration = (configuration - ARRAY['webhookProviderId','webhookCallbackUrl','webhookAudienceId','webhookConfiguredAt']::text[])
            || '{"webhookSigningConfigured":true,"webhookManagement":"manual"}'::jsonb, updated_at = now()
        WHERE workspace_id = ${workspaceId} AND id = ${connectionId}
          AND provider = 'mailchimp_email' AND status = 'active' RETURNING id
      `;
      if (!updated[0]) return false;
      await transaction`DELETE FROM mailchimp_webhook_health_state WHERE connection_id = ${connectionId}`;
      await transaction`
        INSERT INTO audit_event (id, organization_id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
        SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, 'mailchimp.webhook-signing-configured',
          'channel_connection', ${connectionId}, ${transaction.json({ signingConfigured: true } as JSONValue)}
        FROM workspace WHERE id = ${workspaceId}
      `;
      return true;
    });
  }

  async configureManagedMailchimpWebhook(
    workspaceId: string,
    connectionId: string,
    encryptedCredentials: string,
    webhook: { providerWebhookId: string; callbackUrl: string; audienceId: string; configuredAt: string },
    actorUserId: string,
  ): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(webhook.providerWebhookId) || !/^[A-Za-z0-9_-]{1,64}$/u.test(webhook.audienceId)) {
      throw new Error("Invalid managed Mailchimp webhook identity");
    }
    const callback = new URL(webhook.callbackUrl);
    if (callback.protocol !== "https:" || callback.username || callback.password || callback.hash || callback.href.length > 2048) {
      throw new Error("Invalid managed Mailchimp webhook callback");
    }
    if (new Date(webhook.configuredAt).toISOString() !== webhook.configuredAt) throw new Error("Invalid managed Mailchimp webhook time");
    return this.sql.begin(async (transaction) => {
      const configuration = {
        webhookSigningConfigured: true,
        webhookManagement: "managed",
        webhookProviderId: webhook.providerWebhookId,
        webhookCallbackUrl: callback.href,
        webhookAudienceId: webhook.audienceId,
        webhookConfiguredAt: webhook.configuredAt,
      } as const;
      const updated = await transaction<{ id: string }[]>`
        UPDATE channel_connection SET encrypted_credentials = ${encryptedCredentials},
          configuration = configuration || ${transaction.json(configuration as unknown as JSONValue)}, updated_at = now()
        WHERE workspace_id = ${workspaceId} AND id = ${connectionId}
          AND provider = 'mailchimp_email' AND status = 'active'
          AND configuration->>'audienceId' = ${webhook.audienceId}
        RETURNING id
      `;
      if (!updated[0]) return false;
      await transaction`
        INSERT INTO mailchimp_webhook_health_state (
          connection_id, workspace_id, audience_id, expected_callback_url, provider_webhook_id
        ) VALUES (
          ${connectionId}, ${workspaceId}, ${webhook.audienceId}, ${callback.href}, ${webhook.providerWebhookId}
        )
        ON CONFLICT (connection_id) DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id, audience_id = EXCLUDED.audience_id,
          expected_callback_url = EXCLUDED.expected_callback_url,
          provider_webhook_id = EXCLUDED.provider_webhook_id,
          next_check_at = now(), claimed_at = NULL, attempt_count = 0,
          last_checked_at = NULL, last_health_code = NULL,
          consecutive_failure_count = 0, last_error_code = NULL, updated_at = now()
      `;
      await transaction`
        INSERT INTO audit_event (id, organization_id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
        SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, 'mailchimp.webhook-managed',
          'channel_connection', ${connectionId}, ${transaction.json({
            providerWebhookId: webhook.providerWebhookId,
            audienceId: webhook.audienceId,
            callbackUrl: callback.href,
          } as JSONValue)}
        FROM workspace WHERE id = ${workspaceId}
      `;
      return true;
    });
  }

  async disableMailchimpWebhook(
    workspaceId: string,
    connectionId: string,
    encryptedCredentials: string,
    actorUserId: string,
  ): Promise<boolean> {
    return this.sql.begin(async (transaction) => {
      const updated = await transaction<{ id: string }[]>`
        UPDATE channel_connection SET encrypted_credentials = ${encryptedCredentials},
          configuration = (configuration - ARRAY[
            'webhookProviderId','webhookCallbackUrl','webhookAudienceId','webhookConfiguredAt','webhookManagement'
          ]::text[]) || '{"webhookSigningConfigured":false}'::jsonb,
          updated_at = now()
        WHERE workspace_id = ${workspaceId} AND id = ${connectionId}
          AND provider = 'mailchimp_email' AND status = 'active' RETURNING id
      `;
      if (!updated[0]) return false;
      await transaction`DELETE FROM mailchimp_webhook_health_state WHERE connection_id = ${connectionId}`;
      await transaction`
        INSERT INTO audit_event (id, organization_id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
        SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, 'mailchimp.webhook-disabled',
          'channel_connection', ${connectionId}, ${transaction.json({ signingConfigured: false } as JSONValue)}
        FROM workspace WHERE id = ${workspaceId}
      `;
      return true;
    });
  }

  async getCampaignExecutionTarget(
    instanceId: string,
    stepKey: string,
  ): Promise<CampaignExecutionTarget | undefined> {
    const rows = await this.sql<
      (CampaignExecutionTarget & { channelConnectionId?: string })[]
    >`
      SELECT i.workspace_id, i.campaign_id, i.id AS campaign_instance_id, r.id AS campaign_step_run_id,
        i.requested_by, brand_version.brand_profile_id,
        s.step_key, s.operation_type, s.desired_capability, s.approval_required, s.execution_methods, s.inputs AS input,
        (EXISTS (SELECT 1 FROM campaign_approval approval WHERE approval.campaign_instance_id = i.id
          AND approval.workspace_id = i.workspace_id AND approval.campaign_step_run_id = r.id AND approval.status = 'approved')
          OR (cv.autonomy_mode = 'campaign_approval' AND EXISTS (
            SELECT 1 FROM campaign_approval approval WHERE approval.campaign_instance_id = i.id
              AND approval.workspace_id = i.workspace_id AND approval.campaign_step_run_id IS NULL AND approval.status = 'approved'
              AND approval.request_snapshot->>'campaignVersionId' = i.campaign_version_id::text))) AS human_approval_granted,
        COALESCE(s.inputs->>'channelConnectionId', s.inputs->>'channel_connection_id', preview.channel_connection_id::text) AS channel_connection_id,
        preview.rendered_content AS draft_preview_content, preview.rendered_subject AS draft_preview_subject,
        preview.content_draft_version_id AS draft_preview_version_id,
        preview_link.id AS draft_preview_tracked_link_id,
        (preview.status = 'ready' AND preview_version.status = 'approved' AND draft.current_version_id = preview.content_draft_version_id
          AND preview_connection.status = 'active' AND preview_connection.capabilities_observed_at = preview.capability_observed_at
          AND NOT EXISTS (
            SELECT 1
            FROM draft_channel_preview_asset snapshot
            JOIN content_asset current_asset ON current_asset.id = snapshot.content_asset_id
            LEFT JOIN content_asset rights_source ON rights_source.id = current_asset.source_asset_id
            WHERE snapshot.draft_channel_preview_id = preview.id
              AND (
                snapshot.rights_status <> 'cleared'
                OR snapshot.rights_channel_connection_id IS DISTINCT FROM preview.channel_connection_id
                OR snapshot.rights_campaign_id IS DISTINCT FROM i.campaign_id
                OR snapshot.rights_brand_profile_id IS DISTINCT FROM brand_version.brand_profile_id
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
                    AND campaign_scope.campaign_id = i.campaign_id
                )
                OR NOT EXISTS (
                  SELECT 1 FROM content_asset_rights_brand_profile brand_scope
                  WHERE brand_scope.content_asset_id = CASE WHEN rights_source.id IS NULL
                    THEN current_asset.id ELSE rights_source.id END
                    AND brand_scope.brand_profile_id = brand_version.brand_profile_id
                )
              )
          )
          AND (preview.link_mode = 'canonical' OR (preview_link.id IS NOT NULL AND preview_link.status = 'active'
            AND preview_link.workspace_id = preview.workspace_id AND preview_link.destination_id = preview.destination_id))) AS draft_preview_eligible,
        cv.destination_id, d.canonical_url AS destination_url
      FROM campaign_instance i
      JOIN campaign_version cv ON cv.id = i.campaign_version_id
      LEFT JOIN brand_profile_version brand_version ON brand_version.id = cv.brand_profile_version_id
      JOIN campaign_step s ON s.campaign_version_id = cv.id AND s.step_key = ${stepKey}
      JOIN campaign_step_run r ON r.campaign_instance_id = i.id AND r.campaign_step_id = s.id
      LEFT JOIN destination d ON d.id = cv.destination_id
      LEFT JOIN draft_channel_preview preview ON preview.id::text = s.inputs->>'draftChannelPreviewId' AND preview.workspace_id = i.workspace_id
      LEFT JOIN content_draft_version preview_version ON preview_version.id = preview.content_draft_version_id
      LEFT JOIN content_draft draft ON draft.id = preview.content_draft_id
      LEFT JOIN channel_connection preview_connection ON preview_connection.id = preview.channel_connection_id
      LEFT JOIN tracked_link preview_link ON preview_link.draft_channel_preview_id = preview.id
      WHERE i.id = ${instanceId}
    `;
    const target = rows[0];
    if (!target) return undefined;
    const connection = target.channelConnectionId
      ? await this.getChannelConnection(
          target.workspaceId,
          target.channelConnectionId,
        )
      : undefined;
    const previewId =
      typeof target.input.draftChannelPreviewId === "string"
        ? target.input.draftChannelPreviewId
        : undefined;
    const assets = previewId
      ? await this.sql<StoredDraftPreviewAsset[]>`
      SELECT content_asset_id, sort_order, source_asset_id, object_key, content_hash, file_name, mime_type,
        byte_size, alt_text, alt_text_status, scan_status, scan_revision, scan_scanned_at, rights_status,
        rights_revision, rights_reviewed_at, rights_expires_at,
        rights_channel_connection_id, rights_campaign_id, rights_brand_profile_id
      FROM draft_channel_preview_asset WHERE draft_channel_preview_id::text = ${previewId} ORDER BY sort_order
    `
      : [];
    return {
      ...target,
      connection,
      draftPreviewAssets: assets.map((asset) => ({
        ...asset,
        byteSize: Number(asset.byteSize),
        scanScannedAt: asset.scanScannedAt
          ? new Date(asset.scanScannedAt).toISOString()
          : undefined,
        rightsReviewedAt: asset.rightsReviewedAt
          ? new Date(asset.rightsReviewedAt).toISOString()
          : undefined,
        rightsExpiresAt: asset.rightsExpiresAt
          ? new Date(asset.rightsExpiresAt).toISOString()
          : undefined,
      })),
    };
  }

  async beginPublicationAction(input: {
    target: CampaignExecutionTarget;
    idempotencyKey: string;
    requestSnapshot: Record<string, unknown>;
  }): Promise<{ action: StoredPublicationAction; created: boolean }> {
    if (!input.target.connection)
      throw new Error("Channel connection is required");
    await new CampaignRepository(this.sql).assertStepExecutionAuthorized(input.target.campaignInstanceId, input.target.stepKey);
    const currentTarget = await this.getCampaignExecutionTarget(input.target.campaignInstanceId, input.target.stepKey);
    const connection = await this.getChannelConnection(input.target.workspaceId, input.target.connection.id);
    if (!currentTarget || currentTarget.workspaceId !== input.target.workspaceId
      || currentTarget.campaignId !== input.target.campaignId
      || currentTarget.campaignStepRunId !== input.target.campaignStepRunId
      || currentTarget.channelConnectionId !== input.target.connection.id
      || currentTarget.operationType !== "publish_content"
      || !connection || connection.status !== "active" || connection.provider !== input.target.connection.provider
      || input.target.connection.workspaceId !== input.target.workspaceId
      || (input.target.channelConnectionId && input.target.channelConnectionId !== connection.id)) {
      throw new CampaignValidationError([{ code: "publication_target_mismatch", message: "Publication target does not match the active campaign, step, and workspace connection." }]);
    }
    if (["mailchimp_email", "slack_webhook", "mastodon_account"].includes(connection.provider) && !currentTarget.humanApprovalGranted) {
      throw new CampaignValidationError([{ code: "publication_approval_required", message: "This provider requires a recorded human approval for the campaign or exact action." }]);
    }
    const id = randomUUID();
    const inserted = await this.sql<{ id: string }[]>`
      INSERT INTO publication_action (id, workspace_id, campaign_instance_id, campaign_step_run_id, channel_connection_id, action_type, status, idempotency_key, request_snapshot)
      VALUES (${id}, ${input.target.workspaceId}, ${input.target.campaignInstanceId}, ${input.target.campaignStepRunId}, ${input.target.connection.id},
        'publish_content', 'dispatching', ${input.idempotencyKey}, ${this.sql.json(input.requestSnapshot as JSONValue)})
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
    `;
    const action = await this.getPublicationActionByIdempotencyKey(
      input.idempotencyKey,
    );
    if (!action)
      throw new Error("Publication action insert did not produce an action");
    if (action.workspaceId !== input.target.workspaceId || action.campaignInstanceId !== input.target.campaignInstanceId
      || action.campaignStepRunId !== input.target.campaignStepRunId || action.channelConnectionId !== connection.id) {
      throw new CampaignValidationError([{ code: "publication_target_mismatch", message: "Publication idempotency key belongs to a different execution target." }]);
    }
    return { action, created: Boolean(inserted[0]) };
  }

  async getPublicationActionByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<StoredPublicationAction | undefined> {
    return (
      await this.sql<StoredPublicationAction[]>`
      SELECT action.id, action.workspace_id, action.campaign_instance_id, action.campaign_step_run_id, action.channel_connection_id,
        connection.provider,
        action.action_type, action.status, action.idempotency_key, action.request_snapshot,
        action.provider_external_id, action.provider_url, action.response_metadata, action.last_error
      FROM publication_action action JOIN channel_connection connection ON connection.id = action.channel_connection_id
      WHERE idempotency_key = ${idempotencyKey}
    `
    )[0];
  }

  async finishPublicationAction(
    id: string,
    result: {
      status: "succeeded" | "failed" | "ambiguous";
      providerExternalId?: string;
      providerUrl?: string;
      responseMetadata?: Record<string, unknown>;
      error?: string;
    },
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const updated = await transaction<{ id: string }[]>`
        UPDATE publication_action SET status = ${result.status},
          provider_external_id = COALESCE(${result.providerExternalId ?? null}, provider_external_id),
          provider_url = COALESCE(${result.providerUrl ?? null}, provider_url),
          response_metadata = ${transaction.json((result.responseMetadata ?? {}) as JSONValue)},
          last_error = ${result.error ?? null}, completed_at = now(), updated_at = now()
        WHERE id = ${id} RETURNING id
      `;
      if (updated[0] && result.status === "succeeded") await transaction`
        INSERT INTO mastodon_status_report_collection_state (
          publication_action_id, workspace_id, provider_status_id, provider_account_id,
          provider_status_url, instance_origin, next_attempt_at
        )
        SELECT action.id, action.workspace_id, action.provider_external_id,
          COALESCE(
            NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,accountId}', ''),
            connection.configuration->>'accountId'
          ),
          action.provider_url,
          COALESCE(
            NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,instanceOrigin}', ''),
            connection.configuration->>'instanceOrigin'
          ),
          now() + interval '5 minutes'
        FROM publication_action action
        JOIN channel_connection connection ON connection.id = action.channel_connection_id
          AND connection.workspace_id = action.workspace_id
        WHERE action.id = ${id} AND connection.provider = 'mastodon_account'
          AND action.provider_external_id IS NOT NULL AND action.provider_url IS NOT NULL
          AND COALESCE(
            NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,accountId}', ''),
            connection.configuration->>'accountId'
          ) IS NOT NULL
          AND COALESCE(
            NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,instanceOrigin}', ''),
            connection.configuration->>'instanceOrigin'
          ) IS NOT NULL
        ON CONFLICT (publication_action_id) DO NOTHING
      `;
    });
  }

  async listMastodonPublicationMedia(publicationActionId: string): Promise<StoredMastodonPublicationMedia[]> {
    return this.sql<StoredMastodonPublicationMedia[]>`
      SELECT publication_action_id, ordinal, content_asset_id, content_hash, provider_media_id, created_at
      FROM mastodon_publication_media
      WHERE publication_action_id = ${publicationActionId}
      ORDER BY ordinal
    `;
  }

  async recordMastodonPublicationMedia(input: {
    publicationActionId: string;
    ordinal: number;
    contentAssetId: string;
    contentHash: string;
    providerMediaId: string;
  }): Promise<StoredMastodonPublicationMedia> {
    if (!Number.isInteger(input.ordinal) || input.ordinal < 0 || input.ordinal > 3)
      throw new Error("Mastodon publication media ordinal must be from 0 through 3");
    if (!/^sha256:[0-9a-f]{64}$/u.test(input.contentHash)) throw new Error("Mastodon publication media hash is invalid");
    if (!input.providerMediaId.trim() || input.providerMediaId.length > 500 || /[\u0000-\u001f\u007f]/u.test(input.providerMediaId))
      throw new Error("Mastodon provider media identity is invalid");
    await this.sql`
      INSERT INTO mastodon_publication_media (
        publication_action_id, ordinal, content_asset_id, content_hash, provider_media_id
      )
      SELECT action.id, ${input.ordinal}, ${input.contentAssetId}, ${input.contentHash}, ${input.providerMediaId}
      FROM publication_action action
      JOIN channel_connection connection ON connection.id = action.channel_connection_id
        AND connection.workspace_id = action.workspace_id
      WHERE action.id = ${input.publicationActionId}
        AND action.status = 'dispatching'
        AND connection.provider = 'mastodon_account'
        AND action.request_snapshot #>> ARRAY['attachments', ${String(input.ordinal)}, 'contentAssetId'] = ${input.contentAssetId}
        AND action.request_snapshot #>> ARRAY['attachments', ${String(input.ordinal)}, 'contentHash'] = ${input.contentHash}
      ON CONFLICT DO NOTHING
    `;
    const stored = (await this.listMastodonPublicationMedia(input.publicationActionId))
      .find((media) => media.ordinal === input.ordinal);
    if (!stored || stored.contentAssetId !== input.contentAssetId || stored.contentHash !== input.contentHash
      || stored.providerMediaId !== input.providerMediaId) {
      throw new Error("Mastodon provider media identity could not be bound to the exact publication attachment");
    }
    return stored;
  }

  async recordPublicationProviderIdentity(
    id: string,
    providerExternalId: string,
    providerUrl?: string,
  ): Promise<void> {
    const updated = await this.sql.begin(async (transaction) => {
      const rows = await transaction<{ id: string }[]>`
        UPDATE publication_action
        SET provider_external_id = ${providerExternalId}, provider_url = ${providerUrl ?? null}, updated_at = now()
        WHERE id = ${id} AND status = 'dispatching'
          AND (provider_external_id IS NULL OR provider_external_id = ${providerExternalId})
        RETURNING id
      `;
      if (rows[0]) await transaction`
        INSERT INTO mailchimp_report_collection_state (publication_action_id, workspace_id, audience_id, next_attempt_at)
        SELECT action.id, action.workspace_id,
          COALESCE(NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,audienceId}', ''), connection.configuration->>'audienceId'),
          now() + interval '5 minutes'
        FROM publication_action action
        JOIN channel_connection connection ON connection.id = action.channel_connection_id
          AND connection.workspace_id = action.workspace_id
        WHERE action.id = ${id} AND connection.provider = 'mailchimp_email'
        ON CONFLICT (publication_action_id) DO NOTHING
      `;
      return rows;
    });
    if (!updated[0]) throw new Error("Publication action provider identity could not be recorded");
  }

  async getMastodonStatusReportTarget(
    workspaceId: string,
    publicationActionId: string,
  ): Promise<{ action: StoredPublicationAction; connection: StoredChannelConnection; accountId: string; instanceOrigin: string } | undefined> {
    const action = (
      await this.sql<(StoredPublicationAction & { reportAccountId: string; reportInstanceOrigin: string })[]>`
        SELECT action.id, action.workspace_id, action.campaign_instance_id, action.campaign_step_run_id,
          action.channel_connection_id, connection.provider, action.action_type, action.status,
          action.idempotency_key, action.request_snapshot, action.provider_external_id, action.provider_url,
          action.response_metadata, action.last_error,
          COALESCE(
            NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,accountId}', ''),
            connection.configuration->>'accountId'
          ) AS report_account_id,
          COALESCE(
            NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,instanceOrigin}', ''),
            connection.configuration->>'instanceOrigin'
          ) AS report_instance_origin
        FROM publication_action action
        JOIN channel_connection connection ON connection.id = action.channel_connection_id
        WHERE action.workspace_id = ${workspaceId} AND action.id = ${publicationActionId}
          AND action.status = 'succeeded' AND action.provider_external_id IS NOT NULL
          AND action.provider_url IS NOT NULL
          AND connection.workspace_id = action.workspace_id AND connection.provider = 'mastodon_account'
          AND COALESCE(
            NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,accountId}', ''),
            connection.configuration->>'accountId'
          ) IS NOT NULL
          AND COALESCE(
            NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,instanceOrigin}', ''),
            connection.configuration->>'instanceOrigin'
          ) IS NOT NULL
      `
    )[0];
    if (!action) return undefined;
    const connection = await this.getChannelConnection(workspaceId, action.channelConnectionId);
    if (!connection) return undefined;
    return { action, connection, accountId: action.reportAccountId, instanceOrigin: action.reportInstanceOrigin };
  }

  async recordMastodonStatusReportSnapshot(
    workspaceId: string,
    publicationActionId: string,
    report: MastodonStatusReportInput,
    actorUserId: string,
    expectedAttemptCount?: number,
  ): Promise<{ snapshot: StoredMastodonStatusReportSnapshot; created: boolean }> {
    for (const value of [report.statusId, report.accountId]) {
      if (!value.trim() || value.length > 500 || /[\u0000-\u001f\u007f]/u.test(value))
        throw new Error("Mastodon status report identities must be bounded strings");
    }
    for (const value of [report.repliesCount, report.reblogsCount, report.favouritesCount]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error("Mastodon status report totals must be safe non-negative integers");
    }
    let normalizedUrl: string;
    try { normalizedUrl = new URL(report.statusUrl).href; } catch { throw new Error("Mastodon status report URL is invalid"); }
    if (normalizedUrl !== report.statusUrl) throw new Error("Mastodon status report URL must be normalized");
    const normalizedCreatedAt = new Date(report.statusCreatedAt).toISOString();
    if (normalizedCreatedAt !== report.statusCreatedAt) throw new Error("Mastodon status report creation time must be normalized ISO UTC");
    const canonical = JSON.stringify({
      statusId: report.statusId, accountId: report.accountId,
      repliesCount: report.repliesCount, reblogsCount: report.reblogsCount,
      favouritesCount: report.favouritesCount, statusCreatedAt: report.statusCreatedAt,
    });
    const snapshotHash = createHash("sha256").update(canonical).digest("hex");
    return this.sql.begin(async (transaction) => {
      const target = (
        await transaction<{
          campaignInstanceId: string;
          requestedBy: string;
          successCriteria: CampaignSuccessCriterion[];
          successAction: "notify_only" | "pause";
        }[]>`
          SELECT action.campaign_instance_id, instance.requested_by,
            version.success_criteria, version.success_action
          FROM publication_action action
          JOIN channel_connection connection ON connection.id = action.channel_connection_id
          JOIN campaign_instance instance ON instance.id = action.campaign_instance_id
          JOIN campaign_version version ON version.id = instance.campaign_version_id
          WHERE action.workspace_id = ${workspaceId} AND action.id = ${publicationActionId}
            AND action.status = 'succeeded'
            AND connection.workspace_id = action.workspace_id AND connection.provider = 'mastodon_account'
            AND action.provider_external_id = ${report.statusId}
            AND action.provider_url = ${report.statusUrl}
            AND COALESCE(
              NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,accountId}', ''),
              connection.configuration->>'accountId'
            ) = ${report.accountId}
          FOR UPDATE OF action
        `
      )[0];
      if (!target) throw new Error("Mastodon report must match the exact workspace publication, status, account, and URL");
      if (expectedAttemptCount !== undefined) {
        const claim = await transaction<{ publicationActionId: string }[]>`
          SELECT publication_action_id FROM mastodon_status_report_collection_state
          WHERE publication_action_id = ${publicationActionId} AND workspace_id = ${workspaceId}
            AND attempt_count = ${expectedAttemptCount} AND claimed_at IS NOT NULL
          FOR UPDATE
        `;
        if (!claim[0]) throw new MastodonReportCollectionClaimLostError();
      }
      const id = randomUUID();
      const inserted = await transaction<{ id: string }[]>`
        INSERT INTO mastodon_status_report_snapshot (
          id, workspace_id, publication_action_id, provider_status_id, provider_account_id,
          provider_status_url, snapshot_hash, replies_count, reblogs_count, favourites_count, status_created_at, created_by
        ) VALUES (
          ${id}, ${workspaceId}, ${publicationActionId}, ${report.statusId}, ${report.accountId},
          ${report.statusUrl}, ${snapshotHash}, ${report.repliesCount}, ${report.reblogsCount}, ${report.favouritesCount},
          ${report.statusCreatedAt}, ${actorUserId}
        ) ON CONFLICT (publication_action_id, snapshot_hash) DO NOTHING RETURNING id
      `;
      if (inserted[0]) await transaction`
        INSERT INTO audit_event (id, organization_id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
        SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, 'publication.mastodon_status_report_recorded',
          'publication_action', ${publicationActionId},
          ${transaction.json({ statusId: report.statusId, snapshotHash } as JSONValue)}
        FROM workspace WHERE id = ${workspaceId}
      `;
      const snapshot = (
        await transaction<StoredMastodonStatusReportSnapshot[]>`
          SELECT id, workspace_id, publication_action_id, provider_status_id AS status_id,
            provider_account_id AS account_id, provider_status_url AS status_url, snapshot_hash,
            replies_count::float8 AS replies_count, reblogs_count::float8 AS reblogs_count,
            favourites_count::float8 AS favourites_count, status_created_at, observed_at
          FROM mastodon_status_report_snapshot
          WHERE publication_action_id = ${publicationActionId} AND snapshot_hash = ${snapshotHash}
        `
      )[0];
      if (!snapshot) throw new Error("Mastodon status report snapshot was not available after recording");
      const providerMetrics: readonly [ProviderAggregateMetricType, number][] = [
        ["mastodon_reply", report.repliesCount],
        ["mastodon_reblog", report.reblogsCount],
        ["mastodon_favourite", report.favouritesCount],
      ];
      for (const [metricType, metricTotal] of providerMetrics) await transaction`
        INSERT INTO campaign_provider_metric_total (
          workspace_id, campaign_instance_id, publication_action_id, mastodon_report_snapshot_id,
          metric_type, metric_total, observed_at
        ) VALUES (
          ${workspaceId}, ${target.campaignInstanceId}, ${publicationActionId}, ${snapshot.id},
          ${metricType}, ${metricTotal}, ${snapshot.observedAt}
        ) ON CONFLICT (publication_action_id, metric_type) DO UPDATE SET
          report_snapshot_id = NULL,
          mastodon_report_snapshot_id = EXCLUDED.mastodon_report_snapshot_id,
          metric_total = EXCLUDED.metric_total,
          observed_at = EXCLUDED.observed_at,
          updated_at = now()
        WHERE campaign_provider_metric_total.mastodon_report_snapshot_id IS DISTINCT FROM EXCLUDED.mastodon_report_snapshot_id
          OR campaign_provider_metric_total.metric_total IS DISTINCT FROM EXCLUDED.metric_total
      `;
      const eventTotals = await transaction<{ eventType: string; count: number }[]>`
        SELECT event_type, count(*)::integer AS count FROM measurement_event
        WHERE workspace_id = ${workspaceId} AND campaign_instance_id = ${target.campaignInstanceId}
        GROUP BY event_type
      `;
      const providerTotals = await transaction<{ eventType: string; count: number }[]>`
        SELECT metric_type AS event_type, sum(metric_total)::float8 AS count
        FROM campaign_provider_metric_total
        WHERE workspace_id = ${workspaceId} AND campaign_instance_id = ${target.campaignInstanceId}
        GROUP BY metric_type
      `;
      const currencyRows = await transaction<{ eventType: string; currency: string; value: number }[]>`
        SELECT event_type, currency, COALESCE(sum(value), 0)::float8 AS value
        FROM measurement_event
        WHERE workspace_id = ${workspaceId} AND campaign_instance_id = ${target.campaignInstanceId}
          AND currency IS NOT NULL AND value IS NOT NULL
        GROUP BY event_type, currency
      `;
      const totals = Object.fromEntries([...eventTotals, ...providerTotals].map((row) => [row.eventType, { count: row.count }]));
      const currencyTotals: Record<string, Record<string, number>> = {};
      for (const row of currencyRows) (currencyTotals[row.eventType] ??= {})[row.currency] = row.value;
      const evaluation = evaluateCampaignSuccess(target.successCriteria, totals, currencyTotals);
      if (evaluation.allCriteriaMet) await transaction`
        INSERT INTO campaign_workflow_command (
          id, workspace_id, campaign_instance_id, command_type, idempotency_key, payload, actor_user_id
        ) VALUES (
          ${randomUUID()}, ${workspaceId}, ${target.campaignInstanceId}, 'success_criteria_met',
          ${`campaign:${target.campaignInstanceId}:success-criteria-met`},
          ${transaction.json({
            criteria: evaluation.criteria,
            action: target.successAction,
            measuredAt: new Date().toISOString(),
            triggerKey: `mastodon-status-report:${snapshot.id}`,
            triggerSource: "mastodon_status_report",
          } as unknown as JSONValue)}, ${target.requestedBy}
        ) ON CONFLICT (idempotency_key) DO NOTHING
      `;
      return { snapshot, created: Boolean(inserted[0]) };
    });
  }

  async listMastodonStatusReportSnapshots(
    workspaceId: string,
    campaignInstanceId: string,
  ): Promise<StoredMastodonStatusReportSnapshot[]> {
    return this.sql<StoredMastodonStatusReportSnapshot[]>`
      SELECT snapshot.id, snapshot.workspace_id, snapshot.publication_action_id,
        snapshot.provider_status_id AS status_id, snapshot.provider_account_id AS account_id,
        snapshot.provider_status_url AS status_url, snapshot.snapshot_hash,
        snapshot.replies_count::float8 AS replies_count, snapshot.reblogs_count::float8 AS reblogs_count,
        snapshot.favourites_count::float8 AS favourites_count,
        snapshot.status_created_at, snapshot.observed_at
      FROM mastodon_status_report_snapshot snapshot
      JOIN publication_action action ON action.id = snapshot.publication_action_id
      WHERE snapshot.workspace_id = ${workspaceId} AND action.campaign_instance_id = ${campaignInstanceId}
      ORDER BY snapshot.observed_at DESC LIMIT 100
    `;
  }

  async claimMastodonStatusReportCollections(
    limit: number,
    maxAgeSeconds: number,
  ): Promise<MastodonStatusReportCollectionTarget[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new Error("Mastodon status report collection limit must be from 1 through 50");
    if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 3600 || maxAgeSeconds > 2592000)
      throw new Error("Mastodon status report collection max age must be from 3600 through 2592000 seconds");
    return this.sql<MastodonStatusReportCollectionTarget[]>`
      WITH candidates AS (
        SELECT state.publication_action_id
        FROM mastodon_status_report_collection_state state
        JOIN publication_action action ON action.id = state.publication_action_id
        JOIN channel_connection connection ON connection.id = action.channel_connection_id
          AND connection.workspace_id = action.workspace_id
        WHERE state.next_attempt_at <= now()
          AND state.workspace_id = action.workspace_id
          AND (state.claimed_at IS NULL OR state.claimed_at < now() - interval '5 minutes')
          AND action.status = 'succeeded'
          AND action.provider_external_id = state.provider_status_id
          AND action.provider_url = state.provider_status_url
          AND action.started_at >= now() - (${maxAgeSeconds} * interval '1 second')
          AND connection.provider = 'mastodon_account' AND connection.status = 'active'
          AND connection.capabilities #>> '{supportedActions,read_metrics}' = 'true'
          AND COALESCE(
            NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,accountId}', ''),
            connection.configuration->>'accountId'
          ) = state.provider_account_id
          AND COALESCE(
            NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,instanceOrigin}', ''),
            connection.configuration->>'instanceOrigin'
          ) = state.instance_origin
        ORDER BY state.next_attempt_at, state.publication_action_id
        LIMIT ${limit} FOR UPDATE OF state SKIP LOCKED
      ), claimed AS (
        UPDATE mastodon_status_report_collection_state state
        SET claimed_at = now(), attempt_count = attempt_count + 1, updated_at = now()
        FROM candidates WHERE state.publication_action_id = candidates.publication_action_id
        RETURNING state.publication_action_id, state.workspace_id, state.provider_status_id,
          state.provider_account_id, state.provider_status_url, state.instance_origin, state.attempt_count
      )
      SELECT claimed.workspace_id, claimed.publication_action_id,
        claimed.provider_status_id, claimed.provider_account_id, claimed.provider_status_url,
        claimed.instance_origin, connection.encrypted_credentials,
        connection.created_by AS actor_user_id, claimed.attempt_count
      FROM claimed
      JOIN publication_action action ON action.id = claimed.publication_action_id
      JOIN channel_connection connection ON connection.id = action.channel_connection_id
        AND connection.workspace_id = action.workspace_id
      ORDER BY claimed.publication_action_id
    `;
  }

  async completeMastodonStatusReportCollection(
    publicationActionId: string,
    result: { delaySeconds: number; errorCode?: string },
    expectedAttemptCount: number,
  ): Promise<boolean> {
    if (!Number.isSafeInteger(expectedAttemptCount) || expectedAttemptCount < 1)
      throw new Error("Mastodon report collection attempt must be a positive safe integer");
    if (!Number.isInteger(result.delaySeconds) || result.delaySeconds < 60 || result.delaySeconds > 86400)
      throw new Error("Mastodon status report collection delay must be from 60 through 86400 seconds");
    const updated = await this.sql<{ id: string }[]>`
      UPDATE mastodon_status_report_collection_state SET
        next_attempt_at = now() + (${result.delaySeconds} * interval '1 second'),
        claimed_at = NULL, last_attempt_at = now(),
        last_success_at = CASE WHEN ${result.errorCode ?? null}::text IS NULL THEN now() ELSE last_success_at END,
        last_error_code = ${result.errorCode ?? null}, updated_at = now()
      WHERE publication_action_id = ${publicationActionId} AND claimed_at IS NOT NULL
        AND attempt_count = ${expectedAttemptCount}
      RETURNING publication_action_id AS id
    `;
    return Boolean(updated[0]);
  }

  async listMastodonStatusReportCollectionStates(
    workspaceId: string,
    campaignInstanceId: string,
  ): Promise<StoredMastodonStatusReportCollectionState[]> {
    return this.sql<StoredMastodonStatusReportCollectionState[]>`
      SELECT state.publication_action_id, state.next_attempt_at, state.attempt_count,
        state.claimed_at, state.last_attempt_at, state.last_success_at, state.last_error_code,
        CASE
          WHEN state.claimed_at < now() - interval '5 minutes' THEN 'abandoned'
          WHEN state.claimed_at IS NOT NULL THEN 'collecting'
          WHEN state.next_attempt_at <= now() THEN 'overdue'
          WHEN state.last_error_code IS NOT NULL THEN 'retrying'
          WHEN state.last_success_at IS NOT NULL THEN 'scheduled'
          ELSE 'pending'
        END AS operational_status
      FROM mastodon_status_report_collection_state state
      JOIN publication_action action ON action.id = state.publication_action_id
      WHERE state.workspace_id = ${workspaceId}
        AND action.workspace_id = state.workspace_id
        AND action.campaign_instance_id = ${campaignInstanceId}
      ORDER BY state.next_attempt_at, state.publication_action_id
    `;
  }

  async getMastodonStatusReportCollectionOperationsSummary(
    workspaceId: string,
  ): Promise<MastodonStatusReportCollectionOperationsSummary> {
    const rows = await this.sql<MastodonStatusReportCollectionOperationsSummary[]>`
      WITH classified AS (
        SELECT state.next_attempt_at, state.claimed_at,
          CASE
            WHEN state.claimed_at < now() - interval '5 minutes' THEN 'abandoned'
            WHEN state.claimed_at IS NOT NULL THEN 'collecting'
            WHEN state.next_attempt_at <= now() THEN 'overdue'
            WHEN state.last_error_code IS NOT NULL THEN 'retrying'
            WHEN state.last_success_at IS NOT NULL THEN 'scheduled'
            ELSE 'pending'
          END AS operational_status
        FROM mastodon_status_report_collection_state state
        JOIN publication_action action ON action.id = state.publication_action_id
          AND action.workspace_id = state.workspace_id
        WHERE state.workspace_id = ${workspaceId}
      )
      SELECT count(*)::integer AS total,
        count(*) FILTER (WHERE operational_status = 'pending')::integer AS pending,
        count(*) FILTER (WHERE operational_status = 'scheduled')::integer AS scheduled,
        count(*) FILTER (WHERE operational_status = 'retrying')::integer AS retrying,
        count(*) FILTER (WHERE operational_status = 'overdue')::integer AS overdue,
        count(*) FILTER (WHERE operational_status = 'collecting')::integer AS collecting,
        count(*) FILTER (WHERE operational_status = 'abandoned')::integer AS abandoned,
        min(next_attempt_at) FILTER (WHERE operational_status = 'overdue') AS oldest_overdue_at,
        min(claimed_at) FILTER (WHERE operational_status = 'abandoned') AS oldest_abandoned_claim_at
      FROM classified
    `;
    return rows[0] ?? {
      total: 0, pending: 0, scheduled: 0, retrying: 0,
      overdue: 0, collecting: 0, abandoned: 0,
    };
  }

  async reconcileMastodonStatusReportCollectionAlerts(maxAgeSeconds: number): Promise<MastodonStatusReportCollectionAlertReconciliationResult> {
    if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 3600 || maxAgeSeconds > 2592000)
      throw new Error("Mastodon alert collection max age must be from 3600 through 2592000 seconds");
    return this.sql.begin(async (transaction) => {
      // One observer reconciles at a time; collectors can still claim concurrently.
      const [lease] = await transaction<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(129691, 119) AS acquired
      `;
      if (!lease?.acquired) return { active: 0, resolved: 0 };
      const [result] = await transaction<MastodonStatusReportCollectionAlertReconciliationResult[]>`
        WITH attention AS MATERIALIZED (
          SELECT state.workspace_id,
            CASE
              WHEN state.claimed_at < now() - interval '5 minutes' THEN 'abandoned'
              ELSE 'overdue'
            END AS alert_type,
            count(*)::integer AS affected_count,
            min(CASE WHEN state.claimed_at < now() - interval '5 minutes'
              THEN state.claimed_at ELSE state.next_attempt_at END) AS oldest_at
          FROM mastodon_status_report_collection_state state
          JOIN publication_action action ON action.id = state.publication_action_id
            AND action.workspace_id = state.workspace_id
          JOIN channel_connection connection ON connection.id = action.channel_connection_id
            AND connection.workspace_id = action.workspace_id
          WHERE (state.claimed_at < now() - interval '5 minutes'
             OR (state.claimed_at IS NULL AND state.next_attempt_at < now() - interval '5 minutes'))
            AND action.status = 'succeeded'
            AND action.started_at >= now() - (${maxAgeSeconds} * interval '1 second')
            AND action.provider_external_id = state.provider_status_id
            AND action.provider_url = state.provider_status_url
            AND connection.provider = 'mastodon_account' AND connection.status = 'active'
            AND connection.capabilities #>> '{supportedActions,read_metrics}' = 'true'
            AND COALESCE(NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,accountId}', ''),
              connection.configuration->>'accountId') = state.provider_account_id
            AND COALESCE(NULLIF(action.request_snapshot #>> '{providerPreflight,targetIdentity,instanceOrigin}', ''),
              connection.configuration->>'instanceOrigin') = state.instance_origin
          GROUP BY state.workspace_id, alert_type
        ), resolved AS (
          UPDATE mastodon_status_report_collection_alert alert
          SET status = 'resolved', resolved_at = now()
          WHERE alert.status = 'active' AND NOT EXISTS (
            SELECT 1 FROM attention WHERE attention.workspace_id = alert.workspace_id
              AND attention.alert_type = alert.alert_type
          ) RETURNING alert.id
        ), refreshed AS (
        INSERT INTO mastodon_status_report_collection_alert (
          id, workspace_id, alert_type, status, affected_count, oldest_at
        )
        SELECT gen_random_uuid(), workspace_id, alert_type, 'active', affected_count, oldest_at
        FROM attention
        ON CONFLICT (workspace_id, alert_type) WHERE status = 'active'
        DO UPDATE SET affected_count = EXCLUDED.affected_count,
          oldest_at = EXCLUDED.oldest_at, last_detected_at = now()
        RETURNING id
        ) SELECT (SELECT count(*)::integer FROM refreshed) AS active,
          (SELECT count(*)::integer FROM resolved) AS resolved
      `;
      return result ?? { active: 0, resolved: 0 };
    });
  }

  async listMastodonStatusReportCollectionAlerts(
    workspaceId: string,
  ): Promise<StoredMastodonStatusReportCollectionAlert[]> {
    return this.sql<StoredMastodonStatusReportCollectionAlert[]>`
      SELECT id, alert_type, status, affected_count, oldest_at,
        first_detected_at, last_detected_at, resolved_at
      FROM mastodon_status_report_collection_alert
      WHERE workspace_id = ${workspaceId}
      ORDER BY (status = 'active') DESC, last_detected_at DESC, id
      LIMIT 100
    `;
  }

  async claimMailchimpReportCollections(
    limit: number,
    maxAgeSeconds: number,
  ): Promise<MailchimpReportCollectionTarget[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new Error("Mailchimp report collection limit must be from 1 through 50");
    if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 3600 || maxAgeSeconds > 2592000)
      throw new Error("Mailchimp report collection max age must be from 3600 through 2592000 seconds");
    return this.sql<MailchimpReportCollectionTarget[]>`
      WITH candidates AS (
        SELECT state.publication_action_id
        FROM mailchimp_report_collection_state state
        JOIN publication_action action ON action.id = state.publication_action_id
        JOIN channel_connection connection ON connection.id = action.channel_connection_id
          AND connection.workspace_id = action.workspace_id
        WHERE state.next_attempt_at <= now()
          AND state.workspace_id = action.workspace_id
          AND (state.claimed_at IS NULL OR state.claimed_at < now() - interval '5 minutes')
          AND action.provider_external_id IS NOT NULL
          AND action.started_at >= now() - (${maxAgeSeconds} * interval '1 second')
          AND connection.provider = 'mailchimp_email' AND connection.status = 'active'
        ORDER BY state.next_attempt_at, state.publication_action_id
        LIMIT ${limit} FOR UPDATE OF state SKIP LOCKED
      ), claimed AS (
        UPDATE mailchimp_report_collection_state state
        SET claimed_at = now(), attempt_count = attempt_count + 1, updated_at = now()
        FROM candidates WHERE state.publication_action_id = candidates.publication_action_id
        RETURNING state.publication_action_id, state.workspace_id, state.attempt_count
      )
      SELECT claimed.workspace_id, claimed.publication_action_id,
        action.provider_external_id AS provider_campaign_id,
        state.audience_id,
        connection.encrypted_credentials, connection.created_by AS actor_user_id,
        claimed.attempt_count
      FROM claimed
      JOIN mailchimp_report_collection_state state ON state.publication_action_id = claimed.publication_action_id
      JOIN publication_action action ON action.id = claimed.publication_action_id
      JOIN channel_connection connection ON connection.id = action.channel_connection_id
        AND connection.workspace_id = action.workspace_id
      ORDER BY claimed.publication_action_id
    `;
  }

  async completeMailchimpReportCollection(
    publicationActionId: string,
    result: { delaySeconds: number; errorCode?: string },
  ): Promise<void> {
    if (!Number.isInteger(result.delaySeconds) || result.delaySeconds < 60 || result.delaySeconds > 86400)
      throw new Error("Mailchimp report collection delay must be from 60 through 86400 seconds");
    const updated = await this.sql<{ id: string }[]>`
      UPDATE mailchimp_report_collection_state SET
        next_attempt_at = now() + (${result.delaySeconds} * interval '1 second'),
        claimed_at = NULL, last_attempt_at = now(),
        last_success_at = CASE WHEN ${result.errorCode ?? null}::text IS NULL THEN now() ELSE last_success_at END,
        last_error_code = ${result.errorCode ?? null}, updated_at = now()
      WHERE publication_action_id = ${publicationActionId} AND claimed_at IS NOT NULL
      RETURNING publication_action_id AS id
    `;
    if (!updated[0]) throw new Error("Mailchimp report collection claim is no longer current");
  }

  async listMailchimpReportCollectionStates(
    workspaceId: string,
    campaignInstanceId: string,
  ): Promise<StoredMailchimpReportCollectionState[]> {
    return this.sql<StoredMailchimpReportCollectionState[]>`
      SELECT state.publication_action_id, state.next_attempt_at, state.attempt_count,
        state.claimed_at, state.last_attempt_at, state.last_success_at, state.last_error_code,
        state.last_webhook_received_at, state.webhook_wakeup_count
      FROM mailchimp_report_collection_state state
      JOIN publication_action action ON action.id = state.publication_action_id
        AND action.workspace_id = state.workspace_id
      WHERE state.workspace_id = ${workspaceId}
        AND action.campaign_instance_id = ${campaignInstanceId}
      ORDER BY state.next_attempt_at, state.publication_action_id
    `;
  }

  async claimMailchimpWebhookHealthChecks(batchSize: number): Promise<MailchimpWebhookHealthCheckTarget[]> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) throw new Error("Invalid Mailchimp webhook health batch size");
    return this.sql<MailchimpWebhookHealthCheckTarget[]>`
      WITH candidates AS (
        SELECT state.connection_id
        FROM mailchimp_webhook_health_state state
        JOIN channel_connection connection ON connection.id = state.connection_id
          AND connection.workspace_id = state.workspace_id
        WHERE state.next_check_at <= now()
          AND (state.claimed_at IS NULL OR state.claimed_at < now() - interval '5 minutes')
          AND connection.provider = 'mailchimp_email' AND connection.status = 'active'
          AND connection.configuration->>'webhookManagement' = 'managed'
          AND connection.configuration->>'webhookProviderId' = state.provider_webhook_id
          AND connection.configuration->>'webhookCallbackUrl' = state.expected_callback_url
          AND connection.configuration->>'webhookAudienceId' = state.audience_id
        ORDER BY state.next_check_at, state.connection_id
        FOR UPDATE OF state SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE mailchimp_webhook_health_state state SET
        claimed_at = now(), attempt_count = state.attempt_count + 1, updated_at = now()
      FROM candidates, channel_connection connection
      WHERE state.connection_id = candidates.connection_id
        AND connection.id = state.connection_id
      RETURNING state.workspace_id, state.connection_id, state.audience_id,
        state.expected_callback_url, state.provider_webhook_id,
        connection.encrypted_credentials, state.attempt_count::integer AS attempt_count
    `;
  }

  async completeMailchimpWebhookHealthCheck(
    connectionId: string,
    result: {
      delaySeconds: number;
      healthCode?: "managed_active" | "managed_missing" | "managed_drifted" | "managed_secret_missing";
      errorCode?: "authorization" | "validation" | "rate_limit" | "transient" | "permanent" | "ambiguous" | "credential_unavailable" | "unknown";
    },
  ): Promise<void> {
    if (!Number.isInteger(result.delaySeconds) || result.delaySeconds < 60 || result.delaySeconds > 86400) throw new Error("Invalid Mailchimp webhook health delay");
    if (Boolean(result.healthCode) === Boolean(result.errorCode)) throw new Error("Mailchimp webhook health completion requires exactly one outcome");
    if (result.healthCode) {
      await this.sql`
        UPDATE mailchimp_webhook_health_state SET
          next_check_at = now() + (${result.delaySeconds} * interval '1 second'), claimed_at = NULL,
          last_checked_at = now(), last_health_code = ${result.healthCode}, last_error_code = NULL,
          consecutive_failure_count = CASE WHEN ${result.healthCode} = 'managed_active'
            THEN 0 ELSE consecutive_failure_count + 1 END,
          updated_at = now()
        WHERE connection_id = ${connectionId}
      `;
      return;
    }
    await this.sql`
      UPDATE mailchimp_webhook_health_state SET
        next_check_at = now() + (${result.delaySeconds} * interval '1 second'), claimed_at = NULL,
        last_error_code = ${result.errorCode!}, consecutive_failure_count = consecutive_failure_count + 1,
        updated_at = now()
      WHERE connection_id = ${connectionId}
    `;
  }

  async listMailchimpWebhookHealthStates(workspaceId: string): Promise<StoredMailchimpWebhookHealthState[]> {
    return this.sql<StoredMailchimpWebhookHealthState[]>`
      SELECT state.connection_id, state.next_check_at, state.attempt_count,
        state.claimed_at, state.last_checked_at, state.last_health_code,
        state.consecutive_failure_count, state.last_error_code
      FROM mailchimp_webhook_health_state state
      JOIN channel_connection connection ON connection.id = state.connection_id
        AND connection.workspace_id = state.workspace_id
      WHERE state.workspace_id = ${workspaceId}
      ORDER BY state.next_check_at, state.connection_id
    `;
  }

  async getMailchimpWebhookTarget(connectionId: string): Promise<MailchimpWebhookTarget | undefined> {
    return (await this.sql<MailchimpWebhookTarget[]>`
      SELECT workspace_id, id AS connection_id, configuration->>'audienceId' AS audience_id, encrypted_credentials
      FROM channel_connection
      WHERE id = ${connectionId} AND provider = 'mailchimp_email' AND status = 'active'
        AND configuration->>'audienceId' ~ '^[A-Za-z0-9_-]{1,64}$'
    `)[0];
  }

  async wakeMailchimpReportCollectionFromWebhook(input: {
    connectionId: string; audienceId: string; providerCampaignId: string; deliveryHash: string; timestamp: number;
  }): Promise<boolean> {
    if (!/^[0-9a-f]{64}$/u.test(input.deliveryHash)) throw new Error("Invalid Mailchimp webhook delivery hash");
    if (!Number.isSafeInteger(input.timestamp) || input.timestamp < 0) throw new Error("Invalid Mailchimp webhook timestamp");
    const rows = await this.sql<{ id: string }[]>`
      UPDATE mailchimp_report_collection_state state SET
        next_attempt_at = LEAST(state.next_attempt_at, now()),
        last_webhook_delivery_hash = ${input.deliveryHash}, last_webhook_timestamp = ${input.timestamp},
        last_webhook_received_at = now(), webhook_wakeup_count = state.webhook_wakeup_count + 1, updated_at = now()
      FROM publication_action action
      WHERE action.id = state.publication_action_id
        AND action.channel_connection_id = ${input.connectionId}
        AND action.provider_external_id = ${input.providerCampaignId}
        AND state.audience_id = ${input.audienceId}
        AND (state.last_webhook_timestamp IS NULL OR state.last_webhook_timestamp < ${input.timestamp})
      RETURNING state.publication_action_id AS id
    `;
    return Boolean(rows[0]);
  }

  async listPublicationActions(
    workspaceId: string,
    campaignInstanceId: string,
  ): Promise<StoredPublicationAction[]> {
    return this.sql<StoredPublicationAction[]>`
      SELECT action.id, action.workspace_id, action.campaign_instance_id, action.campaign_step_run_id, action.channel_connection_id,
        connection.provider,
        action.action_type, action.status, action.idempotency_key, action.request_snapshot,
        action.provider_external_id, action.provider_url, action.response_metadata, action.last_error
      FROM publication_action action JOIN channel_connection connection ON connection.id = action.channel_connection_id
      WHERE action.workspace_id = ${workspaceId} AND action.campaign_instance_id = ${campaignInstanceId}
      ORDER BY action.started_at DESC
    `;
  }

  async getMailchimpCampaignReportTarget(
    workspaceId: string,
    publicationActionId: string,
  ): Promise<{ action: StoredPublicationAction; connection: StoredChannelConnection; audienceId: string } | undefined> {
    const action = (
      await this.sql<(StoredPublicationAction & { reportAudienceId: string })[]>`
        SELECT action.id, action.workspace_id, action.campaign_instance_id, action.campaign_step_run_id,
          action.channel_connection_id, connection.provider, action.action_type, action.status,
          action.idempotency_key, action.request_snapshot, action.provider_external_id, action.provider_url,
          action.response_metadata, action.last_error, collection.audience_id AS report_audience_id
        FROM publication_action action
        JOIN channel_connection connection ON connection.id = action.channel_connection_id
        JOIN mailchimp_report_collection_state collection ON collection.publication_action_id = action.id
        WHERE action.workspace_id = ${workspaceId} AND action.id = ${publicationActionId}
          AND connection.workspace_id = action.workspace_id AND connection.provider = 'mailchimp_email'
      `
    )[0];
    if (!action) return undefined;
    const connection = await this.getChannelConnection(workspaceId, action.channelConnectionId);
    if (!connection) return undefined;
    return { action, connection, audienceId: action.reportAudienceId };
  }

  async recordMailchimpCampaignReportSnapshot(
    workspaceId: string,
    publicationActionId: string,
    report: MailchimpCampaignReportInput,
    actorUserId: string,
  ): Promise<{ snapshot: StoredMailchimpCampaignReportSnapshot; created: boolean; publicationReconciled: boolean }> {
    const canonical = JSON.stringify({
      campaignId: report.campaignId, audienceId: report.audienceId, emailsSent: report.emailsSent,
      opensTotal: report.opensTotal, uniqueOpens: report.uniqueOpens, clicksTotal: report.clicksTotal,
      uniqueClicks: report.uniqueClicks, unsubscribed: report.unsubscribed, hardBounces: report.hardBounces,
      softBounces: report.softBounces, abuseReports: report.abuseReports, sendTime: report.sendTime,
    });
    const snapshotHash = createHash("sha256").update(canonical).digest("hex");
    return this.sql.begin(async (transaction) => {
      const target = (
        await transaction<{
          status: StoredPublicationAction["status"];
          campaignInstanceId: string;
          requestedBy: string;
          successCriteria: CampaignSuccessCriterion[];
          successAction: "notify_only" | "pause";
        }[]>`
          SELECT action.status, action.campaign_instance_id, instance.requested_by,
            version.success_criteria, version.success_action
          FROM publication_action action
          JOIN channel_connection connection ON connection.id = action.channel_connection_id
          JOIN mailchimp_report_collection_state collection ON collection.publication_action_id = action.id
          JOIN campaign_instance instance ON instance.id = action.campaign_instance_id
          JOIN campaign_version version ON version.id = instance.campaign_version_id
          WHERE action.workspace_id = ${workspaceId} AND action.id = ${publicationActionId}
            AND connection.workspace_id = action.workspace_id AND connection.provider = 'mailchimp_email'
            AND action.provider_external_id = ${report.campaignId}
            AND collection.workspace_id = action.workspace_id
            AND collection.audience_id = ${report.audienceId}
          FOR UPDATE OF action
        `
      )[0];
      if (!target) throw new Error("Mailchimp report must match the exact workspace publication, Campaign, and audience");
      const id = randomUUID();
      const inserted = await transaction<{ id: string }[]>`
        INSERT INTO mailchimp_campaign_report_snapshot (
          id, workspace_id, publication_action_id, provider_campaign_id, audience_id, snapshot_hash,
          emails_sent, opens_total, unique_opens, clicks_total, unique_clicks, unsubscribed,
          hard_bounces, soft_bounces, abuse_reports, send_time, created_by
        ) VALUES (
          ${id}, ${workspaceId}, ${publicationActionId}, ${report.campaignId}, ${report.audienceId}, ${snapshotHash},
          ${report.emailsSent}, ${report.opensTotal}, ${report.uniqueOpens}, ${report.clicksTotal},
          ${report.uniqueClicks}, ${report.unsubscribed}, ${report.hardBounces}, ${report.softBounces},
          ${report.abuseReports}, ${report.sendTime}, ${actorUserId}
        ) ON CONFLICT (publication_action_id, snapshot_hash) DO NOTHING RETURNING id
      `;
      const publicationReconciled = target.status !== "succeeded";
      if (publicationReconciled) await transaction`
        UPDATE publication_action SET status = 'succeeded', last_error = null,
          response_metadata = response_metadata || ${transaction.json({ reportReconciled: true } as JSONValue)},
          completed_at = COALESCE(completed_at, now()), updated_at = now()
        WHERE id = ${publicationActionId} AND workspace_id = ${workspaceId}
      `;
      if (inserted[0] || publicationReconciled) await transaction`
        INSERT INTO audit_event (id, organization_id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
        SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, 'publication.mailchimp_report_reconciled',
          'publication_action', ${publicationActionId},
          ${transaction.json({ campaignId: report.campaignId, snapshotHash, publicationReconciled } as JSONValue)}
        FROM workspace WHERE id = ${workspaceId}
      `;
      const snapshot = (
        await transaction<StoredMailchimpCampaignReportSnapshot[]>`
          SELECT id, workspace_id, publication_action_id, provider_campaign_id AS campaign_id,
            audience_id, snapshot_hash, emails_sent, opens_total,
            unique_opens, clicks_total, unique_clicks, unsubscribed, hard_bounces, soft_bounces,
            abuse_reports, send_time, observed_at
          FROM mailchimp_campaign_report_snapshot
          WHERE publication_action_id = ${publicationActionId} AND snapshot_hash = ${snapshotHash}
        `
      )[0];
      if (!snapshot) throw new Error("Mailchimp report snapshot was not available after reconciliation");
      const providerMetrics: readonly [ProviderAggregateMetricType, number][] = [
        ["email_sent", report.emailsSent],
        ["email_unique_open", report.uniqueOpens],
        ["email_unique_click", report.uniqueClicks],
        ["email_unsubscribe", report.unsubscribed],
        ["email_bounce", report.hardBounces + report.softBounces],
        ["email_complaint", report.abuseReports],
      ];
      if (providerMetrics.some(([, total]) => !Number.isSafeInteger(total)))
        throw new Error("Mailchimp aggregate metric totals must remain safe integers");
      for (const [metricType, metricTotal] of providerMetrics) await transaction`
        INSERT INTO campaign_provider_metric_total (
          workspace_id, campaign_instance_id, publication_action_id, report_snapshot_id,
          metric_type, metric_total, observed_at
        ) VALUES (
          ${workspaceId}, ${target.campaignInstanceId}, ${publicationActionId}, ${snapshot.id},
          ${metricType}, ${metricTotal}, ${snapshot.observedAt}
        ) ON CONFLICT (publication_action_id, metric_type) DO UPDATE SET
          report_snapshot_id = EXCLUDED.report_snapshot_id,
          metric_total = EXCLUDED.metric_total,
          observed_at = EXCLUDED.observed_at,
          updated_at = now()
        WHERE campaign_provider_metric_total.report_snapshot_id IS DISTINCT FROM EXCLUDED.report_snapshot_id
          OR campaign_provider_metric_total.metric_total IS DISTINCT FROM EXCLUDED.metric_total
      `;
      const eventTotals = await transaction<{ eventType: string; count: number }[]>`
        SELECT event_type, count(*)::integer AS count FROM measurement_event
        WHERE workspace_id = ${workspaceId} AND campaign_instance_id = ${target.campaignInstanceId}
        GROUP BY event_type
      `;
      const providerTotals = await transaction<{ eventType: string; count: number }[]>`
        SELECT metric_type AS event_type, sum(metric_total)::float8 AS count
        FROM campaign_provider_metric_total
        WHERE workspace_id = ${workspaceId} AND campaign_instance_id = ${target.campaignInstanceId}
        GROUP BY metric_type
      `;
      const currencyRows = await transaction<{ eventType: string; currency: string; value: number }[]>`
        SELECT event_type, currency, COALESCE(sum(value), 0)::float8 AS value
        FROM measurement_event
        WHERE workspace_id = ${workspaceId} AND campaign_instance_id = ${target.campaignInstanceId}
          AND currency IS NOT NULL AND value IS NOT NULL
        GROUP BY event_type, currency
      `;
      const totals = Object.fromEntries([...eventTotals, ...providerTotals].map((row) => [row.eventType, { count: row.count }]));
      const currencyTotals: Record<string, Record<string, number>> = {};
      for (const row of currencyRows) (currencyTotals[row.eventType] ??= {})[row.currency] = row.value;
      const evaluation = evaluateCampaignSuccess(target.successCriteria, totals, currencyTotals);
      if (evaluation.allCriteriaMet) await transaction`
        INSERT INTO campaign_workflow_command (
          id, workspace_id, campaign_instance_id, command_type, idempotency_key, payload, actor_user_id
        ) VALUES (
          ${randomUUID()}, ${workspaceId}, ${target.campaignInstanceId}, 'success_criteria_met',
          ${`campaign:${target.campaignInstanceId}:success-criteria-met`},
          ${transaction.json({
            criteria: evaluation.criteria,
            action: target.successAction,
            measuredAt: new Date().toISOString(),
            triggerKey: `mailchimp-report:${snapshot.id}`,
            triggerSource: "mailchimp_campaign_report",
          } as unknown as JSONValue)}, ${target.requestedBy}
        ) ON CONFLICT (idempotency_key) DO NOTHING
      `;
      return { snapshot, created: Boolean(inserted[0]), publicationReconciled };
    });
  }

  async listMailchimpCampaignReportSnapshots(
    workspaceId: string,
    campaignInstanceId: string,
  ): Promise<StoredMailchimpCampaignReportSnapshot[]> {
    return this.sql<StoredMailchimpCampaignReportSnapshot[]>`
      SELECT snapshot.id, snapshot.workspace_id, snapshot.publication_action_id,
        snapshot.provider_campaign_id AS campaign_id,
        snapshot.audience_id, snapshot.snapshot_hash,
        snapshot.emails_sent, snapshot.opens_total, snapshot.unique_opens, snapshot.clicks_total,
        snapshot.unique_clicks, snapshot.unsubscribed, snapshot.hard_bounces, snapshot.soft_bounces,
        snapshot.abuse_reports, snapshot.send_time, snapshot.observed_at
      FROM mailchimp_campaign_report_snapshot snapshot
      JOIN publication_action action ON action.id = snapshot.publication_action_id
      WHERE snapshot.workspace_id = ${workspaceId} AND action.campaign_instance_id = ${campaignInstanceId}
      ORDER BY snapshot.observed_at DESC LIMIT 100
    `;
  }

  async retryPublicationAction(
    id: string,
    target: CampaignExecutionTarget,
    request: { content: string; subject?: string },
  ): Promise<boolean> {
    // Only a failed action bound to this exact execution may be claimed. A stale
    // contender must not change a dispatch already owned (or completed) elsewhere.
    const action = (await this.sql<StoredPublicationAction[]>`
      SELECT id, workspace_id, campaign_instance_id, campaign_step_run_id, channel_connection_id,
        status, request_snapshot
      FROM publication_action WHERE id = ${id}
    `)[0];
    if (!action || !target.connection || action.workspaceId !== target.workspaceId
      || action.campaignInstanceId !== target.campaignInstanceId
      || action.campaignStepRunId !== target.campaignStepRunId
      || action.channelConnectionId !== target.connection.id) {
      throw new CampaignValidationError([{ code: "publication_target_mismatch", message: "Publication retry does not match its original workspace, campaign, step, and connection." }]);
    }
    if (action.status !== "failed") return false;
    if (action.requestSnapshot.content !== request.content
      || (action.requestSnapshot.subject ?? undefined) !== request.subject) {
      throw new CampaignValidationError([{ code: "publication_target_mismatch", message: "Publication retry content differs from its original rendered request." }]);
    }

    await new CampaignRepository(this.sql).assertStepExecutionAuthorized(target.campaignInstanceId, target.stepKey);
    const currentTarget = await this.getCampaignExecutionTarget(target.campaignInstanceId, target.stepKey);
    const connection = currentTarget?.connection;
    if (!currentTarget || currentTarget.workspaceId !== target.workspaceId
      || currentTarget.campaignId !== target.campaignId
      || currentTarget.campaignStepRunId !== target.campaignStepRunId
      || currentTarget.channelConnectionId !== target.connection.id
      || currentTarget.operationType !== "publish_content"
      || !connection || connection.status !== "active" || connection.provider !== target.connection.provider
      || connection.encryptedCredentials !== target.connection.encryptedCredentials
      || target.connection.workspaceId !== target.workspaceId
      || (target.channelConnectionId && target.channelConnectionId !== connection.id)) {
      throw new CampaignValidationError([{ code: "publication_target_mismatch", message: "Publication retry target no longer matches the active campaign version, step, and workspace connection." }]);
    }
    if (["mailchimp_email", "slack_webhook", "mastodon_account"].includes(connection.provider) && !currentTarget.humanApprovalGranted) {
      throw new CampaignValidationError([{ code: "publication_approval_required", message: "This provider requires a recorded human approval for the campaign or exact action." }]);
    }
    const previewId = currentTarget.input.draftChannelPreviewId;
    if ((typeof previewId === "string" || action.requestSnapshot.draftChannelPreviewId !== undefined) && (!currentTarget.draftPreviewEligible
      || previewId !== action.requestSnapshot.draftChannelPreviewId
      || currentTarget.draftPreviewVersionId !== action.requestSnapshot.draftVersionId
      || currentTarget.draftPreviewVersionId !== target.draftPreviewVersionId)) {
      throw new CampaignValidationError([{ code: "publication_target_mismatch", message: "Publication retry requires its original exact approved Draft preview." }]);
    }
    const preflight = action.requestSnapshot.providerPreflight;
    const identity = preflight && typeof preflight === "object" && !Array.isArray(preflight)
      ? (preflight as Record<string, unknown>).targetIdentity : undefined;
    const identityKeys = connection.provider === "discord_webhook" ? ["webhookId", "guildId", "channelId"]
      : connection.provider === "slack_webhook" ? ["teamId", "serviceId", "host"]
        : connection.provider === "mastodon_account" ? ["accountId", "instanceOrigin", "host"]
          : ["audienceId", "dataCenter"];
    const requiredIdentityKeys = connection.provider === "discord_webhook" ? ["webhookId", "channelId"] : identityKeys;
    // Legacy failures without a recorded provider identity cannot safely be
    // re-sent to an account which might have changed behind the same connection.
    if (!identity || typeof identity !== "object" || Array.isArray(identity)
      || requiredIdentityKeys.some((key) => typeof (identity as Record<string, unknown>)[key] !== "string"
        || !(identity as Record<string, unknown>)[key])
      || identityKeys.some((key) => {
        const original = (identity as Record<string, unknown>)[key];
        return original !== undefined && original !== connection.configuration[key];
      })) {
      throw new CampaignValidationError([{ code: "publication_target_mismatch", message: "Publication retry provider identity is missing or differs from the original account." }]);
    }
    const claimed = await this.sql<{ id: string }[]>`
      UPDATE publication_action SET status = 'dispatching', last_error = null, completed_at = null, updated_at = now()
      WHERE id = ${id} AND status = 'failed'
        AND workspace_id = ${target.workspaceId} AND campaign_instance_id = ${target.campaignInstanceId}
        AND campaign_step_run_id = ${target.campaignStepRunId} AND channel_connection_id = ${connection.id}
        AND EXISTS (
          SELECT 1 FROM campaign_instance instance
          JOIN campaign_version version ON version.id = instance.campaign_version_id
          JOIN campaign_step_run run ON run.campaign_instance_id = instance.id
          JOIN campaign_step step ON step.id = run.campaign_step_id AND step.campaign_version_id = instance.campaign_version_id
          JOIN channel_connection current_connection ON current_connection.id = ${connection.id}
            AND current_connection.workspace_id = instance.workspace_id
          WHERE instance.id = ${target.campaignInstanceId} AND instance.workspace_id = ${target.workspaceId}
            AND instance.campaign_id = ${target.campaignId} AND instance.status = 'active'
            AND run.id = ${target.campaignStepRunId} AND run.status = 'running' AND step.step_key = ${target.stepKey}
            AND current_connection.status = 'active' AND current_connection.provider = ${connection.provider}
            AND current_connection.encrypted_credentials = ${connection.encryptedCredentials}
            AND current_connection.configuration = ${this.sql.json(connection.configuration as JSONValue)}
            AND current_connection.capabilities = ${this.sql.json(target.connection.capabilities as JSONValue)}
            AND version.autonomy_mode IN ('approval_required', 'approve_uncertain', 'approve_first_occurrence', 'campaign_approval', 'confidence_based', 'fully_autonomous', 'custom')
            AND (version.autonomy_mode <> 'campaign_approval' OR EXISTS (
              SELECT 1 FROM campaign_approval approval WHERE approval.campaign_instance_id = instance.id
                AND approval.workspace_id = instance.workspace_id AND approval.campaign_step_run_id IS NULL
                AND approval.status = 'approved' AND approval.request_snapshot->>'campaignVersionId' = instance.campaign_version_id::text
            ))
            AND ((version.autonomy_mode IN ('fully_autonomous', 'custom', 'campaign_approval') AND NOT step.approval_required) OR EXISTS (
              SELECT 1 FROM campaign_approval approval WHERE approval.campaign_instance_id = instance.id
                AND approval.workspace_id = instance.workspace_id AND approval.campaign_step_run_id = run.id AND approval.status = 'approved'
            ))
            AND (current_connection.provider = 'discord_webhook' OR EXISTS (
              SELECT 1 FROM campaign_approval approval WHERE approval.campaign_instance_id = instance.id
                AND approval.workspace_id = instance.workspace_id AND approval.status = 'approved'
                AND (approval.campaign_step_run_id = run.id OR (version.autonomy_mode = 'campaign_approval'
                  AND approval.campaign_step_run_id IS NULL AND approval.request_snapshot->>'campaignVersionId' = instance.campaign_version_id::text))
            ))
            AND step.schedule_type IN ('immediate', 'exact_time', 'dependency')
            AND (step.schedule_type <> 'exact_time' OR step.scheduled_at <= now())
            AND step.condition = '{}'::jsonb
            AND NOT EXISTS (
              SELECT 1 FROM unnest(step.depends_on) dependency(step_key) WHERE NOT EXISTS (
                SELECT 1 FROM campaign_step predecessor JOIN campaign_step_run completed ON completed.campaign_step_id = predecessor.id
                WHERE predecessor.campaign_version_id = instance.campaign_version_id AND predecessor.step_key = dependency.step_key
                  AND completed.campaign_instance_id = instance.id AND completed.status IN ('succeeded', 'partially_succeeded')
              )
            )
            AND (${typeof previewId !== "string"} OR EXISTS (
              SELECT 1 FROM draft_channel_preview preview
              JOIN content_draft_version preview_version ON preview_version.id = preview.content_draft_version_id
              JOIN content_draft draft ON draft.id = preview.content_draft_id AND draft.current_version_id = preview_version.id
              WHERE preview.id::text = ${typeof previewId === "string" ? previewId : null}
                AND preview.workspace_id = instance.workspace_id AND preview.channel_connection_id = current_connection.id
                AND preview.status = 'ready' AND preview_version.status = 'approved'
                AND preview.content_draft_version_id::text = ${currentTarget.draftPreviewVersionId ?? null}
                AND preview.capability_observed_at = current_connection.capabilities_observed_at
            ))
        )
      RETURNING id
    `;
    return Boolean(claimed[0]);
  }

  async createTrackedLink(input: {
    workspaceId: string;
    destinationId: string;
    campaignInstanceId?: string;
    campaignStepRunId?: string;
    utmParameters?: Record<string, string>;
    expiresAt?: string;
    createdBy: string;
  }): Promise<StoredTrackedLink> {
    if (input.campaignStepRunId) {
      const existing = (
        await this.sql<{ slug: string }[]>`
        SELECT slug
        FROM tracked_link WHERE campaign_step_run_id = ${input.campaignStepRunId}
      `
      )[0];
      if (existing) return (await this.getTrackedLink(existing.slug))!;
    }
    const destination = (
      await this.sql<{ canonicalUrl: string; status: string }[]>`
      SELECT canonical_url, status FROM destination WHERE id = ${input.destinationId} AND workspace_id = ${input.workspaceId}
    `
    )[0];
    if (!destination || destination.status !== "published")
      throw new Error(
        "Tracked links require a published workspace Destination",
      );
    const id = randomUUID();
    const slug = randomBytes(12).toString("base64url");
    await this.sql`
      INSERT INTO tracked_link (id, workspace_id, destination_id, campaign_instance_id, campaign_step_run_id,
        slug, canonical_url, utm_parameters, expires_at, created_by)
      VALUES (${id}, ${input.workspaceId}, ${input.destinationId}, ${input.campaignInstanceId ?? null}, ${input.campaignStepRunId ?? null},
        ${slug}, ${destination.canonicalUrl}, ${this.sql.json((input.utmParameters ?? {}) as JSONValue)}, ${input.expiresAt ?? null}, ${input.createdBy})
    `;
    return (await this.getTrackedLink(slug))!;
  }

  async getTrackedLink(slug: string): Promise<StoredTrackedLink | undefined> {
    const row = (
      await this.sql<
        (Omit<StoredTrackedLink, "utmParameters"> & {
          utmParametersJson: string;
        })[]
      >`
      SELECT id, workspace_id, destination_id, campaign_instance_id, campaign_step_run_id,
        draft_channel_preview_id, slug, canonical_url, utm_parameters::text AS utm_parameters_json,
        status, expires_at, created_at
      FROM tracked_link WHERE slug = ${slug}
    `
    )[0];
    if (!row) return undefined;
    const { utmParametersJson, ...link } = row;
    return {
      ...link,
      utmParameters: JSON.parse(utmParametersJson) as Record<string, string>,
    };
  }

  async createMeasurementKey(
    workspaceId: string,
    name: string,
    actorUserId: string,
    options: {
      allowedEventTypes?: readonly MeasurementEventType[];
      allowedCampaignIds?: readonly string[];
      expiresAt?: string;
    } = {},
  ): Promise<{ id: string; secret: string; prefix: string }> {
    const id = randomUUID();
    const secret = `mm_live_${randomBytes(32).toString("base64url")}`;
    const prefix = secret.slice(0, 14);
    const allowedEventTypes = [
      ...new Set(options.allowedEventTypes ?? MEASUREMENT_EVENT_TYPES),
    ];
    if (
      !allowedEventTypes.length ||
      allowedEventTypes.some(
        (eventType) => !MEASUREMENT_EVENT_TYPES.includes(eventType),
      )
    ) {
      throw new Error(
        "Measurement key scope must contain supported event types",
      );
    }
    const expiresAt = options.expiresAt
      ? new Date(options.expiresAt)
      : undefined;
    if (
      expiresAt &&
      (!Number.isFinite(expiresAt.getTime()) ||
        expiresAt.getTime() <= Date.now())
    ) {
      throw new Error("Measurement key expiry must be in the future");
    }
    const allowedCampaignIds = [...new Set(options.allowedCampaignIds ?? [])];
    if (
      allowedCampaignIds.length !== (options.allowedCampaignIds ?? []).length ||
      allowedCampaignIds.length > 100
    ) {
      throw new Error(
        "Measurement key Campaign scope must contain up to 100 unique Campaigns",
      );
    }
    const campaignScopeMode = allowedCampaignIds.length ? "restricted" : "all";
    await this.sql.begin(async (transaction) => {
      if (allowedCampaignIds.length) {
        const campaigns = await transaction<{ id: string }[]>`
          SELECT id FROM campaign
          WHERE workspace_id = ${workspaceId} AND id IN ${transaction(allowedCampaignIds)}
        `;
        if (campaigns.length !== allowedCampaignIds.length)
          throw new Error(
            "Measurement key Campaign scope must belong to the workspace",
          );
      }
      await transaction`
        INSERT INTO measurement_ingest_key (id, workspace_id, name, key_prefix, key_hash, allowed_event_types, campaign_scope_mode, expires_at, created_by)
        VALUES (${id}, ${workspaceId}, ${name}, ${prefix}, ${hash(secret)}, ${allowedEventTypes}::text[], ${campaignScopeMode}, ${expiresAt ?? null}, ${actorUserId})
      `;
      for (const campaignId of allowedCampaignIds)
        await transaction`
          INSERT INTO measurement_ingest_key_campaign_scope (measurement_ingest_key_id, campaign_id)
          VALUES (${id}, ${campaignId})
        `;
      await transaction`
        INSERT INTO audit_event (id, organization_id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
        SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, 'measurement.key.created', 'measurement_ingest_key', ${id},
          ${transaction.json({ name, keyPrefix: prefix, allowedEventTypes, campaignScopeMode, allowedCampaignIds, expiresAt: expiresAt?.toISOString() } as JSONValue)} FROM workspace WHERE id = ${workspaceId}
      `;
    });
    return { id, secret, prefix };
  }

  async listMeasurementKeys(
    workspaceId: string,
  ): Promise<StoredMeasurementKey[]> {
    return this.sql`
      SELECT id, name, key_prefix,
        CASE WHEN status = 'revoked' THEN 'revoked'
          WHEN expires_at IS NOT NULL AND expires_at <= now() THEN 'expired' ELSE 'active' END AS status,
        allowed_event_types, campaign_scope_mode,
        ARRAY(SELECT scope.campaign_id FROM measurement_ingest_key_campaign_scope scope
          WHERE scope.measurement_ingest_key_id = measurement_ingest_key.id ORDER BY scope.campaign_id) AS allowed_campaign_ids,
        created_at, last_used_at, expires_at, revoked_at
      FROM measurement_ingest_key WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC
    `;
  }

  async revokeMeasurementKey(
    workspaceId: string,
    id: string,
    actorUserId: string,
  ): Promise<boolean> {
    return this.sql.begin(async (transaction) => {
      const revoked = await transaction<
        { id: string; name: string; keyPrefix: string }[]
      >`
        UPDATE measurement_ingest_key SET status = 'revoked', revoked_at = now()
        WHERE workspace_id = ${workspaceId} AND id = ${id} AND status = 'active'
        RETURNING id, name, key_prefix
      `;
      if (!revoked[0]) return false;
      await transaction`
        INSERT INTO audit_event (id, organization_id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
        SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, 'measurement.key.revoked', 'measurement_ingest_key', ${id},
          ${transaction.json({ name: revoked[0].name, keyPrefix: revoked[0].keyPrefix } as JSONValue)} FROM workspace WHERE id = ${workspaceId}
      `;
      return true;
    });
  }

  async authenticateMeasurementKey(
    secret: string,
  ): Promise<MeasurementKeyPrincipal | undefined> {
    const rows = await this.sql<MeasurementKeyPrincipal[]>`
      WITH authenticated AS (
        UPDATE measurement_ingest_key SET last_used_at = now()
        WHERE key_hash = ${hash(secret)} AND status = 'active'
          AND (expires_at IS NULL OR expires_at > now())
        RETURNING id, workspace_id, allowed_event_types, campaign_scope_mode
      )
      SELECT authenticated.id, authenticated.workspace_id, authenticated.allowed_event_types,
        authenticated.campaign_scope_mode,
        ARRAY(SELECT scope.campaign_id FROM measurement_ingest_key_campaign_scope scope
          WHERE scope.measurement_ingest_key_id = authenticated.id ORDER BY scope.campaign_id) AS allowed_campaign_ids
      FROM authenticated
    `;
    return rows[0];
  }

  async isMeasurementCampaignAllowed(
    principal: MeasurementKeyPrincipal,
    input: {
      campaignId?: string;
      campaignInstanceId?: string;
      campaignStepRunId?: string;
      trackedLinkId?: string;
      publicationActionId?: string;
    },
  ): Promise<boolean> {
    if (principal.campaignScopeMode === "all") return true;
    const roots = await this.sql<{ campaignId: string }[]>`
      SELECT DISTINCT campaign_id FROM (
        SELECT id AS campaign_id FROM campaign
          WHERE ${input.campaignId ?? null}::uuid IS NOT NULL
            AND id = ${input.campaignId ?? null} AND workspace_id = ${principal.workspaceId}
        UNION ALL
        SELECT campaign_id FROM campaign_instance
          WHERE ${input.campaignInstanceId ?? null}::uuid IS NOT NULL
            AND id = ${input.campaignInstanceId ?? null} AND workspace_id = ${principal.workspaceId}
        UNION ALL
        SELECT instance.campaign_id FROM campaign_step_run run
          JOIN campaign_instance instance ON instance.id = run.campaign_instance_id
          WHERE ${input.campaignStepRunId ?? null}::uuid IS NOT NULL
            AND run.id = ${input.campaignStepRunId ?? null} AND instance.workspace_id = ${principal.workspaceId}
        UNION ALL
        SELECT instance.campaign_id FROM tracked_link link
          JOIN campaign_instance instance ON instance.id = link.campaign_instance_id
          WHERE ${input.trackedLinkId ?? null}::uuid IS NOT NULL
            AND link.id = ${input.trackedLinkId ?? null} AND link.workspace_id = ${principal.workspaceId}
        UNION ALL
        SELECT instance.campaign_id FROM publication_action action
          JOIN campaign_instance instance ON instance.id = action.campaign_instance_id
          WHERE ${input.publicationActionId ?? null}::uuid IS NOT NULL
            AND action.id = ${input.publicationActionId ?? null} AND action.workspace_id = ${principal.workspaceId}
      ) resolved
    `;
    return (
      roots.length === 1 &&
      principal.allowedCampaignIds.includes(roots[0].campaignId)
    );
  }

  async recordMeasurementEvent(input: {
    workspaceId: string;
    eventKey: string;
    eventType: MeasurementEventType;
    source: string;
    campaignId?: string;
    campaignInstanceId?: string;
    campaignStepRunId?: string;
    destinationId?: string;
    trackedLinkId?: string;
    publicationActionId?: string;
    externalEventId?: string;
    value?: number;
    currency?: string;
    properties?: Record<string, unknown>;
    occurredAt: string;
  }): Promise<boolean> {
    return this.sql.begin(async (transaction) => {
      if (input.campaignInstanceId) {
        const locked = await transaction<{ id: string }[]>`
          SELECT id FROM campaign_instance
          WHERE id = ${input.campaignInstanceId} AND workspace_id = ${input.workspaceId}
          FOR UPDATE
        `;
        if (!locked[0])
          throw new Error(
            "Measurement event references must belong to the ingest key workspace",
          );
      }
      const references = (
        await transaction<{ valid: boolean }[]>`
        SELECT
          (${input.campaignId ?? null}::uuid IS NULL OR EXISTS (SELECT 1 FROM campaign WHERE id = ${input.campaignId ?? null} AND workspace_id = ${input.workspaceId})) AND
          (${input.campaignInstanceId ?? null}::uuid IS NULL OR EXISTS (SELECT 1 FROM campaign_instance WHERE id = ${input.campaignInstanceId ?? null} AND workspace_id = ${input.workspaceId})) AND
          (${input.campaignStepRunId ?? null}::uuid IS NULL OR EXISTS (SELECT 1 FROM campaign_step_run r JOIN campaign_instance i ON i.id = r.campaign_instance_id WHERE r.id = ${input.campaignStepRunId ?? null} AND i.workspace_id = ${input.workspaceId})) AND
          (${input.destinationId ?? null}::uuid IS NULL OR EXISTS (SELECT 1 FROM destination WHERE id = ${input.destinationId ?? null} AND workspace_id = ${input.workspaceId})) AND
          (${input.trackedLinkId ?? null}::uuid IS NULL OR EXISTS (SELECT 1 FROM tracked_link WHERE id = ${input.trackedLinkId ?? null} AND workspace_id = ${input.workspaceId})) AND
          (${input.publicationActionId ?? null}::uuid IS NULL OR EXISTS (SELECT 1 FROM publication_action WHERE id = ${input.publicationActionId ?? null} AND workspace_id = ${input.workspaceId})) AS valid
      `
      )[0];
      if (!references.valid)
        throw new Error(
          "Measurement event references must belong to the ingest key workspace",
        );
      const inserted = await transaction<{ id: string }[]>`
        INSERT INTO measurement_event (id, workspace_id, event_key, event_type, source, campaign_id,
          campaign_instance_id, campaign_step_run_id, destination_id, tracked_link_id, publication_action_id,
          external_event_id, value, currency, properties, occurred_at)
        VALUES (${randomUUID()}, ${input.workspaceId}, ${input.eventKey}, ${input.eventType}, ${input.source},
          ${input.campaignId ?? null}, ${input.campaignInstanceId ?? null}, ${input.campaignStepRunId ?? null},
          ${input.destinationId ?? null}, ${input.trackedLinkId ?? null}, ${input.publicationActionId ?? null},
          ${input.externalEventId ?? null}, ${input.value ?? null}, ${input.currency ?? null},
          ${transaction.json((input.properties ?? {}) as JSONValue)}, ${input.occurredAt})
        ON CONFLICT (workspace_id, event_key) DO NOTHING RETURNING id
      `;
      if (!inserted[0] || !input.campaignInstanceId)
        return Boolean(inserted[0]);

      const instance = (
        await transaction<
          {
            successCriteria: CampaignSuccessCriterion[];
            successAction: "notify_only" | "pause";
            requestedBy: string;
          }[]
        >`
          SELECT cv.success_criteria, cv.success_action, ci.requested_by
          FROM campaign_instance ci JOIN campaign_version cv ON cv.id = ci.campaign_version_id
          WHERE ci.workspace_id = ${input.workspaceId} AND ci.id = ${input.campaignInstanceId}
        `
      )[0];
      const totalsRows = await transaction<
        { eventType: string; count: number }[]
      >`
        SELECT event_type, count(*)::integer AS count
        FROM measurement_event
        WHERE workspace_id = ${input.workspaceId} AND campaign_instance_id = ${input.campaignInstanceId}
        GROUP BY event_type
      `;
      const currencyRows = await transaction<
        { eventType: string; currency: string; value: number }[]
      >`
        SELECT event_type, currency, COALESCE(sum(value), 0)::float8 AS value
        FROM measurement_event
        WHERE workspace_id = ${input.workspaceId} AND campaign_instance_id = ${input.campaignInstanceId}
          AND currency IS NOT NULL AND value IS NOT NULL
        GROUP BY event_type, currency
      `;
      const totals = Object.fromEntries(
        totalsRows.map((row) => [row.eventType, { count: row.count }]),
      );
      const currencyTotals: Record<string, Record<string, number>> = {};
      for (const row of currencyRows)
        (currencyTotals[row.eventType] ??= {})[row.currency] = row.value;
      const evaluation = evaluateCampaignSuccess(
        instance.successCriteria,
        totals,
        currencyTotals,
      );
      if (evaluation.allCriteriaMet) {
        const payload = {
          criteria: evaluation.criteria,
          action: instance.successAction,
          measuredAt: new Date().toISOString(),
          triggerKey: input.eventKey,
          triggerSource: "measurement_event",
          triggerEventKey: input.eventKey,
        };
        await transaction`
          INSERT INTO campaign_workflow_command (
            id, workspace_id, campaign_instance_id, command_type, idempotency_key, payload, actor_user_id
          ) VALUES (
            ${randomUUID()}, ${input.workspaceId}, ${input.campaignInstanceId}, 'success_criteria_met',
            ${`campaign:${input.campaignInstanceId}:success-criteria-met`},
            ${transaction.json(payload as unknown as JSONValue)}, ${instance.requestedBy}
          ) ON CONFLICT (idempotency_key) DO NOTHING
        `;
      }
      return true;
    });
  }

  async recordTrackedVisit(
    link: StoredTrackedLink,
    eventKey = randomUUID(),
  ): Promise<void> {
    await this.recordMeasurementEvent({
      workspaceId: link.workspaceId,
      eventKey,
      eventType: "destination_visit",
      source: "tracked_link",
      campaignInstanceId: link.campaignInstanceId,
      campaignStepRunId: link.campaignStepRunId,
      destinationId: link.destinationId,
      trackedLinkId: link.id,
      occurredAt: new Date().toISOString(),
    });
  }

  async getCampaignMeasurementSummary(
    workspaceId: string,
    campaignInstanceId: string,
  ): Promise<MeasurementSummary> {
    const instance = (
      await this.sql<{ successCriteria: CampaignSuccessCriterion[] }[]>`
      SELECT cv.success_criteria
      FROM campaign_instance ci JOIN campaign_version cv ON cv.id = ci.campaign_version_id
      WHERE ci.workspace_id = ${workspaceId} AND ci.id = ${campaignInstanceId}
    `
    )[0];
    const rows = await this.sql<
      {
        eventType: string;
        count: number;
        value: number;
        firstEventAt?: string;
        lastEventAt?: string;
      }[]
    >`
      SELECT event_type, count(*)::integer AS count,
        COALESCE(sum(value) FILTER (WHERE currency IS NULL), 0)::float8 AS value,
        min(occurred_at) AS first_event_at, max(occurred_at) AS last_event_at
      FROM measurement_event WHERE workspace_id = ${workspaceId} AND campaign_instance_id = ${campaignInstanceId}
      GROUP BY event_type ORDER BY event_type
    `;
    const currencyRows = await this.sql<
      { eventType: string; currency: string; value: number }[]
    >`
      SELECT event_type, currency, COALESCE(sum(value), 0)::float8 AS value
      FROM measurement_event
      WHERE workspace_id = ${workspaceId} AND campaign_instance_id = ${campaignInstanceId}
        AND currency IS NOT NULL AND value IS NOT NULL
      GROUP BY event_type, currency ORDER BY event_type, currency
    `;
    const providerRows = await this.sql<
      { eventType: string; count: number; lastObservedAt: string }[]
    >`
      SELECT metric_type AS event_type, sum(metric_total)::float8 AS count,
        max(observed_at) AS last_observed_at
      FROM campaign_provider_metric_total
      WHERE workspace_id = ${workspaceId} AND campaign_instance_id = ${campaignInstanceId}
      GROUP BY metric_type ORDER BY metric_type
    `;
    const totals: Record<string, { count: number; value: number }> = Object.fromEntries(
      rows.map((row) => [
        row.eventType,
        { count: row.count, value: row.value },
      ]),
    );
    const providerTotals = Object.fromEntries(providerRows.map((row) => [row.eventType, row.count]));
    for (const row of providerRows) totals[row.eventType] = { count: row.count, value: 0 };
    const currencyTotals: Record<string, Record<string, number>> = {};
    for (const row of currencyRows)
      (currencyTotals[row.eventType] ??= {})[row.currency] = row.value;
    const evaluation = evaluateCampaignSuccess(
      instance?.successCriteria ?? [],
      totals,
      currencyTotals,
    );
    const successTransition = (
      await this.sql<CampaignSuccessTransition[]>`
        SELECT status, created_at AS queued_at, completed_at AS delivered_at
        FROM campaign_workflow_command
        WHERE workspace_id = ${workspaceId} AND campaign_instance_id = ${campaignInstanceId}
          AND command_type = 'success_criteria_met'
        ORDER BY created_at LIMIT 1
      `
    )[0];
    return {
      campaignInstanceId,
      totals,
      providerTotals,
      currencyTotals,
      criteria: evaluation.criteria,
      allCriteriaMet: evaluation.allCriteriaMet,
      successTransition,
      firstEventAt: rows
        .map((row) => row.firstEventAt)
        .filter(Boolean)
        .sort()[0],
      lastEventAt: rows
        .map((row) => row.lastEventAt)
        .filter(Boolean)
        .sort()
        .at(-1),
      lastProviderObservedAt: providerRows.map((row) => row.lastObservedAt).sort().at(-1),
    };
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}
