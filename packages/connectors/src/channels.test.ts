import { afterEach, describe, expect, it, vi } from "vitest";
import { ChannelConnectorError, DISCORD_WEBHOOK_CAPABILITIES, DiscordWebhookConnector, isExactMailchimpCampaignWebhook, MAILCHIMP_EMAIL_CAPABILITIES, MailchimpEmailConnector, MastodonAccountConnector, mastodonCapabilities, parseDiscordWebhookUrl, parseMastodonInstanceOrigin, parseSlackWebhookUrl, renderChannelPreview, SLACK_WEBHOOK_CAPABILITIES, SlackWebhookConnector } from "./channels";
import { ChannelDispatchDeadlineExceededError } from "./request-budget";
import type { ConnectorFetch } from "./types";

afterEach(() => vi.restoreAllMocks());

const url = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz123456";

const deadlinePublishers = [
  {
    name: "Discord",
    create: (request: ConnectorFetch) => new DiscordWebhookConnector(url, request),
    acknowledgement: () => new Response(JSON.stringify({ id: "message-1", channel_id: "channel-1" })),
  },
  {
    name: "Slack",
    create: (request: ConnectorFetch) => new SlackWebhookConnector("https://hooks.slack.com/services/T01234567/B01234567/abcdefghijklmnopqrstuvwxyz123456", request),
    acknowledgement: () => new Response("ok"),
  },
  {
    name: "Mastodon",
    create: (request: ConnectorFetch) => new MastodonAccountConnector("https://social.example.test", "mastodon-user-token-abcdefghijklmnopqrstuvwxyz", ["social.example.test"], request),
    acknowledgement: () => new Response(JSON.stringify({ id: "status-1", url: "https://social.example.test/@marketme/status-1" })),
  },
];

