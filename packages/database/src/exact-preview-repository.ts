import { renderChannelPreview, type ChannelCapabilityManifest } from "@market-me/connectors";
import postgres, { type TransactionSql } from "postgres";
import {
  createExactPreviewFingerprint,
  EXACT_PREVIEW_FINGERPRINT_LIMITS,
  type ExactPreviewFingerprintResult,
  type ExactPreviewSnapshotV1,
} from "./exact-preview-fingerprint";

export type ExactPreviewReadErrorCode = "preview_unavailable" | "preview_ineligible"
  | "snapshot_lossy" | "snapshot_too_large" | "render_changed" | "tracked_origin_required";

export class ExactPreviewReadError extends Error {
  constructor(readonly code: ExactPreviewReadErrorCode, message: string) {
    super(message);
    this.name = "ExactPreviewReadError";
  }
}

export interface ExactPreviewReadInput {
  readonly workspaceId: string;
  readonly previewId: string;
}

/** Labels are display-only and deliberately excluded from the exact proof. */
export interface ExactTextPreviewSelection extends ExactPreviewFingerprintResult {
  readonly connectionName: string;
  readonly destinationTitle: string | null;
}

function unavailable(): never {
  throw new ExactPreviewReadError("preview_unavailable", "The selected preview is unavailable in this workspace.");
}

function ineligible(): never {
  throw new ExactPreviewReadError("preview_ineligible", "Review a current approved text preview with an active account and valid destination.");
}

