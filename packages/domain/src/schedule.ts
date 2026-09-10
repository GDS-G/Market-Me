import type { CampaignStep, CampaignStepStatus } from "./index";

export const MAX_DEPENDENCY_DELAY_SECONDS = 31_536_000;

export type StepScheduleInput = Pick<CampaignStep,
  "dependsOn" | "scheduleType" | "scheduledAt" | "preferredWindowStart" | "preferredWindowEnd" | "dependencyDelaySeconds">;

export interface StepSchedulePredecessor {
  stepKey: string;
  status: CampaignStepStatus;
  /** First durable success/partial-success time, from the same instance and pinned version. */
  completedAt?: string;
}

type ScheduleBounds = { notBefore?: string; deadline?: string };
export type StepScheduleState =
  | ({ state: "waiting_dependencies"; missingDependencies: readonly string[] } & ScheduleBounds)
  | { state: "waiting_until"; notBefore: string; deadline?: string }
  | ({ state: "ready" } & ScheduleBounds)
  | { state: "expired"; reason: "deadline_reached" | "no_legal_time"; deadline: string; notBefore?: string };

export function normalizeDependencyDelaySeconds(value: unknown, dependencies: readonly string[]): number {
  const delay = value === undefined ? 0 : value;
  if (typeof delay !== "number" || !Number.isSafeInteger(delay) || delay < 0 || delay > MAX_DEPENDENCY_DELAY_SECONDS) {
    throw new RangeError("Dependency delay must be an integer from 0 through 31536000 seconds.");
  }
  if (delay > 0 && dependencies.length === 0) throw new RangeError("A positive dependency delay requires at least one dependency.");
  return delay;
}

/** Parse an absolute ISO instant without accepting locale dates or normalized invalid calendar days. */
export function parseScheduleInstant(value: unknown): number {
  if (typeof value !== "string") throw new RangeError("Schedule times must be absolute ISO instants.");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) throw new RangeError("Schedule times must be absolute ISO instants with an explicit timezone.");
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day
    || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59) {
    throw new RangeError("Schedule time contains an invalid calendar date or clock time.");
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new RangeError("Schedule time is invalid.");
  return timestamp;
}

/** Earliest-legal-start evaluation only: no provider dispatch, recurrence, slot allocation or browser clock. */
export function evaluateStepSchedule(
  step: StepScheduleInput,
  predecessors: readonly StepSchedulePredecessor[],
  now: number,
): StepScheduleState {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new RangeError("The evaluation clock must be a finite timestamp.");
  const delay = normalizeDependencyDelaySeconds(step.dependencyDelaySeconds, step.dependsOn) * 1_000;
  const schedule = step.scheduleType ?? "immediate";
  let lower: number | undefined;
  let upper: number | undefined;
  if (schedule === "exact_time") lower = parseScheduleInstant(step.scheduledAt);
  else if (schedule === "preferred_window") {
    lower = parseScheduleInstant(step.preferredWindowStart);
    upper = parseScheduleInstant(step.preferredWindowEnd);
    if (lower >= upper) throw new RangeError("A preferred window requires its start before its end.");
  } else if (schedule !== "immediate" && schedule !== "dependency") {
    throw new RangeError(`Schedule type ${schedule} does not have an implemented evaluator.`);
  }

  const missingDependencies: string[] = [];
  for (const key of new Set(step.dependsOn)) {
    const matching = predecessors.filter((candidate) => candidate.stepKey === key);
    // Duplicate evidence is not a reason to pick a convenient completion.
    if (matching.length !== 1) { missingDependencies.push(key); continue; }
    const predecessor = matching[0]!;
    if (!(["succeeded", "partially_succeeded"] as const).some((status) => predecessor.status === status)
      || predecessor.completedAt === undefined) { missingDependencies.push(key); continue; }
    const eligibleAt = parseScheduleInstant(predecessor.completedAt) + delay;
    if (!Number.isFinite(new Date(eligibleAt).getTime())) throw new RangeError("Dependency delay exceeds the supported timestamp range.");
    lower = Math.max(lower ?? -Infinity, eligibleAt);
  }
  const bounds = {
    ...(lower === undefined ? {} : { notBefore: new Date(lower).toISOString() }),
    ...(upper === undefined ? {} : { deadline: new Date(upper).toISOString() }),
  };
  if (upper !== undefined && (now >= upper || (lower !== undefined && lower >= upper))) {
    return { state: "expired", reason: now >= upper ? "deadline_reached" : "no_legal_time", ...bounds, deadline: new Date(upper).toISOString() };
  }
  if (missingDependencies.length) return { state: "waiting_dependencies", ...bounds, missingDependencies };
  if (lower !== undefined && now < lower) return { state: "waiting_until", ...bounds, notBefore: new Date(lower).toISOString() };
  return { state: "ready", ...bounds };
}
