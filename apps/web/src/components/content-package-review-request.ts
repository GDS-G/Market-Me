import { z } from "zod";

/** Browser input validation only. The repository rechecks current scope and review bytes. */
export const reviewUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).transform((value) => value.toLowerCase());
export const packageReviewFingerprint = z.string().regex(/^mm-package-review-v1:sha256:[0-9a-f]{64}$/);
export const packageReviewVersion = z.number().int().min(1).max(2_147_483_647);
export const packageReviewPrecondition = {
  workspaceId: reviewUuid,
  expectedVersion: packageReviewVersion,
  expectedReviewFingerprint: packageReviewFingerprint,
};
const approvalInput = z.object({ ...packageReviewPrecondition, packageId: reviewUuid }).strict();
const approvalAttempt = z.object({ version: z.literal(1), userId: reviewUuid, idempotencyKey: reviewUuid, input: approvalInput }).strict();
export type PackageApprovalAttempt = z.infer<typeof approvalAttempt>;
export type PackageApprovalInput = z.infer<typeof approvalInput>;
export interface PackageReviewScope { userId: string; workspaceId: string; packageId: string }

export function packageReviewRequestPath(packageId: string, workspaceId: string): string {
  return `/api/v1/content-packages/${reviewUuid.parse(packageId)}/review?workspaceId=${encodeURIComponent(reviewUuid.parse(workspaceId))}`;
}
export function packageApprovalStorageKey(scope: PackageReviewScope): string {
  return `market-me:package-approval:v1:${scope.userId}:${scope.workspaceId}:${scope.packageId}`;
}
function assertScope(attempt: PackageApprovalAttempt, scope: PackageReviewScope) {
  if (attempt.userId !== scope.userId || attempt.input.workspaceId !== scope.workspaceId || attempt.input.packageId !== scope.packageId) {
    throw new Error("Saved approval belongs to another user, workspace, or package.");
  }
}
export function createPackageApprovalAttempt(scope: PackageReviewScope, input: PackageApprovalInput, idempotencyKey: string): PackageApprovalAttempt {
  const attempt = approvalAttempt.parse({ version: 1, userId: scope.userId, input, idempotencyKey });
  assertScope(attempt, scope);
  return attempt;
}
export function restorePackageApprovalAttempt(raw: string | null, scope: PackageReviewScope): PackageApprovalAttempt | undefined {
  if (raw === null) return undefined;
  const attempt = approvalAttempt.parse(JSON.parse(raw));
  assertScope(attempt, scope);
  return attempt;
}
/** Only the captured precondition and original key may be resent after an uncertain response. */
export function packageApprovalRequest(attempt: PackageApprovalAttempt): string {
  return JSON.stringify({ workspaceId: attempt.input.workspaceId, expectedVersion: attempt.input.expectedVersion,
    expectedReviewFingerprint: attempt.input.expectedReviewFingerprint, idempotencyKey: attempt.idempotencyKey });
}
export async function sendPackageApprovalAttempt(attempt: PackageApprovalAttempt, scope: PackageReviewScope,
  storage: Pick<Storage, "setItem">, send: typeof fetch = fetch): Promise<Response> {
  assertScope(attempt, scope);
  storage.setItem(packageApprovalStorageKey(scope), JSON.stringify(attempt));
  return send(`/api/v1/content-packages/${reviewUuid.parse(attempt.input.packageId)}/approve`, {
    method: "POST", headers: { "content-type": "application/json" }, body: packageApprovalRequest(attempt),
  });
}
export function packageApprovalResultPath(packageId: string, approvalId: string, workspaceId: string): string {
  return `/content-packages/${reviewUuid.parse(packageId)}/approvals/${reviewUuid.parse(approvalId)}?workspaceId=${encodeURIComponent(reviewUuid.parse(workspaceId))}`;
}
export function canApprovePackage(role: string): boolean { return ["owner", "admin", "approver"].includes(role); }
export function canEditPackageAssets(role: string): boolean { return ["owner", "admin", "editor"].includes(role); }

/** Preserve captured microseconds and explicit offset. Validation must not Date-round-trip the value. */
export const reviewRightsInstant = z.string().datetime({ offset: true })
  .regex(/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