function trustedOrigin(appBaseUrl: string | undefined): string | null {
  if (!appBaseUrl) return null;
  try {
    const url = new URL(appBaseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    // Match existing trackedPreviewUrl semantics: use the origin, not a supplied path.
    return url.origin;
  } catch { return null; }
}

/**
 * Caller owns current authorization and any Campaign/preparation locks. This
 * helper only establishes the existing publication content lock order. It does
 * not itself grant access, validate a fingerprint, or open a nested transaction.
 * Always call the coherent loader again after these locks have been acquired.
 */
export async function lockExactTextPreviewInTransaction(
  transaction: TransactionSql,
  input: ExactPreviewReadInput,
): Promise<void> {
  const found = (await transaction<{
    channelConnectionId: string; contentDraftId: string; contentDraftVersionId: string;
  }[]>`
    SELECT channel_connection_id, content_draft_id, content_draft_version_id
    FROM draft_channel_preview WHERE workspace_id = ${input.workspaceId} AND id::text = ${input.previewId}
  `)[0];
  if (!found) unavailable();
  await transaction`SELECT id FROM channel_connection WHERE id = ${found.channelConnectionId} AND workspace_id = ${input.workspaceId} FOR SHARE`;
  await transaction`SELECT id FROM content_draft_approval WHERE content_draft_version_id = ${found.contentDraftVersionId} ORDER BY id FOR SHARE`;
  await transaction`SELECT id FROM content_draft WHERE id = ${found.contentDraftId} AND workspace_id = ${input.workspaceId} FOR SHARE`;
  await transaction`SELECT id FROM content_draft_version WHERE id = ${found.contentDraftVersionId} AND content_draft_id = ${found.contentDraftId} FOR SHARE`;
  const locked = (await transaction<{
    channelConnectionId: string; contentDraftId: string; contentDraftVersionId: string; destinationId: string | null;
  }[]>`
    SELECT channel_connection_id, content_draft_id, content_draft_version_id, destination_id
    FROM draft_channel_preview WHERE workspace_id = ${input.workspaceId} AND id::text = ${input.previewId} FOR UPDATE
  `)[0];
  if (!locked || locked.channelConnectionId !== found.channelConnectionId
    || locked.contentDraftId !== found.contentDraftId || locked.contentDraftVersionId !== found.contentDraftVersionId) unavailable();
  if (locked.destinationId) {
    await transaction`SELECT id FROM destination WHERE id = ${locked.destinationId} AND workspace_id = ${input.workspaceId} FOR SHARE`;
  }
  // Preview UPDATE lock also excludes ordinary attachment/linked-row insertion
  // FK key-share and preview recreation. Existing link writers are locked here.
  await transaction`SELECT id FROM tracked_link WHERE draft_channel_preview_id::text = ${input.previewId} ORDER BY id FOR SHARE`;
}

interface RawPreviewProjection {
  snapshotJson: string;
  configurationJson: string;
  configuration: Record<string, unknown>;
  connectionName: string;
  destinationTitle: string | null;
  draftStatus: string;
  versionStatus: string;
  sourceVersionStatus: string;
  campaignStatus: string;
  isCurrentVersion: boolean;
  hasApproval: boolean;
  exactObservation: boolean;
  attachmentCount: number;
  destinationAvailable: boolean;
  linkAvailable: boolean;
  timestampsInRange: boolean;
  headline: string;
  body: string;
  callToAction: string | null;
  hashtags: string[];
}

/**
 * One MVCC SELECT captures exact render, identity, lineage, raw JSON and UTC
 * microseconds. Safe for a read-only authorized choice; mutations must first
 * acquire the locks above (or the matching publication locks). Current workspace
 * membership and preparation/instance lineage are the caller's responsibility.
 * The returned token is neither approval nor a lease on future mutable state.
 */
export async function loadExactTextPreviewInTransaction(
  transaction: TransactionSql,
  input: ExactPreviewReadInput,
  options: { readonly appBaseUrl?: string } = {},
): Promise<ExactTextPreviewSelection> {
  const origin = trustedOrigin(options.appBaseUrl);
  const row = (await transaction<RawPreviewProjection[]>`
    SELECT jsonb_build_object(
      'schemaVersion', 1, 'rendererContract', 'stored-channel-preview-text-v1',
      'lineage', jsonb_build_object(
        'workspaceId', preview.workspace_id::text, 'campaignId', campaign.id::text,
        'sourceCampaignVersionId', source_version.id::text, 'generationId', generation.id::text,
        'previewId', preview.id::text, 'contentDraftId', draft.id::text,
        'contentDraftVersionId', version.id::text),
      'preview', jsonb_build_object(
        'provider', preview.provider, 'channelConnectionId', preview.channel_connection_id::text,
        'destinationId', preview.destination_id::text, 'linkMode', preview.link_mode, 'status', preview.status,
        'renderedSubject', preview.rendered_subject, 'renderedContent', preview.rendered_content,
        'subjectCount', preview.subject_count, 'subjectLimit', preview.subject_limit,
        'characterCount', preview.character_count, 'characterLimit', preview.character_limit,
        'validationIssues', preview.validation_issues, 'capabilityVersion', preview.capability_version,
        'capabilityObservedAtUtcMicros', to_char(preview.capability_observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'capabilitySnapshot', preview.capability_snapshot, 'createdBy', preview.created_by::text,
        'createdAtUtcMicros', to_char(preview.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'assets', '[]'::jsonb),
      'connection', jsonb_build_object(
        'id', connection.id::text, 'workspaceId', connection.workspace_id::text,
        'provider', connection.provider, 'status', connection.status,
        'identity', CASE connection.provider
          WHEN 'discord_webhook' THEN jsonb_build_object('webhookId', connection.configuration->>'webhookId',
            'channelId', connection.configuration->>'channelId', 'guildId', connection.configuration->>'guildId')
          WHEN 'slack_webhook' THEN jsonb_build_object('teamId', connection.configuration->>'teamId',
            'serviceId', connection.configuration->>'serviceId', 'host', connection.configuration->>'host')
          WHEN 'mastodon_account' THEN jsonb_build_object('accountId', connection.configuration->>'accountId',
            'instanceOrigin', connection.configuration->>'instanceOrigin', 'host', connection.configuration->>'host')
          ELSE '{}'::jsonb END),
      'destination', CASE WHEN destination.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', destination.id::text, 'workspaceId', destination.workspace_id::text,
        'provider', destination.provider, 'status', destination.status, 'canonicalUrl', destination.canonical_url) END,
      'trackedLink', CASE WHEN link.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', link.id::text, 'workspaceId', link.workspace_id::text, 'destinationId', link.destination_id::text,
        'draftChannelPreviewId', link.draft_channel_preview_id::text,
        'campaignInstanceId', link.campaign_instance_id::text, 'campaignStepRunId', link.campaign_step_run_id::text,
        'slug', link.slug, 'canonicalUrl', link.canonical_url, 'utmParameters', link.utm_parameters,
        'status', link.status, 'expiresAtUtcMicros', to_char(link.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'publicRedirectUrl', ${origin}::text || '/r/' || link.slug) END
      )::text AS snapshot_json,
      connection.name AS connection_name, destination.title AS destination_title,
      connection.configuration::text AS configuration_json, connection.configuration,
      draft.status AS draft_status, version.status AS version_status,
      source_version.status AS source_version_status, campaign.status AS campaign_status,
      draft.current_version_id = version.id AS is_current_version,
      EXISTS (SELECT 1 FROM content_draft_approval approval WHERE approval.content_draft_version_id = version.id
        AND approval.content_draft_id = draft.id AND approval.workspace_id = preview.workspace_id
        AND approval.status = 'approved') AS has_approval,
      (connection.capabilities = preview.capability_snapshot
        AND connection.capabilities_observed_at = preview.capability_observed_at
        AND connection.provider = preview.provider) IS TRUE AS exact_observation,
      (SELECT count(*)::integer FROM draft_channel_preview_asset asset WHERE asset.draft_channel_preview_id = preview.id) AS attachment_count,
      (preview.destination_id IS NULL OR (destination.id IS NOT NULL
        AND (destination.available_at IS NULL OR destination.available_at <= statement_timestamp())
        AND (destination.expires_at IS NULL OR destination.expires_at > statement_timestamp()))) AS destination_available,
      (link.id IS NULL OR link.expires_at IS NULL OR link.expires_at > statement_timestamp()) AS link_available,
      (preview.capability_observed_at >= '0001-01-01 00:00:00+00'::timestamptz
        AND preview.capability_observed_at < '10000-01-01 00:00:00+00'::timestamptz
        AND preview.created_at >= '0001-01-01 00:00:00+00'::timestamptz
        AND preview.created_at < '10000-01-01 00:00:00+00'::timestamptz
        AND (link.expires_at IS NULL OR (link.expires_at >= '0001-01-01 00:00:00+00'::timestamptz
          AND link.expires_at < '10000-01-01 00:00:00+00'::timestamptz))) AS timestamps_in_range,
      version.headline, version.body, version.call_to_action, version.hashtags
    FROM draft_channel_preview preview
    JOIN content_draft draft ON draft.id = preview.content_draft_id AND draft.workspace_id = preview.workspace_id
    JOIN content_draft_version version ON version.id = preview.content_draft_version_id AND version.content_draft_id = draft.id
    JOIN draft_generation generation ON generation.id = draft.draft_generation_id AND generation.workspace_id = preview.workspace_id
    JOIN campaign_version source_version ON source_version.id = generation.campaign_version_id
    JOIN campaign ON campaign.id = source_version.campaign_id AND campaign.workspace_id = preview.workspace_id
    JOIN channel_connection connection ON connection.id = preview.channel_connection_id AND connection.workspace_id = preview.workspace_id
    LEFT JOIN destination ON destination.id = preview.destination_id AND destination.workspace_id = preview.workspace_id
    LEFT JOIN tracked_link link ON link.draft_channel_preview_id = preview.id
    WHERE preview.id::text = ${input.previewId} AND preview.workspace_id = ${input.workspaceId}
  `)[0];
  if (!row) unavailable();
  if (row.attachmentCount !== 0 || !row.isCurrentVersion || !row.hasApproval
    || row.draftStatus !== "approved" || row.versionStatus !== "approved"
    || !["published", "superseded"].includes(row.sourceVersionStatus) || row.campaignStatus === "archived"
    || !row.exactObservation || !row.destinationAvailable || !row.linkAvailable || !row.timestampsInRange) ineligible();
  if (Buffer.byteLength(row.snapshotJson, "utf8") > EXACT_PREVIEW_FINGERPRINT_LIMITS.canonicalBytes * 2
    || Buffer.byteLength(row.configurationJson, "utf8") > EXACT_PREVIEW_FINGERPRINT_LIMITS.canonicalBytes * 2) {
    // jsonb text contains formatting spaces; bound before parsing, then enforce
    // the tighter canonical byte/node/depth bounds in the pure primitive.
    throw new ExactPreviewReadError("snapshot_too_large", "The stored preview exceeds the supported snapshot limit.");
  }
  const raw = JSON.parse(row.snapshotJson) as { preview: { linkMode: string } };
  if (raw.preview.linkMode === "tracked" && !origin) {
    throw new ExactPreviewReadError("tracked_origin_required", "Configure a trusted APP_BASE_URL before reviewing this tracked preview.");
  }
  const result = createExactPreviewFingerprint(raw);
  assertRawRoutingIdentity(result.snapshot, JSON.parse(row.configurationJson), row.configuration);
  // Compare to the SAME captured JSONB, not a later live read. This catches
  // JSON.parse rounding of PostgreSQL arbitrary-precision numbers at any depth.
  const roundtrip = (await transaction<{ exact: boolean }[]>`
    SELECT ${row.snapshotJson}::text::jsonb = ${result.canonicalSnapshot}::text::jsonb AS exact
  `)[0];
  if (!roundtrip?.exact) throw new ExactPreviewReadError("snapshot_lossy", "The stored snapshot contains JSON numbers that cannot be represented losslessly.");
  assertEligibleSnapshot(result.snapshot, input);
  const manifest = manifestForRender(result.snapshot);
  const snapshot = result.snapshot;
  const destinationUrl = snapshot.preview.linkMode === "tracked"
    ? snapshot.trackedLink!.publicRedirectUrl : snapshot.destination?.canonicalUrl;
  const rendered = renderChannelPreview(manifest, {
    subject: row.headline, body: row.body, hashtags: row.hashtags,
    ...(row.callToAction ? { callToAction: row.callToAction } : {}),
    ...(destinationUrl ? { destinationUrl } : {}),
  });
  if (rendered.content !== snapshot.preview.renderedContent
    || (rendered.subject ?? null) !== snapshot.preview.renderedSubject
    || (rendered.subjectCount ?? null) !== snapshot.preview.subjectCount
    || (rendered.subjectLimit ?? null) !== snapshot.preview.subjectLimit
    || rendered.characterCount !== snapshot.preview.characterCount
    || (rendered.characterLimit ?? null) !== snapshot.preview.characterLimit
    || rendered.issues.length !== 0) {
    throw new ExactPreviewReadError("render_changed", "The stored preview no longer matches its approved copy and routing context. Recreate and review it.");
  }
  return Object.freeze({ ...result, connectionName: row.connectionName, destinationTitle: row.destinationTitle });
}

/** SQL ->> and driver key transforms are projections, not raw identity proof. */
function assertRawRoutingIdentity(snapshot: ExactPreviewSnapshotV1, raw: unknown, normalized: Record<string, unknown>): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) ineligible();
  const source = raw as Record<string, unknown>;
  const identity = snapshot.connection.identity;
  const fields = Object.keys(identity);
  // Exact runtime transformer: a second snake-case alias can otherwise overwrite
  // a camel-case routing field when getChannelConnection reads the same JSON.
  for (const key of Object.keys(source)) {
    const projected = postgres.toCamel(key);
    if (fields.includes(projected) && projected !== key) ineligible();
  }
  for (const [key, expected] of Object.entries(identity)) {
    const value = source[key];
    if (snapshot.connection.provider === "discord_webhook" && key === "guildId"
      && value == null && normalized[key] == null && expected === null) continue;
    if (typeof value !== "string" || value !== expected || normalized[key] !== value) ineligible();
  }
}

