import { describe, expect, it } from "vitest";
import { campaignStepRequiresApproval, validateCampaignExecution, evaluateCampaignSuccess, evaluateReadiness, resolveCommunicationPolicy, resolveContextFacts, resolveScopedValue, validateCampaignGraph } from "./policies";

describe("evaluateCampaignSuccess", () => {
  it("evaluates immutable event-count thresholds without inventing missing measurements", () => {
    expect(evaluateCampaignSuccess([
      { id: "traffic", eventType: "destination_visit", targetCount: 100 },
      { id: "registrations", eventType: "registration", targetCount: 10 },
    ], { destination_visit: { count: 125 }, registration: { count: 4 } })).toEqual({
      criteria: [
        { id: "traffic", eventType: "destination_visit", metric: "count", targetCount: 100, currentCount: 125, met: true },
        { id: "registrations", eventType: "registration", metric: "count", targetCount: 10, currentCount: 4, met: false },
      ],
      allCriteriaMet: false,
    });
    expect(evaluateCampaignSuccess([{ id: "leads", eventType: "lead", targetCount: 1 }], {}))
      .toEqual({ criteria: [{ id: "leads", eventType: "lead", metric: "count", targetCount: 1, currentCount: 0, met: false }], allCriteriaMet: false });
    expect(evaluateCampaignSuccess([], {})).toEqual({ criteria: [], allCriteriaMet: false });
  });

  it("keeps value goals isolated by exact ISO currency", () => {
    expect(evaluateCampaignSuccess([
      { id: "usd_revenue", eventType: "revenue", metric: "value", targetValue: 1000, currency: "USD" },
      { id: "eur_revenue", eventType: "revenue", metric: "value", targetValue: 1000, currency: "EUR" },
    ], { revenue: { count: 3 } }, { revenue: { USD: 1250, EUR: 300 } })).toEqual({
      criteria: [
        { id: "usd_revenue", eventType: "revenue", metric: "value", targetValue: 1000, currency: "USD", currentValue: 1250, met: true },
        { id: "eur_revenue", eventType: "revenue", metric: "value", targetValue: 1000, currency: "EUR", currentValue: 300, met: false },
      ],
      allCriteriaMet: false,
    });
  });

  it("evaluates explicit provider aggregate totals without synthetic events", () => {
    expect(evaluateCampaignSuccess([
      { id: "opens", eventType: "email_unique_open", targetCount: 50 },
      { id: "clicks", eventType: "email_unique_click", targetCount: 20 },
      { id: "favourites", eventType: "mastodon_favourite", targetCount: 10 },
    ], { email_unique_open: { count: 60 }, email_unique_click: { count: 12 }, mastodon_favourite: { count: 14 } })).toEqual({
      criteria: [
        { id: "opens", eventType: "email_unique_open", metric: "count", targetCount: 50, currentCount: 60, met: true },
        { id: "clicks", eventType: "email_unique_click", metric: "count", targetCount: 20, currentCount: 12, met: false },
        { id: "favourites", eventType: "mastodon_favourite", metric: "count", targetCount: 10, currentCount: 14, met: true },
      ],
      allCriteriaMet: false,
    });
  });
});

describe("resolveScopedValue", () => {
  it("uses the most specific defined override", () => {
    expect(
      resolveScopedValue({ workspace: "minimal", campaign: "detailed", post: "teaser" }),
    ).toBe("teaser");
  });

  it("places campaign settings above destination and audience defaults", () => {
    expect(
      resolveScopedValue({ brand: "subtle", audience: "light", platform: "standard", campaign: "strong" }),
    ).toBe("strong");
  });

  it("preserves explicit falsy values", () => {
    expect(resolveScopedValue({ workspace: true, audience: false })).toBe(false);
  });
});

