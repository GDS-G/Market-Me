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
