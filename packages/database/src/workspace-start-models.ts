import type { WorkspaceRole } from "./models";

/** Bounded output keys; these are saved-state counts, never execution eligibility. */
export const WORKSPACE_START_COUNT_KEYS = Object.freeze([
  "sourceCount", "enabledSourceCount", "packageCount", "packagesToReview", "approvedPackageCount", "failedPackageCount",
  "draftCount", "draftsToEdit", "approvedDraftCount", "campaignCount", "draftOnlyPlanCount", "otherPublishedPlanCount",
  "runCount", "openRunCount", "attentionRunCount", "completedRunCount", "pendingDraftApprovals", "pendingWorkflowApprovals",
] as const);
export type WorkspaceStartCountKey = (typeof WORKSPACE_START_COUNT_KEYS)[number];
export type WorkspaceStartCounts = Readonly<Record<WorkspaceStartCountKey, number>>;
export type WorkspaceStartSnapshot = WorkspaceStartCounts & {
  readonly workspaceId: string;
  readonly role: WorkspaceRole;
  readonly observedAt: string;
};

const roles: readonly WorkspaceRole[] = Object.freeze(["owner", "admin", "editor", "approver", "analyst", "viewer"]);

export function workspaceStartUuid(value: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())) {
    throw new Error("A valid workspace and authenticated user are required for the start guide.");
  }
  return value.trim().toLowerCase();
}

/** PostgreSQL count(*) is bigint. Reject precision loss instead of displaying a fabricated count. */
export function workspaceStartCount(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^(0|[1-9]\d{0,15})$/.test(value))) {
    throw new Error("The workspace guide count is unavailable.");
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("The workspace guide count is unavailable.");
  return count;
}

export function workspaceStartSnapshot(row: Record<string, unknown>): WorkspaceStartSnapshot {
  if (!roles.includes(row.role as WorkspaceRole)) throw new Error("The workspace guide role is unavailable.");
  const instant = row.observedAt;
  if (!(instant instanceof Date) && typeof instant !== "string") throw new Error("The workspace guide time is unavailable.");
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error("The workspace guide time is unavailable.");
  const counts = Object.fromEntries(WORKSPACE_START_COUNT_KEYS.map(key => [key, workspaceStartCount(row[key])])) as Record<WorkspaceStartCountKey, number>;
  return Object.freeze({ workspaceId: workspaceStartUuid(row.workspaceId as string), role: row.role as WorkspaceRole,
    observedAt: date.toISOString(), ...counts });
}