function assertEligibleSnapshot(snapshot: ExactPreviewSnapshotV1, input: ExactPreviewReadInput): void {
  const { lineage, preview, connection, destination, trackedLink: link } = snapshot;
  if (lineage.workspaceId !== input.workspaceId || lineage.previewId !== input.previewId
    || connection.workspaceId !== input.workspaceId || connection.id !== preview.channelConnectionId
    || preview.provider !== connection.provider || preview.status !== "ready" || connection.status !== "active"
    || preview.validationIssues.length || preview.assets.length
    || preview.renderedSubject !== null || preview.subjectCount !== null || preview.subjectLimit !== null) ineligible();
  if (preview.destinationId !== (destination?.id ?? null)
    || (destination && (destination.workspaceId !== input.workspaceId || destination.status !== "published"))) ineligible();
  if (preview.linkMode === "tracked") {
    if (!destination || !link || link.workspaceId !== input.workspaceId || link.destinationId !== destination.id
      || link.draftChannelPreviewId !== lineage.previewId || link.campaignInstanceId !== null
      || link.campaignStepRunId !== null || link.status !== "active" || link.canonicalUrl !== destination.canonicalUrl) ineligible();
  } else if (link !== null) ineligible();
}

function manifestForRender(snapshot: ExactPreviewSnapshotV1): ChannelCapabilityManifest {
  const raw = snapshot.preview.capabilitySnapshot;
  const actions = raw.supportedActions;
  const limits = raw.limits;
  if (!actions || typeof actions !== "object" || Array.isArray(actions)
    || !limits || typeof limits !== "object" || Array.isArray(limits)
    || raw.provider !== snapshot.preview.provider || raw.version !== snapshot.preview.capabilityVersion
    || typeof raw.observedAt !== "string" || !Array.isArray(raw.executionMethods)
    || !raw.executionMethods.includes("official_api")) ineligible();
  const actionMap = actions as Record<string, unknown>;
  if ((actionMap.publish_content ?? actionMap.publishContent) !== true) ineligible();
  const limitMap = limits as Record<string, unknown>;
  if (!Number.isSafeInteger(limitMap.contentCharacters) || Number(limitMap.contentCharacters) < 1
    || Number(limitMap.contentCharacters) > 100_000) ineligible();
  if (snapshot.preview.provider === "mastodon_account"
    && (!Number.isSafeInteger(limitMap.charactersReservedPerUrl) || Number(limitMap.charactersReservedPerUrl) < 1
      || Number(limitMap.charactersReservedPerUrl) > 1_000)) ineligible();
  // Rendering understands normalized action names; the hash continues to cover
  // the untouched raw keys, including any unfamiliar manifest fields.
  return { ...raw, supportedActions: { publish_content: true,
    read_metrics: (actionMap.read_metrics ?? actionMap.readMetrics) === true,
    monitor_events: (actionMap.monitor_events ?? actionMap.monitorEvents) === true },
  } as unknown as ChannelCapabilityManifest;
}
