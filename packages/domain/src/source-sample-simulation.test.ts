import { describe, expect, it } from "vitest";
import { simulateSourceSample, type SourceSampleConfiguration, type SourceSampleItem } from "./source-sample-simulation";

const source: SourceSampleConfiguration = { allowedMimeTypes: ["text/plain", "image/*"], ignorePatterns: ["**/Drafts/**"], recursive: true,
  readinessMode: "immediate", stabilizationWindowSeconds: 120 };
const now = new Date("2026-10-01T12:00:00.000Z");
const file: SourceSampleItem = { key: "file", parentKey: "folder", name: "launch.txt", displayPath: "/Launches/launch.txt", mimeType: "text/plain",
  isFolder: false, modifiedAt: "2026-10-01T11:00:00.000Z" };
const run = (items: readonly SourceSampleItem[], config: SourceSampleConfiguration = source, partial = false) => simulateSourceSample(config, items, { now, partial });

describe("bounded metadata source simulation", () => {
  it("proposes analysis of each eligible root without claiming a ready package, content extraction, AI spend or activation", () => {
    const result = run([file]);
    expect(result.items[0]).toMatchObject({ outcome: "ready_for_analysis", relatedItemIndexes: [0], stableForSeconds: 3600 });
    expect(result.counts).toEqual({ inspected: 1, folders: 0, ignored: 0, eligibleFiles: 1, readyForAnalysis: 1, waiting: 0, unknown: 0, reviewRequired: 0 });
    expect(result).toMatchObject({ evaluatedAt: now.toISOString(), partial: false, aiRequests: 0, futureProcessingCost: null });
    expect(JSON.stringify(result)).not.toContain('"key"'); expect(JSON.stringify(result)).not.toContain('"parentKey"');
  });
  it("separates traversable folders, excluded files and proposed roots", () => {
    const result = run([file, { ...file, key: "folder", name: "Nested", isFolder: true, mimeType: "folder" },
      { ...file, key: "video", mimeType: "video/mp4" }, { ...file, key: "draft", displayPath: "/Drafts/launch.txt" }]);
    expect(result.items.map((item) => item.outcome)).toEqual(["ready_for_analysis", "folder", "ignored", "ignored"]);
    expect(result.items[1]!.reason).toContain("does not enter"); expect(result.items[2]!.filter.exclusions).toEqual(["mime_type"]);
    expect(result.items[3]!.filter.exclusions).toEqual(["ignored_path"]);
  });
  it("explains nonrecursive folders without traversing them", () => {
    expect(run([{ ...file, isFolder: true }], { ...source, recursive: false }).items[0]!.reason).toContain("not included");
  });
  it.each([false, true])("a settling wait remains definite even when sample partial=%s", (partial) => {
    const result = run([{ ...file, modifiedAt: "2026-10-01T11:59:30.000Z" }], source, partial);
    expect(result.items[0]).toMatchObject({ outcome: "waiting", stableForSeconds: 30, missingRequirements: ["stabilization_window"] });
  });
  it("does not turn future modification times into ready content", () => {
    expect(run([{ ...file, modifiedAt: "2026-10-01T13:00:00.000Z" }], { ...source, stabilizationWindowSeconds: 0 }).items[0]).toMatchObject({ outcome: "unknown", stableForSeconds: 0 });
  });
  it("uses the indexed timestamp fallback only when modification time is absent", () => {
    const withoutModified = { ...file }; delete withoutModified.modifiedAt;
    expect(run([{ ...withoutModified, lastSeenAt: file.modifiedAt! }]).items[0]!.outcome).toBe("ready_for_analysis");
    expect(run([{ ...file, modifiedAt: "invalid", lastSeenAt: file.modifiedAt! }]).items[0]!.outcome).toBe("unknown");
    expect(run([withoutModified]).items[0]!.missingRequirements).toEqual(["settling_timestamp"]);
  });
  it("uses only eligible files in the same observed parent for readiness, with the root included", () => {
    const items = [file, { ...file, key: "support", name: "support.txt" }, { ...file, key: "other", parentKey: "different" },
      { ...file, key: "folder", isFolder: true }, { ...file, key: "ignored", displayPath: "/Drafts/ignored.txt" }];
    const result = run(items, { ...source, readinessMode: "related_files", relatedFileMinimum: 2 });
    expect(result.items[0]).toMatchObject({ outcome: "ready_for_analysis", relatedItemIndexes: [0, 1] });
    expect(result.items[1]).toMatchObject({ outcome: "ready_for_analysis", relatedItemIndexes: [0, 1] });
    expect(result.items[2]).toMatchObject({ outcome: "waiting", relatedItemIndexes: [2] });
    expect(result.counts.readyForAnalysis).toBe(2); // Two possible per-root packages, not one merged package.
  });
  it("does not equate missing support in an incomplete page with absent files", () => {
    const related = { ...source, readinessMode: "related_files" as const, relatedFileMinimum: 2 };
    expect(run([file], related, false).items[0]!.outcome).toBe("waiting");
    expect(run([file], related, true).items[0]!.outcome).toBe("unknown");
    expect(run([file, { ...file, key: "support" }], related, true).items[0]!.outcome).toBe("ready_for_analysis");
  });
  it("does not group unrelated items with unknown parents", () => {
    const items = [file, { ...file, key: "other" }].map((item) => { const copy = { ...item }; delete copy.parentKey; return copy; });
    const result = run(items, { ...source, readinessMode: "related_files", relatedFileMinimum: 2 });
    expect(result.items.map((item) => item.relatedItemIndexes)).toEqual([[0], [1]]);
    expect(result.items.map((item) => item.outcome)).toEqual(["unknown", "unknown"]);
  });
  it("uses the exact existing filename marker rule and exposes incomplete marker coverage", () => {
    const marked = { ...source, readinessMode: "ready_marker" as const, readyMarker: "READY" };
    expect(run([file], marked).items[0]!.outcome).toBe("waiting");
    expect(run([file], marked, true).items[0]!.outcome).toBe("unknown");
    expect(run([file, { ...file, key: "marker", name: "READY" }], marked, true).items[0]!.outcome).toBe("ready_for_analysis");
    expect(run([file, { ...file, key: "marker", name: "ready" }], marked).items[0]!.outcome).toBe("waiting");
  });
  it("keeps unavailable AI recommendation as review, never fabricated confidence", () => {
    const result = run([file], { ...source, readinessMode: "ai_recommended", aiConfidenceThreshold: 0.9 });
    expect(result.items[0]).toMatchObject({ outcome: "review_required", missingRequirements: ["ai_recommendation"] });
    expect(result.aiRequests).toBe(0); expect(result.futureProcessingCost).toBeNull();
  });
  it("returns an honest empty result", () => {
    const result = run([]); expect(result.counts.inspected).toBe(0); expect(result.items).toEqual([]);
  });
  it("rejects oversized, ambiguous or invalid-clock captures without returning partial plans", () => {
    expect(() => run(Array.from({ length: 201 }, (_, index) => ({ ...file, key: String(index) })))).toThrow();
    expect(() => run([file, file])).toThrow();
    expect(() => simulateSourceSample(source, [file], { now: new Date("invalid"), partial: false })).toThrow();
  });
  it("is deterministic and does not mutate the capture", () => {
    const input = Object.freeze([Object.freeze(file)]);
    expect(run(input)).toEqual(run(input)); expect(input[0]).toEqual(file);
  });
  it("bounds metadata and rejects legacy expressions and excessive filter work", () => {
    expect(() => run([{ ...file, name: "x".repeat(513) }])).toThrow();
    expect(() => run([{ ...file, key: "" }])).toThrow();
    expect(() => run([file], { ...source, ignorePatterns: ["a?b"] })).toThrow();
    expect(() => run([file], { ...source, ignorePatterns: ["\u0000"] })).toThrow();
    expect(() => run(Array.from({ length: 200 }, (_, index) => ({ ...file, key: String(index), displayPath: "x".repeat(4_096) })),
      { ...source, ignorePatterns: ["*a".repeat(100)] })).toThrow("filter work limit");
  });
});
