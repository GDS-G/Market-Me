import type { SmartSource } from "./index";
import { evaluateReadiness } from "./policies";
import { classifySourceIntake, type SourceIntakeDecision } from "./source-intake-filter";

export const SOURCE_SAMPLE_LIMIT = 200;
export type SourceSampleConfiguration = Pick<SmartSource, "allowedMimeTypes" | "ignorePatterns" | "recursive"
  | "readinessMode" | "stabilizationWindowSeconds" | "relatedFileMinimum" | "readyMarker" | "aiConfidenceThreshold">;
export interface SourceSampleItem {
  /** Stable only inside this capture; never an action/approval capability. */
  key: string;
  parentKey?: string;
  name: string;
  displayPath: string;
  mimeType: string;
  isFolder: boolean;
  modifiedAt?: string;
  lastSeenAt?: string;
}
export type SourceSampleOutcome = "folder" | "ignored" | "ready_for_analysis" | "waiting" | "unknown" | "review_required";
export interface SourceSampleExplanation {
  index: number;
  name: string;
  displayPath: string;
  mimeType: string;
  outcome: SourceSampleOutcome;
  reason: string;
  filter: SourceIntakeDecision;
  stableForSeconds?: number;
  /** Visible indexes, not provider IDs. The root itself counts toward readiness. */
  relatedItemIndexes: readonly number[];
  missingRequirements: readonly string[];
}
export interface SourceSampleSimulation {
  evaluatedAt: string;
  partial: boolean;
  items: readonly SourceSampleExplanation[];
  counts: { inspected: number; folders: number; ignored: number; eligibleFiles: number; readyForAnalysis: number; waiting: number; unknown: number; reviewRequired: number };
  /** This only describes the dry test, never predicted production/monthly spending. */
  aiRequests: 0;
  futureProcessingCost: null;
}

/** Metadata-only planning. No I/O, random identity, persistence, extraction or AI. */
export function simulateSourceSample(source: SourceSampleConfiguration, sample: readonly SourceSampleItem[], options: {
  now: Date;
  partial: boolean;
}): SourceSampleSimulation {
  if (!Number.isFinite(options.now.getTime()) || sample.length > SOURCE_SAMPLE_LIMIT || new Set(sample.map((item) => item.key)).size !== sample.length) {
    throw new Error("Source sample must have a valid clock and at most 200 uniquely identified items.");
  }
  if (sample.some((item) => !item.key || item.key.length > 500 || (item.parentKey?.length ?? 0) > 500 || item.name.length > 512
    || item.displayPath.length > 4_096 || item.mimeType.length > 200)
    || source.ignorePatterns.some((pattern) => pattern.includes("?") || pattern.includes("\u0000"))) {
    throw new Error("This sample contains unsupported metadata or legacy filter expressions.");
  }
  const matchingWork = source.ignorePatterns.reduce((sum, pattern) => sum + pattern.length, 0)
    * sample.reduce((sum, item) => sum + 2 * item.displayPath.length + item.name.length + 1, 0);
  if (matchingWork > 10_000_000) throw new Error("This source exceeds the bounded dry-test filter work limit.");
  const filters = sample.map((item) => classifySourceIntake(source, item, item.displayPath));
  const groups = new Map<string, number[]>();
  for (let index = 0; index < sample.length; index++) {
    const item = sample[index]!;
    if (item.isFolder || !filters[index]!.eligible || item.parentKey === undefined) continue;
    const siblings = groups.get(item.parentKey) ?? [];
    siblings.push(index); groups.set(item.parentKey, siblings);
  }
  const items = sample.map((item, index): SourceSampleExplanation => {
    const filter = filters[index]!;
    const base = { index, name: item.name, displayPath: item.displayPath, mimeType: item.mimeType, filter,
      relatedItemIndexes: [] as number[], missingRequirements: [] as string[] };
    if (item.isFolder) return { ...base, outcome: "folder", reason: source.recursive
      ? "Folder metadata only. Recursion is configured, but this bounded test does not enter this folder."
      : "Folder metadata only. Subfolders are not included by this source." };
    if (!filter.eligible) return { ...base, outcome: "ignored", reason: filter.exclusions.includes("mime_type")
      ? "The file's MIME type is not included in the saved source filters."
      : "The filename or displayed path matches a saved exclusion pattern." };
    const relatedItemIndexes = item.parentKey === undefined ? [index] : groups.get(item.parentKey) ?? [index];
    const timestamp = item.modifiedAt ?? item.lastSeenAt;
    const modifiedMs = timestamp === undefined ? Number.NaN : new Date(timestamp).getTime();
    if (!Number.isFinite(modifiedMs)) return { ...base, relatedItemIndexes, outcome: "unknown",
      reason: "No usable modification or index timestamp is available; settling cannot be established from this sample.", missingRequirements: ["settling_timestamp"] };
    if (modifiedMs > options.now.getTime()) return { ...base, relatedItemIndexes, outcome: "unknown", stableForSeconds: 0,
      reason: "The modification timestamp is in the future. Check the provider or desktop clock before relying on settling.", missingRequirements: ["settling_timestamp"] };
    const stableForSeconds = Math.floor((options.now.getTime() - modifiedMs) / 1000);
    const decision = evaluateReadiness(source, { stableForSeconds, relatedFileCount: relatedItemIndexes.length,
      markers: relatedItemIndexes.map((sibling) => sample[sibling]!.name) });
    if (decision.ready) return { ...base, relatedItemIndexes, stableForSeconds, outcome: "ready_for_analysis", reason: decision.reason };
    if (source.readinessMode === "ai_recommended") return { ...base, relatedItemIndexes, stableForSeconds, outcome: "review_required",
      reason: "This test does not request an AI recommendation. Existing intake prepares a package needing review when that recommendation is unavailable.",
      missingRequirements: decision.missingRequirements };
    const uncertainSupport = decision.missingRequirements.some((requirement) => requirement === "related_files" || requirement === "ready_marker")
      && (options.partial || item.parentKey === undefined);
    return { ...base, relatedItemIndexes, stableForSeconds, outcome: uncertainSupport ? "unknown" : "waiting",
      reason: uncertainSupport ? "Supporting files or the marker are not established by this bounded sample; they may exist outside its known scope." : decision.reason,
      missingRequirements: decision.missingRequirements };
  });
  const count = (outcome: SourceSampleOutcome) => items.filter((item) => item.outcome === outcome).length;
  return { evaluatedAt: options.now.toISOString(), partial: options.partial, items,
    counts: { inspected: items.length, folders: count("folder"), ignored: count("ignored"), eligibleFiles: items.length - count("folder") - count("ignored"),
      readyForAnalysis: count("ready_for_analysis"), waiting: count("waiting"), unknown: count("unknown"), reviewRequired: count("review_required") },
    aiRequests: 0, futureProcessingCost: null };
}
