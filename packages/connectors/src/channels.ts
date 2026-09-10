import type { ConnectorFetch } from "./types";

export const CHANNEL_PROVIDERS = ["discord_webhook", "mailchimp_email", "slack_webhook", "mastodon_account"] as const;
export type ChannelProvider = (typeof CHANNEL_PROVIDERS)[number];
export const NORMALIZED_CHANNEL_ACTIONS = ["publish_content", "read_metrics", "monitor_events"] as const;
export type NormalizedChannelAction = (typeof NORMALIZED_CHANNEL_ACTIONS)[number];

export interface ChannelCapabilityManifest {
  provider: ChannelProvider;
  version: string;
  observedAt: string;
  authenticationMethods: readonly string[];
  supportedActions: Readonly<Record<NormalizedChannelAction, boolean>>;
  executionMethods: readonly ("official_api" | "manual_handoff")[];
  limits: Readonly<Record<string, number>>;
  features: Readonly<Record<string, boolean>>;
}

export interface ChannelConnectionTest {
  ok: boolean;
  providerIdentity?: Readonly<Record<string, string>>;
  providerConfiguration?: Readonly<Record<string, unknown>>;
  capabilities?: ChannelCapabilityManifest;
  error?: string;
}

export interface PublishContentInput {
  content: string;
  idempotencyKey?: string;
  username?: string;
  suppressNotifications?: boolean;
  attachments?: readonly PublishAttachmentInput[];
  providerAttachmentIds?: readonly string[];
}

export interface PublishAttachmentInput {
  fileName: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  description?: string;
  data: Uint8Array;
}

export interface PublishContentResult {
  externalId?: string;
  externalUrl?: string;
  metadata: Readonly<Record<string, unknown>>;
}

export interface MastodonStatusReport {
  statusId: string;
  accountId: string;
  statusUrl: string;
  repliesCount: number;
  reblogsCount: number;
  favouritesCount: number;
  statusCreatedAt: string;
}

export interface ChannelPreviewInput {
  subject?: string;
  body: string;
  callToAction?: string;
  hashtags: readonly string[];
  destinationUrl?: string;
}

export interface ChannelPreviewResult {
  subject?: string;
  subjectCount?: number;
  subjectLimit?: number;
  content: string;
  characterCount: number;
  characterLimit?: number;
  issues: readonly { code: "publish_unsupported" | "content_empty" | "content_limit" | "subject_empty" | "subject_limit"; message: string }[];
}

export class ChannelConnectorError extends Error {
  constructor(message: string, readonly kind: "authorization" | "validation" | "rate_limit" | "transient" | "permanent" | "ambiguous", readonly retryAfterMs?: number) {
    super(message);
    this.name = "ChannelConnectorError";
  }
}

export const DISCORD_WEBHOOK_CAPABILITIES: ChannelCapabilityManifest = {
  provider: "discord_webhook",
  version: "2026-08-05",
  observedAt: "2026-08-05T00:00:00.000Z",
  authenticationMethods: ["incoming_webhook_url"],
  supportedActions: { publish_content: true, read_metrics: false, monitor_events: false },
  executionMethods: ["official_api", "manual_handoff"],
  limits: { contentCharacters: 2000, embedsPerMessage: 10, attachmentsPerMessage: 10, attachmentBytes: 10 * 1024 * 1024, attachmentDescriptionCharacters: 1024 },
  features: {
    text: true, edit: true, delete: true, nativeScheduling: false, inboundEvents: false, attachments: true,
    imageJpeg: true, imagePng: true, imageWebp: true, imageGif: true,
  },
};

export const MAILCHIMP_EMAIL_CAPABILITIES: ChannelCapabilityManifest = {
  provider: "mailchimp_email",
  version: "2026-08-12",
  observedAt: "2026-08-12T00:00:00.000Z",
  authenticationMethods: ["api_key"],
  supportedActions: { publish_content: true, read_metrics: true, monitor_events: false },
  executionMethods: ["official_api", "manual_handoff"],
  limits: { contentCharacters: 100_000, subjectCharacters: 150, attachmentsPerMessage: 0 },
  features: { text: true, edit: false, delete: false, nativeScheduling: false, inboundEvents: false, attachments: false, audienceManagedConsent: true },
};

export const SLACK_WEBHOOK_CAPABILITIES: ChannelCapabilityManifest = {
  provider: "slack_webhook",
  version: "2026-08-12",
  observedAt: "2026-08-12T00:00:00.000Z",
  authenticationMethods: ["incoming_webhook_url"],
  supportedActions: { publish_content: true, read_metrics: false, monitor_events: false },
  executionMethods: ["official_api", "manual_handoff"],
  limits: { contentCharacters: 4_000, attachmentsPerMessage: 0, messagesPerSecondPerChannel: 1 },
  features: {
    text: true,
    edit: false,
    delete: false,
    nativeScheduling: false,
    inboundEvents: false,
    attachments: false,
    providerMessageIdentity: false,
  },
};

export function mastodonCapabilities(
  contentCharacters: number,
  charactersReservedPerUrl = 23,
  media?: {
    attachmentsPerMessage: number;
    attachmentBytes: number;
    attachmentPixels: number;
    attachmentDescriptionCharacters: number;
    supportedImageMimeTypes: readonly ("image/jpeg" | "image/png" | "image/webp")[];
  },
): ChannelCapabilityManifest {
  if (!Number.isSafeInteger(contentCharacters) || contentCharacters < 1 || contentCharacters > 100_000) {
    throw new ChannelConnectorError("Mastodon reported an invalid status character limit", "permanent");
  }
  if (!Number.isSafeInteger(charactersReservedPerUrl) || charactersReservedPerUrl < 1 || charactersReservedPerUrl > 1_000) {
    throw new ChannelConnectorError("Mastodon reported an invalid reserved URL character count", "permanent");
  }
  return {
    provider: "mastodon_account",
    version: "2026-08-12",
    observedAt: "2026-08-12T00:00:00.000Z",
    authenticationMethods: ["user_access_token"],
    supportedActions: { publish_content: true, read_metrics: true, monitor_events: false },
    executionMethods: ["official_api", "manual_handoff"],
    limits: {
      contentCharacters,
      charactersReservedPerUrl,
      attachmentsPerMessage: media?.attachmentsPerMessage ?? 0,
      ...(media ? {
        attachmentBytes: media.attachmentBytes,
        attachmentPixels: media.attachmentPixels,
        attachmentDescriptionCharacters: media.attachmentDescriptionCharacters,
      } : {}),
    },
    features: {
      text: true,
      edit: false,
      delete: false,
      nativeScheduling: false,
      inboundEvents: false,
      attachments: Boolean(media?.attachmentsPerMessage),
      imageJpeg: media?.supportedImageMimeTypes.includes("image/jpeg") ?? false,
      imagePng: media?.supportedImageMimeTypes.includes("image/png") ?? false,
      imageWebp: media?.supportedImageMimeTypes.includes("image/webp") ?? false,
      providerMessageIdentity: true,
      providerIdempotency: true,
      publicVisibility: true,
    },
  };
}

