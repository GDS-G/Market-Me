import { createHash } from "node:crypto";
import type { WorkspaceRole } from "./models";

/** Removal ends one grant, never the account or its historical workspace identity. */
export const WORKSPACE_MEMBER_LIFECYCLE_LIMITS = Object.freeze({ reason: 500, requestBytes: 4_096, revision: 2_147_483_647 });
const ERROR_BRAND = Symbol.for("@market-me/database/WorkspaceMemberLifecycleError/v1");
export class WorkspaceMemberLifecycleError extends Error {
  readonly [ERROR_BRAND] = true;
  constructor(readonly code: "invalid_input" | "access_denied" | "not_found" | "protected_member" | "revision_conflict" | "request_conflict" | "impact_conflict" | "unresolved_dependencies", message: string) {
    super(message); this.name = "WorkspaceMemberLifecycleError";
  }
}
export function isWorkspaceMemberLifecycleError(value: unknown): value is WorkspaceMemberLifecycleError {
  return value instanceof Error && Reflect.get(value, ERROR_BRAND) === true;
}
export interface WorkspaceMemberRemovalRequest {
  workspaceId: string;
  targetUserId: string;
  requestId: string;
  expectedIncarnationId: string;
  expectedRevision: number;
  impactFingerprint: string;
  reason: string;
}
export const WORKSPACE_MEMBER_IMPACT_KEYS = Object.freeze([
  "assignedConversations", "enabledRoutingRules", "openConversationReviews", "pendingCampaignApprovals",
  "pendingIncomingInvitations", "pendingIssuedInvitations", "enabledSourceBindings", "queuedSourceCommands",
  "preparedAiIntents", "activeCampaignRuns", "ownedDestinations",
] as const);
export type WorkspaceMemberImpactKey = (typeof WORKSPACE_MEMBER_IMPACT_KEYS)[number];
/** Exact counts, never rounded Number values or lists of private work contents. */
export type WorkspaceMemberImpact = Readonly<Record<WorkspaceMemberImpactKey, string>>;
export interface WorkspaceMemberGrant {
  userId: string;
  displayName: string;
  role: WorkspaceRole;
  incarnationId: string;
  revision: number;
}
/** Historical original outcome; does not assert that the person has not rejoined. */
export interface WorkspaceMemberRemovalReceipt extends WorkspaceMemberRemovalRequest {
  previousRole: Exclude<WorkspaceRole, "owner">;
  revision: number;
  revokedAt: string;
  impact: WorkspaceMemberImpact;
}
export interface WorkspaceMemberRemovalPreview {
  workspaceId: string;
  target: WorkspaceMemberGrant;
  observedAt: string;
  impact: WorkspaceMemberImpact;
  impactFingerprint: string;
  blocked: boolean;
}
export function workspaceMemberImpactFingerprint(workspaceId: string, actorIncarnationId: string, target: Pick<WorkspaceMemberGrant, "userId" | "incarnationId" | "revision">, impact: WorkspaceMemberImpact): string {
  // A stale-preview fence, not an authentication credential or secret signature.
  return createHash("sha256").update(JSON.stringify(["member-removal-impact-v1", workspaceMemberLifecycleUuid(workspaceId),
    workspaceMemberLifecycleUuid(actorIncarnationId),
    workspaceMemberLifecycleUuid(target.userId), workspaceMemberLifecycleUuid(target.incarnationId), target.revision,
    WORKSPACE_MEMBER_IMPACT_KEYS.map(key => [key, impact[key]])])).digest("hex");
}
export function workspaceMemberLifecycleUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new WorkspaceMemberLifecycleError("invalid_input", "Provide canonical workspace, member, grant and request identifiers.");
  }
  return value.toLowerCase();
}
export function normalizeWorkspaceMemberRemovalRequest(input: unknown): WorkspaceMemberRemovalRequest {
  const invalid = (): never => { throw new WorkspaceMemberLifecycleError("invalid_input", "Review one current member and provide a brief reason before removing access."); };
  if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = new Set(["workspaceId", "targetUserId", "requestId", "expectedIncarnationId", "expectedRevision", "impactFingerprint", "reason"]);
  const names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.size || names.some(key => typeof key !== "string" || !keys.has(key)
    || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) invalid();
  const raw = input as Record<string, unknown>;
  if (typeof raw.expectedRevision !== "number" || !Number.isInteger(raw.expectedRevision)
    || raw.expectedRevision < 1 || raw.expectedRevision >= WORKSPACE_MEMBER_LIFECYCLE_LIMITS.revision) invalid();
  if (typeof raw.reason !== "string" || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(raw.reason)) invalid();
  if (typeof raw.impactFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(raw.impactFingerprint)) invalid();
  const reason = (raw.reason as string).normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!reason || reason.length > WORKSPACE_MEMBER_LIFECYCLE_LIMITS.reason) invalid();
  const request: WorkspaceMemberRemovalRequest = {
    workspaceId: workspaceMemberLifecycleUuid(raw.workspaceId), targetUserId: workspaceMemberLifecycleUuid(raw.targetUserId),
    requestId: workspaceMemberLifecycleUuid(raw.requestId), expectedIncarnationId: workspaceMemberLifecycleUuid(raw.expectedIncarnationId),
    expectedRevision: raw.expectedRevision as number, impactFingerprint: raw.impactFingerprint as string, reason,
  };
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > WORKSPACE_MEMBER_LIFECYCLE_LIMITS.requestBytes) invalid();
  return Object.freeze(request);
}
