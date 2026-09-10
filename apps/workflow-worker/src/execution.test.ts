import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DISCORD_WEBHOOK_CAPABILITIES,
  MAILCHIMP_EMAIL_CAPABILITIES,
  mastodonCapabilities,
  SLACK_WEBHOOK_CAPABILITIES,
  encryptToken,
} from "@market-me/connectors";
import type {
  CampaignExecutionTarget,
  CompanionRepository,
  PublishingRepository,
  StoredPublicationAction,
  StoredStepScheduleState,
} from "@market-me/database";
import { CampaignExecutionRouter } from "./execution";

const key = randomBytes(32).toString("base64");
const webhook =
  "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz123456";

afterEach(() => vi.unstubAllGlobals());

describe("CampaignExecutionRouter", () => {
  it("propagates durable finalization proof into the request snapshot without trusting input or context overrides", async () => {
    const fingerprint = `mm-preview-v1:sha256:${"a".repeat(64)}`;
    const selected = { ...slackTarget(), campaignFinalizationId: "finalization-1", draftChannelPreviewFingerprint: fingerprint,
      input: { ...slackTarget().input, campaignFinalizationId: "input-forgery", draftChannelPreviewFingerprint: "input-forgery" } };
    const begin = vi.fn<PublishingRepository["beginPublicationAction"]>(async () => ({ created: true, action: action("dispatching") }));
    const finish = vi.fn();
    const request = vi.fn(async () => new Response("ok")); vi.stubGlobal("fetch", request);
    const repository = { getCampaignExecutionTarget: vi.fn(async () => selected), beginPublicationAction: begin,
      finishPublicationAction: finish } as unknown as PublishingRepository;
    const result = await new CampaignExecutionRouter(repository, key, undefined).execute({ instanceId: "instance-1", stepKey: "publish",
      context: { campaignFinalizationId: "context-forgery", draftChannelPreviewFingerprint: "context-forgery" } });
    expect(result.status).toBe("succeeded");
    expect(begin).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ target: selected,
      requestSnapshot: expect.objectContaining({ campaignFinalizationId: "finalization-1", draftChannelPreviewFingerprint: fingerprint,
        draftChannelPreviewId: "preview-slack", draftVersionId: "version-slack", content: selected.draftPreviewContent }) }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith("action-1", expect.objectContaining({ status: "succeeded" }));
  });

  it("does not invent durable proof for legacy plans containing similarly named input fields", async () => {
    const selected = { ...slackTarget(), input: { ...slackTarget().input,
      campaignFinalizationId: "not-durable", draftChannelPreviewFingerprint: "not-durable" } };
    const begin = vi.fn<PublishingRepository["beginPublicationAction"]>(async () => ({ created: true, action: action("dispatching") }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
    const repository = { getCampaignExecutionTarget: vi.fn(async () => selected), beginPublicationAction: begin,
      finishPublicationAction: vi.fn() } as unknown as PublishingRepository;
    expect((await new CampaignExecutionRouter(repository, key, undefined).execute({ instanceId: "instance-1", stepKey: "publish", context: {} })).status).toBe("succeeded");
    expect(begin.mock.calls[0]![0].requestSnapshot).not.toHaveProperty("campaignFinalizationId");
    expect(begin.mock.calls[0]![0].requestSnapshot).not.toHaveProperty("draftChannelPreviewFingerprint");
  });

  it.each([true, false])("passes pinned provenance to a failed retry and respects the winning claim (%s)", async (won) => {
    const fingerprint = `mm-preview-v1:sha256:${"b".repeat(64)}`;
    const selected = { ...slackTarget(), campaignFinalizationId: "finalization-1", draftChannelPreviewFingerprint: fingerprint };
    const stored = { ...action("failed"), requestSnapshot: Object.freeze({ campaignFinalizationId: "finalization-1",
      draftChannelPreviewFingerprint: fingerprint, content: selected.draftPreviewContent }) };
    const retry = vi.fn(async () => won), begin = vi.fn(), finish = vi.fn();
    const request = vi.fn(async () => new Response("ok")); vi.stubGlobal("fetch", request);
    const repository = { getCampaignExecutionTarget: vi.fn(async () => selected),
      getPublicationActionByIdempotencyKey: vi.fn(async () => stored), retryPublicationAction: retry,
      beginPublicationAction: begin, finishPublicationAction: finish } as unknown as PublishingRepository;
    const result = await new CampaignExecutionRouter(repository, key, undefined).execute({ instanceId: "instance-1", stepKey: "publish", context: {} });
    expect(retry).toHaveBeenCalledExactlyOnceWith("action-1", selected, { content: selected.draftPreviewContent, subject: undefined });
    expect(begin).not.toHaveBeenCalled();
    expect(stored.requestSnapshot).toEqual({ campaignFinalizationId: "finalization-1", draftChannelPreviewFingerprint: fingerprint, content: selected.draftPreviewContent });
    expect(result.status).toBe(won ? "succeeded" : "manual_required");
    expect(request).toHaveBeenCalledTimes(won ? 1 : 0);
    expect(finish).toHaveBeenCalledTimes(won ? 1 : 0);
  });

  it("stops an ineligible finalized preview before any provider preflight or claim", async () => {
    const selected = { ...slackTarget(), campaignFinalizationId: "finalization-1", draftChannelPreviewFingerprint: `mm-preview-v1:sha256:${"c".repeat(64)}`,
      draftPreviewEligible: false };
    const request = vi.fn(), begin = vi.fn(), retry = vi.fn(), record = vi.fn(); vi.stubGlobal("fetch", request);
    const repository = { getCampaignExecutionTarget: vi.fn(async () => selected), beginPublicationAction: begin,
      retryPublicationAction: retry, recordConnectionTest: record } as unknown as PublishingRepository;
    expect(await new CampaignExecutionRouter(repository, key, undefined).execute({ instanceId: "instance-1", stepKey: "publish", context: {} }))
      .toMatchObject({ status: "manual_required", reason: expect.stringContaining("stale") });
    expect(request).not.toHaveBeenCalled(); expect(begin).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled(); expect(record).not.toHaveBeenCalled();
  });

  it.each(["succeeded", "dispatching", "ambiguous"] as const)("preserves old %s recovery without requiring newly introduced proof or current target eligibility", async (status) => {
    const stored = Object.freeze({ ...action(status), requestSnapshot: Object.freeze({ content: "Historically accepted copy" }),
      providerExternalId: "original-provider-id", providerUrl: "https://example.test/original-result" });
    const recover = vi.fn(async () => stored), live = vi.fn(async () => { throw new Error("Current finalized preview was revoked"); });
    const begin = vi.fn(), retry = vi.fn(), finish = vi.fn(), request = vi.fn(); vi.stubGlobal("fetch", request);
    const repository = { getCampaignPublicationForRecovery: recover, getCampaignExecutionTarget: live,
      beginPublicationAction: begin, retryPublicationAction: retry, finishPublicationAction: finish } as unknown as PublishingRepository;
    const input = { workspaceId: "workspace-1", campaignId: "campaign-1", campaignVersionId: "version-1",
      campaignStepRunId: "run-1", instanceId: "instance-1", stepKey: "publish", context: { draftChannelPreviewFingerprint: "new-proof-must-not-be-required" } };
    const result = await new CampaignExecutionRouter(repository, undefined, undefined).recoverScheduledExecution(input);
    expect(recover).toHaveBeenCalledExactlyOnceWith(input);
    expect(result).toMatchObject(status === "succeeded" ? { status: "succeeded", output: { externalId: "original-provider-id", externalUrl: "https://example.test/original-result" } } : { status: "manual_required" });
    expect(live).not.toHaveBeenCalled(); expect(begin).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
    expect(stored.requestSnapshot).not.toHaveProperty("campaignFinalizationId");
  });

  it("does not publish when a late preflight health result loses its connection guard", async () => {
    const selected = target();
    const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: "webhook-1", channel_id: "channel-1" })));
    vi.stubGlobal("fetch", request);
    const record = vi.fn(async () => false), begin = vi.fn();
    const repository = { getCampaignExecutionTarget: vi.fn(async () => selected), recordConnectionTest: record, beginPublicationAction: begin } as unknown as PublishingRepository;
    const result = await new CampaignExecutionRouter(repository, key, undefined).execute({ instanceId: "instance-1", stepKey: "publish", context: {} });
    expect(result).toMatchObject({ status: "manual_required", reason: expect.stringContaining("revoked or changed") });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: "GET" }));
    expect(record).toHaveBeenCalledWith(selected.workspaceId, selected.connection!.id, expect.objectContaining({ ok: true }), selected.connection);
    expect(begin).not.toHaveBeenCalled();
  });

  it("rejects preferred-window fallback and unsupported providers before any side effect", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    for (const selected of [emailTarget(), assistedTarget(), { ...slackTarget(), executionMethods: ["official_api", "manual_handoff"] }, {
      ...slackTarget(), draftPreviewAssets: [{} as NonNullable<CampaignExecutionTarget["draftPreviewAssets"]>[number]],
    }]) {
      const repository = { getCampaignExecutionTarget: vi.fn(async () => ({ ...selected, scheduleType: "preferred_window" })) } as unknown as PublishingRepository;
      const result = await new CampaignExecutionRouter(repository, key, undefined).execute({ instanceId: "instance-1", stepKey: "publish", context: {} });
      expect(result).toMatchObject({ status: "manual_required", reason: expect.stringContaining("single-write") });
    }
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["entry", "after preflight", "after claim", "connector cutoff"])("suppresses provider writes when a window expires at %s", async (phase) => {
    const end = Date.now() + 60_000;
    const selected = { ...slackTarget(), campaignVersionId: "version-1", scheduleType: "preferred_window" };
    let checks = 0;
    const getSchedule = vi.fn(async () => {
      checks += 1;
      const threshold = phase === "entry" ? 1 : phase === "after preflight" ? 2 : phase === "after claim" ? 3 : 4;
      return scheduleState(checks >= threshold ? "expired" : "ready", phase === "connector cutoff" ? Date.now() - 1 : end);
    });
    const begin = vi.fn(async () => ({ created: true, action: action("dispatching") }));
    const finish = vi.fn();
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => selected), getPublicationScheduleState: getSchedule,
      getCampaignPublicationForRecovery: vi.fn(async () => undefined), beginPublicationAction: begin,
      finishPublicationAction: finish,
    } as unknown as PublishingRepository;
    const result = await new CampaignExecutionRouter(repository, key, undefined).execute({ instanceId: "instance-1", stepKey: "publish", context: { dispatchDeadlineAt: end + 3_600_000 } });
    expect(result).toMatchObject({ status: "schedule_blocked" });
    expect(request).not.toHaveBeenCalled();
    if (phase === "entry" || phase === "after preflight") {
      expect(begin).not.toHaveBeenCalled(); expect(finish).not.toHaveBeenCalled();
    } else {
      expect(begin).toHaveBeenCalledTimes(1);
      expect(finish).toHaveBeenCalledWith("action-1", expect.objectContaining({ status: "failed" }));
    }
  });

  it("preserves a valid acknowledgement received after the request-start deadline", async () => {
    const deadline = Date.now() + 10_000;
    const selected = { ...slackTarget(), campaignVersionId: "version-1", scheduleType: "preferred_window" };
    const request = vi.fn(async () => {
      // The request started legally; a clock jump must not invalidate its acknowledgement.
      vi.spyOn(Date, "now").mockReturnValue(deadline + 1);
      return new Response("ok");
    });
    vi.stubGlobal("fetch", request);
    const finish = vi.fn();
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => selected), getPublicationScheduleState: vi.fn(async () => scheduleState("ready", deadline)),
      beginPublicationAction: vi.fn(async () => ({ created: true, action: action("dispatching") })), finishPublicationAction: finish,
    } as unknown as PublishingRepository;
    try {
      const result = await new CampaignExecutionRouter(repository, key, undefined).execute({ instanceId: "instance-1", stepKey: "publish", context: { dispatchDeadlineAt: 1 } });
      expect(result.status).toBe("succeeded");
      expect(request).toHaveBeenCalledTimes(1);
      expect(finish).toHaveBeenCalledWith("action-1", expect.objectContaining({ status: "succeeded" }));
    } finally { vi.restoreAllMocks(); }
  });

  it.each(["succeeded", "dispatching", "ambiguous"] as const)("does not overwrite a prior %s publication with schedule expiry", async (status) => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const finish = vi.fn();
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => ({ ...slackTarget(), campaignVersionId: "version-1", scheduleType: "preferred_window" })),
      getPublicationScheduleState: vi.fn(async () => scheduleState("expired", Date.now() - 1)),
      getCampaignPublicationForRecovery: vi.fn(async () => action(status)), finishPublicationAction: finish,
    } as unknown as PublishingRepository;
    const result = await new CampaignExecutionRouter(repository, key, undefined).execute({ instanceId: "instance-1", stepKey: "publish", context: {} });
    expect(result.status).toBe(status === "succeeded" ? "succeeded" : "manual_required");
    expect(request).not.toHaveBeenCalled(); expect(finish).not.toHaveBeenCalled();
  });

  it("requires review, not a fabricated DB expiry, when the worker clock cutoff disagrees", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const finish = vi.fn();
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => ({ ...slackTarget(), campaignVersionId: "version-1", scheduleType: "preferred_window" })),
      getPublicationScheduleState: vi.fn(async () => scheduleState("ready", Date.now() - 1)),
      beginPublicationAction: vi.fn(async () => ({ created: true, action: action("dispatching") })), finishPublicationAction: finish,
    } as unknown as PublishingRepository;
    const result = await new CampaignExecutionRouter(repository, key, undefined).execute({ instanceId: "instance-1", stepKey: "publish", context: {} });
    expect(result).toMatchObject({ status: "manual_required", reason: expect.stringContaining("clock synchronization") });
    expect(request).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith("action-1", expect.objectContaining({ status: "failed" }));
  });

  it("preserves an uncertain claimed-action cleanup for reconciliation without attempting dispatch", async () => {
    let checks = 0;
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const finish = vi.fn().mockRejectedValue(new Error("commit result unavailable"));
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => ({ ...slackTarget(), campaignVersionId: "version-1", scheduleType: "preferred_window" })),
      getPublicationScheduleState: vi.fn(async () => scheduleState(++checks < 3 ? "ready" : "expired", Date.now() + 10_000)),
      beginPublicationAction: vi.fn(async () => ({ created: true, action: action("dispatching") })), finishPublicationAction: finish,
    } as unknown as PublishingRepository;
    const result = await new CampaignExecutionRouter(repository, key, undefined).execute({ instanceId: "instance-1", stepKey: "publish", context: {} });
    expect(result).toMatchObject({ status: "manual_required", reason: expect.stringContaining("cleanup could not be confirmed") });
    expect(request).not.toHaveBeenCalled(); expect(finish).toHaveBeenCalledTimes(1);
  });

  it("does not turn accepted success with an uncertain database commit into retryable failure", async () => {
    const request = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", request);
    const finish = vi.fn().mockRejectedValue(new Error("connection lost during commit"));
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => slackTarget()),
      beginPublicationAction: vi.fn(async () => ({ created: true, action: action("dispatching") })),
      finishPublicationAction: finish,
    } as unknown as PublishingRepository;
    const result = await new CampaignExecutionRouter(repository, key, undefined)
      .execute({ instanceId: "instance-1", stepKey: "publish", context: {} });
    expect(result).toMatchObject({ status: "manual_required", reason: expect.stringContaining("provider accepted") });
    expect(request).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith("action-1", expect.objectContaining({ status: "succeeded" }));
  });

  it.each(["succeeded", "dispatching", "ambiguous", "failed"] as const)("recovers a prior %s outcome with exact identity and no new side effects", async (status) => {
    const stored = { ...action(status), responseMetadata: { trackedLinkId: "original-link" } };
    const recover = vi.fn(async () => stored);
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    // No other repository operation is supplied: recovery must be read-only.
    const repository = { getCampaignPublicationForRecovery: recover } as unknown as PublishingRepository;
    const input = { workspaceId: "workspace-1", campaignId: "campaign-1", campaignVersionId: "version-1", campaignStepRunId: "step-run-1", instanceId: "instance-1", stepKey: "publish", context: { dispatchDeadlineAt: 1 } };
    const result = await new CampaignExecutionRouter(repository, undefined, undefined).recoverScheduledExecution(input);
    expect(recover).toHaveBeenCalledWith(input);
    if (status === "failed") expect(result).toBeUndefined();
    else if (status === "succeeded") expect(result).toMatchObject({ status, output: { trackedLinkId: "original-link" } });
    else expect(result).toMatchObject({ status: "manual_required" });
    expect(request).not.toHaveBeenCalled();
  });

  it("publishes through a configured capability and records provider identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "message-1",
              guild_id: "guild-1",
              channel_id: "channel-1",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const finish = vi.fn(async () => undefined);
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => target()),
      beginPublicationAction: vi.fn(async () => ({
        created: true,
        action: action("dispatching"),
      })),
      finishPublicationAction: finish,
    } as unknown as PublishingRepository;
    const result = await new CampaignExecutionRouter(
      repository,
      key,
      "https://market.example",
    ).execute({ instanceId: "instance-1", stepKey: "publish", context: {} });
    expect(result).toEqual(
      expect.objectContaining({
        status: "succeeded",
        output: expect.objectContaining({ externalId: "message-1" }),
      }),
    );
    expect(finish).toHaveBeenCalledWith(
      "action-1",
      expect.objectContaining({
        status: "succeeded",
        providerExternalId: "message-1",
      }),
    );
  });

  it("suppresses an automatic resend when a prior dispatch has no result", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const finish = vi.fn(async () => undefined);
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => target()),
      getPublicationActionByIdempotencyKey: vi.fn(async () =>
        action("dispatching"),
      ),
      beginPublicationAction: vi.fn(async () => ({
        created: false,
        action: action("dispatching"),
      })),
      finishPublicationAction: finish,
    } as unknown as PublishingRepository;
    const result = await new CampaignExecutionRouter(
      repository,
      key,
      undefined,
    ).execute({ instanceId: "instance-1", stepKey: "publish", context: {} });
    expect(result).toEqual(
      expect.objectContaining({ status: "manual_required" }),
    );
    expect(finish).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["prior failure", "insert conflict"])("does not send or overwrite a publication when a %s retry claim is lost", async (path) => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const selected = slackTarget(); // Slack target preflight is local and performs no provider write.
    const retry = vi.fn(async () => false);
    const finish = vi.fn();
    const begin = vi.fn(async () => ({ created: false, action: action("failed") }));
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => selected),
      getPublicationActionByIdempotencyKey: vi.fn(async () => path === "prior failure" ? action("failed") : undefined),
      beginPublicationAction: begin,
      retryPublicationAction: retry,
      finishPublicationAction: finish,
    } as unknown as PublishingRepository;
    await expect(new CampaignExecutionRouter(repository, key, undefined)
      .execute({ instanceId: "instance-1", stepKey: "publish", context: {} }))
      .resolves.toMatchObject({ status: "manual_required", reason: expect.stringContaining("automatic resend was suppressed") });
    expect(retry).toHaveBeenCalledExactlyOnceWith("action-1", selected, { content: selected.draftPreviewContent, subject: undefined });
    expect(begin).toHaveBeenCalledTimes(path === "prior failure" ? 0 : 1);
    expect(request).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it("does not overwrite a dispatch discovered after an insert conflict", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const finish = vi.fn();
    const retry = vi.fn();
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => slackTarget()),
      getPublicationActionByIdempotencyKey: vi.fn(async () => undefined),
      beginPublicationAction: vi.fn(async () => ({ created: false, action: action("dispatching") })),
      retryPublicationAction: retry,
      finishPublicationAction: finish,
    } as unknown as PublishingRepository;
    await expect(new CampaignExecutionRouter(repository, key, undefined)
      .execute({ instanceId: "instance-1", stepKey: "publish", context: {} }))
      .resolves.toMatchObject({ status: "manual_required" });
    expect(request).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it("sends an exact approved email preview after recorded policy review even when the step checkbox is off", async () => {
    const request = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(String(input)).pathname;
      if (path.includes("/lists/")) return new Response(JSON.stringify({ id: "audience_1", name: "Customers" }), { status: 200 });
      if (path.endsWith("/campaigns")) return new Response(JSON.stringify({ id: "mail_campaign_1", web_id: 42 }), { status: 200 });
      return new Response(path.endsWith("/actions/send") ? null : "", { status: path.endsWith("/actions/send") ? 204 : 200 });
    });
    vi.stubGlobal("fetch", request);
    const recordIdentity = vi.fn(async () => undefined);
    const finish = vi.fn(async () => undefined);
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => ({ ...emailTarget(), approvalRequired: false })),
      beginPublicationAction: vi.fn(async () => ({ created: true, action: action("dispatching") })),
      recordPublicationProviderIdentity: recordIdentity,
      finishPublicationAction: finish,
    } as unknown as PublishingRepository;
    const result = await new CampaignExecutionRouter(repository, key, "https://market.example")
      .execute({ instanceId: "instance-1", stepKey: "publish", context: {} });
    expect(result).toMatchObject({ status: "succeeded", output: { externalId: "mail_campaign_1" } });
    expect(recordIdentity).toHaveBeenCalledWith("action-1", "mail_campaign_1", "https://us21.admin.mailchimp.com/campaigns/show/?id=42");
    expect(finish).toHaveBeenCalledWith("action-1", expect.objectContaining({ status: "succeeded", providerExternalId: "mail_campaign_1" }));
    expect(request.mock.calls.map((call) => new URL(String(call[0])).pathname)).toEqual([
      "/3.0/lists/audience_1", "/3.0/campaigns", "/3.0/campaigns/mail_campaign_1/content", "/3.0/campaigns/mail_campaign_1/actions/send",
    ]);
  });

  it("posts one Slack message without a duplicate preflight post or invented message ID", async () => {
    const request = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        text: "Approved Slack launch", mrkdwn: false, link_names: false, unfurl_links: false, unfurl_media: false,
      });
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", request);
    const begin = vi.fn(async () => ({ created: true, action: action("dispatching") }));
    const finish = vi.fn(async () => undefined);
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => slackTarget()),
      beginPublicationAction: begin,
      finishPublicationAction: finish,
    } as unknown as PublishingRepository;
    const result = await new CampaignExecutionRouter(repository, key, "https://market.example")
      .execute({ instanceId: "instance-1", stepKey: "publish", context: {} });
    expect(result).toMatchObject({ status: "succeeded" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(begin).toHaveBeenCalledWith(expect.objectContaining({ requestSnapshot: expect.objectContaining({
      provider: "slack_webhook",
      providerPreflight: {
        checked: true,
        mode: "local_target_identity",
        targetIdentity: { teamId: "T01234567", serviceId: "B01234567", host: "hooks.slack.com" },
      },
    }) }));
    expect(finish).toHaveBeenCalledWith("action-1", expect.objectContaining({
      status: "succeeded",
      providerExternalId: undefined,
      responseMetadata: expect.objectContaining({ acknowledgement: "ok", providerMessageIdAvailable: false }),
    }));
  });

  it("does not treat a configured approval checkbox as a recorded human decision for any gated provider", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    for (const original of [emailTarget(), slackTarget(), mastodonTarget()]) {
      const begin = vi.fn();
      const repository = { getCampaignExecutionTarget: vi.fn(async () => ({ ...original, approvalRequired: true, humanApprovalGranted: false })), beginPublicationAction: begin } as unknown as PublishingRepository;
      expect(await new CampaignExecutionRouter(repository, key, undefined, undefined, undefined, ["social.example.test"])
        .execute({ instanceId: "instance-1", stepKey: "publish", context: {} })).toEqual({ status: "manual_required", reason: expect.stringContaining("recorded human approval") });
      expect(begin).not.toHaveBeenCalled();
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("refuses Slack delivery without an exact approved preview", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const changed = { ...slackTarget(), input: { content: "Unreviewed Slack copy" }, draftPreviewContent: undefined, draftPreviewVersionId: undefined };
    const repository = { getCampaignExecutionTarget: vi.fn(async () => changed) } as unknown as PublishingRepository;
    await expect(new CampaignExecutionRouter(repository, key, undefined)
      .execute({ instanceId: "instance-1", stepKey: "publish", context: {} }))
      .resolves.toEqual({ status: "manual_required", reason: expect.stringContaining("exact approved Draft preview") });
    expect(request).not.toHaveBeenCalled();
  });

  it("publishes one exact Mastodon status after read-only account and limit preflight", async () => {
    const request = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("verify_credentials")) {
        return new Response(JSON.stringify({ id: "account-1", username: "marketme", acct: "marketme", url: "https://social.example.test/@marketme" }), { status: 200 });
      }
      if (url.pathname.endsWith("/api/v2/instance")) {
        return new Response(JSON.stringify({ configuration: { statuses: { max_characters: 500, characters_reserved_per_url: 23 } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "status-1", url: "https://social.example.test/@marketme/status-1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", request);
    const begin = vi.fn(async () => ({ created: true, action: action("dispatching") }));
    const finish = vi.fn(async () => undefined);
    const recordConnectionTest = vi.fn(async () => undefined);
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => mastodonTarget()),
      beginPublicationAction: begin,
      finishPublicationAction: finish,
      recordConnectionTest,
    } as unknown as PublishingRepository;
    const result = await new CampaignExecutionRouter(
      repository, key, "https://market.example", undefined, undefined, ["social.example.test"],
    ).execute({ instanceId: "instance-1", stepKey: "publish", context: {} });
    expect(result.status, JSON.stringify(result)).toBe("succeeded");
    expect(result).toMatchObject({ output: { externalId: "status-1", externalUrl: "https://social.example.test/@marketme/status-1" } });
    expect(request).toHaveBeenCalledTimes(3);
    const publicationRequest = request.mock.calls.find((call) => new URL(String(call[0])).pathname === "/api/v1/statuses");
    expect(publicationRequest?.[1]?.method).toBe("POST");
    expect((publicationRequest?.[1]?.headers as Record<string, string>)["idempotency-key"]).toBe("campaign:instance-1:step:publish:publish");
    expect(JSON.parse(String(publicationRequest?.[1]?.body))).toEqual({ status: "Approved Mastodon launch", visibility: "public", sensitive: false });
    expect(begin).toHaveBeenCalledWith(expect.objectContaining({ requestSnapshot: expect.objectContaining({
      provider: "mastodon_account",
      providerPreflight: expect.objectContaining({ checked: true, mode: "provider_read", targetIdentity: expect.objectContaining({ accountId: "account-1" }) }),
    }) }));
    expect(finish).toHaveBeenCalledWith("action-1", expect.objectContaining({ status: "succeeded", providerExternalId: "status-1" }));
  });

  it("refuses Mastodon publication when the instance limit changed after preview approval", async () => {
    const request = vi.fn(async (input: URL | RequestInfo) => new URL(String(input)).pathname.endsWith("verify_credentials")
      ? new Response(JSON.stringify({ id: "account-1", username: "marketme", acct: "marketme", url: "https://social.example.test/@marketme" }), { status: 200 })
      : new Response(JSON.stringify({ configuration: { statuses: { max_characters: 499, characters_reserved_per_url: 23 } } }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => mastodonTarget()),
      recordConnectionTest: vi.fn(async () => undefined),
      beginPublicationAction: vi.fn(),
    } as unknown as PublishingRepository;
    await expect(new CampaignExecutionRouter(
      repository, key, undefined, undefined, undefined, ["social.example.test"],
    ).execute({ instanceId: "instance-1", stepKey: "publish", context: {} })).resolves.toEqual({
      status: "manual_required", reason: expect.stringContaining("limits changed"),
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(repository.beginPublicationAction).not.toHaveBeenCalled();
  });

  it("durably binds one reviewed Mastodon image before creating the exact status", async () => {
    const bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlNQZIAAAAASUVORK5CYII=", "base64"));
    const events: string[] = [];
    const request = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("verify_credentials")) return new Response(JSON.stringify({
        id: "account-1", username: "marketme", acct: "marketme", url: "https://social.example.test/@marketme",
      }), { status: 200 });
      if (path === "/api/v2/instance") return mastodonMediaInstanceResponse();
      if (path === "/api/v2/media") {
        events.push("upload");
        const form = init?.body as FormData;
        expect(form.get("description")).toBe("Blue launch graphic");
        return new Response(JSON.stringify({ id: "media-1", url: null }), { status: 202 });
      }
      if (path === "/api/v1/media/media-1") { events.push("ready"); return new Response(JSON.stringify({ id: "media-1", url: "https://social.example.test/media/media-1.png" }), { status: 200 }); }
      if (path === "/api/v1/statuses") {
        events.push("status");
        expect(JSON.parse(String(init?.body))).toMatchObject({ status: "Approved exact copy", media_ids: ["media-1"] });
        return new Response(JSON.stringify({ id: "status-1", url: "https://social.example.test/@marketme/status-1" }), { status: 200 });
      }
      throw new Error(`Unexpected ${path}`);
    });
    vi.stubGlobal("fetch", request);
    const recordMedia = vi.fn(async () => { events.push("persist"); return {} as never; });
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => mastodonImageTarget(bytes)),
      beginPublicationAction: vi.fn(async () => ({ created: true, action: action("dispatching") })),
      listMastodonPublicationMedia: vi.fn(async () => []),
      recordMastodonPublicationMedia: recordMedia,
      finishPublicationAction: vi.fn(async () => undefined),
    } as unknown as PublishingRepository;
    const store = { read: vi.fn(async () => bytes), putImmutable: vi.fn(async () => undefined) };
    await expect(new CampaignExecutionRouter(
      repository, key, undefined, undefined, store, ["social.example.test"],
    ).execute({ instanceId: "instance-1", stepKey: "publish", context: {} })).resolves.toMatchObject({ status: "succeeded" });
    expect(events).toEqual(["upload", "persist", "ready", "status"]);
    expect(recordMedia).toHaveBeenCalledWith(expect.objectContaining({
      publicationActionId: "action-1", ordinal: 0, contentAssetId: "asset-1", providerMediaId: "media-1",
    }));
  });

  it("resumes a failed Mastodon attempt from its persisted media ID without re-uploading", async () => {
    const bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlNQZIAAAAASUVORK5CYII=", "base64"));
    const request = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("verify_credentials")) return new Response(JSON.stringify({ id: "account-1", username: "marketme", acct: "marketme", url: "https://social.example.test/@marketme" }), { status: 200 });
      if (path === "/api/v2/instance") return mastodonMediaInstanceResponse();
      if (path === "/api/v1/media/media-1") return new Response(JSON.stringify({ id: "media-1", url: "https://social.example.test/media/media-1.png" }), { status: 200 });
      if (path === "/api/v1/statuses") return new Response(JSON.stringify({ id: "status-1", url: "https://social.example.test/@marketme/status-1" }), { status: 200 });
      throw new Error(`Unexpected ${path}`);
    });
    vi.stubGlobal("fetch", request);
    const retry = vi.fn(async () => true);
    const recordMedia = vi.fn();
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => mastodonImageTarget(bytes)),
      getPublicationActionByIdempotencyKey: vi.fn(async () => action("failed")),
      retryPublicationAction: retry,
      listMastodonPublicationMedia: vi.fn(async () => [{
        publicationActionId: "action-1", ordinal: 0, contentAssetId: "asset-1",
        contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        providerMediaId: "media-1", createdAt: new Date(0).toISOString(),
      }]),
      recordMastodonPublicationMedia: recordMedia,
      finishPublicationAction: vi.fn(async () => undefined),
    } as unknown as PublishingRepository;
    const store = { read: vi.fn(async () => bytes), putImmutable: vi.fn(async () => undefined) };
    await expect(new CampaignExecutionRouter(
      repository, key, undefined, undefined, store, ["social.example.test"],
    ).execute({ instanceId: "instance-1", stepKey: "publish", context: {} })).resolves.toMatchObject({ status: "succeeded" });
    expect(retry).toHaveBeenCalledWith("action-1", expect.objectContaining({ campaignStepRunId: "run-1" }), expect.objectContaining({ content: "Approved exact copy" }));
    expect(recordMedia).not.toHaveBeenCalled();
    expect(request.mock.calls.some((call) => new URL(String(call[0])).pathname === "/api/v2/media")).toBe(false);
  });

  it("refuses Mailchimp delivery without both an exact preview and step approval", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    for (const changed of [
      { ...emailTarget(), input: { content: "Direct body", subject: "Direct subject" }, draftPreviewContent: undefined, draftPreviewSubject: undefined, draftPreviewVersionId: undefined },
      { ...emailTarget(), humanApprovalGranted: false },
    ]) {
      const repository = { getCampaignExecutionTarget: vi.fn(async () => changed) } as unknown as PublishingRepository;
      await expect(new CampaignExecutionRouter(repository, key, undefined).execute({ instanceId: "instance-1", stepKey: "publish", context: {} }))
        .resolves.toEqual({ status: "manual_required", reason: expect.stringContaining("exact approved Draft preview") });
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("publishes an approved tracked-link Draft preview without recomposing its Destination", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "message-preview",
            guild_id: "guild-1",
            channel_id: "channel-1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", request);
    const begin = vi.fn(async (input) => ({
      created: true,
      action: action("dispatching"),
    }));
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => ({
        ...target(),
        input: { draftChannelPreviewId: "preview-1" },
        draftPreviewContent:
          "Approved exact copy\n\nhttps://market.example/r/approved",
        draftPreviewVersionId: "version-2",
        draftPreviewTrackedLinkId: "tracked-1",
        draftPreviewEligible: true,
      })),
      beginPublicationAction: begin,
      finishPublicationAction: vi.fn(async () => undefined),
    } as unknown as PublishingRepository;
    const result = await new CampaignExecutionRouter(
      repository,
      key,
      "https://market.example",
    ).execute({ instanceId: "instance-1", stepKey: "publish", context: {} });
    expect(result.status).toBe("succeeded");
    expect(begin).toHaveBeenCalledWith(
      expect.objectContaining({
        requestSnapshot: expect.objectContaining({
          content: "Approved exact copy\n\nhttps://market.example/r/approved",
          trackedLinkId: "tracked-1",
          draftChannelPreviewId: "preview-1",
          draftVersionId: "version-2",
        }),
      }),
    );
  });

  it("publishes the exact approved preview attachment as Discord multipart data", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const request = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "GET")
          return new Response(
            JSON.stringify({
              id: "123456789012345678",
              guild_id: "guild-1",
              channel_id: "channel-1",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        expect(init?.body).toBeInstanceOf(FormData);
        const form = init!.body as FormData;
        const payload = JSON.parse(String(form.get("payload_json")));
        expect(payload.attachments).toEqual([
          { id: 0, filename: "launch.png", description: "Blue launch graphic" },
        ]);
        expect(await (form.get("files[0]") as File).arrayBuffer()).toEqual(
          bytes.buffer,
        );
        return new Response(JSON.stringify({ id: "message-media" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", request);
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => previewTarget(bytes)),
      beginPublicationAction: vi.fn(async () => ({
        created: true,
        action: action("dispatching"),
      })),
      finishPublicationAction: vi.fn(async () => undefined),
    } as unknown as PublishingRepository;
    const store = {
      read: vi.fn(async () => bytes),
      putImmutable: vi.fn(async () => undefined),
    };
    expect(
      await new CampaignExecutionRouter(
        repository,
        key,
        undefined,
        undefined,
        store,
      ).execute({ instanceId: "instance-1", stepKey: "publish", context: {} }),
    ).toMatchObject({ status: "succeeded" });
  });

  it("fails closed before action creation or provider I/O when preview media is missing", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const begin = vi.fn();
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => previewTarget(bytes)),
      beginPublicationAction: begin,
    } as unknown as PublishingRepository;
    const store = {
      read: vi.fn(async () => {
        throw new Error("missing");
      }),
      putImmutable: vi.fn(async () => undefined),
    };
    expect(
      await new CampaignExecutionRouter(
        repository,
        key,
        undefined,
        undefined,
        store,
      ).execute({ instanceId: "instance-1", stepKey: "publish", context: {} }),
    ).toEqual({
      status: "manual_required",
      reason: expect.stringContaining("missing"),
    });
    expect(begin).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed before media or provider I/O when the snapshotted rights clearance expired", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const begin = vi.fn();
    const targetWithExpiredRights = previewTarget(bytes);
    targetWithExpiredRights.draftPreviewAssets =
      targetWithExpiredRights.draftPreviewAssets!.map((asset) => ({
        ...asset,
        rightsExpiresAt: "2000-01-01T00:00:00.000Z",
      }));
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => targetWithExpiredRights),
      beginPublicationAction: begin,
    } as unknown as PublishingRepository;
    const store = {
      read: vi.fn(async () => bytes),
      putImmutable: vi.fn(async () => undefined),
    };
    expect(
      await new CampaignExecutionRouter(
        repository,
        key,
        undefined,
        undefined,
        store,
      ).execute({ instanceId: "instance-1", stepKey: "publish", context: {} }),
    ).toEqual({
      status: "manual_required",
      reason: expect.stringContaining("rights clearance"),
    });
    expect(store.read).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed before media or provider I/O when malware scan evidence is unavailable", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const begin = vi.fn();
    const targetWithoutScan = previewTarget(bytes);
    targetWithoutScan.draftPreviewAssets =
      targetWithoutScan.draftPreviewAssets!.map((asset) => ({
        ...asset,
        scanStatus: "not_configured",
        scanRevision: 0,
        scanScannedAt: undefined,
      }));
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => targetWithoutScan),
      beginPublicationAction: begin,
    } as unknown as PublishingRepository;
    const store = {
      read: vi.fn(async () => bytes),
      putImmutable: vi.fn(async () => undefined),
    };
    expect(
      await new CampaignExecutionRouter(
        repository,
        key,
        undefined,
        undefined,
        store,
      ).execute({ instanceId: "instance-1", stepKey: "publish", context: {} }),
    ).toEqual({
      status: "manual_required",
      reason: expect.stringContaining("malware scan"),
    });
    expect(store.read).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed before provider I/O when a Draft preview is stale", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => ({
        ...target(),
        input: { draftChannelPreviewId: "preview-1" },
        draftPreviewContent: "Old copy",
        draftPreviewVersionId: "version-1",
        draftPreviewEligible: false,
      })),
    } as unknown as PublishingRepository;
    expect(
      await new CampaignExecutionRouter(repository, key, undefined).execute({
        instanceId: "instance-1",
        stepKey: "publish",
        context: {},
      }),
    ).toEqual({
      status: "manual_required",
      reason: expect.stringContaining("stale"),
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed before media or provider I/O when attachment rights name another publishing account", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const begin = vi.fn();
    const mismatched = previewTarget(bytes);
    mismatched.draftPreviewAssets = mismatched.draftPreviewAssets!.map(
      (asset) => ({ ...asset, rightsChannelConnectionId: "connection-other" }),
    );
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => mismatched),
      beginPublicationAction: begin,
    } as unknown as PublishingRepository;
    const store = {
      read: vi.fn(async () => bytes),
      putImmutable: vi.fn(async () => undefined),
    };
    expect(
      await new CampaignExecutionRouter(
        repository,
        key,
        undefined,
        undefined,
        store,
      ).execute({ instanceId: "instance-1", stepKey: "publish", context: {} }),
    ).toEqual({
      status: "manual_required",
      reason: expect.stringContaining("rights clearance"),
    });
    expect(store.read).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed before media or provider I/O when attachment rights name another Campaign", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const begin = vi.fn();
    const mismatched = previewTarget(bytes);
    mismatched.draftPreviewAssets = mismatched.draftPreviewAssets!.map(
      (asset) => ({ ...asset, rightsCampaignId: "campaign-other" }),
    );
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => mismatched),
      beginPublicationAction: begin,
    } as unknown as PublishingRepository;
    const store = {
      read: vi.fn(async () => bytes),
      putImmutable: vi.fn(async () => undefined),
    };
    expect(
      await new CampaignExecutionRouter(
        repository,
        key,
        undefined,
        undefined,
        store,
      ).execute({ instanceId: "instance-1", stepKey: "publish", context: {} }),
    ).toEqual({
      status: "manual_required",
      reason: expect.stringContaining("rights clearance"),
    });
    expect(store.read).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed before media or provider I/O when attachment rights name another Brand Profile", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const begin = vi.fn();
    const mismatched = previewTarget(bytes);
    mismatched.draftPreviewAssets = mismatched.draftPreviewAssets!.map(
      (asset) => ({ ...asset, rightsBrandProfileId: "brand-other" }),
    );
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => mismatched),
      beginPublicationAction: begin,
    } as unknown as PublishingRepository;
    const store = {
      read: vi.fn(async () => bytes),
      putImmutable: vi.fn(async () => undefined),
    };
    expect(
      await new CampaignExecutionRouter(
        repository,
        key,
        undefined,
        undefined,
        store,
      ).execute({ instanceId: "instance-1", stepKey: "publish", context: {} }),
    ).toEqual({
      status: "manual_required",
      reason: expect.stringContaining("rights clearance"),
    });
    expect(store.read).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("fails before publication action creation when the live Discord webhook is unavailable", async () => {
    const request = vi.fn(async () => new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", request);
    const begin = vi.fn();
    const record = vi.fn(async () => undefined);
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => target()),
      getPublicationActionByIdempotencyKey: vi.fn(async () => undefined),
      beginPublicationAction: begin,
      recordConnectionTest: record,
    } as unknown as PublishingRepository;
    const result = await new CampaignExecutionRouter(
      repository,
      key,
      undefined,
    ).execute({ instanceId: "instance-1", stepKey: "publish", context: {} });
    expect(result).toEqual({
      status: "manual_required",
      reason: expect.stringContaining("preflight failed"),
    });
    expect(begin).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      "workspace-1",
      "connection-1",
      expect.objectContaining({ ok: false }),
      expect.objectContaining({ encryptedCredentials: expect.any(String), configuration: expect.any(Object) }),
    );
  });

  it("blocks delivery when the Discord webhook now resolves to a different channel", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "123456789012345678",
            guild_id: "guild-new",
            channel_id: "channel-new",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", request);
    const begin = vi.fn();
    const record = vi.fn(async () => undefined);
    const changed = target();
    changed.connection = {
      ...changed.connection!,
      configuration: {
        webhookId: "123456789012345678",
        guildId: "guild-1",
        channelId: "channel-1",
      },
    };
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => changed),
      getPublicationActionByIdempotencyKey: vi.fn(async () => undefined),
      beginPublicationAction: begin,
      recordConnectionTest: record,
    } as unknown as PublishingRepository;
    const result = await new CampaignExecutionRouter(
      repository,
      key,
      undefined,
    ).execute({ instanceId: "instance-1", stepKey: "publish", context: {} });
    expect(result).toEqual({
      status: "manual_required",
      reason: expect.stringContaining("target identity changed"),
    });
    expect(begin).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      "workspace-1",
      "connection-1",
      expect.objectContaining({ ok: false }),
      expect.objectContaining({ encryptedCredentials: expect.any(String), configuration: expect.any(Object) }),
    );
  });

  it("queues an eligible Campaign step on the only healthy companion", async () => {
    const createJob = vi.fn(async (input) => ({
      ...input,
      id: "job-1",
      status: "queued",
      attemptCount: 0,
      result: {},
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }));
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => assistedTarget()),
    } as unknown as PublishingRepository;
    const companion = {
      listWorkers: vi.fn(async () => [
        {
          id: "worker-1",
          workspaceId: "workspace-1",
          name: "Desktop",
          platform: "windows",
          architecture: "x86_64",
          appVersion: "0.8.0",
          status: "active",
          healthState: "healthy",
          effectiveHealthState: "healthy",
          tokenPrefix: "mm_worker_x",
          capabilities: { assistedOpenUrl: true },
          healthDetails: {},
          lastSeenAt: new Date().toISOString(),
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      ]),
      createJob,
    } as unknown as CompanionRepository;
    const result = await new CampaignExecutionRouter(
      repository,
      undefined,
      undefined,
      companion,
    ).execute({ instanceId: "instance-1", stepKey: "assist", context: {} });
    expect(result).toEqual({
      status: "manual_required",
      reason: expect.stringContaining("queued"),
    });
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: "worker-1",
        campaignInstanceId: "instance-1",
        campaignStepRunId: "run-1",
        action: "open_url",
        targetUrl: "https://example.com/launch",
        allowedDomains: ["example.com"],
        idempotencyKey: "campaign:instance-1:step:assist:open_url",
      }),
    );
  });

  it("requires explicit selection when multiple companions are eligible", async () => {
    const worker = {
      id: "worker-1",
      status: "active",
      effectiveHealthState: "healthy",
      capabilities: { assistedOpenUrl: true },
    };
    const repository = {
      getCampaignExecutionTarget: vi.fn(async () => assistedTarget()),
    } as unknown as PublishingRepository;
    const companion = {
      listWorkers: vi.fn(async () => [worker, { ...worker, id: "worker-2" }]),
      createJob: vi.fn(),
    } as unknown as CompanionRepository;
    const result = await new CampaignExecutionRouter(
      repository,
      undefined,
      undefined,
      companion,
    ).execute({ instanceId: "instance-1", stepKey: "assist", context: {} });
    expect(result).toEqual({
      status: "manual_required",
      reason: expect.stringContaining("Multiple eligible companions"),
    });
    expect(companion.createJob).not.toHaveBeenCalled();
  });
});