export function renderChannelPreview(manifest: ChannelCapabilityManifest, input: ChannelPreviewInput): ChannelPreviewResult {
  const email = manifest.provider === "mailchimp_email";
  const subject = email ? input.subject?.trim() : undefined;
  const sections = [input.body.trim(), input.callToAction?.trim(), !email && input.hashtags.length ? input.hashtags.join(" ") : undefined, input.destinationUrl?.trim()].filter((value): value is string => Boolean(value));
  const content = sections.join("\n\n");
  const characterLimit = manifest.limits.contentCharacters;
  const issues: ChannelPreviewResult["issues"][number][] = [];
  if (!manifest.supportedActions.publish_content) issues.push({ code: "publish_unsupported", message: `${manifest.provider} does not currently support publishing content.` });
  if (email && !subject) issues.push({ code: "subject_empty", message: "Email publishing requires a subject." });
  const subjectLimit = email ? manifest.limits.subjectCharacters : undefined;
  if (subject && subjectLimit !== undefined && subject.length > subjectLimit) issues.push({ code: "subject_limit", message: `The email subject exceeds the ${subjectLimit}-character provider limit by ${subject.length - subjectLimit}.` });
  const characterCount = manifest.provider === "mastodon_account"
    ? mastodonStatusCharacterCount(content, manifest.limits.charactersReservedPerUrl)
    : content.length;
  if (!content) issues.push({ code: "content_empty", message: "The rendered channel content is empty." });
  if (characterLimit !== undefined && characterCount > characterLimit) issues.push({ code: "content_limit", message: `The rendered content exceeds the ${characterLimit}-character provider limit by ${characterCount - characterLimit}.` });
  return {
    ...(subject ? { subject, subjectCount: subject.length } : {}),
    ...(subjectLimit !== undefined ? { subjectLimit } : {}),
    content,
    characterCount,
    ...(characterLimit !== undefined ? { characterLimit } : {}),
    issues,
  };
}

export class DiscordWebhookConnector {
  readonly manifest = DISCORD_WEBHOOK_CAPABILITIES;
  private readonly webhookUrl: URL;

  constructor(webhookUrl: string, private readonly request: ConnectorFetch = fetch) {
    this.webhookUrl = parseDiscordWebhookUrl(webhookUrl);
  }

  async testConnection(): Promise<ChannelConnectionTest> {
    const response = await this.request(this.webhookUrl, { method: "GET", headers: { accept: "application/json" } });
    if (!response.ok) return { ok: false, error: classifyHttpMessage(response.status) };
    const payload = await response.json() as Record<string, unknown>;
    return {
      ok: true,
      providerIdentity: Object.fromEntries([
        ["webhookId", payload.id], ["name", payload.name], ["guildId", payload.guild_id], ["channelId", payload.channel_id],
      ].filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    };
  }

  async publishContent(input: PublishContentInput): Promise<PublishContentResult> {
    const content = input.content.trim();
    const attachments = [...(input.attachments ?? [])];
    if ((!content && !attachments.length) || content.length > this.manifest.limits.contentCharacters) throw new ChannelConnectorError("Discord content must contain at most 2000 characters and a message requires content or an attachment", "validation");
    if (attachments.length > this.manifest.limits.attachmentsPerMessage) throw new ChannelConnectorError("Discord accepts at most 10 attachments per message", "validation");
    for (const attachment of attachments) validateDiscordAttachment(attachment, this.manifest);
    const url = new URL(this.webhookUrl);
    url.searchParams.set("wait", "true");
    const payload = {
        content,
        ...(input.username ? { username: input.username.slice(0, 80) } : {}),
        allowed_mentions: { parse: [] },
        ...(input.suppressNotifications ? { flags: 1 << 12 } : {}),
        ...(attachments.length ? { attachments: attachments.map((attachment, id) => ({ id, filename: attachment.fileName, ...(attachment.description ? { description: attachment.description } : {}) })) } : {}),
      };
    let body: BodyInit;
    let headers: Record<string, string>;
    if (attachments.length) {
      const form = new FormData();
      form.set("payload_json", JSON.stringify(payload));
      attachments.forEach((attachment, index) => form.set(`files[${index}]`, new Blob([attachmentArrayBuffer(attachment.data)], { type: attachment.mimeType }), attachment.fileName));
      body = form; headers = { accept: "application/json" };
    } else { body = JSON.stringify(payload); headers = { "content-type": "application/json", accept: "application/json" }; }
    const response = await this.request(url, { method: "POST", headers, body });
    if (!response.ok) {
      const retryAfterMs = parseRetryAfter(response);
      if (response.status === 429) throw new ChannelConnectorError("Discord rate limit reached", "rate_limit", retryAfterMs);
      if (response.status === 401 || response.status === 403 || response.status === 404) throw new ChannelConnectorError(classifyHttpMessage(response.status), "authorization");
      if (response.status >= 500) throw new ChannelConnectorError(`Discord returned ${response.status}; delivery is ambiguous`, "ambiguous");
      throw new ChannelConnectorError(`Discord rejected the message with ${response.status}`, "permanent");
    }
    const responsePayload = await response.json() as Record<string, unknown>;
    if (typeof responsePayload.id !== "string") throw new ChannelConnectorError("Discord confirmed delivery without a message ID", "ambiguous");
    const channelId = typeof responsePayload.channel_id === "string" ? responsePayload.channel_id : undefined;
    const guildId = typeof responsePayload.guild_id === "string" ? responsePayload.guild_id : undefined;
    return {
      externalId: responsePayload.id,
      externalUrl: channelId && guildId ? `https://discord.com/channels/${guildId}/${channelId}/${responsePayload.id}` : undefined,
      metadata: { channelId, guildId, rateLimitBucket: response.headers.get("x-ratelimit-bucket") ?? undefined },
    };
  }
}

export class SlackWebhookConnector {
  readonly manifest = SLACK_WEBHOOK_CAPABILITIES;
  private readonly webhookUrl: URL;

  constructor(webhookUrl: string, private readonly request: ConnectorFetch = fetch) {
    this.webhookUrl = parseSlackWebhookUrl(webhookUrl);
  }

  targetIdentity(): Readonly<Record<string, string>> {
    const [, teamId, serviceId] = this.webhookUrl.pathname.split("/").filter(Boolean);
    return { teamId: teamId!, serviceId: serviceId!, host: this.webhookUrl.hostname };
  }

  async testConnection(): Promise<ChannelConnectionTest> {
    try {
      await this.post("Market Me connection test — no Campaign content was published.", "connection test");
      return { ok: true, providerIdentity: this.targetIdentity() };
    } catch (error) {
      if (error instanceof ChannelConnectorError) return { ok: false, error: error.message };
      return { ok: false, error: "Slack connection test could not reach the provider" };
    }
  }

  async publishContent(input: PublishContentInput): Promise<PublishContentResult> {
    const content = input.content.trim();
    if (!content || content.length > this.manifest.limits.contentCharacters) {
      throw new ChannelConnectorError("Slack content must contain 1 through 4,000 characters", "validation");
    }
    if (input.attachments?.length) {
      throw new ChannelConnectorError("Slack incoming-webhook delivery does not accept Market Me attachments", "validation");
    }
    await this.post(content, "delivery");
    return {
      metadata: {
        acknowledgement: "ok",
        providerMessageIdAvailable: false,
        targetIdentity: this.targetIdentity(),
      },
    };
  }

