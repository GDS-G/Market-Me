import { packageWorkPage, packageWorkUuid, type PackageWorkDraft, type PackageWorkRun } from "@market-me/database";

export function packageWorkQuery(query: Record<string, string | string[] | undefined>): number {
  if (Object.keys(query).some(key => key !== "page")) throw new Error("Unsupported package work query.");
  if (query.page === undefined) return 1;
  if (typeof query.page !== "string" || !/^[1-9]\d{0,3}$/.test(query.page)) throw new Error("Invalid package work page.");
  return packageWorkPage(Number(query.page));
}
export function packageWorkPath(packageId: string, page = 1): string {
  const id = packageWorkUuid(packageId), selected = packageWorkPage(page);
  return `/content-packages/${id}/work${selected === 1 ? "" : `?page=${selected}`}`;
}
export const PACKAGE_WORK_DRAFT_LABELS: Readonly<Record<NonNullable<PackageWorkDraft["current"]>["status"], string>> = Object.freeze({
  working: "Working copy", pending_review: "Waiting for review", approved: "Marked approved", rejected: "Review rejected", changes_requested: "Changes requested", archived: "Archived",
});
export const PACKAGE_WORK_RUN_LABELS: Readonly<Record<PackageWorkRun["status"], string>> = Object.freeze({
  awaiting_approval: "Waiting for workflow approval", scheduled: "Scheduled", active: "In progress", paused: "Paused", completed: "Marked completed", failed: "Could not complete", canceled: "Canceled",
});
