import { describe, expect, it } from "vitest";
import { preferredWindowRouteIssue } from "./campaign-route-policy";

describe("preferred-window route admission", () => {
  const route = { operationType: "publish_content", executionMethods: ["official_api"], provider: "discord_webhook", attachmentCount: 0 };
  it.each(["discord_webhook", "slack_webhook", "mastodon_account"])("admits single-request %s text", (provider) => {
    expect(preferredWindowRouteIssue({ ...route, provider })).toBeUndefined();
  });
  it.each([
    { operationType: "wait" }, { provider: undefined }, { provider: "mailchimp_email" },
    { executionMethods: [] }, { executionMethods: ["official_api", "manual_handoff"] },
    { executionMethods: ["user_assisted"] }, { attachmentCount: 1 }, { attachmentCount: -1 }, { attachmentCount: NaN },
  ])("rejects unsupported or malformed routes: %j", (change) => {
    expect(preferredWindowRouteIssue({ ...route, ...change })).toBeTypeOf("string");
  });
});