function target(): CampaignExecutionTarget {
  return {
    workspaceId: "workspace-1",
    campaignId: "campaign-1",
    campaignInstanceId: "instance-1",
    campaignStepRunId: "run-1",
    requestedBy: "user-1",
    stepKey: "publish",
    operationType: "publish_content",
    desiredCapability: "publish_content",
    approvalRequired: true,
    humanApprovalGranted: true,
    executionMethods: ["official_api"],
    input: { content: "Launch" },
    channelConnectionId: "connection-1",
    connection: {
      id: "connection-1",
      workspaceId: "workspace-1",
      provider: "discord_webhook",
      name: "Announcements",
      status: "active",
      encryptedCredentials: encryptToken(webhook, key),
      configuration: {},
      capabilities: DISCORD_WEBHOOK_CAPABILITIES as unknown as Record<
        string,
        unknown
      >,
      createdBy: "user-1",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    },
  };
}

function scheduleState(state: "ready" | "expired", deadline: number): StoredStepScheduleState {
  return {
    state, ...(state === "expired" ? { reason: "deadline_reached" as const } : {}),
    deadline: new Date(deadline).toISOString(), evaluatedAt: new Date().toISOString(),
    workspaceId: "workspace-1", campaignId: "campaign-1", campaignInstanceId: "instance-1",
    campaignVersionId: "version-1", campaignStepRunId: "run-1", stepKey: "publish", predecessors: [],
  } as StoredStepScheduleState;
}

