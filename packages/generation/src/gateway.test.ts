import { describe, expect, it } from "vitest";
import { AI_ASSISTANT_ACTIONS, type AiProviderAdapterDescriptor } from "@market-me/domain";
import { AI_ASSISTANT_PROFILES, BUILT_IN_AI_ADAPTERS, isAiRoutingPreferenceCompatible, planAiAssistantWork, planAiCapResponse, routeAiTask, selectAiAssistant } from "./gateway";

const adapters: readonly AiProviderAdapterDescriptor[] = [
  ...BUILT_IN_AI_ADAPTERS,
  {
    provider: "approved-cloud",
    model: "quality",
    displayName: "Approved quality model",
    capabilities: ["generate_text", "analyze_image", "use_tools"],
    privacyClass: "cloud",
    quality: "highest",
    speed: "thorough",
    cost: "high",
    contextLimit: 100_000,
    available: true,
    approved: true,
    requiresPaidReservation: true,
  },
  {
    provider: "unapproved-cloud",
    model: "cheap",
    displayName: "Unapproved cheap model",
    capabilities: ["generate_text"],
    privacyClass: "cloud",
    quality: "highest",
    speed: "fast",
    cost: "low",
    contextLimit: 100_000,
    available: true,
    approved: false,
    requiresPaidReservation: true,
  },
];

describe("routeAiTask", () => {
  it("keeps local-only work on an approved local adapter", () => {
    const decision = routeAiTask(
      {
        capability: "generate_text",
        mode: "private_local",
        maximumPrivacyClass: "local",
      },
      adapters,
    );
    expect(decision.status).toBe("selected");
    expect(decision.adapter?.provider).toBe("market-me");
    expect(decision.adapter?.privacyClass).toBe("local");
  });

  it("uses capability and mode ranking without selecting an unapproved adapter", () => {
    const decision = routeAiTask(
      {
        capability: "analyze_image",
        mode: "highest_quality",
        maximumPrivacyClass: "cloud",
      },
      adapters,
    );
    expect(decision.adapter?.provider).toBe("approved-cloud");
  });

  it("fails closed instead of silently broadening privacy", () => {
    const decision = routeAiTask(
      {
        capability: "analyze_image",
        mode: "recommended",
        maximumPrivacyClass: "local",
      },
      adapters,
    );
    expect(decision).toMatchObject({ status: "unavailable" });
    expect(decision.reasons.join(" ")).toContain("will not broaden data exposure");
  });

  it("rejects adapters whose context limit is too small", () => {
    expect(
      routeAiTask(
        {
          capability: "generate_text",
          mode: "recommended",
          maximumPrivacyClass: "cloud",
          estimatedInputUnits: 200_000,
        },
        adapters,
      ).status,
    ).toBe("unavailable");
  });

  it("applies an eligible explicit route only after hard filters", () => {
    expect(
      routeAiTask(
        {
          capability: "generate_text",
          mode: "highest_quality",
          maximumPrivacyClass: "cloud",
          preferredAdapter: {
            provider: "market-me",
            model: "grounded-template",
          },
        },
        adapters,
      ),
    ).toMatchObject({
      status: "selected",
      adapter: { provider: "market-me", model: "grounded-template" },
    });
    expect(
      routeAiTask(
        {
          capability: "generate_text",
          mode: "private_local",
          maximumPrivacyClass: "local",
          preferredAdapter: { provider: "approved-cloud", model: "quality" },
        },
        adapters,
      ),
    ).toMatchObject({ status: "unavailable" });
  });

  it("accepts only registered approved capability-compatible preferences", () => {
    expect(
      isAiRoutingPreferenceCompatible(
        "prepare_copy",
        { provider: "market-me", model: "grounded-template" },
        adapters,
      ),
    ).toBe(true);
    expect(
      isAiRoutingPreferenceCompatible(
        "discover_profiles_and_content",
        { provider: "market-me", model: "grounded-template" },
        adapters,
      ),
    ).toBe(false);
    expect(
      isAiRoutingPreferenceCompatible(
        "prepare_copy",
        { provider: "unapproved-cloud", model: "cheap" },
        adapters,
      ),
    ).toBe(false);
  });
});

