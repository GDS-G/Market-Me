import { describe, expect, it } from "vitest";
import { evaluateStepSchedule, MAX_DEPENDENCY_DELAY_SECONDS, normalizeDependencyDelaySeconds, parseScheduleInstant, type StepScheduleInput } from "./schedule";
import { validateCampaignExecution, validateCampaignGraph } from "./policies";
import type { CampaignStep } from "./index";

const start = "2026-09-10T09:00:00.123Z";
const end = "2026-09-10T10:00:00.456Z";
const startMs = Date.parse(start), endMs = Date.parse(end);
const immediate: StepScheduleInput = { dependsOn: [] };
const window: StepScheduleInput = { dependsOn: [], scheduleType: "preferred_window", preferredWindowStart: start, preferredWindowEnd: end };
const authored: CampaignStep = { id: "publish", name: "Publish", desiredCapability: "publish_content", dependsOn: [], inputs: {}, outputs: {}, executionMethods: ["official_api"], approvalRequired: false };

describe("bounded schedule inputs", () => {
  it("defaults dependency delay to zero and accepts the bounded integer endpoints", () => {
    expect(normalizeDependencyDelaySeconds(undefined, [])).toBe(0);
    expect(normalizeDependencyDelaySeconds(0, [])).toBe(0);
    expect(normalizeDependencyDelaySeconds(MAX_DEPENDENCY_DELAY_SECONDS, ["prepare"])).toBe(MAX_DEPENDENCY_DELAY_SECONDS);
  });

  it.each(["1", null, true, -1, 0.5, NaN, Infinity, -Infinity, 31_536_001, Number.MAX_SAFE_INTEGER])("rejects invalid dependency delay %s", (value) => {
    expect(() => normalizeDependencyDelaySeconds(value, ["prepare"])).toThrow(RangeError);
    expect(validateCampaignGraph([{ ...authored, dependencyDelaySeconds: value as number }]).valid).toBe(false);
  });

  it("requires a predecessor for a positive delay", () => {
    expect(() => normalizeDependencyDelaySeconds(1, [])).toThrow(/requires/);
    expect(() => evaluateStepSchedule({ dependsOn: [], dependencyDelaySeconds: 1 }, [], startMs)).toThrow(/requires/);
  });

  it.each([undefined, "", "invalid", "2026-09-10", "2026-09-10T09:00:00", "2026-02-30T09:00:00Z", "2026-09-10T24:00:00Z", "2026-09-10T09:00:00+99:00"])("rejects non-absolute or invalid instant %s", (value) => {
    expect(() => parseScheduleInstant(value)).toThrow(RangeError);
  });

  it("normalizes explicit offsets and preserves milliseconds", () => {
    expect(parseScheduleInstant("2026-09-10T04:00:00.123-05:00")).toBe(startMs);
  });

  it("keeps bounded scheduling closed by default and only opts into validated structure", () => {
    const delayed = { ...authored, dependsOn: ["prepare"], dependencyDelaySeconds: 5 };
    expect(validateCampaignExecution("fully_autonomous", [delayed])).toEqual([expect.objectContaining({ code: "unsupported_delay" })]);
    expect(validateCampaignExecution("fully_autonomous", [{ ...authored, ...window }])).toEqual([expect.objectContaining({ code: "unsupported_schedule" })]);
    expect(validateCampaignExecution("fully_autonomous", [{ ...delayed, ...window, dependsOn: ["prepare"] }], { allowBoundedScheduling: true })).toEqual([]);
    expect(validateCampaignExecution("fully_autonomous", [{ ...authored, ...window, preferredWindowEnd: start }], { allowBoundedScheduling: true })).toEqual([expect.objectContaining({ code: "invalid_schedule" })]);
    for (const scheduleType of ["recurring", "conditional", "follow_up", "evergreen_queue"] as const) {
      expect(validateCampaignExecution("fully_autonomous", [{ ...authored, scheduleType }], { allowBoundedScheduling: true })).toEqual([expect.objectContaining({ code: "unsupported_schedule" })]);
    }
    expect(validateCampaignExecution("draft_only", [authored], { allowBoundedScheduling: true })).toEqual([expect.objectContaining({ code: "autonomy_execution_disabled" })]);
    expect(validateCampaignExecution("fully_autonomous", [{ ...authored, condition: { active: true } }], { allowBoundedScheduling: true })).toEqual([expect.objectContaining({ code: "unsupported_condition" })]);
  });
});

