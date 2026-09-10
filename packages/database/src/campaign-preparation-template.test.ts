import { describe, expect, it } from "vitest";
import { INFORMATION_DEPTHS, PROMOTIONAL_STRENGTHS, validateCampaignExecution, validateCampaignGraph } from "@market-me/domain";
import {
  CAMPAIGN_PREPARATION_LIMITS,
  CampaignPreparationTemplateValidationError,
  compileGeneralAnnouncementPreparation,
} from "./campaign-preparation-template";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const contentPackageId = "22222222-2222-4222-8222-222222222222";
const brandProfileVersionId = "33333333-3333-4333-8333-333333333333";
const audienceA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const audienceB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const destinationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const required = { workspaceId, contentPackageId, expectedPackageVersion: 1 };

describe("General Announcement planning compiler", () => {
  it("emits an ordinary valid graph that cannot execute, with safe explicit defaults", () => {
    const { campaign, normalizedInput, canonicalPayload } = compileGeneralAnnouncementPreparation(required);
    expect(normalizedInput).toEqual({
      templateKey: "general_announcement", templateVersion: 1, ...required,
      name: "General announcement", description: "", audienceProfileVersionIds: [],
      informationDepth: "contextual", promotionalStrength: "informational", timezone: "UTC",
    });
    expect(campaign).toMatchObject({
      workspaceId, name: "General announcement", objective: "awareness", contentPackageIds: [contentPackageId],
      autonomyMode: "draft_only", context: {}, audienceProfileVersionIds: [], successCriteria: [], successAction: "notify_only",
      steps: [{ id: "review_preparation", operationType: "request_approval", desiredCapability: "workflow.approval",
        executionMethods: ["manual_handoff"], inputs: {}, outputs: {}, approvalRequired: true, scheduleType: "immediate" }],
    });
    expect(campaign.steps).toHaveLength(1);
    expect(campaign).not.toHaveProperty("destinationId");
    expect(campaign).not.toHaveProperty("brandProfileVersionId");
    expect(campaign).not.toHaveProperty("campaignInstanceId");
    expect(campaign).not.toHaveProperty("id");
    const steps = campaign.steps.map((step) => ({ ...step, outputs: step.outputs ?? {} }));
    expect(validateCampaignGraph(steps).valid).toBe(true);
    expect(validateCampaignExecution(campaign.autonomyMode, steps)).toMatchObject([{ code: "autonomy_execution_disabled" }]);
    expect(validateCampaignExecution(campaign.autonomyMode, steps, { allowBoundedScheduling: true }))
      .toMatchObject([{ code: "autonomy_execution_disabled" }]);
    expect(JSON.parse(canonicalPayload)).toEqual(normalizedInput);
  });

  it("canonicalizes equivalent inputs without inferring accounts or changing authored audience order", () => {
    const first = compileGeneralAnnouncementPreparation({
      ...required, workspaceId: ` ${workspaceId.toUpperCase()} `,
      contentPackageId: ` ${contentPackageId} `, name: "  Summer\n  announcement ", description: "  Details\r\nMore details  ",
      brandProfileVersionId, audienceProfileVersionIds: [audienceB.toUpperCase(), audienceA],
      destinationId: destinationId.toUpperCase(), informationDepth: "detailed", promotionalStrength: "light", timezone: " America/Chicago ",
    });
    const second = compileGeneralAnnouncementPreparation({
      timezone: "America/Chicago", promotionalStrength: "light", informationDepth: "detailed",
      destinationId, audienceProfileVersionIds: [audienceB, audienceA], brandProfileVersionId,
      description: "Details\nMore details", name: "Summer announcement", templateVersion: 1,
      templateKey: "general_announcement", expectedPackageVersion: 1, contentPackageId, workspaceId,
    });
    expect(first.canonicalPayload).toBe(second.canonicalPayload);
    expect(first.campaign).toEqual(second.campaign);
    expect(first.campaign.audienceProfileVersionIds).toEqual([audienceB, audienceA]);
    expect(first.campaign).toMatchObject({ destinationId, brandProfileVersionId, timezone: "America/Chicago" });
    expect(compileGeneralAnnouncementPreparation({ ...second.normalizedInput, audienceProfileVersionIds: [audienceA, audienceB] }).canonicalPayload)
      .not.toBe(second.canonicalPayload);
  });

  it("treats omitted defaults and explicitly supplied defaults identically", () => {
    const implicit = compileGeneralAnnouncementPreparation(required);
    expect(compileGeneralAnnouncementPreparation({ ...implicit.normalizedInput, brandProfileVersionId: undefined, destinationId: undefined }).canonicalPayload)
      .toBe(implicit.canonicalPayload);
    expect(compileGeneralAnnouncementPreparation({ ...required, name: "Cafe\u0301" }).canonicalPayload)
      .toBe(compileGeneralAnnouncementPreparation({ ...required, name: "Caf\u00e9" }).canonicalPayload);
  });

  it("keeps revision and resource identity in canonical bytes and accepts exactly 20 distinct audiences", () => {
    const baseline = compileGeneralAnnouncementPreparation(required).canonicalPayload;
    for (const change of [{ expectedPackageVersion: 2 }, { contentPackageId: audienceA }, { workspaceId: audienceB },
      { brandProfileVersionId }, { destinationId }, { informationDepth: "detailed" }, { name: "Another preparation" }]) {
      expect(compileGeneralAnnouncementPreparation({ ...required, ...change }).canonicalPayload).not.toBe(baseline);
    }
    const audiences = Array.from({ length: 20 }, (_, index) => `10000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`);
    expect(compileGeneralAnnouncementPreparation({ ...required, audienceProfileVersionIds: audiences }).normalizedInput.audienceProfileVersionIds)
      .toEqual(audiences);
  });

  it("preserves validated timezone identifiers instead of embedding ICU alias choices in canonical bytes", () => {
    const utc = compileGeneralAnnouncementPreparation(required);
    const alias = compileGeneralAnnouncementPreparation({ ...required, timezone: " Etc/UTC " });
    expect(alias.normalizedInput.timezone).toBe("Etc/UTC");
    expect(alias.campaign.timezone).toBe("Etc/UTC");
    expect(alias.canonicalPayload).not.toBe(utc.canonicalPayload);
    expect(compileGeneralAnnouncementPreparation({ ...required, timezone: " UTC " }).canonicalPayload).toBe(utc.canonicalPayload);
    expect(compileGeneralAnnouncementPreparation({ ...required, timezone: "US/Central" }).normalizedInput.timezone).toBe("US/Central");
  });

  it("does not mutate or retain caller arrays, and freezes the constructed plan", () => {
    const audienceProfileVersionIds = [audienceB, audienceA];
    const input = Object.freeze({ ...required, audienceProfileVersionIds: Object.freeze(audienceProfileVersionIds) });
    const before = JSON.stringify(input);
    const result = compileGeneralAnnouncementPreparation(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(result.normalizedInput.audienceProfileVersionIds).not.toBe(audienceProfileVersionIds);
    expect(result.campaign.audienceProfileVersionIds).not.toBe(result.normalizedInput.audienceProfileVersionIds);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.campaign.steps[0]!.inputs)).toBe(true);
    expect(Object.isFrozen(result.campaign.steps)).toBe(true);
    expect(Object.isFrozen(result.normalizedInput.audienceProfileVersionIds)).toBe(true);
    expect(compileGeneralAnnouncementPreparation(input)).toEqual(result);
  });

  it.each(["autonomyMode", "context", "steps", "approvalRequired", "credentials", "channelConnectionId", "actorUserId", "idempotencyKey", "packageTitle", "toJSON"])(
    "rejects caller field %s instead of granting or embedding authority", (field) => {
      expect(() => compileGeneralAnnouncementPreparation({ ...required, [field]: { execute: true, token: "fixture-only" } }))
        .toThrow(CampaignPreparationTemplateValidationError);
    },
  );

  it("rejects non-JSON prototypes, prototype keys, symbols and getters without invoking them", () => {
    let invoked = false;
    const getter = { ...required };
    Object.defineProperty(getter, "name", { enumerable: true, get: () => { invoked = true; return "Untrusted getter"; } });
    const inputs = [null, [], "input", Object.create(required), Object.assign(Object.create(null), required),
      { ...required, [Symbol("authority")]: true }, getter,
      JSON.parse(`{"workspaceId":"${workspaceId}","contentPackageId":"${contentPackageId}","expectedPackageVersion":1,"__proto__":{"autonomyMode":"fully_autonomous"}}`)];
    for (const input of inputs) expect(() => compileGeneralAnnouncementPreparation(input)).toThrow(CampaignPreparationTemplateValidationError);
    const audienceGetter = [audienceA];
    Object.defineProperty(audienceGetter, "0", { enumerable: true, get: () => { invoked = true; return audienceA; } });
    const extendedArray = Object.assign([audienceA], { authority: "publish" });
    class CustomArray extends Array<string> {}
    for (const audienceProfileVersionIds of [audienceGetter, extendedArray, new CustomArray(audienceA), new Array(1), null]) {
      expect(() => compileGeneralAnnouncementPreparation({ ...required, audienceProfileVersionIds })).toThrow(CampaignPreparationTemplateValidationError);
    }
    expect(invoked).toBe(false);
  });

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity, "1", null, undefined, CAMPAIGN_PREPARATION_LIMITS.packageVersion + 1])(
    "rejects invalid package revision %s", (expectedPackageVersion) => {
      expect(() => compileGeneralAnnouncementPreparation({ ...required, expectedPackageVersion }))
        .toThrow(CampaignPreparationTemplateValidationError);
    },
  );

  it.each([{ templateKey: "product_launch" }, { templateKey: "GENERAL_ANNOUNCEMENT" }, { templateVersion: 2 }, { templateVersion: "1" }, { templateVersion: NaN }])(
    "rejects unsupported template selection %j", (selection) => {
      expect(() => compileGeneralAnnouncementPreparation({ ...required, ...selection })).toThrow(CampaignPreparationTemplateValidationError);
    },
  );

  it("rejects invalid references, duplicate audiences and out-of-range settings", () => {
    const changes = [
      { workspaceId: "not-a-uuid" }, { contentPackageId: "" }, { destinationId: "https://example.test" },
      { brandProfileVersionId: null }, { audienceProfileVersionIds: [audienceA, audienceA.toUpperCase()] },
      { audienceProfileVersionIds: "all" }, { audienceProfileVersionIds: [null] }, { audienceProfileVersionIds: Array(21).fill(audienceA) },
      { name: " " }, { name: "x".repeat(201) }, { name: "Hidden\u0000name" }, { description: "x".repeat(5_001) },
      { timezone: "Not/A_Zone" }, { timezone: "" }, { informationDepth: "unknown" }, { promotionalStrength: 2 },
    ];
    for (const change of changes) expect(() => compileGeneralAnnouncementPreparation({ ...required, ...change }))
      .toThrow(CampaignPreparationTemplateValidationError);
  });

  it("accepts existing copy-control enums and exact supported bounds without increasing autonomy", () => {
    for (const informationDepth of INFORMATION_DEPTHS) for (const promotionalStrength of PROMOTIONAL_STRENGTHS) {
      const compiled = compileGeneralAnnouncementPreparation({ ...required, informationDepth, promotionalStrength,
        expectedPackageVersion: CAMPAIGN_PREPARATION_LIMITS.packageVersion, name: "x".repeat(200), description: "x".repeat(5_000) });
      expect(compiled.campaign).toMatchObject({ informationDepth, promotionalStrength, autonomyMode: "draft_only" });
      expect(compiled.campaign.context).toEqual({});
    }
  });
});
