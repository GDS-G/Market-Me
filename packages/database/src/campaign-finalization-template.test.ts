import { afterEach, describe, expect, it, vi } from "vitest";
import { campaignStepRequiresApproval, evaluateStepSchedule, validateCampaignExecution, validateCampaignGraph } from "@market-me/domain";
import { compileGeneralAnnouncementPreparation } from "./campaign-preparation-template";
import {
  CAMPAIGN_FINALIZATION_COMPILER, CampaignFinalizationTemplateValidationError,
  compileCampaignFinalization, normalizeCampaignFinalizationInput,
  type CampaignFinalizationTemplateInput, type CampaignFinalizationTrustedContext,
} from "./campaign-finalization-template";

const ids = {
  workspace: "11111111-1111-4111-8111-111111111111", preparation: "22222222-2222-4222-8222-222222222222",
  planning: "33333333-3333-4333-8333-333333333333", draft: "44444444-4444-4444-8444-444444444444",
  draftVersion: "55555555-5555-4555-8555-555555555555", preview: "66666666-6666-4666-8666-666666666666",
  campaign: "77777777-7777-4777-8777-777777777777", generation: "88888888-8888-4888-8888-888888888888",
  contentPackage: "99999999-9999-4999-8999-999999999999", connection: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  brand: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", audienceA: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  audienceB: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", destination: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  other: "ffffffff-ffff-4fff-8fff-ffffffffffff",
};
const token = `mm-preview-v1:sha256:${"a".repeat(64)}`;
const input: CampaignFinalizationTemplateInput = {
  workspaceId: ids.workspace, preparationId: ids.preparation, expectedPlanningVersionId: ids.planning,
  draftId: ids.draft, expectedDraftVersionId: ids.draftVersion, previewId: ids.preview,
  expectedPreviewFingerprint: token, timing: { type: "immediate" },
};
function context(): CampaignFinalizationTrustedContext {
  const configurationSnapshot = compileGeneralAnnouncementPreparation({
    workspaceId: ids.workspace, contentPackageId: ids.contentPackage, expectedPackageVersion: 7,
    name: "Café 🚀 launch", description: "Prepared description", brandProfileVersionId: ids.brand,
    audienceProfileVersionIds: [ids.audienceB, ids.audienceA], destinationId: ids.destination,
    informationDepth: "detailed", promotionalStrength: "light", timezone: "America/Chicago",
  }).normalizedInput;
  return {
    preparation: { id: ids.preparation, workspaceId: ids.workspace, campaignId: ids.campaign,
      planningVersionId: ids.planning, generationId: ids.generation, contentPackageId: ids.contentPackage,
      contentPackageVersion: 7, configurationSnapshot,
      // A current approved revision need not equal the initial prepared revision.
      preparedDrafts: [{ draftId: ids.draft, versionId: ids.other }] },
    preview: { workspaceId: ids.workspace, campaignId: ids.campaign, sourceCampaignVersionId: ids.planning,
      generationId: ids.generation, previewId: ids.preview, draftId: ids.draft, draftVersionId: ids.draftVersion,
      channelConnectionId: ids.connection, destinationId: ids.destination, fingerprint: token,
      provider: "discord_webhook", attachmentCount: 0 },
  };
}
afterEach(() => vi.restoreAllMocks());