  private async post(content: string, operation: string): Promise<void> {
    let response: Response;
    try {
      response = await this.request(this.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8", accept: "text/plain" },
        body: JSON.stringify({
          text: content,
          mrkdwn: false,
          link_names: false,
          unfurl_links: false,
          unfurl_media: false,
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new ChannelConnectorError(`Slack ${operation} outcome is ambiguous`, "ambiguous");
    }
    if (response.status === 429) {
      throw new ChannelConnectorError("Slack rate limit reached", "rate_limit", parseRetryAfter(response));
    }
    const acknowledgement = await readBoundedSlackText(response);
    if (response.ok && acknowledgement === "ok") return;
    if (response.status === 401 || response.status === 403 || response.status === 404 || response.status === 410) {
      throw new ChannelConnectorError("Slack rejected or disabled the incoming webhook", "authorization");
    }
    if (response.status >= 500) {
      throw new ChannelConnectorError(`Slack ${operation} returned ${response.status}; outcome is ambiguous`, "ambiguous");
    }
    if (response.ok) {
      throw new ChannelConnectorError(`Slack ${operation} returned an unknown acknowledgement`, "ambiguous");
    }
    throw new ChannelConnectorError(`Slack rejected ${operation} with ${response.status}`, "permanent");
  }
}

export class MastodonAccountConnector {
  private readonly origin: URL;
  private readonly authorization: string;

  constructor(
    instanceOrigin: string,
    accessToken: string,
    allowedHosts: readonly string[],
    private readonly request: ConnectorFetch = fetch,
  ) {
    this.origin = parseMastodonInstanceOrigin(instanceOrigin, allowedHosts);
    const token = accessToken.trim();
    if (token.length < 20 || token.length > 500 || /[\u0000-\u001f\u007f]/u.test(token)) {
      throw new ChannelConnectorError("Use a bounded Mastodon user access token", "validation");
    }
    this.authorization = `Bearer ${token}`;
  }

  async testConnection(): Promise<ChannelConnectionTest> {
    try {
      const [accountResponse, instanceResponse] = await Promise.all([
        this.get("/api/v1/accounts/verify_credentials"),
        this.get("/api/v2/instance"),
      ]);
      if (!accountResponse.ok) return { ok: false, error: mastodonHttpMessage(accountResponse.status, "credential verification") };
      if (!instanceResponse.ok) return { ok: false, error: mastodonHttpMessage(instanceResponse.status, "instance discovery") };
      const account = await readBoundedProviderJson(accountResponse, "Mastodon");
      const instance = await readBoundedProviderJson(instanceResponse, "Mastodon");
      const accountId = boundedMastodonIdentity(account.id, "account ID");
      const username = boundedMastodonIdentity(account.username, "username");
      const acct = boundedMastodonIdentity(account.acct, "account handle");
      const configuration = boundedObjectForProvider(instance.configuration, "Mastodon instance configuration");
      const statuses = boundedObjectForProvider(configuration.statuses, "Mastodon status configuration");
      const maxCharacters = mastodonCharacterLimit(statuses.max_characters);
      const charactersReservedPerUrl = mastodonReservedUrlCharacters(statuses.characters_reserved_per_url);
      const mediaConfiguration = mastodonMediaConfiguration(configuration, statuses);
      const profileUrl = safeMastodonProviderUrl(account.url, this.origin);
      return {
        ok: true,
        providerIdentity: {
          host: this.origin.hostname,
          instanceOrigin: this.origin.origin,
          accountId,
          username,
          acct,
          ...(profileUrl ? { profileUrl } : {}),
          maxCharacters: String(maxCharacters),
          charactersReservedPerUrl: String(charactersReservedPerUrl),
        },
        ...(mediaConfiguration ? { providerConfiguration: {
          host: this.origin.hostname,
          instanceOrigin: this.origin.origin,
          accountId,
          username,
          acct,
          ...(profileUrl ? { profileUrl } : {}),
          maxCharacters,
          charactersReservedPerUrl,
          ...mediaConfiguration,
        } } : {}),
        capabilities: mastodonCapabilities(maxCharacters, charactersReservedPerUrl, mediaConfiguration),
      };
    } catch (error) {
      if (error instanceof ChannelConnectorError) return { ok: false, error: error.message };
      return { ok: false, error: "Mastodon connection test could not reach the approved instance" };
    }
  }

  async publishContent(input: PublishContentInput): Promise<PublishContentResult> {
    const content = input.content.trim();
    if (!content || content.length > 100_000) {
      throw new ChannelConnectorError("Mastodon content must contain 1 through 100,000 characters before live limit validation", "validation");
    }
    if (input.attachments?.length) throw new ChannelConnectorError("Upload Mastodon attachments before creating the status", "validation");
    const providerAttachmentIds = [...(input.providerAttachmentIds ?? [])].map((id) => boundedMastodonIdentity(id, "media ID"));
    if (providerAttachmentIds.length > 4 || new Set(providerAttachmentIds).size !== providerAttachmentIds.length) {
      throw new ChannelConnectorError("Mastodon accepts at most four unique uploaded media IDs", "validation");
    }
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200 || /[^A-Za-z0-9:._-]/u.test(idempotencyKey)) {
      throw new ChannelConnectorError("Mastodon publishing requires a bounded idempotency key", "validation");
    }
    let response: Response;
    try {
      response = await this.request(new URL("/api/v1/statuses", this.origin), {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: this.authorization,
          "content-type": "application/json",
          accept: "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ status: content, visibility: "public", sensitive: false, ...(providerAttachmentIds.length ? { media_ids: providerAttachmentIds } : {}) }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new ChannelConnectorError("Mastodon publication outcome is ambiguous", "ambiguous");
    }
    if (response.status === 429) {
      throw new ChannelConnectorError("Mastodon rate limit reached", "rate_limit", parseMastodonRetryAfter(response));
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new ChannelConnectorError(mastodonHttpMessage(response.status, "publication"), "authorization");
      if (response.status >= 500) throw new ChannelConnectorError(`Mastodon publication returned ${response.status}; outcome is ambiguous`, "ambiguous");
      throw new ChannelConnectorError(`Mastodon rejected publication with ${response.status}`, "permanent");
    }
    let payload: Record<string, unknown>;
    try {
      payload = await readBoundedProviderJson(response, "Mastodon");
    } catch {
      throw new ChannelConnectorError("Mastodon confirmed publication without a usable bounded response", "ambiguous");
    }
    const externalId = boundedMastodonIdentity(payload.id, "status ID");
    const externalUrl = safeMastodonProviderUrl(payload.url, this.origin);
    if (!externalUrl) throw new ChannelConnectorError("Mastodon confirmed publication without a same-instance status URL", "ambiguous");
    return {
      externalId,
      externalUrl,
      metadata: {
        host: this.origin.hostname,
        visibility: "public",
        providerIdempotencyApplied: true,
        ...(providerAttachmentIds.length ? { attachmentCount: providerAttachmentIds.length } : {}),
      },
    };
  }

  async uploadMedia(
    attachment: PublishAttachmentInput,
    manifest: ChannelCapabilityManifest,
  ): Promise<{ mediaId: string; ready: boolean }> {
    validateMastodonAttachment(attachment, manifest);
    const form = new FormData();
    form.set("file", new Blob([attachmentArrayBuffer(attachment.data)], { type: attachment.mimeType }), attachment.fileName);
    if (attachment.description) form.set("description", attachment.description.trim());
    let response: Response;
    try {
      response = await this.request(new URL("/api/v2/media", this.origin), {
        method: "POST", redirect: "error",
        headers: { authorization: this.authorization, accept: "application/json" },
        body: form, signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new ChannelConnectorError("Mastodon media upload outcome is ambiguous", "ambiguous"); }
    if (response.status === 429) throw new ChannelConnectorError("Mastodon media rate limit reached", "rate_limit", parseMastodonRetryAfter(response));
    if (response.status === 401 || response.status === 403) throw new ChannelConnectorError("Mastodon rejected media-upload credentials or scope", "authorization");
    if (response.status >= 500) throw new ChannelConnectorError(`Mastodon media upload returned ${response.status}; outcome is ambiguous`, "ambiguous");
    if (response.status !== 200 && response.status !== 202) throw new ChannelConnectorError(`Mastodon rejected media upload with ${response.status}`, "permanent");
    let payload: Record<string, unknown>;
    try { payload = await readBoundedProviderJson(response, "Mastodon"); }
    catch { throw new ChannelConnectorError("Mastodon accepted media without a usable bounded identity", "ambiguous"); }
    return { mediaId: boundedMastodonIdentity(payload.id, "media ID"), ready: response.status === 200 && typeof payload.url === "string" };
  }

  async mediaReady(mediaIdValue: string): Promise<boolean> {
    const mediaId = encodeURIComponent(boundedMastodonIdentity(mediaIdValue, "media ID"));
    let response: Response;
    try { response = await this.get(`/api/v1/media/${mediaId}`); }
    catch { throw new ChannelConnectorError("Mastodon media readiness could not reach the approved instance", "transient"); }
    if (response.status === 429) throw new ChannelConnectorError("Mastodon media readiness rate limit reached", "rate_limit", parseMastodonRetryAfter(response));
    if (response.status === 401 || response.status === 403 || response.status === 404) throw new ChannelConnectorError("Mastodon media is unavailable to the configured account", "authorization");
    if (!response.ok) throw new ChannelConnectorError(`Mastodon media readiness failed with ${response.status}`, "transient");
    const payload = await readBoundedProviderJson(response, "Mastodon");
    if (boundedMastodonIdentity(payload.id, "media ID") !== decodeURIComponent(mediaId)) throw new ChannelConnectorError("Mastodon media readiness returned a different identity", "permanent");
    return typeof payload.url === "string" && Boolean(payload.url);
  }

  async getStatusReport(statusIdValue: string, expectedAccountIdValue: string): Promise<MastodonStatusReport> {
    const statusId = boundedMastodonIdentity(statusIdValue, "status ID");
    const expectedAccountId = boundedMastodonIdentity(expectedAccountIdValue, "account ID");
    let response: Response;
    try { response = await this.get(`/api/v1/statuses/${encodeURIComponent(statusId)}`); }
    catch { throw new ChannelConnectorError("Mastodon status report could not reach the approved instance", "transient"); }
    if (response.status === 429) throw new ChannelConnectorError("Mastodon status-report rate limit reached", "rate_limit", parseMastodonRetryAfter(response));
    if (response.status === 401 || response.status === 403) throw new ChannelConnectorError("Mastodon rejected status-report access", "authorization");
    if (response.status === 404) throw new ChannelConnectorError("Mastodon status report is not available", "permanent");
    if (response.status >= 500) throw new ChannelConnectorError(`Mastodon status report returned ${response.status}`, "transient");
    if (!response.ok) throw new ChannelConnectorError(`Mastodon rejected status-report access with ${response.status}`, "permanent");
    const payload = await readBoundedProviderJson(response, "Mastodon");
    const account = boundedObjectForProvider(payload.account, "Mastodon status account");
    const returnedStatusId = boundedMastodonIdentity(payload.id, "status ID");
    const accountId = boundedMastodonIdentity(account.id, "account ID");
    const statusUrl = safeMastodonProviderUrl(payload.url, this.origin);
    if (returnedStatusId !== statusId || accountId !== expectedAccountId || !statusUrl) {
      throw new ChannelConnectorError("Mastodon status report identity did not match the exact published account and status", "permanent");
    }
    return {
      statusId,
      accountId,
      statusUrl,
      repliesCount: nonNegativeProviderInteger(payload.replies_count, "Mastodon status replies"),
      reblogsCount: nonNegativeProviderInteger(payload.reblogs_count, "Mastodon status boosts"),
      favouritesCount: nonNegativeProviderInteger(payload.favourites_count, "Mastodon status favourites"),
      statusCreatedAt: boundedProviderIsoDate(payload.created_at, "Mastodon status creation time"),
    };
  }

  private get(pathname: string): Promise<Response> {
    return this.request(new URL(pathname, this.origin), {
      method: "GET",
      redirect: "error",
      headers: { authorization: this.authorization, accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
  }
}

export interface MailchimpCampaignInput {
  audienceId: string;
  subject: string;
  content: string;
  fromName: string;
  replyTo: string;
  title: string;
  campaignId?: string;
  onCampaignCreated?: (campaignId: string, webUrl?: string) => Promise<void>;
}

export interface MailchimpCampaignReport {
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

export interface MailchimpAudienceWebhook {
  webhookId: string;
  audienceId: string;
  callbackUrl: string;
  events: Readonly<Record<string, boolean>>;
  sources: Readonly<Record<string, boolean>>;
}

export interface MailchimpCreatedAudienceWebhook extends MailchimpAudienceWebhook {
  signingSecret: string;
}

const MAILCHIMP_CAMPAIGN_WEBHOOK_EVENTS = {
  subscribe: false,
  unsubscribe: false,
  profile: false,
  cleaned: false,
  upemail: false,
  campaign: true,
  sms_subscribe: false,
  sms_unsubscribe: false,
  upsms: false,
  sms_campaign: false,
} as const;

const MAILCHIMP_CAMPAIGN_WEBHOOK_SOURCES = { user: false, admin: true, api: true } as const;

export class MailchimpEmailConnector {
  readonly manifest = MAILCHIMP_EMAIL_CAPABILITIES;
  private readonly apiOrigin: string;
  private readonly authorization: string;
  readonly dataCenter: string;

  constructor(apiKey: string, private readonly request: ConnectorFetch = fetch) {
    const trimmed = apiKey.trim();
    const match = trimmed.match(/-([a-z]{2}\d+)$/iu);
    if (!match || trimmed.length < 20 || trimmed.length > 200) {
      throw new ChannelConnectorError("Use a bounded Mailchimp API key ending in its data-center suffix", "validation");
    }
    this.dataCenter = match[1]!.toLowerCase();
    this.apiOrigin = `https://${this.dataCenter}.api.mailchimp.com/3.0`;
    this.authorization = `Basic ${Buffer.from(`market-me:${trimmed}`).toString("base64")}`;
  }

  async testAudience(audienceId: string): Promise<ChannelConnectionTest> {
    const id = validateMailchimpIdentifier(audienceId, "audience");
    try {
      const response = await this.request(`${this.apiOrigin}/lists/${id}?fields=id,name`, {
        method: "GET",
        headers: this.headers(),
      });
      if (!response.ok) return { ok: false, error: mailchimpHttpMessage(response.status, "audience test") };
      const payload = await readBoundedJson(response);
      if (payload.id !== id || typeof payload.name !== "string" || !payload.name.trim()) {
        return { ok: false, error: "Mailchimp returned incomplete audience identity" };
      }
      return {
        ok: true,
        providerIdentity: { audienceId: id, audienceName: payload.name.trim(), dataCenter: this.dataCenter },
      };
    } catch (error) {
      if (error instanceof ChannelConnectorError) throw error;
      throw new ChannelConnectorError("Mailchimp audience test could not reach the provider", "transient");
    }
  }

  async publishCampaign(input: MailchimpCampaignInput): Promise<PublishContentResult> {
    const audienceId = validateMailchimpIdentifier(input.audienceId, "audience");
    const subject = boundedRequired(input.subject, 150, "Mailchimp email subject");
    const content = boundedRequired(input.content, 100_000, "Mailchimp email content");
    const fromName = boundedRequired(input.fromName, 100, "Mailchimp sender name");
    const replyTo = validEmail(input.replyTo);
    const title = boundedRequired(input.title, 200, "Mailchimp campaign title");
    let campaignId = input.campaignId
      ? validateMailchimpIdentifier(input.campaignId, "campaign")
      : undefined;
    let webUrl: string | undefined;

    if (!campaignId) {
      const response = await this.providerWrite("/campaigns", {
        method: "POST",
        body: JSON.stringify({
          type: "regular",
          recipients: { list_id: audienceId },
          settings: { subject_line: subject, title, from_name: fromName, reply_to: replyTo },
          tracking: { opens: true, html_clicks: true, text_clicks: true },
        }),
      }, "create", true);
      let payload: Record<string, unknown>;
      try {
        payload = await readBoundedJson(response);
      } catch {
        throw new ChannelConnectorError("Mailchimp created a campaign without a usable bounded response", "ambiguous");
      }
      if (typeof payload.id !== "string") {
        throw new ChannelConnectorError("Mailchimp created a campaign without a stable ID", "ambiguous");
      }
      campaignId = validateMailchimpIdentifier(payload.id, "campaign");
      if (typeof payload.web_id === "number" && Number.isSafeInteger(payload.web_id)) {
        webUrl = `https://${this.dataCenter}.admin.mailchimp.com/campaigns/show/?id=${payload.web_id}`;
      }
      await input.onCampaignCreated?.(campaignId, webUrl);
    }

    await this.providerWrite(`/campaigns/${campaignId}/content`, {
      method: "PUT",
      body: JSON.stringify({ plain_text: mailchimpPlainText(content), html: mailchimpHtml(content) }),
    }, "set content", false);
    await this.providerWrite(`/campaigns/${campaignId}/actions/send`, { method: "POST" }, "send", true);
    return { externalId: campaignId, externalUrl: webUrl, metadata: { audienceId, dataCenter: this.dataCenter } };
  }

  async getCampaignReport(campaignIdValue: string, audienceIdValue: string): Promise<MailchimpCampaignReport> {
    const campaignId = validateMailchimpIdentifier(campaignIdValue, "campaign");
    const audienceId = validateMailchimpIdentifier(audienceIdValue, "audience");
    const fields = [
      "id", "list_id", "emails_sent", "abuse_reports", "unsubscribed", "send_time",
      "bounces.hard_bounces", "bounces.soft_bounces", "opens.opens_total", "opens.unique_opens",
      "clicks.clicks_total", "clicks.unique_clicks",
    ].join(",");
    let response: Response;
    try {
      response = await this.request(`${this.apiOrigin}/reports/${campaignId}?fields=${encodeURIComponent(fields)}`, {
        method: "GET",
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new ChannelConnectorError("Mailchimp campaign report could not reach the provider", "transient");
    }
    if (response.status === 429) throw new ChannelConnectorError("Mailchimp rate limit reached", "rate_limit", parseRetryAfter(response));
    if (response.status === 401 || response.status === 403) throw new ChannelConnectorError("Mailchimp rejected report access", "authorization");
    if (response.status === 404) throw new ChannelConnectorError("Mailchimp campaign report is not available", "permanent");
    if (response.status >= 500) throw new ChannelConnectorError(`Mailchimp campaign report returned ${response.status}`, "transient");
    if (!response.ok) throw new ChannelConnectorError(`Mailchimp rejected campaign report access with ${response.status}`, "permanent");
    const payload = await readBoundedJson(response);
    if (payload.id !== campaignId || payload.list_id !== audienceId) {
      throw new ChannelConnectorError("Mailchimp campaign report identity did not match the approved audience", "permanent");
    }
    const opens = boundedObject(payload.opens, "opens");
    const clicks = boundedObject(payload.clicks, "clicks");
    const bounces = boundedObject(payload.bounces, "bounces");
    const sendTime = boundedIsoDate(payload.send_time, "send time");
    const report: MailchimpCampaignReport = {
      campaignId,
      audienceId,
      emailsSent: nonNegativeInteger(payload.emails_sent, "emails sent"),
      opensTotal: nonNegativeInteger(opens.opens_total, "total opens"),
      uniqueOpens: nonNegativeInteger(opens.unique_opens, "unique opens"),
      clicksTotal: nonNegativeInteger(clicks.clicks_total, "total clicks"),
      uniqueClicks: nonNegativeInteger(clicks.unique_clicks, "unique clicks"),
      unsubscribed: nonNegativeInteger(payload.unsubscribed, "unsubscribes"),
      hardBounces: nonNegativeInteger(bounces.hard_bounces, "hard bounces"),
      softBounces: nonNegativeInteger(bounces.soft_bounces, "soft bounces"),
      abuseReports: nonNegativeInteger(payload.abuse_reports, "abuse reports"),
      sendTime,
    };
    if (report.uniqueOpens > report.opensTotal || report.uniqueClicks > report.clicksTotal) {
      throw new ChannelConnectorError("Mailchimp campaign report totals were internally inconsistent", "permanent");
    }
    return report;
  }

  async listAudienceWebhooks(audienceIdValue: string): Promise<readonly MailchimpAudienceWebhook[]> {
    const audienceId = validateMailchimpIdentifier(audienceIdValue, "audience");
    const fields = "list_id,total_items,webhooks.id,webhooks.url,webhooks.events,webhooks.sources,webhooks.list_id";
    let response: Response;
    try {
      response = await this.request(`${this.apiOrigin}/lists/${audienceId}/webhooks?fields=${encodeURIComponent(fields)}`, {
        method: "GET", headers: this.headers(), signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new ChannelConnectorError("Mailchimp webhook inventory could not reach the provider", "transient");
    }
    this.assertProviderRead(response, "webhook inventory");
    const payload = await readBoundedJson(response);
    if (payload.list_id !== audienceId || !Array.isArray(payload.webhooks) || !Number.isSafeInteger(payload.total_items)) {
      throw new ChannelConnectorError("Mailchimp returned an invalid webhook inventory", "permanent");
    }
    if (payload.webhooks.length > 100 || payload.total_items !== payload.webhooks.length) {
      throw new ChannelConnectorError("Mailchimp returned an incomplete webhook inventory", "permanent");
    }
    return payload.webhooks.map((value) => parseMailchimpAudienceWebhook(value, audienceId));
  }

  async createCampaignWebhook(audienceIdValue: string, callbackUrlValue: string): Promise<MailchimpCreatedAudienceWebhook> {
    const audienceId = validateMailchimpIdentifier(audienceIdValue, "audience");
    const callbackUrl = validateMailchimpCallbackUrl(callbackUrlValue);
    const response = await this.providerWrite(`/lists/${audienceId}/webhooks`, {
      method: "POST",
      body: JSON.stringify({ url: callbackUrl, events: MAILCHIMP_CAMPAIGN_WEBHOOK_EVENTS, sources: MAILCHIMP_CAMPAIGN_WEBHOOK_SOURCES }),
    }, "create webhook", true);
    let payload: Record<string, unknown>;
    try {
      payload = await readBoundedJson(response);
    } catch (error) {
      if (error instanceof ChannelConnectorError) throw error;
      throw new ChannelConnectorError("Mailchimp created a webhook without a usable bounded response", "ambiguous");
    }
    const webhook = parseMailchimpAudienceWebhook(payload, audienceId);
    if (webhook.callbackUrl !== callbackUrl || !isExactMailchimpCampaignWebhook(webhook)) {
      await this.removeUnsafeCreatedWebhook(webhook);
      throw new ChannelConnectorError("Mailchimp created a webhook with unexpected settings; it was removed", "permanent");
    }
    if (typeof payload.signing_secret !== "string" || payload.signing_secret.length < 16 || payload.signing_secret.length > 256) {
      await this.removeUnsafeCreatedWebhook(webhook);
      throw new ChannelConnectorError("Mailchimp omitted the one-time signing secret; the created webhook was removed", "permanent");
    }
    return { ...webhook, signingSecret: payload.signing_secret };
  }

  async deleteAudienceWebhook(audienceIdValue: string, webhookIdValue: string): Promise<void> {
    const audienceId = validateMailchimpIdentifier(audienceIdValue, "audience");
    const webhookId = validateMailchimpIdentifier(webhookIdValue, "webhook");
    let response: Response;
    try {
      response = await this.request(`${this.apiOrigin}/lists/${audienceId}/webhooks/${webhookId}`, {
        method: "DELETE", headers: this.headers(), signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new ChannelConnectorError("Mailchimp delete webhook outcome is ambiguous", "ambiguous");
    }
    if (response.status === 204 || response.status === 404) return;
    if (response.status === 429) throw new ChannelConnectorError("Mailchimp rate limit reached", "rate_limit", parseRetryAfter(response));
    if (response.status === 401 || response.status === 403) throw new ChannelConnectorError("Mailchimp rejected webhook deletion", "authorization");
    if (response.status >= 500) throw new ChannelConnectorError(`Mailchimp delete webhook returned ${response.status}; outcome is ambiguous`, "ambiguous");
    throw new ChannelConnectorError(`Mailchimp rejected webhook deletion with ${response.status}`, "permanent");
  }

  private headers(): Record<string, string> {
    return { authorization: this.authorization, accept: "application/json", "content-type": "application/json" };
  }

  private assertProviderRead(response: Response, operation: string): void {
    if (response.ok) return;
    if (response.status === 429) throw new ChannelConnectorError("Mailchimp rate limit reached", "rate_limit", parseRetryAfter(response));
    if (response.status === 401 || response.status === 403) throw new ChannelConnectorError(mailchimpHttpMessage(response.status, operation), "authorization");
    if (response.status === 404) throw new ChannelConnectorError(mailchimpHttpMessage(response.status, operation), "permanent");
    if (response.status >= 500) throw new ChannelConnectorError(`Mailchimp ${operation} returned ${response.status}`, "transient");
    throw new ChannelConnectorError(`Mailchimp rejected ${operation} with ${response.status}`, "permanent");
  }

  private async removeUnsafeCreatedWebhook(webhook: MailchimpAudienceWebhook): Promise<void> {
    try {
      await this.deleteAudienceWebhook(webhook.audienceId, webhook.webhookId);
    } catch {
      throw new ChannelConnectorError("Mailchimp created an unusable webhook and cleanup is ambiguous", "ambiguous");
    }
  }

  private async providerWrite(path: string, init: RequestInit, operation: string, ambiguousOnFailure: boolean): Promise<Response> {
    let response: Response;
    try {
      response = await this.request(`${this.apiOrigin}${path}`, { ...init, headers: { ...this.headers(), ...init.headers } });
    } catch {
      throw new ChannelConnectorError(
        `Mailchimp ${operation} outcome is ${ambiguousOnFailure ? "ambiguous" : "retryable"}`,
        ambiguousOnFailure ? "ambiguous" : "transient",
      );
    }
    if (response.ok) return response;
    if (response.status === 429) throw new ChannelConnectorError("Mailchimp rate limit reached", "rate_limit", parseRetryAfter(response));
    if ([401, 403, 404].includes(response.status)) throw new ChannelConnectorError(mailchimpHttpMessage(response.status, operation), "authorization");
    if (response.status >= 500 && ambiguousOnFailure) throw new ChannelConnectorError(`Mailchimp ${operation} returned ${response.status}; outcome is ambiguous`, "ambiguous");
    if (response.status >= 500) throw new ChannelConnectorError(`Mailchimp ${operation} returned ${response.status}`, "transient");
    throw new ChannelConnectorError(`Mailchimp rejected ${operation} with ${response.status}`, "permanent");
  }
}

export function isExactMailchimpCampaignWebhook(webhook: MailchimpAudienceWebhook): boolean {
  return Object.entries(MAILCHIMP_CAMPAIGN_WEBHOOK_EVENTS).every(([key, value]) => webhook.events[key] === value)
    && Object.entries(MAILCHIMP_CAMPAIGN_WEBHOOK_SOURCES).every(([key, value]) => webhook.sources[key] === value);
}

function parseMailchimpAudienceWebhook(value: unknown, audienceId: string): MailchimpAudienceWebhook {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChannelConnectorError("Mailchimp returned an invalid webhook", "permanent");
  }
  const payload = value as Record<string, unknown>;
  const webhookId = typeof payload.id === "string" ? validateMailchimpIdentifier(payload.id, "webhook") : undefined;
  const callbackUrl = typeof payload.url === "string" ? validateMailchimpCallbackUrl(payload.url) : undefined;
  if (!webhookId || !callbackUrl || payload.list_id !== audienceId) {
    throw new ChannelConnectorError("Mailchimp returned mismatched webhook identity", "permanent");
  }
  return {
    webhookId, audienceId, callbackUrl,
    events: boundedBooleanRecord(payload.events, "webhook events"),
    sources: boundedBooleanRecord(payload.sources, "webhook sources"),
  };
}

function validateMailchimpCallbackUrl(value: string): string {
  if (value.length > 2048) throw new ChannelConnectorError("Mailchimp webhook callback URL is invalid", "validation");
  let url: URL;
  try { url = new URL(value); } catch { throw new ChannelConnectorError("Mailchimp webhook callback URL is invalid", "validation"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new ChannelConnectorError("Mailchimp webhook callback URL must be public HTTPS without credentials or a fragment", "validation");
  }
  return url.href;
}

function boundedBooleanRecord(value: unknown, label: string): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ChannelConnectorError(`Mailchimp ${label} were invalid`, "permanent");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 20 || entries.some(([key, item]) => !/^[a-z_]{1,32}$/u.test(key) || typeof item !== "boolean")) {
    throw new ChannelConnectorError(`Mailchimp ${label} were invalid`, "permanent");
  }
  return Object.fromEntries(entries) as Record<string, boolean>;
}

function validateMailchimpIdentifier(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^[a-z0-9_-]{1,64}$/iu.test(trimmed)) throw new ChannelConnectorError(`Mailchimp ${label} ID is invalid`, "validation");
  return trimmed;
}

function boundedRequired(value: string, max: number, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new ChannelConnectorError(`${label} must contain 1 through ${max} characters`, "validation");
  return trimmed;
}

function validEmail(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(trimmed)) throw new ChannelConnectorError("Mailchimp reply-to address is invalid", "validation");
  return trimmed;
}

function mailchimpPlainText(content: string): string {
  return `${content.trim()}\n\nUnsubscribe: *|UNSUB|*`;
}

function mailchimpHtml(content: string): string {
  const paragraphs = content.trim().split(/\n{2,}/u).map((value) => `<p>${value.split("\n").map(mailchimpHtmlLine).join("<br>")}</p>`).join("");
  return `<!doctype html><html><body>${paragraphs}<p><a href="*|UNSUB|*">Unsubscribe</a></p></body></html>`;
}

function mailchimpHtmlLine(value: string): string {
  const trimmed = value.trim();
  if (/^https:\/\/[^\s<>]{1,2048}$/u.test(trimmed)) {
    const escaped = escapeHtml(trimmed);
    return `<a href="${escaped}">${escaped}</a>`;
  }
  return escapeHtml(value);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function mailchimpHttpMessage(status: number, operation: string): string {
  if (status === 401 || status === 403) return "Mailchimp rejected the API credentials or required permission";
  if (status === 404) return `Mailchimp ${operation} target was not found`;
  return `Mailchimp ${operation} failed with ${status}`;
}

async function readBoundedJson(response: Response): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 65_536) throw new ChannelConnectorError("Mailchimp response exceeded 64 KiB", "permanent");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 65_536) throw new ChannelConnectorError("Mailchimp response exceeded 64 KiB", "permanent");
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ChannelConnectorError("Mailchimp response was not an object", "permanent");
  return value as Record<string, unknown>;
}

async function readBoundedProviderJson(response: Response, provider: string): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 65_536) throw new ChannelConnectorError(`${provider} response exceeded 64 KiB`, "permanent");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 65_536) throw new ChannelConnectorError(`${provider} response exceeded 64 KiB`, "permanent");
  let value: unknown;
  try { value = JSON.parse(text) as unknown; }
  catch { throw new ChannelConnectorError(`${provider} response was not valid JSON`, "permanent"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ChannelConnectorError(`${provider} response was not an object`, "permanent");
  return value as Record<string, unknown>;
}

function boundedObjectForProvider(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChannelConnectorError(`${label} was not an object`, "permanent");
  }
  return value as Record<string, unknown>;
}

function boundedMastodonIdentity(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 500 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ChannelConnectorError(`Mastodon returned an invalid ${label}`, "permanent");
  }
  return value.trim();
}

function mastodonCharacterLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 100_000) {
    throw new ChannelConnectorError("Mastodon returned an invalid status character limit", "permanent");
  }
  return value;
}

function mastodonReservedUrlCharacters(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 1_000) {
    throw new ChannelConnectorError("Mastodon returned an invalid reserved URL character count", "permanent");
  }
  return value;
}

interface MastodonMediaConfiguration {
  attachmentsPerMessage: number;
  attachmentBytes: number;
  attachmentPixels: number;
  attachmentDescriptionCharacters: number;
  supportedImageMimeTypes: readonly ("image/jpeg" | "image/png" | "image/webp")[];
}

function mastodonMediaConfiguration(
  configuration: Record<string, unknown>,
  statuses: Record<string, unknown>,
): MastodonMediaConfiguration | undefined {
  const mediaValue = configuration.media_attachments;
  if (mediaValue === undefined) return undefined;
  const media = boundedObjectForProvider(mediaValue, "Mastodon media configuration");
  const providerMaxAttachments = boundedMastodonPositiveInteger(
    statuses.max_media_attachments,
    20,
    "maximum media attachment count",
  );
  const providerImageBytes = boundedMastodonPositiveInteger(media.image_size_limit, 1_073_741_824, "image byte limit");
  const providerImagePixels = boundedMastodonPositiveInteger(media.image_matrix_limit, 1_000_000_000, "image pixel limit");
  const providerDescriptionCharacters = boundedMastodonPositiveInteger(media.description_limit, 10_000, "media description limit");
  const supportedMimeTypes = media.supported_mime_types;
  if (!Array.isArray(supportedMimeTypes) || supportedMimeTypes.length > 100
    || supportedMimeTypes.some((value) => typeof value !== "string" || value.length > 100)) {
    throw new ChannelConnectorError("Mastodon returned invalid supported media types", "permanent");
  }
  const accepted = ["image/jpeg", "image/png", "image/webp"] as const;
  const supported = accepted.filter((mimeType) => supportedMimeTypes.includes(mimeType));
  if (!supported.length) {
    throw new ChannelConnectorError("Mastodon does not advertise a supported reviewed-image format", "permanent");
  }
  return {
    attachmentsPerMessage: Math.min(providerMaxAttachments, 4),
    attachmentBytes: Math.min(providerImageBytes, 10 * 1024 * 1024),
    attachmentPixels: Math.min(providerImagePixels, 100_000_000),
    attachmentDescriptionCharacters: Math.min(providerDescriptionCharacters, 1_500),
    supportedImageMimeTypes: supported,
  };
}

function boundedMastodonPositiveInteger(value: unknown, ceiling: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > ceiling) {
    throw new ChannelConnectorError(`Mastodon returned an invalid ${label}`, "permanent");
  }
  return value;
}

export function mastodonStatusCharacterCount(content: string, charactersReservedPerUrl: number): number {
  if (!Number.isSafeInteger(charactersReservedPerUrl) || charactersReservedPerUrl < 1 || charactersReservedPerUrl > 1_000) {
    throw new ChannelConnectorError("Mastodon reserved URL character count is invalid", "validation");
  }
  let count = Array.from(content).length;
  for (const match of content.matchAll(/https?:\/\/[^\s]+/giu)) {
    count += charactersReservedPerUrl - Array.from(match[0]).length;
  }
  return count;
}

function safeMastodonProviderUrl(value: unknown, instanceOrigin: URL): string | undefined {
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== instanceOrigin.hostname || url.port || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}

function boundedObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChannelConnectorError(`Mailchimp report ${label} was not an object`, "permanent");
  }
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ChannelConnectorError(`Mailchimp report ${label} was invalid`, "permanent");
  }
  return value;
}

function boundedIsoDate(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 40) {
    throw new ChannelConnectorError(`Mailchimp report ${label} was invalid`, "permanent");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ChannelConnectorError(`Mailchimp report ${label} was invalid`, "permanent");
  return date.toISOString();
}

function nonNegativeProviderInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ChannelConnectorError(`${label} was invalid`, "permanent");
  }
  return value;
}