function assistedTarget(): CampaignExecutionTarget {
  return {
    workspaceId: "workspace-1",
    campaignId: "campaign-1",
    campaignInstanceId: "instance-1",
    campaignStepRunId: "run-1",
    requestedBy: "user-1",
    stepKey: "assist",
    operationType: "manual_handoff",
    desiredCapability: "open_url",
    approvalRequired: false,
    humanApprovalGranted: false,
    executionMethods: ["user_assisted", "manual_handoff"],
    input: {
      targetUrl: "https://example.com/launch",
      instructions: "Review the launch page and confirm.",
    },
  };
}

function emailTarget(): CampaignExecutionTarget {
  return {
    ...target(),
    input: { draftChannelPreviewId: "preview-email" },
    draftPreviewContent: "Approved email body\n\nhttps://market.example/r/approved",
    draftPreviewSubject: "Approved launch subject",
    draftPreviewVersionId: "version-email",
    draftPreviewEligible: true,
    connection: {
      ...target().connection!,
      provider: "mailchimp_email",
      name: "Customer newsletter",
      encryptedCredentials: encryptToken(`${"a".repeat(32)}-us21`, key),
      configuration: { audienceId: "audience_1", audienceName: "Customers", dataCenter: "us21", fromName: "Market Me", replyTo: "owner@example.com" },
      capabilities: MAILCHIMP_EMAIL_CAPABILITIES as unknown as Record<string, unknown>,
    },
  };
}