describe("strict finalization intent", () => {
  it("uses server-owned domain separation and identical canonical bytes for equivalent intent", () => {
    const one = normalizeCampaignFinalizationInput({ ...input,
      workspaceId: ` ${ids.workspace} `, previewId: ids.preview.toUpperCase(),
      timing: { type: "exact_time", scheduledAt: " 2026-10-01T09:30:01.12-05:00 " } });
    const two = normalizeCampaignFinalizationInput({ timing: { scheduledAt: "2026-10-01T14:30:01.120Z", type: "exact_time" },
      expectedPreviewFingerprint: token, previewId: ids.preview, expectedDraftVersionId: ids.draftVersion,
      draftId: ids.draft, expectedPlanningVersionId: ids.planning, preparationId: ids.preparation,
      workspaceId: ids.workspace, templateVersion: 1 });
    expect(one).toEqual(two);
    expect(JSON.parse(one.canonicalPayload)).toEqual({ compiler: CAMPAIGN_FINALIZATION_COMPILER, input: one.normalizedInput });
    expect(normalizeCampaignFinalizationInput(input).canonicalPayload)
      .toBe(normalizeCampaignFinalizationInput({ ...input, templateVersion: 1 }).canonicalPayload);
  });

  it.each(["workspaceId", "preparationId", "expectedPlanningVersionId", "draftId", "expectedDraftVersionId", "previewId"] as const)(
    "normalizes and retains the exact %s identity", (field) => {
      const result = normalizeCampaignFinalizationInput({ ...input, [field]: ` ${ids.other.toUpperCase()} ` });
      expect(result.normalizedInput[field]).toBe(ids.other);
      expect(result.canonicalPayload).not.toBe(normalizeCampaignFinalizationInput(input).canonicalPayload);
      for (const value of [undefined, null, 1, {}, "", "bad", "00000000-0000-0000-0000-000000000000"]) {
        expect(() => normalizeCampaignFinalizationInput({ ...input, [field]: value })).toThrow(CampaignFinalizationTemplateValidationError);
      }
    });

  it("retains the exact fingerprint and every timing choice in canonical retry intent", () => {
    const baseline = normalizeCampaignFinalizationInput(input).canonicalPayload;
    for (const changes of [{ expectedPreviewFingerprint: `mm-preview-v1:sha256:${"b".repeat(64)}` },
      { timing: { type: "exact_time", scheduledAt: "2026-10-01T00:00:00.001Z" } },
      { timing: { type: "preferred_window", start: "2026-10-01T00:00:00.001Z", end: "2026-10-01T00:00:00.002Z" } }]) {
      expect(normalizeCampaignFinalizationInput({ ...input, ...changes }).canonicalPayload).not.toBe(baseline);
    }
  });

  it.each([undefined, null, "", token.toUpperCase(), ` ${token}`, `${token} `, token.slice(0, -1),
    `mm-preview-v2:sha256:${"a".repeat(64)}`, `mm-preview-v1:sha512:${"a".repeat(64)}`])(
    "rejects missing, aliased, or unsupported fingerprint %s", (expectedPreviewFingerprint) => {
      expect(() => normalizeCampaignFinalizationInput({ ...input, expectedPreviewFingerprint })).toThrow(CampaignFinalizationTemplateValidationError);
    });

  it.each(["campaignId", "channelConnectionId", "content", "subject", "provider", "approvalRequired", "executionMethods",
    "autonomyMode", "context", "steps", "name", "description", "timezone", "destinationId", "brandProfileVersionId",
    "audienceProfileVersionIds", "credentials", "actorUserId", "idempotencyKey", "templateKey", "compiler", "trusted", "preview"])(
    "rejects request-owned %s rather than overriding trusted data", (field) => {
      expect(() => normalizeCampaignFinalizationInput({ ...input, [field]: "untrusted" })).toThrow(CampaignFinalizationTemplateValidationError);
    });

  it.each([0, 2, "1", null, NaN, Infinity])("rejects unsupported template version %s", (templateVersion) => {
    expect(() => normalizeCampaignFinalizationInput({ ...input, templateVersion })).toThrow(CampaignFinalizationTemplateValidationError);
  });

  it("rejects exotic objects, getters, symbols, hidden fields, and prototype payloads without invoking getters", () => {
    let invoked = false;
    const getter = { ...input };
    Object.defineProperty(getter, "previewId", { enumerable: true, get: () => { invoked = true; return ids.preview; } });
    const hidden = { ...input };
    Object.defineProperty(hidden, "previewId", { enumerable: false, value: ids.preview });
    const nestedGetter = { type: "exact_time" };
    Object.defineProperty(nestedGetter, "scheduledAt", { enumerable: true, get: () => { invoked = true; return "2026-01-01T00:00:00Z"; } });
    for (const value of [null, [], "input", Object.create(input), Object.assign(Object.create(null), input), getter, hidden,
      { ...input, [Symbol("authority")]: true }, { ...input, timing: nestedGetter },
      { ...input, timing: Object.create({ type: "immediate" }) },
      JSON.parse(JSON.stringify(input).slice(0, -1) + ',"__proto__":{"approvalRequired":false}}')]) {
      expect(() => normalizeCampaignFinalizationInput(value)).toThrow(CampaignFinalizationTemplateValidationError);
    }
    expect(invoked).toBe(false);
  });
});

