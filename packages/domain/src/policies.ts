import type { CampaignMetricType, CampaignStep, CampaignSuccessCriterion, InformationDepth, PromotionalStrength, ReadinessMode, SmartSource } from "./index";
import { normalizeDependencyDelaySeconds, parseScheduleInstant } from "./schedule";

export type CampaignSuccessEvaluation =
  | { id: string; eventType: CampaignMetricType; metric: "count"; targetCount: number; currentCount: number; met: boolean }
  | { id: string; eventType: CampaignMetricType; metric: "value"; targetValue: number; currency: string; currentValue: number; met: boolean };

export function evaluateCampaignSuccess(
  criteria: readonly CampaignSuccessCriterion[],
  totals: Readonly<Record<string, { count: number }>>,
  currencyTotals: Readonly<Record<string, Readonly<Record<string, number>>>> = {},
): { criteria: readonly CampaignSuccessEvaluation[]; allCriteriaMet: boolean } {
  const evaluated: CampaignSuccessEvaluation[] = criteria.map((criterion) => {
    if (criterion.metric === "value") {
      const currentValue = currencyTotals[criterion.eventType]?.[criterion.currency] ?? 0;
      return { ...criterion, metric: "value", currentValue, met: currentValue >= criterion.targetValue };
    }
    const currentCount = totals[criterion.eventType]?.count ?? 0;
    return { ...criterion, metric: "count", currentCount, met: currentCount >= criterion.targetCount };
  });
  return { criteria: evaluated, allCriteriaMet: evaluated.length > 0 && evaluated.every((criterion) => criterion.met) };
}

export const POLICY_SCOPES = [
  "workspace",
  "brand",
  "smartSource",
  "audience",
  "platform",
  "campaign",
  "post",
] as const;

export type PolicyScope = (typeof POLICY_SCOPES)[number];
export type PolicyOverrideSet<T> = Partial<Record<PolicyScope, T>>;

export interface CandidateItem {
  stableForSeconds: number;
  relatedFileCount: number;
  markers: readonly string[];
  aiRecommendation?: {
    ready: boolean;
    confidence: number;
  };
}

export interface ReadinessDecision {
  ready: boolean;
  mode: ReadinessMode;
  reason: string;
  missingRequirements: readonly string[];
}

export interface ContextFactCandidate {
  id: string;
  factKey: string;
  value: unknown;
  sourceId: string;
}

export interface ContextFactResolution {
  factKey: string;
  status: "resolved" | "conflicted" | "unresolved";
  value?: unknown;
  selectedCandidateIds: readonly string[];
  conflictingCandidateIds: readonly string[];
  reason: string;
}

export function resolveContextFacts(
  factKeys: readonly string[],
  candidates: readonly ContextFactCandidate[],
  rules: readonly import("./index").ContextAuthorityRule[],
): readonly ContextFactResolution[] {
  return [...new Set(factKeys)].sort().map((factKey) => {
    const matching = candidates.filter((candidate) => candidate.factKey === factKey && candidate.value !== undefined);
    if (matching.length === 0) {
      return {
        factKey,
        status: "unresolved" as const,
        selectedCandidateIds: [],
        conflictingCandidateIds: [],
        reason: "No source provides a value for this fact.",
      };
    }
    const groups = groupByValue(matching);
    if (groups.size === 1) {
      return {
        factKey,
        status: "resolved" as const,
        value: matching[0]!.value,
        selectedCandidateIds: matching.map((candidate) => candidate.id),
        conflictingCandidateIds: [],
        reason: matching.length === 1 ? "One source provides this fact." : "All sources agree on this fact.",
      };
    }
    const rule = rules.find((candidate) => candidate.factKey === factKey);
    if (rule?.resolution === "prefer_authority") {
      const preferred = matching.filter((candidate) => rule.preferredSourceIds.includes(candidate.sourceId));
      const preferredGroups = groupByValue(preferred);
      if (preferred.length > 0 && preferredGroups.size === 1) {
        return {
          factKey,
          status: "resolved" as const,
          value: preferred[0]!.value,
          selectedCandidateIds: preferred.map((candidate) => candidate.id),
          conflictingCandidateIds: matching.filter((candidate) => !preferred.includes(candidate)).map((candidate) => candidate.id),
          reason: "An explicit authority rule selected the preferred source value.",
        };
      }
    }
    return {
      factKey,
      status: "conflicted" as const,
      selectedCandidateIds: [],
      conflictingCandidateIds: matching.map((candidate) => candidate.id),
      reason: rule?.resolution === "prefer_authority"
        ? "Preferred sources conflict or do not provide a value; review is required."
        : "Sources disagree and no explicit authority rule resolves the conflict.",
    };
  });
}

