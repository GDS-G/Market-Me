import { describe, expect, it } from "vitest";
import { campaignDraftSchema } from "./campaign-schema";

const base = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  name: "Measured launch",
  description: "",
  objective: "website_traffic",
  contentPackageIds: [],
  audienceProfileVersionIds: [],
  informationDepth: "contextual",
  promotionalStrength: "standard",
  autonomyMode: "approval_required",
  timezone: "UTC",
  context: {},
  steps: [
    {
      id: "publish",
      name: "Publish",
      operationType: "manual_handoff",
      desiredCapability: "manual.handoff",
      dependsOn: [],
      inputs: {},
      outputs: {},
      executionMethods: ["manual_handoff"],
      approvalRequired: true,
    },
  ],
};

describe("campaign scheduling schema", () => {
  it("defaults delay to zero and preserves valid bounded plans with millisecond UTC precision", () => {
    expect(campaignDraftSchema.parse(base).steps[0].dependencyDelaySeconds).toBe(0);
    const schedule = { dependencyDelaySeconds: 31_536_000, dependsOn: ["prepare"], scheduleType: "preferred_window", preferredWindowStart: "2026-09-12T10:00:01.125Z", preferredWindowEnd: "2026-09-12T11:00:02.875Z", condition: { futurePolicy: true }, optional: true };
    expect(campaignDraftSchema.parse({ ...base, steps: [{ ...base.steps[0], ...schedule }] }).steps[0]).toMatchObject(schedule);
  });
  it.each([-1, 0.1, NaN, Infinity, -Infinity, 31_536_001, "60", null, true])("rejects delay %s without coercion", (delay) => {
    expect(campaignDraftSchema.safeParse({ ...base, steps: [{ ...base.steps[0], dependsOn: ["prepare"], dependencyDelaySeconds: delay }] }).success).toBe(false);
  });
  it("requires dependencies for positive delays and an ordered complete window", () => {
    expect(campaignDraftSchema.safeParse({ ...base, steps: [{ ...base.steps[0], dependencyDelaySeconds: 1 }] }).success).toBe(false);
    for (const end of [undefined, "invalid", "2026-09-12T10:00:00.000Z", "2026-09-12T09:00:00.000Z"]) {
      expect(campaignDraftSchema.safeParse({ ...base, steps: [{ ...base.steps[0], scheduleType: "preferred_window", preferredWindowStart: "2026-09-12T10:00:00.000Z", preferredWindowEnd: end }] }).success).toBe(false);
    }
  });
});

describe("campaign success criteria schema", () => {
  it("defaults to no goals and accepts bounded normalized event-count goals", () => {
    expect(campaignDraftSchema.parse(base)).toEqual(
      expect.objectContaining({
        successCriteria: [],
        successAction: "notify_only",
      }),
    );
    expect(
      campaignDraftSchema.parse({ ...base, successAction: "pause" })
        .successAction,
    ).toBe("pause");
    expect(
      campaignDraftSchema.parse({
        ...base,
        successCriteria: [
          { id: "traffic", eventType: "destination_visit", targetCount: 100 },
        ],
      }).successCriteria,
    ).toEqual([
      {
        id: "traffic",
        eventType: "destination_visit",
        metric: "count",
        targetCount: 100,
      },
    ]);
    expect(
      campaignDraftSchema.parse({
        ...base,
        successCriteria: [
          { id: "email_opens", eventType: "email_unique_open", targetCount: 50 },
          { id: "mastodon_favourites", eventType: "mastodon_favourite", targetCount: 25 },
        ],
      }).successCriteria,
    ).toEqual([
      { id: "email_opens", eventType: "email_unique_open", metric: "count", targetCount: 50 },
      { id: "mastodon_favourites", eventType: "mastodon_favourite", metric: "count", targetCount: 25 },
    ]);
    expect(
      campaignDraftSchema.parse({
        ...base,
        successCriteria: [
          {
            id: "revenue",
            eventType: "revenue",
            metric: "value",
            targetValue: 1250.5,
            currency: "USD",
          },
        ],
      }).successCriteria,
    ).toEqual([
      {
        id: "revenue",
        eventType: "revenue",
        metric: "value",
        targetValue: 1250.5,
        currency: "USD",
      },
    ]);
  });

  it("rejects duplicate IDs, unsupported events, and non-positive targets", () => {
    expect(
      campaignDraftSchema.safeParse({
        ...base,
        successCriteria: [
          { id: "traffic", eventType: "destination_visit", targetCount: 1 },
          { id: "traffic", eventType: "registration", targetCount: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(
      campaignDraftSchema.safeParse({
        ...base,
        successCriteria: [{
          id: "invalid_provider_value",
          eventType: "email_unique_open",
          metric: "value",
          targetValue: 10,
          currency: "USD",
        }],
      }).success,
    ).toBe(false);
    expect(
      campaignDraftSchema.safeParse({
        ...base,
        successCriteria: [{ id: "bad", eventType: "unknown", targetCount: 0 }],
      }).success,
    ).toBe(false);
    expect(
      campaignDraftSchema.safeParse({
        ...base,
        successCriteria: [
          {
            id: "bad_value",
            eventType: "revenue",
            metric: "value",
            targetValue: 10,
            currency: "usd",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      campaignDraftSchema.safeParse({ ...base, successAction: "complete" })
        .success,
    ).toBe(false);
  });
});