describe("explicit finalization timing", () => {
  it.each([undefined, null, [], {}, { type: "recurring" }, { type: "dependency" }, { type: "immediate", start: undefined },
    { type: "immediate", scheduledAt: "2026-01-01T00:00:00Z" }, { type: "exact_time" },
    { type: "exact_time", scheduledAt: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
    { type: "preferred_window", start: "2026-01-01T00:00:00Z" },
    { type: "preferred_window", start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z", scheduledAt: undefined },
    { type: "exact_time", scheduledAt: "2026-01-01T00:00:00Z", condition: {} }])("rejects incomplete or mixed timing %j", (timing) => {
    expect(() => normalizeCampaignFinalizationInput({ ...input, timing })).toThrow(CampaignFinalizationTemplateValidationError);
  });

  it.each(["2026-02-29T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T00:00:60Z", "2026-01-01",
    "2026-01-01T00:00:00", "01/01/2026", "2026-01-01T00:00:00.1234Z", "2026-01-01T00:00:00+24:00",
    "0000-01-01T00:00:00Z", "9999-12-31T23:59:59.999-01:00", "0001-01-01T00:00:00+01:00",
    "+010000-01-01T00:00:00Z", "Infinity", Infinity, NaN, new Date("2026-01-01T00:00:00Z")])(
    "rejects invalid, imprecise, or out-of-range instant %s", (scheduledAt) => {
      expect(() => normalizeCampaignFinalizationInput({ ...input, timing: { type: "exact_time", scheduledAt } })).toThrow(CampaignFinalizationTemplateValidationError);
    });

  it("preserves millisecond precision and supported calendar endpoints", () => {
    for (const scheduledAt of ["0001-01-01T00:00:00.000Z", "9999-12-31T23:59:59.999Z", "2024-02-29T12:30:40.123Z"]) {
      expect(normalizeCampaignFinalizationInput({ ...input, timing: { type: "exact_time", scheduledAt } }).normalizedInput.timing)
        .toEqual({ type: "exact_time", scheduledAt });
    }
    expect(normalizeCampaignFinalizationInput({ ...input, timing: { type: "exact_time", scheduledAt: "2026-10-01T00:00:00.1+00:00" } })
      .normalizedInput.timing).toEqual({ type: "exact_time", scheduledAt: "2026-10-01T00:00:00.100Z" });
  });

  it("rejects equal/reversed windows after offset normalization", () => {
    for (const end of ["2026-01-01T10:00:00-05:00", "2026-01-01T14:59:59.999Z"]) {
      expect(() => normalizeCampaignFinalizationInput({ ...input,
        timing: { type: "preferred_window", start: "2026-01-01T15:00:00Z", end } })).toThrow(CampaignFinalizationTemplateValidationError);
    }
  });

  it("uses existing half-open window and lower-bound-only exact-time semantics without consulting a clock", () => {
    vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("Do not sample a clock"); });
    vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("Do not create random IDs"); });
    const step = compileCampaignFinalization({ ...input, timing: { type: "preferred_window",
      start: "2000-01-01T00:00:00.001Z", end: "2000-01-01T00:00:00.002Z" } }, context()).campaign.steps[0]!;
    expect(evaluateStepSchedule(step, [], Date.parse("2000-01-01T00:00:00.000Z")).state).toBe("waiting_until");
    expect(evaluateStepSchedule(step, [], Date.parse("2000-01-01T00:00:00.001Z")).state).toBe("ready");
    expect(evaluateStepSchedule(step, [], Date.parse("2000-01-01T00:00:00.002Z"))).toMatchObject({ state: "expired", reason: "deadline_reached" });
    const exact = compileCampaignFinalization({ ...input, timing: { type: "exact_time", scheduledAt: "2000-01-01T00:00:00.001Z" } }, context()).campaign.steps[0]!;
    expect(evaluateStepSchedule(exact, [], Date.parse("2099-01-01T00:00:00Z"))).toEqual({ state: "ready", notBefore: "2000-01-01T00:00:00.001Z" });
  });
});

