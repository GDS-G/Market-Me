import type { WorkspaceRole } from "./models";

/** Only existing non-owner collaborators; neither owner transfer nor new membership. */
export const MANAGED_MEMBER_ROLES = Object.freeze(["admin", "editor", "approver", "analyst", "viewer"] as const);
export type ManagedMemberRole = (typeof MANAGED_MEMBER_ROLES)[number];
export const WORKSPACE_MEMBER_ROLE_LIMITS = Object.freeze({ reason: 500, requestBytes: 4_096, pageSize: 50, maxPage: 2_000 });
const ERROR_BRAND = Symbol.for("@market-me/database/WorkspaceMemberRoleError/v1");
export class WorkspaceMemberRoleError extends Error {
  readonly [ERROR_BRAND] = true;
  constructor(readonly code: "invalid_input" | "access_denied" | "not_found" | "protected_member" | "request_conflict" | "revision_conflict", message: string) {
    super(message); this.name = "WorkspaceMemberRoleError";
  }
}
export function isWorkspaceMemberRoleError(error: unknown): error is WorkspaceMemberRoleError {
  return error instanceof Error && Reflect.get(error, ERROR_BRAND) === true;
}
export interface WorkspaceMemberRoleRequest {
  workspaceId: string;
  targetUserId: string;
  requestId: string;
  expectedRevision: number;
  newRole: ManagedMemberRole;
  reason: string;
}
/** Original completed outcome, never perpetual authority or a live member-state claim. */
export interface WorkspaceMemberRoleReceipt {
  workspaceId: string;
  targetUserId: string;
  requestId: string;
  previousRole: ManagedMemberRole;
  newRole: ManagedMemberRole;
  revision: number;
  reason: string;
  createdAt: string;
}
export interface ManagedWorkspaceMember {
  userId: string;
  displayName: string;
  role: WorkspaceRole;
  revision: number;
  canChangeRole: boolean;
}
export interface ManagedWorkspaceMemberPage {
  workspaceId: string;
  page: number;
  more: boolean;
  canManage: boolean;
  members: readonly ManagedWorkspaceMember[];
}
export function workspaceMemberRoleUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())) {
    throw new WorkspaceMemberRoleError("invalid_input", "Provide valid workspace, member and request identifiers.");
  }
  return value.trim().toLowerCase();
}
export function normalizeWorkspaceMemberRoleRequest(input: unknown): WorkspaceMemberRoleRequest {
  const invalid = (message: string): never => { throw new WorkspaceMemberRoleError("invalid_input", message); };
  if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) invalid("Provide ordinary JSON role-change settings.");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) {
    invalid("Role changes cannot contain hidden fields or accessors.");
  }
  const raw = input as Record<string, unknown>, allowed = new Set(["workspaceId", "targetUserId", "requestId", "expectedRevision", "newRole", "reason"]);
  if (Object.keys(raw).some(key => !allowed.has(key))) invalid("Role changes cannot include additional permissions or authority.");
  if (!MANAGED_MEMBER_ROLES.includes(raw.newRole as ManagedMemberRole)) invalid("Choose a supported non-owner workspace role.");
  if (typeof raw.expectedRevision !== "number" || !Number.isInteger(raw.expectedRevision) || raw.expectedRevision < 1 || raw.expectedRevision > 2_147_483_647) {
    invalid("Provide the positive saved member-role revision.");
  }
  if (typeof raw.reason !== "string" || /[\u0000-\u001f\u007f]/u.test(raw.reason)) invalid("Provide a brief reason without control characters.");
  const reason = (raw.reason as string).normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!reason || reason.length > WORKSPACE_MEMBER_ROLE_LIMITS.reason) invalid("Use a role-change reason of 1–500 characters.");
  const request: WorkspaceMemberRoleRequest = { workspaceId: workspaceMemberRoleUuid(raw.workspaceId), targetUserId: workspaceMemberRoleUuid(raw.targetUserId),
    requestId: workspaceMemberRoleUuid(raw.requestId), expectedRevision: raw.expectedRevision as number, newRole: raw.newRole as ManagedMemberRole, reason };
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > WORKSPACE_MEMBER_ROLE_LIMITS.requestBytes) invalid("Role-change settings exceed the request limit.");
  return Object.freeze(request);
}
