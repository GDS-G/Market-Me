import { z } from "zod";

// No database runtime imports: browser validation is independent, never authority.
export const MEMBER_ROLE_CHOICES = Object.freeze(["admin", "editor", "approver", "analyst", "viewer"] as const);
export type MemberRole = (typeof MEMBER_ROLE_CHOICES)[number];
export const MEMBER_ROLE_DESCRIPTIONS: Readonly<Record<MemberRole, string>> = Object.freeze({
  admin: "Workspace administration, member invitations and non-owner role changes, content writing and eligible approvals. Does not grant organization ownership.",
  editor: "Workspace content writing and preparation. Does not grant team administration or approval authority.",
  approver: "Workspace reading and eligible approval decisions. Does not grant content writing or team administration.",
  analyst: "Read access for analysis. Currently has no additional writer, approval or team-administration permission.",
  viewer: "Workspace read access without writer, approval or team-administration permission.",
});
export const MEMBER_ROLE_BROWSER_LIMITS = Object.freeze({ reason: 500, requestBytes: 4_096, recoveryBytes: 8_192, responseBytes: 8_192 });
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const revision = z.number().int().min(1).max(2_147_483_647), role = z.enum(MEMBER_ROLE_CHOICES);
export function normalizeMemberRoleReason(value: string) {
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error("Use a brief one-line reason without control characters.");
  const reason = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!reason || reason.length > MEMBER_ROLE_BROWSER_LIMITS.reason) throw new Error("Use a role-change reason of 1–500 characters.");
  return reason;
}
const reason = z.string().min(1).max(MEMBER_ROLE_BROWSER_LIMITS.reason).refine(value => {
  try { return normalizeMemberRoleReason(value) === value; } catch { return false; }
});
const requestSchema = z.strictObject({ workspaceId: uuid, targetUserId: uuid, requestId: uuid, expectedRevision: revision, newRole: role, reason });
const attemptSchema = z.strictObject({ version: z.literal(1), userId: uuid, previousRole: role, request: requestSchema });
const receiptSchema = z.strictObject({ workspaceId: uuid, targetUserId: uuid, requestId: uuid, previousRole: role, newRole: role,
  revision: revision.min(2), reason, createdAt: z.iso.datetime() });
export type MemberRoleRequest = z.infer<typeof requestSchema>;
export type MemberRoleAttempt = z.infer<typeof attemptSchema>;
export type MemberRoleReceipt = z.infer<typeof receiptSchema>;
export type MemberRoleScope = { userId: string; workspaceId: string };
type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const size = (value: string) => new TextEncoder().encode(value).byteLength;
export function memberRoleStorageKey(scope: MemberRoleScope) {
  return `market-me:workspace-member-role:v1:${uuid.parse(scope.userId)}:${uuid.parse(scope.workspaceId)}`;
}
function checkScope(attempt: MemberRoleAttempt, scope: MemberRoleScope) {
  if (attempt.userId !== scope.userId || attempt.request.workspaceId !== scope.workspaceId || attempt.request.targetUserId === scope.userId) {
    throw new Error("Saved role change belongs to another account/workspace or targets your own membership.");
  }
  if (attempt.previousRole === attempt.request.newRole) throw new Error("Choose a different role.");
  if (size(JSON.stringify(attempt.request)) > MEMBER_ROLE_BROWSER_LIMITS.requestBytes) throw new Error("Role-change request is too large.");
  Object.freeze(attempt.request); return Object.freeze(attempt);
}
export function makeMemberRoleAttempt(scope: MemberRoleScope, previousRole: MemberRole, request: MemberRoleRequest): MemberRoleAttempt {
  return checkScope(attemptSchema.parse({ version: 1, userId: scope.userId, previousRole, request }), scope);
}
export function restoreMemberRoleAttempt(serialized: string | null, scope: MemberRoleScope): MemberRoleAttempt | undefined {
  if (serialized === null) return undefined;
  if (size(serialized) > MEMBER_ROLE_BROWSER_LIMITS.recoveryBytes) throw new Error("Saved role change is too large.");
  return checkScope(attemptSchema.parse(JSON.parse(serialized)), scope);
}
/** One retained request per account/workspace, including attempts for other members. */
export function persistMemberRoleAttempt(storage: RecoveryStorage, scope: MemberRoleScope, attempt: MemberRoleAttempt): MemberRoleAttempt {
  const valid = checkScope(attemptSchema.parse(attempt), scope), key = memberRoleStorageKey(scope);
  const prior = restoreMemberRoleAttempt(storage.getItem(key), scope), serialized = JSON.stringify(valid);
  if (prior && JSON.stringify(prior) !== serialized) throw new Error("Another member-role request is saved. Reload and recover it first.");
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error("Recovery storage did not retain the exact request. Nothing was sent.");
  return valid;
}
export function clearMemberRoleAttempt(storage: RecoveryStorage, scope: MemberRoleScope, retained: string | null | undefined) {
  const key = memberRoleStorageKey(scope);
  if (retained === undefined || storage.getItem(key) !== retained) throw new Error("Recovery data changed or could not be read. Reload before clearing it.");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("Recovery storage was not cleared.");
}
export function memberRoleLookupPath(attempt: MemberRoleAttempt) {
  return `/api/v1/workspace-member-roles?${new URLSearchParams({ workspaceId: attempt.request.workspaceId, requestId: attempt.request.requestId })}`;
}
export function parseMemberRoleReceipt(value: unknown, attempt: MemberRoleAttempt): MemberRoleReceipt {
  const receipt = receiptSchema.parse(value), request = attempt.request;
  if (receipt.workspaceId !== request.workspaceId || receipt.targetUserId !== request.targetUserId || receipt.requestId !== request.requestId
    || receipt.previousRole !== attempt.previousRole || receipt.newRole !== request.newRole || receipt.reason !== request.reason
    || receipt.revision !== request.expectedRevision + 1) throw new Error("Result does not match the exact saved member-role change.");
  return receipt;
}
export async function readMemberRoleResponse(response: Response): Promise<unknown> {
  const maximum = MEMBER_ROLE_BROWSER_LIMITS.responseBytes;
  if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
    || Number(response.headers.get("content-length")) > maximum || !response.body) throw new Error("Invalid member-role response.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new Error("Member-role response is too large."); } chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { reader.releaseLock(); }
}
const resultSchema = z.strictObject({ data: receiptSchema, meta: z.strictObject({ replayed: z.boolean() }).optional() });
const errorSchema = z.strictObject({ error: z.strictObject({ code: z.string().min(1).max(80), message: z.string().min(1).max(1_000) }) });
export async function runMemberRoleAttempt(storage: RecoveryStorage, scope: MemberRoleScope, attempt: MemberRoleAttempt,
  lookup: boolean, send: typeof fetch = fetch): Promise<MemberRoleReceipt> {
  const exact = persistMemberRoleAttempt(storage, scope, attempt);
  const response = await send(lookup ? memberRoleLookupPath(exact) : "/api/v1/workspace-member-roles", lookup
    ? { method: "GET", cache: "no-store" }
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(exact.request), cache: "no-store" });
  const payload = await readMemberRoleResponse(response);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(payload);
    throw new Error(parsed.success ? parsed.data.error.message : "No confirmed result. Check or retry the saved request; do not assume it failed.");
  }
  if (response.status !== 200 && response.status !== 201) throw new Error("Unrecognized role-change result. Recover the saved request.");
  return parseMemberRoleReceipt(resultSchema.parse(payload).data, exact);
}
