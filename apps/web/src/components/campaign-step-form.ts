import type { CampaignStep, CampaignStepType, ExecutionMethod, ScheduleType } from "@market-me/domain";

/** Editable projection. Hidden advanced fields must survive a normal form save. */
export interface StepDraft {
  id: string;
  name: string;
  operationType: CampaignStepType;
  capability: string;
  dependsOn: string;
  approvalRequired: boolean;
  scheduleType: ScheduleType;
  scheduledAt: string;
  preferredWindowStart: string;
  preferredWindowEnd: string;
  condition: string;
  executionMethods: ExecutionMethod[];
  optional: boolean;
  maxAttempts: number;
  timeoutSeconds: number;
  inputs: string;
  outputs: string;
}

// datetime-local carries no zone. These controls are explicitly UTC, never browser-local.
export function toUtcDateTimeInput(instant?: string): string {
  return instant ? new Date(instant).toISOString().slice(0, -1) : "";
}

export function fromUtcDateTimeInput(value: string): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) {
    throw new Error("Schedule times must be valid UTC date and time values.");
  }
  const iso = new Date(`${value}Z`).toISOString();
  // Reject normalized impossible calendar dates instead of moving the scheduled day.
  if (!iso.startsWith(value)) throw new Error("Schedule times must be valid UTC date and time values.");
  return iso;
}

export function toStepDraft(step: CampaignStep): StepDraft {
  return {
    id: step.id, name: step.name, operationType: step.operationType ?? "manual_handoff",
    capability: step.desiredCapability, dependsOn: step.dependsOn.join(", "),
    approvalRequired: step.approvalRequired, scheduleType: step.scheduleType ?? "immediate",
    scheduledAt: toUtcDateTimeInput(step.scheduledAt),
    preferredWindowStart: toUtcDateTimeInput(step.preferredWindowStart),
    preferredWindowEnd: toUtcDateTimeInput(step.preferredWindowEnd),
    condition: JSON.stringify(step.condition ?? {}, null, 2),
    executionMethods: [...step.executionMethods], optional: step.optional ?? false,
    maxAttempts: step.maxAttempts ?? 3, timeoutSeconds: step.timeoutSeconds ?? 300,
    inputs: JSON.stringify(step.inputs, null, 2), outputs: JSON.stringify(step.outputs, null, 2),
  };
}

function objectJson(value: string, field: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${field} must be a JSON object.`);
  return parsed as Record<string, unknown>;
}

export function serializeStepDraft(step: StepDraft): CampaignStep {
  return {
    id: step.id, name: step.name, operationType: step.operationType,
    desiredCapability: step.capability,
    dependsOn: step.dependsOn.split(",").map((value) => value.trim()).filter(Boolean),
    inputs: objectJson(step.inputs, "Step inputs"), outputs: objectJson(step.outputs, "Step outputs"),
    executionMethods: [...step.executionMethods], approvalRequired: step.approvalRequired,
    scheduleType: step.scheduleType, scheduledAt: fromUtcDateTimeInput(step.scheduledAt),
    preferredWindowStart: fromUtcDateTimeInput(step.preferredWindowStart),
    preferredWindowEnd: fromUtcDateTimeInput(step.preferredWindowEnd),
    condition: objectJson(step.condition, "Schedule condition"),
    maxAttempts: step.maxAttempts, timeoutSeconds: step.timeoutSeconds, optional: step.optional,
  };
}
