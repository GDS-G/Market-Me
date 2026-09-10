import { describe, expect, it } from "vitest";
import type { CampaignStep } from "@market-me/domain";
import { fromUtcDateTimeInput, serializeStepDraft, toStepDraft, toUtcDateTimeInput } from "./campaign-step-form";

const step: CampaignStep = {
  id: "followup", name: "Follow up", operationType: "manual_handoff", desiredCapability: "manual.handoff",
  dependsOn: ["publish"], inputs: { text: "Review first" }, outputs: { receipt: "string" },
  dependencyDelaySeconds: 3600,
  executionMethods: ["user_assisted", "manual_handoff"], approvalRequired: true,
  scheduleType: "follow_up", scheduledAt: "2026-09-12T10:30:42.125Z",
  preferredWindowStart: "2026-09-12T10:00:00.000Z", preferredWindowEnd: "2026-09-12T11:00:00.000Z",
  condition: { when: "no_response", afterSeconds: 3600 }, optional: true, maxAttempts: 2, timeoutSeconds: 120,
};

describe("Campaign step form round trip", () => {
  it("defaults a legacy missing delay to zero without changing its UTC times", () => {
    const legacy = { ...step, dependencyDelaySeconds: undefined };
    expect(serializeStepDraft(toStepDraft(legacy))).toEqual({ ...step, dependencyDelaySeconds: 0 });
  });
  it.each([-1, 0.5, NaN, Infinity, 31_536_001, "60", null])("rejects invalid delay %s without coercing or dropping it", (delay) => {
    expect(() => serializeStepDraft({ ...toStepDraft(step), dependencyDelaySeconds: delay as number })).toThrow("Dependency delay");
  });
  it("requires a predecessor for a positive delay and preserves window milliseconds on rename", () => {
    expect(() => serializeStepDraft({ ...toStepDraft(step), dependsOn: " , " })).toThrow("requires at least one dependency");
    const window = { ...step, preferredWindowStart: "2026-09-12T10:00:01.125Z", preferredWindowEnd: "2026-09-12T11:00:02.875Z" };
    expect(serializeStepDraft({ ...toStepDraft(window), name: "Rename" })).toEqual({ ...window, name: "Rename" });
  });
  it("preserves advanced schedule data, execution methods and optionality", () => {
    expect(serializeStepDraft(toStepDraft(step))).toEqual(step);
  });
  it("does not change an absolute time or discard seconds during an unrelated edit", () => {
    const draft = toStepDraft({ ...step, scheduledAt: "2026-09-12T05:30:42.125-05:00" });
    expect(draft.scheduledAt).toBe("2026-09-12T10:30:42.125");
    expect(serializeStepDraft({ ...draft, name: "Renamed" }).scheduledAt).toBe(step.scheduledAt);
  });
  it("treats new input as UTC and never the browser timezone", () => {
    expect(fromUtcDateTimeInput("2026-09-12T10:30")).toBe("2026-09-12T10:30:00.000Z");
    expect(fromUtcDateTimeInput("")).toBeUndefined();
    expect(toUtcDateTimeInput()).toBe("");
    expect(() => fromUtcDateTimeInput("2026-02-30T10:00")).toThrow();
    expect(() => fromUtcDateTimeInput("2026-09-12T10:30Z")).toThrow();
  });
  it("rejects non-object advanced data without silently erasing it", () => {
    expect(() => serializeStepDraft({ ...toStepDraft(step), condition: "[]" })).toThrow("JSON object");
    expect(() => serializeStepDraft({ ...toStepDraft(step), inputs: "null" })).toThrow("JSON object");
  });
});
