import type { WorkspaceRole } from "./models";

export const PACKAGE_WORK_PAGE_SIZE = 10;
export const PACKAGE_WORK_MAX_PAGE = 1000;
export const PACKAGE_WORK_MAX_DRAFTS = 20;
export const PACKAGE_WORK_RUN_LIMIT = 5;
export const PACKAGE_WORK_JSON_LIMIT = 524288;
const roles = Object.freeze(["owner", "admin", "editor", "approver", "analyst", "viewer"] as const);
export const PACKAGE_WORK_DRAFT_STATES = Object.freeze(["working", "pending_review", "approved", "rejected", "changes_requested", "archived"] as const);
export const PACKAGE_WORK_RUN_STATES = Object.freeze(["awaiting_approval", "scheduled", "active", "paused", "completed", "failed", "canceled"] as const);
const packageStates = Object.freeze(["detecting", "stabilizing", "analyzing", "needs_review", "ready", "approved", "executing", "completed", "failed"] as const);

export interface PackageWorkDraft {
  readonly draftId: string; readonly initialVersionId: string; readonly audienceLabel: string;
  readonly current: Readonly<{ versionId: string; versionNumber: number; status: (typeof PACKAGE_WORK_DRAFT_STATES)[number] }> | null;
}
export interface PackageWorkRun { readonly id: string; readonly status: (typeof PACKAGE_WORK_RUN_STATES)[number]; readonly createdAt: string }
export interface PackageWorkFinalization {
  readonly id: string; readonly finalizedVersionId: string; readonly selectedDraftId: string;
  readonly selectedDraftVersionId: string; readonly createdAt: string; readonly runs: readonly PackageWorkRun[]; readonly hasMoreRuns: boolean;
}
export interface PackageWorkPreparation {
  readonly id: string; readonly campaignId: string; readonly campaignName: string;
  readonly packageVersion: number; readonly createdAt: string; readonly drafts: readonly PackageWorkDraft[];
  readonly finalization: PackageWorkFinalization | null;
}
export interface PackageWorkSnapshot {
  readonly workspaceId: string; readonly packageId: string; readonly title: string; readonly packageVersion: number;
  readonly packageStatus: (typeof packageStates)[number]; readonly role: WorkspaceRole; readonly observedAt: string;
  readonly page: number; readonly hasMore: boolean; readonly preparations: readonly PackageWorkPreparation[];
}

function unavailable(): never { throw new Error("The package work snapshot is unavailable."); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return unavailable();
  return value as Record<string, unknown>;
}
export function packageWorkUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())) return unavailable();
  return value.trim().toLowerCase();
}
function positive(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 2147483647) return unavailable(); return value; }
export function packageWorkPage(value: unknown = 1): number { const page = positive(value); if (page > PACKAGE_WORK_MAX_PAGE) return unavailable(); return page; }
function label(value: unknown): string { if (typeof value !== "string" || value.length > 800) return unavailable(); return value; }
function time(value: unknown): string {
  if (!(value instanceof Date) && typeof value !== "string") return unavailable();
  const date = new Date(value); if (!Number.isFinite(date.getTime())) return unavailable(); return date.toISOString();
}
function choice<T extends string>(value: unknown, values: readonly T[]): T { if (typeof value !== "string" || !values.includes(value as T)) return unavailable(); return value as T; }
function list(value: unknown, limit: number): unknown[] { if (!Array.isArray(value) || value.length > limit) return unavailable(); return value; }
function unique(values: readonly string[]): void { if (new Set(values).size !== values.length) unavailable(); }
function draft(value: unknown): PackageWorkDraft {
  const row = object(value), current = row.current === null ? null : object(row.current);
  return Object.freeze({ draftId: packageWorkUuid(row.draftId), initialVersionId: packageWorkUuid(row.initialVersionId), audienceLabel: label(row.audienceLabel),
    current: current ? Object.freeze({ versionId: packageWorkUuid(current.versionId), versionNumber: positive(current.versionNumber), status: choice(current.status, PACKAGE_WORK_DRAFT_STATES) }) : null });
}
function finalization(value: unknown, drafts: readonly PackageWorkDraft[]): PackageWorkFinalization | null {
  if (value === null) return null;
  const row = object(value);
  const selectedDraftId = packageWorkUuid(row.selectedDraftId);
  if (!drafts.some(d => d.draftId === selectedDraftId)) return unavailable();
  const runs = list(row.runs, PACKAGE_WORK_RUN_LIMIT + 1).map(value => {
    const run = object(value); return Object.freeze({ id: packageWorkUuid(run.id), status: choice(run.status, PACKAGE_WORK_RUN_STATES), createdAt: time(run.createdAt) });
  });
  unique(runs.map(r => r.id));
  return Object.freeze({ id: packageWorkUuid(row.id), finalizedVersionId: packageWorkUuid(row.finalizedVersionId), selectedDraftId,
    selectedDraftVersionId: packageWorkUuid(row.selectedDraftVersionId), createdAt: time(row.createdAt),
    runs: Object.freeze(runs.slice(0, PACKAGE_WORK_RUN_LIMIT)), hasMoreRuns: runs.length > PACKAGE_WORK_RUN_LIMIT });
}
function preparation(value: unknown): PackageWorkPreparation {
  const row = object(value); if (row.lineageValid !== true) return unavailable();
  const drafts = list(row.drafts, PACKAGE_WORK_MAX_DRAFTS).map(draft); if (!drafts.length) return unavailable(); unique(drafts.map(d => d.draftId));
  return Object.freeze({ id: packageWorkUuid(row.id), campaignId: packageWorkUuid(row.campaignId), campaignName: label(row.campaignName),
    packageVersion: positive(row.packageVersion), createdAt: time(row.createdAt), drafts: Object.freeze(drafts), finalization: finalization(row.finalization, drafts) });
}
/** Raw nested JSON is selected as text, avoiding postgres.camel rewriting historical JSON keys. */
export function packageWorkSnapshot(row: Record<string, unknown>, page: number): PackageWorkSnapshot {
  if (typeof row.preparationsJson !== "string" || Buffer.byteLength(row.preparationsJson, "utf8") > PACKAGE_WORK_JSON_LIMIT) return unavailable();
  const preparations = list(JSON.parse(row.preparationsJson), PACKAGE_WORK_PAGE_SIZE + 1).map(preparation); unique(preparations.map(p => p.id)); unique(preparations.map(p => p.campaignId));
  return Object.freeze({ workspaceId: packageWorkUuid(row.workspaceId), packageId: packageWorkUuid(row.packageId), title: label(row.title),
    packageVersion: positive(row.packageVersion), packageStatus: choice(row.packageStatus, packageStates), role: choice(row.role, roles), observedAt: time(row.observedAt),
    page: packageWorkPage(page), hasMore: preparations.length > PACKAGE_WORK_PAGE_SIZE, preparations: Object.freeze(preparations.slice(0, PACKAGE_WORK_PAGE_SIZE)) });
}