describe("resolveCommunicationPolicy", () => {
  it("uses the most-specific value while preserving the most restrictive ceiling", () => {
    expect(resolveCommunicationPolicy([
      { source: "workspace", level: "workspace", informationDepth: "contextual", promotionalStrength: "light" },
      { source: "Brand v2", level: "brand", informationDepthCeiling: "detailed", promotionalStrengthCeiling: "strong" },
      { source: "Campaign v1", level: "campaign", informationDepth: "detailed", promotionalStrength: "standard" },
    ])).toEqual(expect.objectContaining({ informationDepth: "detailed", informationDepthSource: "Campaign v1", informationDepthCeiling: "detailed", issues: [] }));
  });

  it("uses the safest same-level value for mixed audiences", () => {
    expect(resolveCommunicationPolicy([
      { source: "Experts", level: "audience", informationDepth: "comprehensive", promotionalStrength: "standard" },
      { source: "New visitors", level: "audience", informationDepth: "teaser", promotionalStrength: "subtle" },
    ])).toEqual(expect.objectContaining({ informationDepth: "teaser", informationDepthSource: "New visitors", promotionalStrength: "subtle" }));
  });

  it("reports ordinal and custom values that exceed a ceiling", () => {
    const result = resolveCommunicationPolicy([
      { source: "Regulated brand", level: "brand", informationDepthCeiling: "contextual", promotionalStrengthCeiling: "light" },
      { source: "Campaign", level: "campaign", informationDepth: "custom", promotionalStrength: "strong" },
    ]);
    expect(result.issues.map((issue) => issue.code)).toEqual(["information_depth_ceiling", "promotional_strength_ceiling"]);
  });
});

describe("resolveContextFacts", () => {
  const candidates = [
    { id: "fact-a", factKey: "launch.date", value: "2026-09-01", sourceId: "brief" },
    { id: "fact-b", factKey: "launch.date", value: "2026-09-03", sourceId: "calendar" },
    { id: "fact-c", factKey: "product.colors", value: ["blue", "gold"], sourceId: "brief" },
    { id: "fact-d", factKey: "product.colors", value: ["blue", "gold"], sourceId: "catalog" },
  ];

  it("keeps disagreements in review without an explicit authority rule", () => {
    expect(resolveContextFacts(["launch.date"], candidates, [])[0]).toEqual(expect.objectContaining({
      status: "conflicted",
      selectedCandidateIds: [],
      conflictingCandidateIds: ["fact-a", "fact-b"],
    }));
  });

  it("uses a named preferred source only when the authority rule is explicit", () => {
    expect(resolveContextFacts(["launch.date"], candidates, [{
      factKey: "launch.date",
      preferredSourceIds: ["calendar"],
      resolution: "prefer_authority",
    }])[0]).toEqual(expect.objectContaining({
      status: "resolved",
      value: "2026-09-03",
      selectedCandidateIds: ["fact-b"],
      conflictingCandidateIds: ["fact-a"],
    }));
  });

  it("resolves agreeing structured values and reports missing facts", () => {
    const result = resolveContextFacts(["product.colors", "product.price"], candidates, []);
    expect(result[0]).toEqual(expect.objectContaining({ status: "resolved", selectedCandidateIds: ["fact-c", "fact-d"] }));
    expect(result[1]).toEqual(expect.objectContaining({ status: "unresolved" }));
  });
});

describe("evaluateReadiness", () => {
  const stableCandidate = {
    stableForSeconds: 300,
    relatedFileCount: 0,
    markers: [] as string[],
  };

  it("never processes an unstable item", () => {
    const result = evaluateReadiness(
      { readinessMode: "immediate", stabilizationWindowSeconds: 120 },
      { ...stableCandidate, stableForSeconds: 30 },
    );
    expect(result.ready).toBe(false);
    expect(result.missingRequirements).toContain("stabilization_window");
  });

  it("supports immediate processing after stabilization", () => {
    expect(
      evaluateReadiness(
        { readinessMode: "immediate", stabilizationWindowSeconds: 120 },
        stableCandidate,
      ).ready,
    ).toBe(true);
  });

  it("waits for the configured number of related files", () => {
    const result = evaluateReadiness(
      { readinessMode: "related_files", stabilizationWindowSeconds: 120, relatedFileMinimum: 2 },
      { ...stableCandidate, relatedFileCount: 1 },
    );
    expect(result.ready).toBe(false);
    expect(result.reason).toContain("1 more related files");
  });

  it("requires an exact configured marker", () => {
    const result = evaluateReadiness(
      { readinessMode: "ready_marker", stabilizationWindowSeconds: 120, readyMarker: "APPROVED" },
      { ...stableCandidate, markers: ["APPROVED"] },
    );
    expect(result.ready).toBe(true);
  });

  it("enforces the AI confidence threshold", () => {
    const result = evaluateReadiness(
      { readinessMode: "ai_recommended", stabilizationWindowSeconds: 120, aiConfidenceThreshold: 0.9 },
      { ...stableCandidate, aiRecommendation: { ready: true, confidence: 0.82 } },
    );
    expect(result.ready).toBe(false);
    expect(result.missingRequirements).toContain("ai_confidence_threshold");
  });
});