function boundedProviderIsoDate(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 40) throw new ChannelConnectorError(`${label} was invalid`, "permanent");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ChannelConnectorError(`${label} was invalid`, "permanent");
  return date.toISOString();
}

function validateDiscordAttachment(attachment: PublishAttachmentInput, manifest: ChannelCapabilityManifest): void {
  const extension = attachment.fileName.toLowerCase().match(/\.(jpe?g|png|webp|gif)$/)?.[1];
  if (!extension || !/^[^\\/\u0000]{1,255}$/.test(attachment.fileName)) throw new ChannelConnectorError("Discord image attachments require a safe .jpg, .jpeg, .png, .webp, or .gif filename", "validation");
  if (attachment.data.byteLength < 1 || attachment.data.byteLength > manifest.limits.attachmentBytes) throw new ChannelConnectorError("Discord image attachments must contain 1 byte through 10 MiB", "validation");
  if (attachment.description !== undefined && (!attachment.description.trim() || attachment.description.length > manifest.limits.attachmentDescriptionCharacters)) throw new ChannelConnectorError("Discord attachment descriptions must contain 1 through 1024 characters when supplied", "validation");
}

function validateMastodonAttachment(attachment: PublishAttachmentInput, manifest: ChannelCapabilityManifest): void {
  const extension = attachment.fileName.toLowerCase().match(/\.(jpe?g|png|webp)$/u)?.[1];
  if (!extension || !/^[^\\/\u0000]{1,255}$/u.test(attachment.fileName)) {
    throw new ChannelConnectorError("Mastodon image attachments require a safe .jpg, .jpeg, .png, or .webp filename", "validation");
  }
  const feature = attachment.mimeType === "image/jpeg" ? "imageJpeg"
    : attachment.mimeType === "image/png" ? "imagePng"
      : attachment.mimeType === "image/webp" ? "imageWebp" : undefined;
  if (!feature || manifest.features[feature] !== true) {
    throw new ChannelConnectorError("Mastodon does not advertise support for this reviewed-image format", "validation");
  }
  const byteLimit = manifest.limits.attachmentBytes;
  if (!Number.isSafeInteger(byteLimit) || attachment.data.byteLength < 1 || attachment.data.byteLength > byteLimit) {
    throw new ChannelConnectorError("Mastodon image attachment bytes exceed the live provider limit", "validation");
  }
  const descriptionLimit = manifest.limits.attachmentDescriptionCharacters;
  if (!attachment.description?.trim() || !Number.isSafeInteger(descriptionLimit)
    || Array.from(attachment.description).length > descriptionLimit) {
    throw new ChannelConnectorError("Mastodon reviewed images require bounded approved alt text", "validation");
  }
}

function attachmentArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

export function parseDiscordWebhookUrl(value: string): URL {
  const url = new URL(value);
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== "discord.com" || parts.length !== 4 || parts[0] !== "api" || parts[1] !== "webhooks" || !/^\d+$/.test(parts[2]) || parts[3].length < 20) {
    throw new ChannelConnectorError("Use an HTTPS discord.com/api/webhooks/<id>/<token> URL", "validation");
  }
  if (url.username || url.password || url.port || url.search || url.hash) throw new ChannelConnectorError("Discord webhook URLs cannot contain credentials, ports, queries, or fragments", "validation");
  return url;
}

export function parseSlackWebhookUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ChannelConnectorError("Use an HTTPS Slack incoming webhook URL", "validation");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const validHost = url.hostname === "hooks.slack.com" || url.hostname === "hooks.slack-gov.com";
  const validIdentity = parts.length === 4
    && parts[0] === "services"
    && /^[A-Z0-9]{6,32}$/u.test(parts[1] ?? "")
    && /^[A-Z0-9]{6,32}$/u.test(parts[2] ?? "")
    && /^[A-Za-z0-9_-]{20,200}$/u.test(parts[3] ?? "");
  if (url.protocol !== "https:" || !validHost || !validIdentity) {
    throw new ChannelConnectorError("Use an HTTPS hooks.slack.com/services/<team>/<service>/<secret> URL", "validation");
  }
  if (url.username || url.password || url.port || url.search || url.hash) {
    throw new ChannelConnectorError("Slack webhook URLs cannot contain credentials, ports, queries, or fragments", "validation");
  }
  return url;
}

