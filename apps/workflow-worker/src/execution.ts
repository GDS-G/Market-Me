import {
  ChannelConnectorError,
  decodeMailchimpCredentialBundle,
  DiscordWebhookConnector,
  MailchimpEmailConnector,
  MastodonAccountConnector,
  mastodonStatusCharacterCount,
  SlackWebhookConnector,
  decryptToken,
  type ChannelCapabilityManifest,
} from "@market-me/connectors";
import { validateCompanionTargetUrl } from "@market-me/companion-protocol";
import type {
  CampaignExecutionTarget,
  CompanionRepository,
  PublishingRepository,
  StoredCompanionWorker,
} from "@market-me/database";
import { inspectImageDimensions, sha256Hex, type ObjectStore } from "@market-me/media";
import type {
  CampaignStepExecution,
  CampaignStepExecutionInput,
} from "@market-me/workflows";

export class CampaignExecutionRouter {
  constructor(
    private readonly repository: PublishingRepository,
    private readonly encryptionKey: string | undefined,
    private readonly appBaseUrl: string | undefined,
    private readonly companionRepository?: CompanionRepository,
    private readonly mediaStore?: ObjectStore,
    private readonly mastodonAllowedHosts: readonly string[] = [],
  ) {}

  async execute(
    input: CampaignStepExecutionInput,
  ): Promise<CampaignStepExecution> {
    const target = await this.repository.getCampaignExecutionTarget(
      input.instanceId,
      input.stepKey,
    );
    const companion = target ? await this.queueCompanionJob(target) : undefined;
    if (companion) return companion;
    if (!target || target.operationType !== "publish_content")
      return {
        status: "manual_required",
        reason: "No automated adapter is registered for this operation.",
      };
    if (!target.connection || target.connection.status !== "active")
      return {
        status: "manual_required",
        reason: "Select an active channel connection.",
      };
    if (!(["discord_webhook", "mailchimp_email", "slack_webhook", "mastodon_account"] as const).includes(target.connection.provider) || !this.encryptionKey)
      return {
        status: "manual_required",
        reason:
          "The selected provider or credential vault is unavailable to this worker.",
      };

    const draftPreviewId =
      typeof target.input.draftChannelPreviewId === "string"
        ? target.input.draftChannelPreviewId
        : undefined;
    if ((target.connection.provider === "mailchimp_email" || target.connection.provider === "slack_webhook" || target.connection.provider === "mastodon_account")
      && (!draftPreviewId || !target.humanApprovalGranted))
      return {
        status: "manual_required",
        reason: `${providerLabel(target.connection.provider)} delivery requires an exact approved Draft preview and a recorded human approval for the Campaign or exact step.`,
      };
    if (
      draftPreviewId &&
      (!target.draftPreviewEligible ||
        !target.draftPreviewContent ||
        !target.draftPreviewVersionId)
    )
      return {
        status: "manual_required",
        reason:
          "The selected Draft channel preview is missing, stale, blocked, or no longer the exact approved version.",
      };
    if (
      draftPreviewId &&
      (target.input.appendDestination === true ||
        target.input.useTrackedLink === true)
    )
      return {
        status: "manual_required",
        reason:
          "Exact Draft channel previews cannot be modified with destination or tracked-link rendering during execution.",
      };
    const rawContent = draftPreviewId
      ? target.draftPreviewContent
      : typeof target.input.content === "string"
        ? target.input.content
        : undefined;
    if (!rawContent)
      return {
        status: "manual_required",
        reason: "Automated publishing requires step input.content.",
      };
    const subject = draftPreviewId
      ? target.draftPreviewSubject
      : typeof target.input.subject === "string"
        ? target.input.subject
        : undefined;
    if (target.connection.provider === "mailchimp_email" && !subject)
      return { status: "manual_required", reason: "Automated email publishing requires an exact subject." };
    let destinationUrl = target.destinationUrl;
    let trackedLinkId: string | undefined = draftPreviewId
      ? target.draftPreviewTrackedLinkId
      : undefined;
    if (
      target.destinationId &&
      target.input.useTrackedLink === true &&
      this.appBaseUrl
    ) {
      const link = await this.repository.createTrackedLink({
        workspaceId: target.workspaceId,
        destinationId: target.destinationId,
        campaignInstanceId: target.campaignInstanceId,
        campaignStepRunId: target.campaignStepRunId,
        utmParameters: {
          utm_source: target.connection.provider === "mailchimp_email"
            ? "mailchimp"
            : target.connection.provider === "slack_webhook" ? "slack"
              : target.connection.provider === "mastodon_account" ? "mastodon" : "discord",
          utm_medium: target.connection.provider === "mailchimp_email" ? "email" : "social",
          utm_campaign: target.campaignId,
          utm_content: target.stepKey,
        },
        createdBy: target.requestedBy,
      });
      destinationUrl = `${this.appBaseUrl.replace(/\/$/, "")}/r/${link.slug}`;
      trackedLinkId = link.id;
    }
    const content = draftPreviewId
      ? rawContent
      : renderContent(
          rawContent,
          destinationUrl,
          target.input.appendDestination === true,
        );
    const idempotencyKey = `campaign:${target.campaignInstanceId}:step:${target.stepKey}:publish`;
    const prior =
      await this.repository.getPublicationActionByIdempotencyKey?.(
        idempotencyKey,
      );
    if (prior?.status === "succeeded")
      return {
        status: "succeeded",
        output: actionOutput(prior, trackedLinkId),
      };
    if (prior?.status === "dispatching" || prior?.status === "ambiguous") {
      return {
        status: "manual_required",
        reason:
          "The prior provider delivery is ambiguous. Verify the channel before completing manually.",
      };
    }
    const attachmentResult = await this.loadPreviewAttachments(target);
    if ("reason" in attachmentResult)
      return { status: "manual_required", reason: attachmentResult.reason };
    const attachments = attachmentResult.attachments;
    let connector: DiscordWebhookConnector | MailchimpEmailConnector | SlackWebhookConnector | MastodonAccountConnector;
    let preflightIdentity: Readonly<Record<string, string>> = {};
    let mastodonPreflightManifest: ChannelCapabilityManifest | undefined;
    try {
      const credential = decryptToken(
        target.connection.encryptedCredentials,
        this.encryptionKey,
      );
      connector = target.connection.provider === "discord_webhook"
        ? new DiscordWebhookConnector(credential)
        : target.connection.provider === "slack_webhook"
          ? new SlackWebhookConnector(credential)
          : target.connection.provider === "mastodon_account"
            ? new MastodonAccountConnector(
                String(target.connection.configuration.instanceOrigin ?? ""), credential, this.mastodonAllowedHosts,
              )
            : new MailchimpEmailConnector(decodeMailchimpCredentialBundle(credential).apiKey);
      const preflight = connector instanceof DiscordWebhookConnector
        ? await connector.testConnection()
        : connector instanceof SlackWebhookConnector
          ? { ok: true, providerIdentity: connector.targetIdentity() }
          : connector instanceof MastodonAccountConnector
            ? await connector.testConnection()
            : await connector.testAudience(String(target.connection.configuration.audienceId ?? ""));
      if (!preflight.ok) {
        await this.repository.recordConnectionTest?.(
          target.workspaceId,
          target.connection.id,
          { ok: false, error: preflight.error },
        );
        return {
          status: "manual_required",
          reason: `Provider publication preflight failed: ${preflight.error ?? "the target is unavailable"}.`,
        };
      }
      preflightIdentity = preflight.providerIdentity ?? {};
      if (
        !sameProviderTarget(target.connection.provider, target.connection.configuration, preflightIdentity)
      ) {
        const error =
          "Provider target identity changed after connection approval";
        await this.repository.recordConnectionTest?.(
          target.workspaceId,
          target.connection.id,
          { ok: false, error },
        );
        return {
          status: "manual_required",
          reason: `${error}. Re-test the Channel Connection and render a new exact preview.`,
        };
      }
      if (connector instanceof MastodonAccountConnector) {
        mastodonPreflightManifest = preflight.capabilities;
        const liveLimit = preflight.capabilities?.limits.contentCharacters;
        const liveReservedPerUrl = preflight.capabilities?.limits.charactersReservedPerUrl;
        const approvedLimit = Number(target.connection.capabilities.limits && (target.connection.capabilities.limits as Record<string, unknown>).contentCharacters);
        const approvedReservedPerUrl = Number(target.connection.capabilities.limits && (target.connection.capabilities.limits as Record<string, unknown>).charactersReservedPerUrl);
        if (!Number.isSafeInteger(liveLimit) || liveLimit !== approvedLimit
          || !Number.isSafeInteger(liveReservedPerUrl) || liveReservedPerUrl !== approvedReservedPerUrl
          || mastodonStatusCharacterCount(content, liveReservedPerUrl) > liveLimit) {
          const error = "Mastodon instance publishing limits changed after preview approval";
          await this.repository.recordConnectionTest?.(target.workspaceId, target.connection.id, { ok: false, error });
          return { status: "manual_required", reason: `${error}. Re-test the Channel Connection and render a new exact preview.` };
        }
        const attachmentIssue = await validateMastodonAttachmentPreflight(
          attachments,
          preflight.capabilities,
          target.connection.capabilities,
        );
        if (attachmentIssue) {
          await this.repository.recordConnectionTest?.(target.workspaceId, target.connection.id, { ok: false, error: attachmentIssue });
          return { status: "manual_required", reason: `${attachmentIssue}. Re-test the Channel Connection and render a new exact preview.` };
        }
      }
      if (!(connector instanceof SlackWebhookConnector)) {
        await this.repository.recordConnectionTest?.(
          target.workspaceId,
          target.connection.id,
          { ok: true, configuration: {
            ...preflight.providerIdentity,
            ...(connector instanceof MastodonAccountConnector ? {
              maxCharacters: Number(preflight.providerIdentity?.maxCharacters),
              charactersReservedPerUrl: Number(preflight.providerIdentity?.charactersReservedPerUrl),
            } : {}),
            ...(preflight.providerConfiguration ?? {}),
          } },
        );
      }
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "Provider publication preflight failed";
      await this.repository.recordConnectionTest?.(
        target.workspaceId,
        target.connection.id,
        { ok: false, error: reason },
      );
      return { status: "manual_required", reason };
    }

    let action = prior;
    if (action?.status === "failed") {
      if (!await this.repository.retryPublicationAction(action.id, target, { content, subject }))
        return { status: "manual_required", reason: "This publication retry is no longer authorized or is owned/completed by another worker; automatic resend was suppressed." };
    }
    else {
      const started = await this.repository.beginPublicationAction({
        target,
        idempotencyKey,
        requestSnapshot: {
          content,
          subject,
          provider: target.connection.provider,
          destinationId: target.destinationId,
          trackedLinkId,
          draftChannelPreviewId: draftPreviewId,
          draftVersionId: target.draftPreviewVersionId,
          providerPreflight: {
            checked: true,
            mode: target.connection.provider === "slack_webhook" ? "local_target_identity" : "provider_read",
            targetIdentity: preflightIdentity,
          },
          attachments: (target.draftPreviewAssets ?? []).map(
            ({
              contentAssetId,
              sourceAssetId,
              contentHash,
              fileName,
              mimeType,
              byteSize,
              altTextStatus,
              scanStatus,
              scanRevision,
              scanScannedAt,
              rightsStatus,
              rightsRevision,
              rightsReviewedAt,
              rightsExpiresAt,
              rightsChannelConnectionId,
              rightsCampaignId,
              rightsBrandProfileId,
            }) => ({
              contentAssetId,
              sourceAssetId,
              contentHash,
              fileName,
              mimeType,
              byteSize,
              altTextStatus,
              scanStatus,
              scanRevision,
              scanScannedAt,
              rightsStatus,
              rightsRevision,
              rightsReviewedAt,
              rightsExpiresAt,
              rightsChannelConnectionId,
              rightsCampaignId,
              rightsBrandProfileId,
            }),
          ),
        },
      });
      action = started.action;
      if (!started.created) {
        if (action.status === "succeeded")
          return {
            status: "succeeded",
            output: actionOutput(action, trackedLinkId),
          };
        if (action.status === "dispatching" || action.status === "ambiguous") {
          return {
            status: "manual_required",
            reason:
              "The provider delivery is ambiguous. Verify the channel before completing manually.",
          };
        }
        if (!await this.repository.retryPublicationAction(action.id, target, { content, subject }))
          return { status: "manual_required", reason: "This publication retry is no longer authorized or is owned/completed by another worker; automatic resend was suppressed." };
      }
    }

    try {
      let mastodonMediaIds: string[] | undefined;
      if (connector instanceof MastodonAccountConnector && attachments.length) {
        if (!mastodonPreflightManifest) throw new ChannelConnectorError("Mastodon media preflight was not captured", "validation");
        const persisted = await this.repository.listMastodonPublicationMedia(action.id);
        mastodonMediaIds = [];
        for (const [ordinal, attachment] of attachments.entries()) {
          const snapshot = target.draftPreviewAssets?.[ordinal];
          if (!snapshot) throw new ChannelConnectorError("Mastodon attachment snapshot ordering changed", "validation");
          const stored = persisted.find((media) => media.ordinal === ordinal);
          if (stored && (stored.contentAssetId !== snapshot.contentAssetId || stored.contentHash !== snapshot.contentHash))
            throw new ChannelConnectorError("Persisted Mastodon media no longer matches the exact approved attachment", "ambiguous");
          let mediaId = stored?.providerMediaId;
          let ready = false;
          if (mediaId) ready = await connector.mediaReady(mediaId);
          else {
            const uploaded = await connector.uploadMedia(attachment, mastodonPreflightManifest);
            mediaId = uploaded.mediaId;
            try {
              await this.repository.recordMastodonPublicationMedia({
                publicationActionId: action.id,
                ordinal,
                contentAssetId: snapshot.contentAssetId,
                contentHash: snapshot.contentHash,
                providerMediaId: mediaId,
              });
            } catch {
              throw new ChannelConnectorError("Mastodon accepted media but its identity could not be durably recorded", "ambiguous");
            }
            ready = uploaded.ready;
          }
          if (!ready) ready = await connector.mediaReady(mediaId);
          if (!ready) throw new ChannelConnectorError("Mastodon media is still processing", "transient", 5_000);
          mastodonMediaIds.push(mediaId);
        }
      }
      const result = connector instanceof DiscordWebhookConnector
        ? await connector.publishContent({
            content,
            username: typeof target.input.username === "string" ? target.input.username : undefined,
            suppressNotifications: target.input.suppressNotifications === true,
            attachments,
          })
        : connector instanceof SlackWebhookConnector
          ? await connector.publishContent({ content })
          : connector instanceof MastodonAccountConnector
            ? await connector.publishContent({ content, idempotencyKey, providerAttachmentIds: mastodonMediaIds })
          : await connector.publishCampaign({
            audienceId: String(target.connection.configuration.audienceId ?? ""),
            subject: subject!,
            content,
            fromName: String(target.connection.configuration.fromName ?? ""),
            replyTo: String(target.connection.configuration.replyTo ?? ""),
            title: `Market Me · ${target.campaignId} · ${target.stepKey}`,
            campaignId: action.providerExternalId,
            onCampaignCreated: async (campaignId, providerUrl) => {
              await this.repository.recordPublicationProviderIdentity(action.id, campaignId, providerUrl);
            },
            });
      await this.repository.finishPublicationAction(action.id, {
        status: "succeeded",
        providerExternalId: result.externalId,
        providerUrl: result.externalUrl,
        responseMetadata: { ...result.metadata, trackedLinkId },
      });
      return {
        status: "succeeded",
        output: {
          externalId: result.externalId,
          externalUrl: result.externalUrl,
          trackedLinkId,
        },
      };
    } catch (error) {
      if (
        error instanceof ChannelConnectorError &&
        (error.kind === "rate_limit" || error.kind === "transient")
      ) {
        await this.repository.finishPublicationAction(action.id, {
          status: "failed",
          error: error.message,
        });
        throw error;
      }
      const ambiguous =
        error instanceof ChannelConnectorError && error.kind === "ambiguous";
      await this.repository.finishPublicationAction(action.id, {
        status: ambiguous ? "ambiguous" : "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        status: "manual_required",
        reason: ambiguous
          ? "Provider delivery is ambiguous; verify before manual completion."
          : error instanceof Error
            ? error.message
            : "Provider execution failed.",
      };
    }
  }

  private async loadPreviewAttachments(
    target: CampaignExecutionTarget,
  ): Promise<
    | {
        attachments: {
          fileName: string;
          mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
          description?: string;
          data: Uint8Array;
        }[];
      }
    | { reason: string }
  > {
    const snapshots = [...(target.draftPreviewAssets ?? [])];
    if (!snapshots.length) return { attachments: [] };
    if (!this.mediaStore)
      return {
        reason:
          "The worker media store is unavailable for the selected exact Draft attachments.",
      };
    const attachments = [] as {
      fileName: string;
      mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
      description?: string;
      data: Uint8Array;
    }[];
    try {
      for (const snapshot of snapshots) {
        if (
          snapshot.scanStatus !== "clean" ||
          snapshot.scanRevision < 1 ||
          !snapshot.scanScannedAt
        ) {
          return {
            reason: `Attachment ${snapshot.fileName} no longer has completed malware scan evidence.`,
          };
        }
        if (
          snapshot.rightsStatus !== "cleared" ||
          snapshot.rightsRevision < 1 ||
          !snapshot.rightsReviewedAt ||
          snapshot.rightsChannelConnectionId !== target.connection?.id ||
          snapshot.rightsCampaignId !== target.campaignId ||
          snapshot.rightsBrandProfileId !== target.brandProfileId ||
          (snapshot.rightsExpiresAt &&
            new Date(snapshot.rightsExpiresAt) <= new Date())
        )
          return {
            reason: `Attachment ${snapshot.fileName} no longer has a current reviewed rights clearance.`,
          };
        const data = await this.mediaStore.read(snapshot.objectKey);
        const contentHash = `sha256:${sha256Hex(data)}`;
        if (
          data.byteLength !== snapshot.byteSize ||
          contentHash !== snapshot.contentHash
        )
          return {
            reason: `Attachment ${snapshot.fileName} no longer matches its approved preview snapshot.`,
          };
        attachments.push({
          fileName: snapshot.fileName,
          mimeType: snapshot.mimeType,
          ...(snapshot.altTextStatus === "approved" && snapshot.altText
            ? { description: snapshot.altText }
            : {}),
          data,
        });
      }
      return { attachments };
    } catch {
      return {
        reason:
          "An approved preview attachment is missing from immutable media storage.",
      };
    }
  }

  private async queueCompanionJob(
    target: CampaignExecutionTarget,
  ): Promise<CampaignStepExecution | undefined> {
    if (
      target.desiredCapability !== "open_url" ||
      !target.executionMethods.includes("user_assisted")
    )
      return undefined;
    if (!this.companionRepository)
      return {
        status: "manual_required",
        reason: "Companion routing is unavailable to this worker.",
      };
    const rawTarget =
      typeof target.input.targetUrl === "string"
        ? target.input.targetUrl
        : target.destinationUrl;
    if (!rawTarget)
      return {
        status: "manual_required",
        reason:
          "Assisted open_url requires input.targetUrl or a Campaign Destination.",
      };
    const requestedDomains = Array.isArray(target.input.allowedDomains)
      ? target.input.allowedDomains.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    let targetUrl: string;
    let hostname: string;
    try {
      hostname = new URL(rawTarget).hostname.toLowerCase();
      targetUrl = validateCompanionTargetUrl(
        rawTarget,
        requestedDomains.length ? requestedDomains : [hostname],
      );
    } catch (error) {
      return {
        status: "manual_required",
        reason:
          error instanceof Error
            ? error.message
            : "Companion target validation failed.",
      };
    }
    const workers = (
      await this.companionRepository.listWorkers(target.workspaceId)
    ).filter(eligibleWorker);
    const requestedWorkerId =
      typeof target.input.companionWorkerId === "string"
        ? target.input.companionWorkerId
        : undefined;
    const worker = requestedWorkerId
      ? workers.find((candidate) => candidate.id === requestedWorkerId)
      : workers.length === 1
        ? workers[0]
        : undefined;
    if (!worker) {
      return {
        status: "manual_required",
        reason: requestedWorkerId
          ? "The selected companion is unavailable, paused, disconnected, or lacks assistedOpenUrl."
          : workers.length > 1
            ? "Multiple eligible companions are online; select input.companionWorkerId."
            : "No healthy active companion supports assistedOpenUrl.",
      };
    }
    const instructions =
      typeof target.input.instructions === "string"
        ? target.input.instructions.trim()
        : typeof target.input.content === "string"
          ? target.input.content.trim()
          : `Open ${targetUrl} and complete the Campaign step.`;
    if (!instructions || instructions.length > 2_000)
      return {
        status: "manual_required",
        reason:
          "Companion instructions must contain 1 through 2,000 characters.",
      };
    const job = await this.companionRepository.createJob({
      workspaceId: target.workspaceId,
      workerId: worker.id,
      campaignInstanceId: target.campaignInstanceId,
      campaignStepRunId: target.campaignStepRunId,
      action: "open_url",
      actionMode: "confirm_before_submit",
      targetUrl,
      expectedOrigin: new URL(targetUrl).origin,
      allowedDomains: [hostname],
      instructions,
      idempotencyKey: `campaign:${target.campaignInstanceId}:step:${target.stepKey}:open_url`,
      createdBy: target.requestedBy,
    });
    return {
      status: "manual_required",
      reason: `Companion job ${job.id} is queued; the Campaign will resume automatically after confirmed completion.`,
    };
  }
}

function eligibleWorker(worker: StoredCompanionWorker): boolean {
  return (
    worker.status === "active" &&
    worker.effectiveHealthState !== "disconnected" &&
    worker.effectiveHealthState !== "needs_attention" &&
    worker.capabilities.assistedOpenUrl === true
  );
}

async function validateMastodonAttachmentPreflight(
  attachments: readonly {
    fileName: string;
    mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
    description?: string;
    data: Uint8Array;
  }[],
  live: ChannelCapabilityManifest | undefined,
  approvedValue: Record<string, unknown>,
): Promise<string | undefined> {
  if (!attachments.length) return undefined;
  if (!live || live.features.attachments !== true) return "Mastodon reviewed-image publishing is no longer available";
  const approvedLimits = approvedValue.limits;
  const approvedFeatures = approvedValue.features;
  if (!approvedLimits || typeof approvedLimits !== "object" || Array.isArray(approvedLimits)
    || !approvedFeatures || typeof approvedFeatures !== "object" || Array.isArray(approvedFeatures))
    return "Mastodon approved media capabilities are missing";
  const limitKeys = ["attachmentsPerMessage", "attachmentBytes", "attachmentPixels", "attachmentDescriptionCharacters"] as const;
  const featureKeys = ["attachments", "imageJpeg", "imagePng", "imageWebp"] as const;
  if (limitKeys.some((key) => live.limits[key] !== (approvedLimits as Record<string, unknown>)[key])
    || featureKeys.some((key) => live.features[key] !== (approvedFeatures as Record<string, unknown>)[key]))
    return "Mastodon instance media limits changed after preview approval";
  if (attachments.length > live.limits.attachmentsPerMessage) return "Mastodon attachment count exceeds the live provider limit";
  for (const attachment of attachments) {
    const feature = attachment.mimeType === "image/jpeg" ? "imageJpeg"
      : attachment.mimeType === "image/png" ? "imagePng"
        : attachment.mimeType === "image/webp" ? "imageWebp" : undefined;
    if (!feature || live.features[feature] !== true) return `${attachment.fileName} is not supported by the live Mastodon instance`;
    if (attachment.data.byteLength < 1 || attachment.data.byteLength > live.limits.attachmentBytes)
      return `${attachment.fileName} exceeds the live Mastodon image byte limit`;
    if (!attachment.description?.trim()
      || Array.from(attachment.description).length > live.limits.attachmentDescriptionCharacters)
      return `${attachment.fileName} requires approved alt text within the live Mastodon description limit`;
    try { await inspectImageDimensions(attachment.data, live.limits.attachmentPixels); }
    catch { return `${attachment.fileName} has unverifiable dimensions or exceeds the live Mastodon pixel limit`; }
  }
  return undefined;
}

function sameProviderTarget(
  provider: "discord_webhook" | "mailchimp_email" | "slack_webhook" | "mastodon_account",
  expected: Record<string, unknown>,
  observed: Readonly<Record<string, string>>,
): boolean {
  const keys = provider === "mailchimp_email"
    ? ["audienceId"]
    : provider === "slack_webhook"
      ? ["teamId", "serviceId", "host"]
      : provider === "mastodon_account"
        ? ["host", "instanceOrigin", "accountId"]
      : ["webhookId", "guildId", "channelId"];
  return keys.every(
    (key) =>
      typeof expected[key] !== "string" || observed[key] === expected[key],
  );
}

function providerLabel(provider: "discord_webhook" | "mailchimp_email" | "slack_webhook" | "mastodon_account"): string {
  return provider === "mailchimp_email" ? "Mailchimp" : provider === "slack_webhook" ? "Slack" : provider === "mastodon_account" ? "Mastodon" : "Discord";
}

function renderContent(
  template: string,
  destinationUrl: string | undefined,
  appendDestination: boolean,
): string {
  const replaced = destinationUrl
    ? template.replaceAll("{{destinationUrl}}", destinationUrl)
    : template;
  return destinationUrl &&
    appendDestination &&
    !replaced.includes(destinationUrl)
    ? `${replaced.trim()}\n\n${destinationUrl}`
    : replaced;
}

function actionOutput(
  action: {
    providerExternalId?: string;
    providerUrl?: string;
    responseMetadata: Record<string, unknown>;
  },
  trackedLinkId?: string,
): Record<string, unknown> {
  return {
    externalId: action.providerExternalId,
    externalUrl: action.providerUrl,
    trackedLinkId: action.responseMetadata.trackedLinkId ?? trackedLinkId,
  };
}