function groupByValue(candidates: readonly ContextFactCandidate[]): Map<string, ContextFactCandidate[]> {
  const groups = new Map<string, ContextFactCandidate[]>();
  for (const candidate of candidates) {
    const key = canonicalJson(candidate.value);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  return groups;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface CampaignGraphIssue {
  code: "empty_graph" | "duplicate_step" | "reserved_step" | "missing_dependency" | "self_dependency" | "cycle" | "invalid_schedule" | "invalid_retry";
  stepId?: string;
  message: string;
}

export interface CampaignGraphValidation {
  valid: boolean;
  issues: readonly CampaignGraphIssue[];
  executionOrder: readonly string[];
}

export interface CampaignExecutionIssue {
  code: "autonomy_execution_disabled" | "reserved_step" | "unsupported_schedule" | "unsupported_condition" | "unsupported_delay" | "invalid_schedule";
  stepId?: string;
  message: string;
}

/** Activation/runtime checks are separate from authoring so unsupported plans remain editable. */
export function validateCampaignExecution(
  autonomyMode: string,
  steps: readonly CampaignStep[],
  options: { allowBoundedScheduling?: boolean } = {},
): readonly CampaignExecutionIssue[] {
  const issues: CampaignExecutionIssue[] = [];
  if (!["approval_required", "approve_uncertain", "approve_first_occurrence", "campaign_approval", "confidence_based", "fully_autonomous", "custom"].includes(autonomyMode)) {
    issues.push({ code: "autonomy_execution_disabled", message: "This campaign's autonomy mode does not authorize execution. Keep it for drafting or select an execution mode before activation." });
  }
  for (const step of steps) {
    try {
      if (normalizeDependencyDelaySeconds(step.dependencyDelaySeconds, step.dependsOn) > 0 && !options.allowBoundedScheduling) {
        issues.push({ code: "unsupported_delay", stepId: step.id, message: `Step ${step.name} has a dependency delay. Its plan is preserved, but delayed execution requires the new scheduler before activation.` });
      }
    } catch (error) {
      issues.push({ code: "invalid_schedule", stepId: step.id, message: error instanceof Error ? error.message : "Dependency delay is invalid." });
    }
    if (step.id === "__campaign__") {
      issues.push({ code: "reserved_step", stepId: step.id, message: "The step ID __campaign__ is reserved for campaign approval. Choose another step ID." });
    }
    if (Object.keys(step.condition ?? {}).length > 0) {
      issues.push({ code: "unsupported_condition", stepId: step.id, message: `Step ${step.name} has an execution condition that is not implemented. Its saved condition is preserved; conditional execution cannot be activated yet.` });
    }
    const schedule = step.scheduleType ?? "immediate";
    if (!["immediate", "exact_time", "dependency"].includes(schedule) && !(options.allowBoundedScheduling && schedule === "preferred_window")) {
      issues.push({ code: "unsupported_schedule", stepId: step.id, message: `Step ${step.name} uses ${schedule.replaceAll("_", " ")} scheduling, which is not implemented. Its saved plan is preserved; choose immediate, exact time, or dependency scheduling before activation.` });
    } else {
      try {
        if (schedule === "exact_time") parseScheduleInstant(step.scheduledAt);
        if (schedule === "preferred_window" && parseScheduleInstant(step.preferredWindowStart) >= parseScheduleInstant(step.preferredWindowEnd)) {
          throw new RangeError("Preferred-window steps require an ordered start and end.");
        }
      } catch (error) {
        issues.push({ code: "invalid_schedule", stepId: step.id, message: error instanceof Error ? error.message : "Schedule bounds are invalid." });
      }
    }
  }
  return issues;
}

/** Without reviewed confidence/history evidence, conditional approval modes cannot waive review. */
export function campaignStepRequiresApproval(autonomyMode: string, step: CampaignStep): boolean {
  if (step.approvalRequired || step.operationType === "request_approval") return true;
  if (step.operationType === "wait") return false;
  return autonomyMode !== "fully_autonomous" && autonomyMode !== "custom" && autonomyMode !== "campaign_approval";
}

export function validateCampaignGraph(steps: readonly CampaignStep[]): CampaignGraphValidation {
  const issues: CampaignGraphIssue[] = [];
  if (steps.length === 0) issues.push({ code: "empty_graph", message: "A campaign requires at least one step." });
  const byId = new Map<string, CampaignStep>();
  for (const step of steps) {
    if (step.id === "__campaign__") issues.push({ code: "reserved_step", stepId: step.id, message: "The step ID __campaign__ is reserved for campaign approval. Choose another step ID." });
    if (byId.has(step.id)) issues.push({ code: "duplicate_step", stepId: step.id, message: `Step ID ${step.id} is duplicated.` });
    else byId.set(step.id, step);
    if (step.dependsOn.includes(step.id)) issues.push({ code: "self_dependency", stepId: step.id, message: "A step cannot depend on itself." });
    for (const dependency of step.dependsOn) {
      if (!steps.some((candidate) => candidate.id === dependency)) issues.push({ code: "missing_dependency", stepId: step.id, message: `Dependency ${dependency} does not exist.` });
    }
    try {
      normalizeDependencyDelaySeconds(step.dependencyDelaySeconds, step.dependsOn);
      if (step.scheduleType === "exact_time") parseScheduleInstant(step.scheduledAt);
      if (step.scheduleType === "preferred_window"
        && parseScheduleInstant(step.preferredWindowStart) >= parseScheduleInstant(step.preferredWindowEnd)) {
        throw new RangeError("Preferred-window steps require an ordered start and end.");
      }
    } catch (error) {
      issues.push({ code: "invalid_schedule", stepId: step.id, message: error instanceof Error ? error.message : "Schedule bounds are invalid." });
    }
    if ((step.maxAttempts ?? 3) < 1 || (step.maxAttempts ?? 3) > 10 || (step.timeoutSeconds ?? 300) < 1) {
      issues.push({ code: "invalid_retry", stepId: step.id, message: "Retries must be 1–10 and timeoutSeconds must be positive." });
    }
  }
  const executionOrder: string[] = [];
  const indegree = new Map([...byId.keys()].map((id) => [id, 0]));
  const outgoing = new Map([...byId.keys()].map((id) => [id, [] as string[]]));
  for (const step of byId.values()) for (const dependency of step.dependsOn) if (byId.has(dependency) && dependency !== step.id) {
    indegree.set(step.id, (indegree.get(step.id) ?? 0) + 1);
    outgoing.get(dependency)!.push(step.id);
  }
  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id).sort();
  while (ready.length) {
    const id = ready.shift()!; executionOrder.push(id);
    for (const dependent of outgoing.get(id) ?? []) {
      const next = (indegree.get(dependent) ?? 1) - 1; indegree.set(dependent, next);
      if (next === 0) { ready.push(dependent); ready.sort(); }
    }
  }
  if (executionOrder.length !== byId.size && !issues.some((issue) => issue.code === "duplicate_step")) {
    issues.push({ code: "cycle", message: "Campaign dependencies contain a cycle." });
  }
  return { valid: issues.length === 0, issues, executionOrder };
}

export function resolveScopedValue<T>(overrides: PolicyOverrideSet<T>): T | undefined {
  for (const scope of [...POLICY_SCOPES].reverse()) {
    const value = overrides[scope];
    if (value !== undefined) return value;
  }

  return undefined;
}

export const COMMUNICATION_POLICY_LEVELS = ["workspace", "brand", "audience", "destination", "campaign", "action"] as const;
export type CommunicationPolicyLevel = (typeof COMMUNICATION_POLICY_LEVELS)[number];

export interface CommunicationPolicyInput {
  source: string;
  level: CommunicationPolicyLevel;
  /** SQL NULL and omitted settings both mean no value at this policy level. */
  informationDepth?: InformationDepth | null;
  informationDepthCeiling?: Exclude<InformationDepth, "custom"> | null;
  promotionalStrength?: PromotionalStrength | null;
  promotionalStrengthCeiling?: Exclude<PromotionalStrength, "custom"> | null;
}

export interface CommunicationPolicyResolution {
  informationDepth?: InformationDepth;
  promotionalStrength?: PromotionalStrength;
  informationDepthSource?: string;
  promotionalStrengthSource?: string;
  informationDepthCeiling?: Exclude<InformationDepth, "custom">;
  promotionalStrengthCeiling?: Exclude<PromotionalStrength, "custom">;
  issues: readonly { code: "information_depth_ceiling" | "promotional_strength_ceiling"; source: string; message: string }[];
}

const informationDepthRank: Record<Exclude<InformationDepth, "custom">, number> = {
  minimal: 0, teaser: 1, contextual: 2, detailed: 3, comprehensive: 4,
};
const promotionalStrengthRank: Record<Exclude<PromotionalStrength, "custom">, number> = {
  informational: 0, subtle: 1, light: 2, standard: 3, strong: 4, campaign_push: 5,
};

/**
 * Resolves explicit communication controls using workspace < brand < audience < destination < campaign < action.
 * Multiple inputs at the same level are reduced to the least-intensive value and ceiling so a mixed audience
 * cannot silently weaken another selected audience's guardrail. Custom values require no active ordinal ceiling.
 */
export function resolveCommunicationPolicy(inputs: readonly CommunicationPolicyInput[]): CommunicationPolicyResolution {
  const ordered = [...inputs].sort((left, right) => COMMUNICATION_POLICY_LEVELS.indexOf(left.level) - COMMUNICATION_POLICY_LEVELS.indexOf(right.level));
  const infoSelection = selectMostSpecific<InformationDepth>(ordered, "informationDepth", informationDepthRank);
  const promoSelection = selectMostSpecific<PromotionalStrength>(ordered, "promotionalStrength", promotionalStrengthRank);
  const infoCeiling = selectCeiling(ordered, "informationDepthCeiling", informationDepthRank);
  const promoCeiling = selectCeiling(ordered, "promotionalStrengthCeiling", promotionalStrengthRank);
  const issues: CommunicationPolicyResolution["issues"][number][] = [];
  if (infoSelection && infoCeiling && (infoSelection.value === "custom" || informationDepthRank[infoSelection.value] > informationDepthRank[infoCeiling.value])) {
    issues.push({ code: "information_depth_ceiling", source: infoCeiling.source, message: `Information depth ${infoSelection.value} exceeds the ${infoCeiling.value} ceiling from ${infoCeiling.source}.` });
  }
  if (promoSelection && promoCeiling && (promoSelection.value === "custom" || promotionalStrengthRank[promoSelection.value] > promotionalStrengthRank[promoCeiling.value])) {
    issues.push({ code: "promotional_strength_ceiling", source: promoCeiling.source, message: `Promotional strength ${promoSelection.value} exceeds the ${promoCeiling.value} ceiling from ${promoCeiling.source}.` });
  }
  return {
    ...(infoSelection ? { informationDepth: infoSelection.value, informationDepthSource: infoSelection.source } : {}),
    ...(promoSelection ? { promotionalStrength: promoSelection.value, promotionalStrengthSource: promoSelection.source } : {}),
    ...(infoCeiling ? { informationDepthCeiling: infoCeiling.value } : {}),
    ...(promoCeiling ? { promotionalStrengthCeiling: promoCeiling.value } : {}),
    issues,
  };
}

function selectMostSpecific<T extends string>(inputs: readonly CommunicationPolicyInput[], field: "informationDepth" | "promotionalStrength", rank: Record<Exclude<T, "custom">, number>): { value: T; source: string } | undefined {
  for (const level of [...COMMUNICATION_POLICY_LEVELS].reverse()) {
    const candidates = inputs.filter((input) => input.level === level && input[field] != null).map((input) => ({ value: input[field] as T, source: input.source }));
    if (!candidates.length) continue;
    return candidates.sort((left, right) => {
      if (left.value === "custom") return 1;
      if (right.value === "custom") return -1;
      return rank[left.value as Exclude<T, "custom">] - rank[right.value as Exclude<T, "custom">];
    })[0];
  }
  return undefined;
}

function selectCeiling<T extends string>(inputs: readonly CommunicationPolicyInput[], field: "informationDepthCeiling" | "promotionalStrengthCeiling", rank: Record<T, number>): { value: T; source: string } | undefined {
  return inputs.filter((input) => input[field] != null).map((input) => ({ value: input[field] as T, source: input.source }))
    .sort((left, right) => rank[left.value] - rank[right.value])[0];
}

export function evaluateReadiness(
  source: Pick<
    SmartSource,
    | "readinessMode"
    | "stabilizationWindowSeconds"
    | "relatedFileMinimum"
    | "readyMarker"
    | "aiConfidenceThreshold"
  >,
  candidate: CandidateItem,
): ReadinessDecision {
  if (candidate.stableForSeconds < source.stabilizationWindowSeconds) {
    const remaining = source.stabilizationWindowSeconds - candidate.stableForSeconds;
    return decision(source.readinessMode, false, `Waiting ${remaining} more seconds for the item to stabilize.`, [
      "stabilization_window",
    ]);
  }

  switch (source.readinessMode) {
    case "immediate":
      return decision("immediate", true, "The item is stable and immediate processing is enabled.");
    case "related_files": {
      const minimum = source.relatedFileMinimum ?? 1;
      const ready = candidate.relatedFileCount >= minimum;
      return decision(
        "related_files",
        ready,
        ready
          ? `Found ${candidate.relatedFileCount} related files.`
          : `Waiting for ${minimum - candidate.relatedFileCount} more related files.`,
        ready ? [] : ["related_files"],
      );
    }
    case "ready_marker": {
      const marker = source.readyMarker?.trim();
      if (!marker) {
        return decision("ready_marker", false, "No ready marker is configured.", ["ready_marker_configuration"]);
      }
      const ready = candidate.markers.includes(marker);
      return decision(
        "ready_marker",
        ready,
        ready ? `Found the configured marker: ${marker}.` : `Waiting for the configured marker: ${marker}.`,
        ready ? [] : ["ready_marker"],
      );
    }
    case "ai_recommended": {
      const threshold = source.aiConfidenceThreshold ?? 0.8;
      const recommendation = candidate.aiRecommendation;
      if (!recommendation) {
        return decision("ai_recommended", false, "An AI readiness recommendation has not completed.", [
          "ai_recommendation",
        ]);
      }
      if (!recommendation.ready) {
        return decision("ai_recommended", false, "AI recommends waiting for additional material or review.", [
          "ai_ready_verdict",
        ]);
      }
      if (recommendation.confidence < threshold) {
        return decision(
          "ai_recommended",
          false,
          `AI confidence ${recommendation.confidence.toFixed(2)} is below the ${threshold.toFixed(2)} threshold.`,
          ["ai_confidence_threshold"],
        );
      }
      return decision(
        "ai_recommended",
        true,
        `AI recommends readiness with ${recommendation.confidence.toFixed(2)} confidence.`,
      );
    }
  }
}

function decision(
  mode: ReadinessMode,
  ready: boolean,
  reason: string,
  missingRequirements: readonly string[] = [],
): ReadinessDecision {
  return { ready, mode, reason, missingRequirements };
}