describe("trusted same-Campaign draft compilation", () => {
  it.each(["discord_webhook", "slack_webhook", "mastodon_account"] as const)("compiles one approved official-API %s step using preparation pins", (provider) => {
    const trusted = context();
    const result = compileCampaignFinalization(input, { ...trusted, preview: { ...trusted.preview, provider } });
    expect(result).toMatchObject({ campaignId: ids.campaign, expectedPlanningVersionId: ids.planning,
      campaign: { workspaceId: ids.workspace, name: "Café 🚀 launch", description: "Prepared description", objective: "awareness",
        contentPackageIds: [ids.contentPackage], brandProfileVersionId: ids.brand, audienceProfileVersionIds: [ids.audienceB, ids.audienceA],
        destinationId: ids.destination, informationDepth: "detailed", promotionalStrength: "light", timezone: "America/Chicago",
        autonomyMode: "approval_required", context: {}, successCriteria: [], successAction: "notify_only" } });
    expect(result.campaign.steps).toHaveLength(1);
    expect(result.campaign.steps[0]).toEqual({ id: "publish_prepared_preview", name: "Publish reviewed preview", operationType: "publish_content",
      desiredCapability: "publish_content", dependsOn: [], dependencyDelaySeconds: 0,
      inputs: { draftChannelPreviewId: ids.preview, draftChannelPreviewFingerprint: token, channelConnectionId: ids.connection },
      outputs: {}, executionMethods: ["official_api"], approvalRequired: true, scheduleType: "immediate",
      condition: {}, maxAttempts: 3, timeoutSeconds: 300, optional: false });
    const steps = result.campaign.steps.map((step) => ({ ...step, outputs: step.outputs ?? {} }));
    expect(validateCampaignGraph(steps)).toMatchObject({ valid: true, executionOrder: ["publish_prepared_preview"] });
    expect(validateCampaignExecution(result.campaign.autonomyMode, steps, { allowBoundedScheduling: true })).toEqual([]);
    expect(campaignStepRequiresApproval(result.campaign.autonomyMode, steps[0])).toBe(true);
    expect(result.campaign).not.toHaveProperty("id");
    expect(result.campaign).not.toHaveProperty("campaignInstanceId");
    expect(result.campaign.steps[0]!.inputs).not.toHaveProperty("content");
  });

  it("maps windows into existing step fields while preserving the legacy validator's closed default", () => {
    const result = compileCampaignFinalization({ ...input, timing: { type: "preferred_window",
      start: "2026-01-01T09:00:00.001-06:00", end: "2026-01-01T10:00:00.999-06:00" } }, context());
    const steps = result.campaign.steps.map((step) => ({ ...step, outputs: step.outputs ?? {} }));
    expect(steps[0]).toMatchObject({ scheduleType: "preferred_window", preferredWindowStart: "2026-01-01T15:00:00.001Z", preferredWindowEnd: "2026-01-01T16:00:00.999Z" });
    expect(steps[0]).not.toHaveProperty("scheduledAt");
    expect(validateCampaignExecution(result.campaign.autonomyMode, steps)).toMatchObject([{ code: "unsupported_schedule" }]);
    expect(validateCampaignExecution(result.campaign.autonomyMode, steps, { allowBoundedScheduling: true })).toEqual([]);
  });

  it.each(["workspaceId", "campaignId", "sourceCampaignVersionId", "generationId", "previewId", "draftId", "draftVersionId", "destinationId"] as const)(
    "rejects a mismatched trusted preview %s", (field) => {
      const trusted = context();
      expect(() => compileCampaignFinalization(input, { ...trusted, preview: { ...trusted.preview, [field]: ids.other } }))
        .toThrow(CampaignFinalizationTemplateValidationError);
    });

  it("rejects a changed trusted fingerprint and an unprepared or ambiguous draft", () => {
    const trusted = context();
    expect(() => compileCampaignFinalization(input, { ...trusted, preview: { ...trusted.preview, fingerprint: `mm-preview-v1:sha256:${"b".repeat(64)}` } }))
      .toThrow(CampaignFinalizationTemplateValidationError);
    for (const preparedDrafts of [[], [{ draftId: ids.other, versionId: ids.draftVersion }],
      [...trusted.preparation.preparedDrafts, ...trusted.preparation.preparedDrafts]]) {
      expect(() => compileCampaignFinalization(input, { ...trusted, preparation: { ...trusted.preparation, preparedDrafts } }))
        .toThrow(CampaignFinalizationTemplateValidationError);
    }
  });

  it.each(["id", "workspaceId", "planningVersionId", "campaignId", "generationId", "contentPackageId"] as const)(
    "rejects a mismatched preparation %s", (field) => {
      const trusted = context();
      expect(() => compileCampaignFinalization(input, { ...trusted, preparation: { ...trusted.preparation, [field]: ids.other } }))
        .toThrow(CampaignFinalizationTemplateValidationError);
    });

  it("rejects a changed package revision or unsupported trusted route", () => {
    const trusted = context();
    expect(() => compileCampaignFinalization(input, { ...trusted, preparation: { ...trusted.preparation, contentPackageVersion: 8 } }))
      .toThrow(CampaignFinalizationTemplateValidationError);
    for (const change of [{ provider: "mailchimp_email" as const }, { attachmentCount: 1 }, { attachmentCount: -1 },
      { attachmentCount: NaN }, { channelConnectionId: "bad" }]) {
      expect(() => compileCampaignFinalization(input, { ...trusted, preview: { ...trusted.preview, ...change } }))
        .toThrow(CampaignFinalizationTemplateValidationError);
    }
  });

  it("accepts no Destination only when both trusted sources omit it", () => {
    const trusted = context();
    const { destinationId: _destination, ...configurationSnapshot } = trusted.preparation.configurationSnapshot;
    const withoutDestination = { ...trusted, preparation: { ...trusted.preparation, configurationSnapshot } };
    expect(() => compileCampaignFinalization(input, withoutDestination)).toThrow(CampaignFinalizationTemplateValidationError);
    const result = compileCampaignFinalization(input, { ...withoutDestination, preview: { ...trusted.preview, destinationId: null } });
    expect(result.campaign).not.toHaveProperty("destinationId");
  });

  it("does not mutate or retain caller arrays and freezes all emitted plan containers", () => {
    const trusted = context();
    const before = JSON.stringify({ input, trusted });
    const result = compileCampaignFinalization(input, trusted);
    expect(JSON.stringify({ input, trusted })).toBe(before);
    expect(result.campaign.audienceProfileVersionIds).not.toBe(trusted.preparation.configurationSnapshot.audienceProfileVersionIds);
    expect(result.normalizedInput.timing).not.toBe(input.timing);
    for (const value of [result, result.normalizedInput, result.normalizedInput.timing, result.campaign,
      result.campaign.steps, result.campaign.steps[0], result.campaign.steps[0]!.inputs, result.campaign.steps[0]!.outputs,
      result.campaign.steps[0]!.executionMethods, result.campaign.context, result.campaign.audienceProfileVersionIds]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(compileCampaignFinalization(input, trusted)).toEqual(result);
  });
});