describe("selectAiAssistant", () => {
  it("publishes the seven specification-defined capability profiles", () => {
    expect(AI_ASSISTANT_PROFILES.map((profile) => profile.displayName)).toEqual([
      "Content Analyst",
      "Copy Assistant",
      "Campaign Planner",
      "Discovery Assistant",
      "Conversation Assistant",
      "Compliance Reviewer",
      "Performance Analyst",
    ]);
    expect(AI_ASSISTANT_PROFILES.every((profile) => profile.executionAuthority === false)).toBe(true);
  });

  it("selects one deterministic non-executing profile for every action", () => {
    const selections = AI_ASSISTANT_ACTIONS.map((action) =>
      selectAiAssistant(action),
    );
    expect(selections).toHaveLength(7);
    expect(selections.map((selection) => selection.profile.id)).toEqual([
      "content_analyst",
      "copy_assistant",
      "campaign_planner",
      "discovery_assistant",
      "conversation_assistant",
      "compliance_reviewer",
      "performance_analyst",
    ]);
    expect(
      selections.every(
        (selection) =>
          selection.automatic &&
          selection.executionAuthority === false &&
          selection.profile.capabilities.includes(selection.requiredCapability),
      ),
    ).toBe(true);
  });

  it("accepts compatible workspace choices and rejects role drift", () => {
    expect(selectAiAssistant("prepare_copy", "conversation_assistant")).toMatchObject({
      automatic: false,
      profile: { id: "conversation_assistant" },
      requiredCapability: "generate_text",
      executionAuthority: false,
    });
    expect(() =>
      selectAiAssistant("prepare_copy", "performance_analyst"),
    ).toThrow("not compatible");
  });
});

describe("planAiAssistantWork", () => {
  it("reports ready qualitative cost without execution or a currency quote", () => {
    expect(
      planAiAssistantWork({
        action: "prepare_copy",
        profileId: "conversation_assistant",
        mode: "recommended",
        maximumPrivacyClass: "local",
      }),
    ).toMatchObject({
      status: "ready",
      estimatedCost: "low",
      currencyEstimateAvailable: false,
      execution: false,
      selection: { automatic: false },
      routing: { status: "selected", adapter: { provider: "market-me" } },
    });
  });

  it("shows unavailable when the selected action has no eligible adapter", () => {
    const plan = planAiAssistantWork({
      action: "discover_profiles_and_content",
      mode: "recommended",
      maximumPrivacyClass: "cloud",
    });
    expect(plan).toMatchObject({
      status: "unavailable",
      currencyEstimateAvailable: false,
      execution: false,
      routing: { status: "unavailable" },
    });
    expect(plan.reasons.join(" ")).toContain("not configured");
  });
});

describe("planAiCapResponse", () => {
  const denied = (capBehavior: "pause_ai_work" | "lower_cost_fallback" | "limited_drafts" | "require_approval", capability: "generate_text" | "analyze_image" = "generate_text") => ({
    id: "11111111-1111-4111-8111-111111111111",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    capability,
    feature: "test",
    currency: "USD",
    estimatedCostMinor: 10,
    status: "denied" as const,
    exceededScopes: ["daily" as const],
    capBehavior,
    requestedBy: "33333333-3333-4333-8333-333333333333",
    resolvedBy: "33333333-3333-4333-8333-333333333333",
    resolvedAt: "2026-08-08T00:00:00.000Z",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  });

  it("maps pause and approval without selecting an adapter", () => {
    expect(planAiCapResponse({ reservation: denied("pause_ai_work"), maximumPrivacyClass: "cloud" })).toMatchObject({ status: "ready", action: "pause", requiresApproval: false });
    expect(planAiCapResponse({ reservation: denied("require_approval"), maximumPrivacyClass: "cloud" })).toMatchObject({ status: "ready", action: "request_approval", requiresApproval: true });
  });

  it("selects the known no-paid local adapter for lower-cost text", () => {
    expect(planAiCapResponse({ reservation: denied("lower_cost_fallback"), maximumPrivacyClass: "local" })).toMatchObject({ status: "ready", action: "use_lower_cost_adapter", adapter: { provider: "market-me" }, requiresPaidReservation: false });
  });

  it("bounds limited drafts to supported draft capabilities", () => {
    expect(planAiCapResponse({ reservation: denied("limited_drafts"), maximumPrivacyClass: "cloud" })).toMatchObject({ status: "ready", action: "create_limited_draft" });
    expect(planAiCapResponse({ reservation: denied("limited_drafts", "analyze_image"), maximumPrivacyClass: "cloud" })).toMatchObject({ status: "unavailable", action: "manual" });
  });

  it("fails closed when no no-paid adapter supports the capability", () => {
    expect(planAiCapResponse({ reservation: denied("lower_cost_fallback", "analyze_image"), maximumPrivacyClass: "cloud" })).toMatchObject({ status: "unavailable", action: "manual" });
  });
});