function slackTarget(): CampaignExecutionTarget {
  return {
    ...target(),
    input: { draftChannelPreviewId: "preview-slack" },
    draftPreviewContent: "Approved Slack launch",
    draftPreviewVersionId: "version-slack",
    draftPreviewEligible: true,
    connection: {
      ...target().connection!,
      provider: "slack_webhook",
      name: "Slack announcements",
      encryptedCredentials: encryptToken("https://hooks.slack.com/services/T01234567/B01234567/abcdefghijklmnopqrstuvwxyz123456", key),
      configuration: { teamId: "T01234567", serviceId: "B01234567", host: "hooks.slack.com" },
      capabilities: SLACK_WEBHOOK_CAPABILITIES as unknown as Record<string, unknown>,
    },
  };
}

function mastodonTarget(): CampaignExecutionTarget {
  return {
    ...target(),
    input: { draftChannelPreviewId: "preview-mastodon" },
    draftPreviewContent: "Approved Mastodon launch",
    draftPreviewVersionId: "version-mastodon",
    draftPreviewEligible: true,
    connection: {
      ...target().connection!,
      provider: "mastodon_account",
      name: "Mastodon brand account",
      encryptedCredentials: encryptToken("mastodon-user-token-abcdefghijklmnopqrstuvwxyz", key),
      configuration: {
        host: "social.example.test", instanceOrigin: "https://social.example.test", accountId: "account-1",
        username: "marketme", acct: "marketme", profileUrl: "https://social.example.test/@marketme", maxCharacters: 500,
        charactersReservedPerUrl: 23,
      },
      capabilities: mastodonCapabilities(500) as unknown as Record<string, unknown>,
    },
  };
}