export function parseMastodonInstanceOrigin(value: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new ChannelConnectorError("Use an HTTPS Mastodon instance origin", "validation"); }
  const allowed = new Set(allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean));
  if (!allowed.size) {
    throw new ChannelConnectorError("Mastodon instance hosts are not configured for this deployment", "validation");
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.username || url.password || url.port || url.search || url.hash) {
    throw new ChannelConnectorError("Mastodon instance must be an undecorated HTTPS origin using the default port", "validation");
  }
  if (!allowed.has(url.hostname)) {
    throw new ChannelConnectorError("Mastodon instance host is not approved by this deployment", "validation");
  }
  return url;
}

async function readBoundedSlackText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 256) {
    throw new ChannelConnectorError("Slack returned an oversized acknowledgement", "ambiguous");
  }
  const value = await response.text();
  if (new TextEncoder().encode(value).byteLength > 256) {
    throw new ChannelConnectorError("Slack returned an oversized acknowledgement", "ambiguous");
  }
  return value.trim();
}

function classifyHttpMessage(status: number): string {
  if (status === 401 || status === 403) return "Discord rejected the webhook credentials";
  if (status === 404) return "Discord webhook no longer exists";
  return `Discord connection test failed with ${status}`;
}

function parseRetryAfter(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : undefined;
}

function parseMastodonRetryAfter(response: Response): number | undefined {
  const direct = parseRetryAfter(response);
  if (direct !== undefined) return direct;
  const reset = response.headers.get("x-ratelimit-reset");
  if (!reset) return undefined;
  const resetAt = new Date(reset).getTime();
  return Number.isFinite(resetAt) ? Math.max(0, resetAt - Date.now()) : undefined;
}

function mastodonHttpMessage(status: number, operation: string): string {
  if (status === 401 || status === 403 || status === 422) return `Mastodon rejected the user token or required scope during ${operation}`;
  if (status === 404) return `Mastodon ${operation} endpoint was not found`;
  if (status === 429) return `Mastodon rate limit reached during ${operation}`;
  return `Mastodon ${operation} failed with ${status}`;
}