describe("evaluateStepSchedule", () => {
  it("leaves immediate/default-zero behavior ready without invented bounds", () => {
    expect(evaluateStepSchedule(immediate, [], startMs)).toEqual({ state: "ready" });
  });

  it("treats exact time only as a lower bound, never as expiry", () => {
    const step = { ...immediate, scheduleType: "exact_time" as const, scheduledAt: start };
    expect(evaluateStepSchedule(step, [], startMs - 1)).toEqual({ state: "waiting_until", notBefore: start });
    expect(evaluateStepSchedule(step, [], startMs)).toEqual({ state: "ready", notBefore: start });
    expect(evaluateStepSchedule(step, [], endMs + 1_000_000)).toEqual({ state: "ready", notBefore: start });
  });

  it("evaluates the half-open preferred window at both exact boundaries", () => {
    expect(evaluateStepSchedule(window, [], startMs - 1)).toEqual({ state: "waiting_until", notBefore: start, deadline: end });
    expect(evaluateStepSchedule(window, [], startMs)).toEqual({ state: "ready", notBefore: start, deadline: end });
    expect(evaluateStepSchedule(window, [], endMs - 1)).toEqual({ state: "ready", notBefore: start, deadline: end });
    expect(evaluateStepSchedule(window, [], endMs)).toEqual({ state: "expired", reason: "deadline_reached", notBefore: start, deadline: end });
  });

  it("uses the latest actual required completion plus delay, not unrelated sibling completion", () => {
    const step = { ...window, dependsOn: ["a", "b"], dependencyDelaySeconds: 10 };
    const predecessors = [
      { stepKey: "a", status: "succeeded" as const, completedAt: start },
      { stepKey: "b", status: "partially_succeeded" as const, completedAt: "2026-09-10T09:00:05.789Z" },
      { stepKey: "unrelated", status: "succeeded" as const, completedAt: end },
    ];
    const notBefore = "2026-09-10T09:00:15.789Z";
    expect(evaluateStepSchedule(step, predecessors, startMs)).toEqual({ state: "waiting_until", notBefore, deadline: end });
    expect(evaluateStepSchedule(step, predecessors, Date.parse(notBefore))).toEqual({ state: "ready", notBefore, deadline: end });
  });

  it("does not infer completion from failed, running, duplicate or missing predecessor evidence", () => {
    const step = { ...window, dependsOn: ["missing", "running", "failed", "no-time", "duplicate"] };
    const predecessors = [
      { stepKey: "running", status: "running" as const, completedAt: start },
      { stepKey: "failed", status: "permanently_failed" as const, completedAt: start },
      { stepKey: "no-time", status: "succeeded" as const },
      { stepKey: "duplicate", status: "succeeded" as const, completedAt: start },
      { stepKey: "duplicate", status: "partially_succeeded" as const, completedAt: start },
    ];
    expect(evaluateStepSchedule(step, predecessors, startMs)).toEqual({ state: "waiting_dependencies", notBefore: start, deadline: end, missingDependencies: step.dependsOn });
    expect(evaluateStepSchedule(step, predecessors, endMs)).toMatchObject({ state: "expired", reason: "deadline_reached", deadline: end });
  });

  it("distinguishes an impossible remaining slot from a clock deadline already reached", () => {
    const step = { ...window, dependsOn: ["a"], dependencyDelaySeconds: 3601 };
    expect(evaluateStepSchedule(step, [{ stepKey: "a", status: "succeeded", completedAt: start }], startMs))
      .toMatchObject({ state: "expired", reason: "no_legal_time", deadline: end });
  });

  it.each([NaN, Infinity, -Infinity, 9e20])("rejects invalid authoritative clock %s", (now) => {
    expect(() => evaluateStepSchedule(immediate, [], now)).toThrow(RangeError);
  });

  it("rejects invalid schedule bounds and unsupported algorithms rather than guessing", () => {
    for (const candidate of [{ ...window, preferredWindowEnd: start }, { ...window, preferredWindowStart: "not-a-date" }, { ...window, preferredWindowStart: end, preferredWindowEnd: start }]) {
      expect(() => evaluateStepSchedule(candidate, [], startMs)).toThrow(RangeError);
      expect(validateCampaignGraph([{ ...authored, ...candidate }]).valid).toBe(false);
    }
    expect(() => evaluateStepSchedule({ ...immediate, scheduleType: "recurring" }, [], startMs)).toThrow(/not have an implemented/);
  });
});