function mastodonMediaManifest() {
  return mastodonCapabilities(500, 23, {
    attachmentsPerMessage: 4,
    attachmentBytes: 10 * 1024 * 1024,
    attachmentPixels: 100_000_000,
    attachmentDescriptionCharacters: 1_500,
    supportedImageMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
}

function mastodonMediaInstanceResponse(): Response {
  return new Response(JSON.stringify({ configuration: {
    statuses: { max_characters: 500, characters_reserved_per_url: 23, max_media_attachments: 4 },
    media_attachments: {
      supported_mime_types: ["image/jpeg", "image/png", "image/webp"],
      image_size_limit: 10 * 1024 * 1024,
      image_matrix_limit: 100_000_000,
      description_limit: 1_500,
    },
  } }), { status: 200 });
}

function mastodonImageTarget(bytes: Uint8Array): CampaignExecutionTarget {
  const base = previewTarget(bytes);
  return {
    ...base,
    input: { draftChannelPreviewId: "preview-mastodon-image" },
    connection: {
      ...base.connection!,
      provider: "mastodon_account",
      name: "Mastodon image account",
      encryptedCredentials: encryptToken("mastodon-user-token-abcdefghijklmnopqrstuvwxyz", key),
      configuration: {
        host: "social.example.test", instanceOrigin: "https://social.example.test", accountId: "account-1",
        username: "marketme", acct: "marketme", maxCharacters: 500, charactersReservedPerUrl: 23,
        attachmentsPerMessage: 4, attachmentBytes: 10 * 1024 * 1024, attachmentPixels: 100_000_000,
        attachmentDescriptionCharacters: 1_500, supportedImageMimeTypes: ["image/jpeg", "image/png", "image/webp"],
      },
      capabilities: mastodonMediaManifest() as unknown as Record<string, unknown>,
    },
  };
}

function previewTarget(bytes: Uint8Array): CampaignExecutionTarget {
  return {
    ...target(),
    brandProfileId: "brand-1",
    input: { draftChannelPreviewId: "preview-1" },
    draftPreviewContent: "Approved exact copy",
    draftPreviewVersionId: "version-2",
    draftPreviewEligible: true,
    draftPreviewAssets: [
      {
        contentAssetId: "asset-1",
        sortOrder: 0,
        objectKey: `${"originals/"}${"a".repeat(64)}/launch.png`,
        contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        fileName: "launch.png",
        mimeType: "image/png",
        byteSize: bytes.byteLength,
        altText: "Blue launch graphic",
        altTextStatus: "approved",
        scanStatus: "clean",
        scanRevision: 1,
        scanScannedAt: "2026-08-12T00:00:00.000Z",
        rightsStatus: "cleared",
        rightsRevision: 1,
        rightsReviewedAt: "2026-08-12T00:00:00.000Z",
        rightsChannelConnectionId: "connection-1",
        rightsCampaignId: "campaign-1",
        rightsBrandProfileId: "brand-1",
      },
    ],
  };
}

function action(
  status: StoredPublicationAction["status"],
): StoredPublicationAction {
  return {
    id: "action-1",
    workspaceId: "workspace-1",
    campaignInstanceId: "instance-1",
    campaignStepRunId: "run-1",
    channelConnectionId: "connection-1",
    actionType: "publish_content",
    status,
    idempotencyKey: "publish-1",
    requestSnapshot: {},
    responseMetadata: {},
  };
}