describe.each(deadlinePublishers)("$name dispatch deadline", ({ create, acknowledgement }) => {
  const input = { content: "Exact reviewed text", idempotencyKey: "campaign:instance:step:publish" };

  it.each([NaN, Infinity, -Infinity, 1e100, -1e100, 999, 1_000, "2000", null])("makes zero requests for invalid or closed deadline %s", async (deadline) => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const request = vi.fn();
    await expect(create(request).publishContent(input, { dispatchDeadlineAt: deadline as number })).rejects.toBeInstanceOf(ChannelDispatchDeadlineExceededError);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([undefined, 1_250, 20_000])("uses a capped standard timeout for deadline %s", async (deadline) => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const request = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      expect(init?.redirect).toBe("error");
      return acknowledgement();
    });
    await expect(create(request).publishContent(input, { dispatchDeadlineAt: deadline })).resolves.toBeDefined();
    expect(timeout).toHaveBeenCalledExactlyOnceWith(deadline === 1_250 ? 250 : 5_000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not reinterpret a received valid acknowledgement after the wall-clock cutoff", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(new AbortController().signal);
    const request = vi.fn(async () => { clock.mockReturnValue(1_300); return acknowledgement(); });
    await expect(create(request).publishContent(input, { dispatchDeadlineAt: 1_250 })).resolves.toBeDefined();
    expect(request).toHaveBeenCalledTimes(1);
    expect(clock).toHaveBeenCalledTimes(2); // budget creation + first I/O only; never the response body
  });

  it("keeps expiry between budget creation and actual I/O classified as no dispatch", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValue(1_250);
    const request = vi.fn();
    await expect(create(request).publishContent(input, { dispatchDeadlineAt: 1_250 }))
      .rejects.toBeInstanceOf(ChannelDispatchDeadlineExceededError);
    expect(request).not.toHaveBeenCalled();
  });

  it("makes zero requests after the conservative database-derived monotonic bound", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValue(125);
    const request = vi.fn();
    await expect(create(request).publishContent(input, { dispatchDeadlineAt: 20_000, dispatchMonotonicDeadlineAt: 125 }))
      .rejects.toBeInstanceOf(ChannelDispatchDeadlineExceededError);
    expect(request).not.toHaveBeenCalled();
  });

  it("marks raw transport failure after one write attempt ambiguous", async () => {
    const request = vi.fn(async () => { throw new Error("socket closed after request started"); });
    await expect(create(request).publishContent(input)).rejects.toMatchObject({ kind: "ambiguous" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("marks an in-flight request timeout ambiguous, not a no-dispatch expiry", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const request = vi.fn(() => new Promise<Response>(() => undefined));
    const outcome = expect(create(request).publishContent(input, { dispatchDeadlineAt: 1_250 })).rejects.toMatchObject({ kind: "ambiguous" });
    expect(request).toHaveBeenCalledTimes(1);
    controller.abort(new DOMException("request timed out", "TimeoutError"));
    await outcome;
  });

  it("keeps the body wait under the original request budget", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    let bodyStarted!: () => void;
    const readingBody = new Promise<void>((resolve) => { bodyStarted = resolve; });
    const response = acknowledgement();
    vi.spyOn(response, "text").mockImplementation(() => { bodyStarted(); return new Promise<string>(() => undefined); });
    const request = vi.fn(async () => response);
    const outcome = expect(create(request).publishContent(input)).rejects.toMatchObject({ kind: "ambiguous" });
    await readingBody;
    controller.abort(new DOMException("body timed out", "TimeoutError"));
    await outcome;
    expect(timeout).toHaveBeenCalledExactlyOnceWith(5_000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("classifies malformed successful response bodies as ambiguous", async () => {
    const request = vi.fn(async () => new Response("not a usable acknowledgement"));
    await expect(create(request).publishContent(input)).rejects.toMatchObject({ kind: "ambiguous" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(["attachments", "providerAttachmentIds"])("rejects deadline-based %s before any I/O", async (field) => {
    const request = vi.fn();
    const media = field === "attachments"
      ? { attachments: [{ fileName: "reviewed.png", mimeType: "image/png" as const, description: "Reviewed image", data: new Uint8Array([1]) }] }
      : { providerAttachmentIds: ["media-1"] };
    await expect(create(request).publishContent({ ...input, ...media }, { dispatchDeadlineAt: Date.now() + 60_000 })).rejects.toMatchObject({ kind: "validation" });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("DiscordWebhookConnector", () => {
  it("bounds connection-test headers and body without exposing raw transport errors", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    let bodyStarted!: () => void;
    const readingBody = new Promise<void>((resolve) => { bodyStarted = resolve; });
    const response = new Response("{}");
    vi.spyOn(response, "text").mockImplementation(() => { bodyStarted(); return new Promise<string>(() => undefined); });
    const request = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect(init?.signal).toBe(controller.signal);
      return response;
    });
    const result = new DiscordWebhookConnector(url, request).testConnection();
    await readingBody;
    controller.abort(new Error("sensitive raw provider diagnostic"));
    await expect(result).resolves.toEqual({ ok: false, error: "Discord connection test could not read a bounded provider response" });
    expect(timeout).toHaveBeenCalledExactlyOnceWith(5_000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("bounds Discord acknowledgement size and rejects invalid message identity", async () => {
    for (const body of [JSON.stringify({ id: "" }), " ".repeat(65_537)]) {
      await expect(new DiscordWebhookConnector(url, async () => new Response(body)).publishContent({ content: "Reviewed" })).rejects.toMatchObject({ kind: "ambiguous" });
    }
  });
  it("renders a capability-bounded channel preview with presentation and destination sections", () => {
    expect(renderChannelPreview(DISCORD_WEBHOOK_CAPABILITIES, { body: "Doors open at nine.", callToAction: "Reserve a place.", hashtags: ["#Community"], destinationUrl: "https://example.com/event" })).toEqual({
      content: "Doors open at nine.\n\nReserve a place.\n\n#Community\n\nhttps://example.com/event",
      characterCount: 76,
      characterLimit: 2000,
      issues: [],
    });
  });

  it("reports provider overflow without truncating the preview", () => {
    const result = renderChannelPreview({ ...DISCORD_WEBHOOK_CAPABILITIES, limits: { contentCharacters: 10 } }, { body: "Complete factual sentence.", hashtags: [] });
    expect(result.content).toBe("Complete factual sentence.");
    expect(result.issues).toEqual([expect.objectContaining({ code: "content_limit" })]);
  });
  it("rejects non-Discord and decorated webhook URLs", () => {
    expect(() => parseDiscordWebhookUrl("https://example.com/api/webhooks/1/token")).toThrow(ChannelConnectorError);
    expect(() => parseDiscordWebhookUrl(`${url}?wait=true`)).toThrow("cannot contain");
  });

  it("publishes with confirmation and disables every mention type", async () => {
    const request = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => new Response(JSON.stringify({ id: "message-1", guild_id: "guild-1", channel_id: "channel-1" }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await new DiscordWebhookConnector(url, request).publishContent({ content: "@everyone launch" });
    expect(result).toEqual(expect.objectContaining({ externalId: "message-1", externalUrl: "https://discord.com/channels/guild-1/channel-1/message-1" }));
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual(expect.objectContaining({ allowed_mentions: { parse: [] } }));
    expect(String(request.mock.calls[0][0])).toContain("wait=true");
  });

  it("publishes reviewed image attachments as Discord multipart fields", async () => {
    const request = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(init?.headers).toEqual({ accept: "application/json" });
      expect(JSON.parse(String(form.get("payload_json")))).toEqual(expect.objectContaining({ attachments: [{ id: 0, filename: "launch.png", description: "Blue launch graphic" }] }));
      expect(form.get("files[0]")).toBeInstanceOf(Blob);
      return new Response(JSON.stringify({ id: "message-media", channel_id: "channel-1" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    expect(await new DiscordWebhookConnector(url, request).publishContent({ content: "Launch", attachments: [{ fileName: "launch.png", mimeType: "image/png", description: "Blue launch graphic", data: new Uint8Array([1, 2, 3]) }] })).toMatchObject({ externalId: "message-media" });
  });

  it("rejects unsupported or inaccessible attachment inputs before provider I/O", async () => {
    const request = vi.fn();
    const connector = new DiscordWebhookConnector(url, request);
    await expect(connector.publishContent({ content: "Launch", attachments: [{ fileName: "launch.svg", mimeType: "image/png", description: "Graphic", data: new Uint8Array([1]) }] })).rejects.toThrow("safe");
    await expect(connector.publishContent({ content: "Launch", attachments: [{ fileName: "launch.png", mimeType: "image/png", description: "", data: new Uint8Array([1]) }] })).rejects.toThrow("descriptions");
    expect(request).not.toHaveBeenCalled();
  });

  it("classifies rate limits and ambiguous server responses", async () => {
    const limited = new DiscordWebhookConnector(url, async () => new Response("", { status: 429, headers: { "retry-after": "1.5" } }));
    await expect(limited.publishContent({ content: "launch" })).rejects.toEqual(expect.objectContaining({ kind: "rate_limit", retryAfterMs: 1500 }));
    const ambiguous = new DiscordWebhookConnector(url, async () => new Response("", { status: 503 }));
    await expect(ambiguous.publishContent({ content: "launch" })).rejects.toEqual(expect.objectContaining({ kind: "ambiguous" }));
  });
});

describe("SlackWebhookConnector", () => {
  const slackUrl = "https://hooks.slack.com/services/T01234567/B01234567/abcdefghijklmnopqrstuvwxyz123456";

  it("parses only exact Slack and GovSlack incoming-webhook targets", () => {
    expect(parseSlackWebhookUrl(slackUrl).hostname).toBe("hooks.slack.com");
    expect(parseSlackWebhookUrl(slackUrl.replace("hooks.slack.com", "hooks.slack-gov.com")).hostname).toBe("hooks.slack-gov.com");
    expect(() => parseSlackWebhookUrl(slackUrl.replace("hooks.slack.com", "example.com"))).toThrow(ChannelConnectorError);
    expect(() => parseSlackWebhookUrl(`${slackUrl}?secret=1`)).toThrow("cannot contain");
  });

  it("renders a conservative non-truncating Slack preview", () => {
    const preview = renderChannelPreview(SLACK_WEBHOOK_CAPABILITIES, {
      body: "Launch update", callToAction: "Read more", hashtags: ["#MarketMe"], destinationUrl: "https://example.com/launch",
    });
    expect(preview).toMatchObject({ characterLimit: 4_000, issues: [] });
    expect(preview.content).toContain("#MarketMe");
  });

  it("posts one visible connection marker and returns only safe target identity", async () => {
    const request = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        text: "Market Me connection test — no Campaign content was published.",
        mrkdwn: false, link_names: false, unfurl_links: false, unfurl_media: false,
      });
      return new Response("ok", { status: 200 });
    });
    await expect(new SlackWebhookConnector(slackUrl, request).testConnection()).resolves.toEqual({
      ok: true,
      providerIdentity: { teamId: "T01234567", serviceId: "B01234567", host: "hooks.slack.com" },
    });
  });

  it("accepts only an exact bounded acknowledgement and records no invented provider message ID", async () => {
    const request = vi.fn(async () => new Response("ok\n", { status: 200 }));
    await expect(new SlackWebhookConnector(slackUrl, request).publishContent({ content: "Launch update" })).resolves.toEqual({
      metadata: {
        acknowledgement: "ok",
        providerMessageIdAvailable: false,
        targetIdentity: { teamId: "T01234567", serviceId: "B01234567", host: "hooks.slack.com" },
      },
    });
    await expect(new SlackWebhookConnector(slackUrl, async () => new Response("unexpected", { status: 200 }))
      .publishContent({ content: "Launch" })).rejects.toMatchObject({ kind: "ambiguous" });
  });

  it("fails closed for attachments and classifies rate and uncertain outcomes", async () => {
    const request = vi.fn();
    await expect(new SlackWebhookConnector(slackUrl, request).publishContent({
      content: "Launch", attachments: [{ fileName: "launch.png", mimeType: "image/png", data: new Uint8Array([1]) }],
    })).rejects.toMatchObject({ kind: "validation" });
    expect(request).not.toHaveBeenCalled();
    await expect(new SlackWebhookConnector(slackUrl, async () => new Response("rate_limited", { status: 429, headers: { "retry-after": "2" } }))
      .publishContent({ content: "Launch" })).rejects.toMatchObject({ kind: "rate_limit", retryAfterMs: 2_000 });
    await expect(new SlackWebhookConnector(slackUrl, async () => { throw new Error("socket closed"); })
      .publishContent({ content: "Launch" })).rejects.toMatchObject({ kind: "ambiguous" });
  });
});

describe("MastodonAccountConnector", () => {
  const origin = "https://social.example.test";
  const token = "mastodon-user-token-abcdefghijklmnopqrstuvwxyz";

  it("accepts only an undecorated allowlisted HTTPS instance origin", () => {
    expect(parseMastodonInstanceOrigin(origin, ["social.example.test"]).origin).toBe(origin);
    expect(() => parseMastodonInstanceOrigin(origin, [])).toThrow("not configured");
    expect(() => parseMastodonInstanceOrigin("https://other.example.test", ["social.example.test"])).toThrow("not approved");
    expect(() => parseMastodonInstanceOrigin(`${origin}/about`, ["social.example.test"])).toThrow("undecorated");
  });

  it("verifies an exact account and discovers the live status limit without a provider write", async () => {
    const request = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      const pathname = new URL(String(input)).pathname;
      return pathname.endsWith("verify_credentials")
        ? new Response(JSON.stringify({ id: "account-1", username: "marketme", acct: "marketme", url: `${origin}/@marketme` }), { status: 200 })
        : new Response(JSON.stringify({ configuration: { statuses: { max_characters: 777, characters_reserved_per_url: 23 } } }), { status: 200 });
    });
    await expect(new MastodonAccountConnector(origin, token, ["social.example.test"], request).testConnection()).resolves.toEqual({
      ok: true,
      providerIdentity: {
        host: "social.example.test", instanceOrigin: origin, accountId: "account-1", username: "marketme",
        acct: "marketme", profileUrl: `${origin}/@marketme`, maxCharacters: "777",
        charactersReservedPerUrl: "23",
      },
      capabilities: mastodonCapabilities(777),
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("uses the instance reserved-URL weight and Unicode code points in previews", () => {
    const preview = renderChannelPreview(mastodonCapabilities(30, 23), {
      body: "🚀 https://x.co/a", hashtags: [],
    });
    expect(preview.characterCount).toBe(25);
    expect(preview.issues).toEqual([]);
    expect(renderChannelPreview(mastodonCapabilities(24, 23), { body: "🚀 https://x.co/a", hashtags: [] }).issues)
      .toEqual([expect.objectContaining({ code: "content_limit" })]);
  });

  it("publishes exact public text once with provider idempotency and stable identity", async () => {
    const request = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init).toMatchObject({ method: "POST", redirect: "error" });
      expect((init?.headers as Record<string, string>)["idempotency-key"]).toBe("campaign:instance:step:publish");
      expect(JSON.parse(String(init?.body))).toEqual({ status: "Approved launch", visibility: "public", sensitive: false });
      return new Response(JSON.stringify({ id: "status-1", url: `${origin}/@marketme/status-1` }), { status: 200 });
    });
    await expect(new MastodonAccountConnector(origin, token, ["social.example.test"], request).publishContent({
      content: "Approved launch", idempotencyKey: "campaign:instance:step:publish",
    })).resolves.toEqual({
      externalId: "status-1",
      externalUrl: `${origin}/@marketme/status-1`,
      metadata: { host: "social.example.test", visibility: "public", providerIdempotencyApplied: true },
    });
  });

  it("discovers capped reviewed-image limits and uploads approved alt text", async () => {
    const request = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname.endsWith("verify_credentials"))
        return new Response(JSON.stringify({ id: "account-1", username: "marketme", acct: "marketme", url: `${origin}/@marketme` }), { status: 200 });
      if (pathname === "/api/v2/instance") return new Response(JSON.stringify({ configuration: {
        statuses: { max_characters: 777, characters_reserved_per_url: 23, max_media_attachments: 8 },
        media_attachments: {
          supported_mime_types: ["image/jpeg", "image/png", "image/webp", "image/gif"],
          image_size_limit: 25 * 1024 * 1024, image_matrix_limit: 120_000_000, description_limit: 2_000,
        },
      } }), { status: 200 });
      if (pathname === "/api/v2/media") {
        expect(init?.method).toBe("POST");
        const form = init?.body as FormData;
        expect(form.get("description")).toBe("Approved product image");
        expect(form.get("file")).toBeInstanceOf(Blob);
        return new Response(JSON.stringify({ id: "media-1", url: `${origin}/media/media-1.png` }), { status: 200 });
      }
      throw new Error(`Unexpected ${pathname}`);
    });
    const connector = new MastodonAccountConnector(origin, token, ["social.example.test"], request);
    const tested = await connector.testConnection();
    expect(tested).toMatchObject({
      ok: true,
      providerConfiguration: {
        attachmentsPerMessage: 4,
        attachmentBytes: 10 * 1024 * 1024,
        attachmentPixels: 100_000_000,
        attachmentDescriptionCharacters: 1_500,
        supportedImageMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      },
      capabilities: { features: { attachments: true, imageJpeg: true, imagePng: true, imageWebp: true } },
    });
    await expect(connector.uploadMedia({
      fileName: "product.png", mimeType: "image/png", description: "Approved product image", data: new Uint8Array([1, 2, 3]),
    }, tested.capabilities!)).resolves.toEqual({ mediaId: "media-1", ready: true });
  });

  it("persists async media identity semantics and attaches ordered IDs to the exact status", async () => {
    const request = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/api/v2/media") return new Response(JSON.stringify({ id: "media-async", url: null }), { status: 202 });
      if (pathname === "/api/v1/media/media-async") return new Response(JSON.stringify({ id: "media-async", url: `${origin}/media/media-async.png` }), { status: 200 });
      if (pathname === "/api/v1/statuses") {
        expect(JSON.parse(String(init?.body))).toEqual({
          status: "Approved image launch", visibility: "public", sensitive: false, media_ids: ["media-async"],
        });
        return new Response(JSON.stringify({ id: "status-media", url: `${origin}/@marketme/status-media` }), { status: 200 });
      }
      throw new Error(`Unexpected ${pathname}`);
    });
    const connector = new MastodonAccountConnector(origin, token, ["social.example.test"], request);
    const manifest = mastodonCapabilities(500, 23, {
      attachmentsPerMessage: 4, attachmentBytes: 10 * 1024 * 1024, attachmentPixels: 100_000_000,
      attachmentDescriptionCharacters: 1_500, supportedImageMimeTypes: ["image/png"],
    });
    await expect(connector.uploadMedia({
      fileName: "launch.png", mimeType: "image/png", description: "Approved launch image", data: new Uint8Array([1]),
    }, manifest)).resolves.toEqual({ mediaId: "media-async", ready: false });
    await expect(connector.mediaReady("media-async")).resolves.toBe(true);
    await expect(connector.publishContent({
      content: "Approved image launch", idempotencyKey: "campaign:image:publish", providerAttachmentIds: ["media-async"],
    })).resolves.toMatchObject({ externalId: "status-media", metadata: { attachmentCount: 1 } });
  });

  it("reads only bounded aggregate metrics for the exact published status and account", async () => {
    const request = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(init).toMatchObject({ method: "GET", redirect: "error" });
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${token}`);
      expect(new URL(String(input)).pathname).toBe("/api/v1/statuses/status-report-1");
      return new Response(JSON.stringify({
        id: "status-report-1",
        created_at: "2026-08-12T10:00:00Z",
        url: `${origin}/@marketme/status-report-1`,
        replies_count: 7,
        reblogs_count: 11,
        favourites_count: 23,
        content: "Provider content must not survive normalization",
        account: { id: "account-1", acct: "marketme", display_name: "Private provider field" },
      }), { status: 200 });
    });
    const report = await new MastodonAccountConnector(origin, token, ["social.example.test"], request)
      .getStatusReport("status-report-1", "account-1");
    expect(report).toEqual({
      statusId: "status-report-1",
      accountId: "account-1",
      statusUrl: `${origin}/@marketme/status-report-1`,
      repliesCount: 7,
      reblogsCount: 11,
      favouritesCount: 23,
      statusCreatedAt: "2026-08-12T10:00:00.000Z",
    });
    expect(JSON.stringify(report)).not.toContain("Provider content");
    expect(JSON.stringify(report)).not.toContain("display_name");
  });

  it("fails closed when a Mastodon status report changes status, account, origin, or count identity", async () => {
    const responseFor = (overrides: Record<string, unknown>) => async () => new Response(JSON.stringify({
      id: "status-report-1", created_at: "2026-08-12T10:00:00Z",
      url: `${origin}/@marketme/status-report-1`, replies_count: 1, reblogs_count: 2, favourites_count: 3,
      account: { id: "account-1" }, ...overrides,
    }), { status: 200 });
    await expect(new MastodonAccountConnector(origin, token, ["social.example.test"], responseFor({ id: "other" }))
      .getStatusReport("status-report-1", "account-1")).rejects.toMatchObject({ kind: "permanent" });
    await expect(new MastodonAccountConnector(origin, token, ["social.example.test"], responseFor({ account: { id: "other" } }))
      .getStatusReport("status-report-1", "account-1")).rejects.toMatchObject({ kind: "permanent" });
    await expect(new MastodonAccountConnector(origin, token, ["social.example.test"], responseFor({ url: "https://other.example.test/status-report-1" }))
      .getStatusReport("status-report-1", "account-1")).rejects.toMatchObject({ kind: "permanent" });
    await expect(new MastodonAccountConnector(origin, token, ["social.example.test"], responseFor({ replies_count: -1 }))
      .getStatusReport("status-report-1", "account-1")).rejects.toMatchObject({ kind: "permanent" });
  });

  it("fails closed on missing idempotency, redirects, cross-instance URLs, and uncertain writes", async () => {
    const unused = vi.fn();
    await expect(new MastodonAccountConnector(origin, token, ["social.example.test"], unused).publishContent({ content: "Launch" }))
      .rejects.toMatchObject({ kind: "validation" });
    expect(unused).not.toHaveBeenCalled();
    await expect(new MastodonAccountConnector(origin, token, ["social.example.test"], async () =>
      new Response(JSON.stringify({ id: "status-1", url: "https://other.example.test/status-1" }), { status: 200 }))
      .publishContent({ content: "Launch", idempotencyKey: "launch-1" })).rejects.toMatchObject({ kind: "ambiguous" });
    await expect(new MastodonAccountConnector(origin, token, ["social.example.test"], async () => { throw new Error("socket closed"); })
      .publishContent({ content: "Launch", idempotencyKey: "launch-2" })).rejects.toMatchObject({ kind: "ambiguous" });
  });
});

describe("MailchimpEmailConnector", () => {
  const apiKey = `${"a".repeat(32)}-us21`;

  it("renders an exact subject and email body without social hashtags", () => {
    expect(renderChannelPreview(MAILCHIMP_EMAIL_CAPABILITIES, {
      subject: "Launch update",
      body: "Doors open at nine.",
      callToAction: "Reserve a place.",
      hashtags: ["#NotEmailCopy"],
      destinationUrl: "https://example.com/event",
    })).toEqual({
      subject: "Launch update",
      subjectCount: 13,
      subjectLimit: 150,
      content: "Doors open at nine.\n\nReserve a place.\n\nhttps://example.com/event",
      characterCount: 64,
      characterLimit: 100000,
      issues: [],
    });
    expect(renderChannelPreview(MAILCHIMP_EMAIL_CAPABILITIES, { body: "Body", hashtags: [] }).issues)
      .toEqual([expect.objectContaining({ code: "subject_empty" })]);
  });

  it("tests one exact audience without returning credentials", async () => {
    const request = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe("https://us21.api.mailchimp.com/3.0/lists/audience_1?fields=id,name");
      expect(new Headers(init?.headers).get("authorization")).toMatch(/^Basic /u);
      return new Response(JSON.stringify({ id: "audience_1", name: "Customers" }), { status: 200 });
    });
    await expect(new MailchimpEmailConnector(apiKey, request).testAudience("audience_1")).resolves.toEqual({
      ok: true,
      providerIdentity: { audienceId: "audience_1", audienceName: "Customers", dataCenter: "us21" },
    });
    expect(JSON.stringify(request.mock.calls)).not.toContain(apiKey);
  });

  it("rejects oversized provider identity responses", async () => {
    const connector = new MailchimpEmailConnector(apiKey, async () => new Response("{}", { status: 200, headers: { "content-length": "65537" } }));
    await expect(connector.testAudience("audience_1")).rejects.toThrow("64 KiB");
  });

  it("creates, persists, fills, and sends one audience campaign", async () => {
    const observed: { path: string; body?: Record<string, unknown> }[] = [];
    const request = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      observed.push({ path, ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) as Record<string, unknown> } : {}) });
      if (path.endsWith("/campaigns")) return new Response(JSON.stringify({ id: "campaign_1", web_id: 42 }), { status: 200 });
      return new Response(path.endsWith("/actions/send") ? null : "", { status: path.endsWith("/actions/send") ? 204 : 200 });
    });
    const created = vi.fn(async () => undefined);
    await expect(new MailchimpEmailConnector(apiKey, request).publishCampaign({
      audienceId: "audience_1", subject: "Launch", content: "<unsafe>\n\nhttps://example.com/tracked", fromName: "Market Me", replyTo: "OWNER@EXAMPLE.COM", title: "Campaign launch", onCampaignCreated: created,
    })).resolves.toEqual({
      externalId: "campaign_1",
      externalUrl: "https://us21.admin.mailchimp.com/campaigns/show/?id=42",
      metadata: { audienceId: "audience_1", dataCenter: "us21" },
    });
    expect(created).toHaveBeenCalledWith("campaign_1", "https://us21.admin.mailchimp.com/campaigns/show/?id=42");
    expect(observed.map((entry) => entry.path)).toEqual([
      "/3.0/campaigns", "/3.0/campaigns/campaign_1/content", "/3.0/campaigns/campaign_1/actions/send",
    ]);
    expect(JSON.stringify(observed[1]?.body)).toContain("&lt;unsafe&gt;");
    expect(JSON.stringify(observed[1]?.body)).toContain("href=\\\"https://example.com/tracked");
    expect(JSON.stringify(observed[1]?.body)).toContain("*|UNSUB|*");
  });

  it("resumes a known campaign without creating a duplicate and treats send uncertainty as ambiguous", async () => {
    const request = vi.fn(async (input: URL | RequestInfo) => {
      if (String(input).endsWith("/actions/send")) throw new Error("connection lost");
      return new Response("", { status: 200 });
    });
    await expect(new MailchimpEmailConnector(apiKey, request).publishCampaign({
      audienceId: "audience_1", subject: "Launch", content: "Body", fromName: "Market Me", replyTo: "owner@example.com", title: "Launch", campaignId: "campaign_1",
    })).rejects.toMatchObject({ kind: "ambiguous" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.some((call) => String(call[0]).endsWith("/campaigns"))).toBe(false);
  });

  it("reads one bounded aggregate campaign report without recipient data", async () => {
    const request = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe("https://us21.api.mailchimp.com/3.0/reports/campaign_1");
      expect(url.searchParams.get("fields")).toContain("bounces.hard_bounces");
      expect(new Headers(init?.headers).get("authorization")).toMatch(/^Basic /u);
      return new Response(JSON.stringify({
        id: "campaign_1", list_id: "audience_1", emails_sent: 120, abuse_reports: 1, unsubscribed: 2,
        send_time: "2026-08-12T06:00:00+00:00",
        bounces: { hard_bounces: 3, soft_bounces: 4 },
        opens: { opens_total: 80, unique_opens: 60 },
        clicks: { clicks_total: 30, unique_clicks: 20 },
      }), { status: 200 });
    });
    await expect(new MailchimpEmailConnector(apiKey, request).getCampaignReport("campaign_1", "audience_1")).resolves.toEqual({
      campaignId: "campaign_1", audienceId: "audience_1", emailsSent: 120, abuseReports: 1, unsubscribed: 2,
      sendTime: "2026-08-12T06:00:00.000Z", hardBounces: 3, softBounces: 4,
      opensTotal: 80, uniqueOpens: 60, clicksTotal: 30, uniqueClicks: 20,
    });
    expect(JSON.stringify(request.mock.calls)).not.toContain(apiKey);
  });

  it("rejects cross-audience and internally inconsistent campaign reports", async () => {
    const response = (overrides: Record<string, unknown>) => new Response(JSON.stringify({
      id: "campaign_1", list_id: "audience_1", emails_sent: 10, abuse_reports: 0, unsubscribed: 0,
      send_time: "2026-08-12T06:00:00Z", bounces: { hard_bounces: 0, soft_bounces: 0 },
      opens: { opens_total: 3, unique_opens: 2 }, clicks: { clicks_total: 2, unique_clicks: 1 }, ...overrides,
    }), { status: 200 });
    await expect(new MailchimpEmailConnector(apiKey, async () => response({ list_id: "another_audience" }))
      .getCampaignReport("campaign_1", "audience_1")).rejects.toThrow("approved audience");
    await expect(new MailchimpEmailConnector(apiKey, async () => response({ opens: { opens_total: 1, unique_opens: 2 } }))
      .getCampaignReport("campaign_1", "audience_1")).rejects.toThrow("internally inconsistent");
  });

  it("creates, inventories, and deletes one exact campaign-only signed webhook", async () => {
    const observed: { method?: string; path: string; body?: Record<string, unknown> }[] = [];
    const configured = {
      id: "webhook_1", list_id: "audience_1", url: "https://market.example/api/webhooks/mailchimp/connection_1",
      events: { subscribe: false, unsubscribe: false, profile: false, cleaned: false, upemail: false, campaign: true, sms_subscribe: false, sms_unsubscribe: false, upsms: false, sms_campaign: false },
      sources: { user: false, admin: true, api: true },
    };
    const request = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      observed.push({ method: init?.method, path: url.pathname, ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) as Record<string, unknown> } : {}) });
      if (init?.method === "POST") return new Response(JSON.stringify({ ...configured, signing_secret: "s".repeat(32) }), { status: 200 });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ list_id: "audience_1", total_items: 1, webhooks: [configured] }), { status: 200 });
    });
    const connector = new MailchimpEmailConnector(apiKey, request);
    await expect(connector.createCampaignWebhook("audience_1", configured.url)).resolves.toMatchObject({
      webhookId: "webhook_1", audienceId: "audience_1", callbackUrl: configured.url, signingSecret: "s".repeat(32),
    });
    await expect(connector.listAudienceWebhooks("audience_1")).resolves.toEqual([
      expect.objectContaining({ webhookId: "webhook_1", callbackUrl: configured.url }),
    ]);
    await expect(connector.deleteAudienceWebhook("audience_1", "webhook_1")).resolves.toBeUndefined();
    expect(observed.map((entry) => [entry.method, entry.path])).toEqual([
      ["POST", "/3.0/lists/audience_1/webhooks"], ["GET", "/3.0/lists/audience_1/webhooks"], ["DELETE", "/3.0/lists/audience_1/webhooks/webhook_1"],
    ]);
    expect(observed[0]?.body).toMatchObject({ events: { campaign: true, subscribe: false, unsubscribe: false }, sources: { user: false, admin: true, api: true } });
    expect(JSON.stringify(observed)).not.toContain("\"email\"");
  });

  it("rejects created webhooks without the one-time secret and identifies configuration drift", async () => {
    const drifted = {
      id: "webhook_1", list_id: "audience_1", url: "https://market.example/api/webhooks/mailchimp/connection_1",
      events: { subscribe: true, unsubscribe: false, profile: false, cleaned: false, upemail: false, campaign: true, sms_subscribe: false, sms_unsubscribe: false, upsms: false, sms_campaign: false },
      sources: { user: false, admin: true, api: true },
    };
    const request = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => init?.method === "DELETE"
      ? new Response(null, { status: 204 }) : new Response(JSON.stringify(drifted), { status: 200 }));
    const connector = new MailchimpEmailConnector(apiKey, request);
    await expect(connector.createCampaignWebhook("audience_1", drifted.url)).rejects.toMatchObject({ kind: "permanent" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(isExactMailchimpCampaignWebhook({
      webhookId: drifted.id, audienceId: drifted.list_id, callbackUrl: drifted.url, events: drifted.events, sources: drifted.sources,
    })).toBe(false);
  });
});