describe("validateCampaignGraph", () => {
  const step = (id: string, dependsOn: string[] = []) => ({ id, name: id, desiredCapability: "manual.handoff", dependsOn, inputs: {}, outputs: {}, executionMethods: ["manual_handoff"] as const, approvalRequired: false });

  it("returns a deterministic topological order for parallel branches", () => {
    expect(validateCampaignGraph([step("publish", ["draft"]), step("draft"), step("email", ["draft"]), step("measure", ["publish", "email"])]))
      .toEqual(expect.objectContaining({ valid: true, executionOrder: ["draft", "email", "publish", "measure"] }));
  });

  it("rejects missing dependencies and cycles", () => {
    const result = validateCampaignGraph([step("a", ["b"]), step("b", ["a"]), step("c", ["missing"])]);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["missing_dependency", "cycle"]));
  });

  it("validates schedules and retry bounds", () => {
    const result = validateCampaignGraph([{ ...step("timed"), scheduleType: "exact_time" as const, maxAttempts: 0 }]);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["invalid_schedule", "invalid_retry"]));
  });

  it("reserves the campaign approval key in authoring and legacy execution", () => {
    expect(validateCampaignGraph([step("__campaign__")]).issues).toEqual([expect.objectContaining({ code: "reserved_step" })]);
    expect(validateCampaignExecution("fully_autonomous", [step("__campaign__")])).toEqual([expect.objectContaining({ code: "reserved_step" })]);
  });
});

describe("campaign execution authority", () => {
  const step = { id: "publish", name: "Publication", operationType: "publish_content" as const, desiredCapability: "publish_content", dependsOn: [], inputs: {}, outputs: {}, executionMethods: ["official_api"] as const, approvalRequired: false };

  it("preserves unsupported authored plans while refusing their execution", () => {
    for (const scheduleType of ["preferred_window", "conditional", "follow_up", "recurring", "evergreen_queue"] as const) {
      const planned = { ...step, scheduleType, preferredWindowStart: "2026-09-10T09:00:00Z", preferredWindowEnd: "2026-09-10T17:00:00Z" };
      expect(validateCampaignGraph([planned]).valid).toBe(true);
      expect(validateCampaignExecution("fully_autonomous", [planned])).toEqual([expect.objectContaining({ code: "unsupported_schedule", stepId: "publish" })]);
    }
    expect(validateCampaignExecution("fully_autonomous", [{ ...step, scheduleType: "exact_time", scheduledAt: "invalid" }])).toEqual([expect.objectContaining({ code: "invalid_schedule" })]);
    expect(validateCampaignExecution("fully_autonomous", [{ ...step, condition: { metric: "destination_visit", minimum: 10 } }])).toEqual([expect.objectContaining({ code: "unsupported_condition" })]);
  });

  it("never authorizes drafting, legacy suggestion, or unknown modes", () => {
    for (const mode of ["draft_only", "suggest_only", "unexpected"]) {
      expect(validateCampaignExecution(mode, [step])).toEqual([expect.objectContaining({ code: "autonomy_execution_disabled" })]);
    }
  });

  it("requires review without confidence/history evidence and preserves explicit gates in autonomous modes", () => {
    for (const mode of ["approval_required", "approve_uncertain", "approve_first_occurrence", "confidence_based"]) {
      expect(campaignStepRequiresApproval(mode, step)).toBe(true);
    }
    for (const mode of ["fully_autonomous", "custom", "campaign_approval"]) {
      expect(campaignStepRequiresApproval(mode, step)).toBe(false);
      expect(campaignStepRequiresApproval(mode, { ...step, approvalRequired: true })).toBe(true);
    }
    expect(campaignStepRequiresApproval("approval_required", { ...step, operationType: "wait" })).toBe(false);
  });
});
