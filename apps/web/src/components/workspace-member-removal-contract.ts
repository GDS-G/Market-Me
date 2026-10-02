import { z } from "zod";

// Deliberately independent browser contracts: no SQL/Node runtime or client authority.
export const MEMBER_REMOVAL_BROWSER_LIMITS = Object.freeze({ reason: 500, requestBytes: 4_096, responseBytes: 16_384, timeoutMs: 15_000, revision: 2_147_483_647 });
export const MEMBER_REMOVAL_IMPACT_LABELS = Object.freeze({
  assignedConversations: "Unresolved conversations assigned to this member",
  enabledRoutingRules: "Enabled inbox routing rules targeting this member",
  openConversationReviews: "Open conversation reviews assigned to this member",
  pendingCampaignApprovals: "Pending campaign approvals assigned to this member",
  pendingIncomingInvitations: "Unexpired pending invitations for this member",
  pendingIssuedInvitations: "Unexpired pending invitations issued by this member",
  enabledSourceBindings: "Enabled source preparation bindings using this member",
  queuedSourceCommands: "Pending, processing or failed source preparation commands using this member",
  preparedAiIntents: "Unexpired prepared AI intents attributed to this member",
  activeCampaignRuns: "Awaiting-approval, scheduled, active or paused campaigns requested by this member",
  ownedDestinations: "Non-archived destinations owned by this member",
});
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const revision = z.number().int().min(1).max(MEMBER_REMOVAL_BROWSER_LIMITS.revision);
const role = z.enum(["admin", "editor", "approver", "analyst", "viewer"]), fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.string().max(19).regex(/^(0|[1-9]\d*)$/);
const impact = z.strictObject({ assignedConversations: count, enabledRoutingRules: count, openConversationReviews: count, pendingCampaignApprovals: count,
  pendingIncomingInvitations: count, pendingIssuedInvitations: count, enabledSourceBindings: count, queuedSourceCommands: count,
  preparedAiIntents: count, activeCampaignRuns: count, ownedDestinations: count });
const preview = z.strictObject({ workspaceId: uuid, target: z.strictObject({ userId: uuid, displayName: z.string().min(1).max(500), role, incarnationId: uuid, revision }),
  observedAt: z.iso.datetime(), impact, impactFingerprint: fingerprint, blocked: z.boolean(),
}).refine(value => value.blocked === (value.impact.pendingIncomingInvitations !== "0" || value.impact.pendingIssuedInvitations !== "0"));
export function normalizeMemberRemovalReason(value: string): string {
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) throw new Error("Use a one-line reason without control or hidden formatting characters.");
  const reason = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!reason || reason.length > MEMBER_REMOVAL_BROWSER_LIMITS.reason) throw new Error("Use a removal reason of 1–500 characters.");
  return reason;
}
const reason = z.string().min(1).max(500).refine(value => { try { return normalizeMemberRemovalReason(value) === value; } catch { return false; } });
const request = z.strictObject({ workspaceId: uuid, targetUserId: uuid, requestId: uuid, expectedIncarnationId: uuid,
  expectedRevision: revision.max(MEMBER_REMOVAL_BROWSER_LIMITS.revision - 1), impactFingerprint: fingerprint, reason });
const receipt = request.extend({ previousRole: role, revision: revision.min(2), revokedAt: z.iso.datetime(), impact });
const envelope = z.strictObject({ data: receipt, meta: z.strictObject({ replayed: z.boolean() }).optional() });
export type MemberRemovalScope = Readonly<{ userId: string; workspaceId: string }>;
export type MemberRemovalPreview = z.infer<typeof preview>;
export type MemberRemovalRequest = Readonly<z.infer<typeof request>>;
export type MemberRemovalReceipt = z.infer<typeof receipt>;
export type MemberRemovalAttempt = Readonly<{ userId: string; preview: MemberRemovalPreview; request: MemberRemovalRequest }>;
export function parseMemberRemovalPreview(value: unknown, scope: MemberRemovalScope, targetUserId: string): MemberRemovalPreview {
  const result = preview.parse(value);
  if (result.workspaceId !== uuid.parse(scope.workspaceId) || result.target.userId !== uuid.parse(targetUserId) || result.target.userId === uuid.parse(scope.userId)) {
    throw new Error("Reload the selected member in your current workspace.");
  }
  Object.freeze(result.target); Object.freeze(result.impact); return Object.freeze(result);
}
export function makeMemberRemovalAttempt(scope: MemberRemovalScope, snapshot: MemberRemovalPreview, requestId: string, note: string): MemberRemovalAttempt {
  const exact = parseMemberRemovalPreview(snapshot, scope, snapshot.target.userId);
  if (exact.blocked || exact.target.revision >= MEMBER_REMOVAL_BROWSER_LIMITS.revision) throw new Error("Resolve the member's blocking conditions before removing access.");
  const intent = request.parse({ workspaceId: exact.workspaceId, targetUserId: exact.target.userId, requestId, expectedIncarnationId: exact.target.incarnationId,
    expectedRevision: exact.target.revision, impactFingerprint: exact.impactFingerprint, reason: normalizeMemberRemovalReason(note) });
  if (new TextEncoder().encode(JSON.stringify(intent)).byteLength > MEMBER_REMOVAL_BROWSER_LIMITS.requestBytes) throw new Error("The removal request exceeds its size limit.");
  return Object.freeze({ userId: uuid.parse(scope.userId), preview: exact, request: Object.freeze(intent) });
}
function checkAttempt(attempt: MemberRemovalAttempt, scope: MemberRemovalScope) {
  if (attempt.userId !== scope.userId) throw new Error("This original request belongs to another account.");
  const exact = makeMemberRemovalAttempt(scope, attempt.preview, attempt.request.requestId, attempt.request.reason);
  if (JSON.stringify(request.parse(attempt.request)) !== JSON.stringify(exact.request)) throw new Error("The original request no longer matches its reviewed member.");
  return exact;
}
export function memberRemovalLookupPath(intent: MemberRemovalRequest): string {
  const exact = request.parse(intent); return `/api/v1/workspace-member-removals?${new URLSearchParams({ workspaceId: exact.workspaceId, requestId: exact.requestId })}`;
}
export function parseMemberRemovalReceipt(value: unknown, attempt: MemberRemovalAttempt): MemberRemovalReceipt {
  const result = receipt.parse(value), original = attempt.request;
  if (Object.keys(original).some(key => result[key as keyof MemberRemovalRequest] !== original[key as keyof MemberRemovalRequest])
    || result.previousRole !== attempt.preview.target.role || result.revision !== original.expectedRevision + 1
    || Object.keys(MEMBER_REMOVAL_IMPACT_LABELS).some(key => result.impact[key as keyof typeof MEMBER_REMOVAL_IMPACT_LABELS] !== attempt.preview.impact[key as keyof typeof MEMBER_REMOVAL_IMPACT_LABELS])) {
    throw new Error("The result does not match the exact original member-removal request and reviewed impact.");
  }
  return result;
}
export async function readMemberRemovalResponse(response: Response): Promise<unknown> {
  const maximum = MEMBER_REMOVAL_BROWSER_LIMITS.responseBytes;
  if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
    || Number(response.headers.get("content-length")) > maximum || !response.body) throw new Error("No valid member-removal result was received.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new Error("The member-removal result exceeds its size limit."); } chunks.push(part.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { reader.releaseLock(); }
}
function failedResponse(status: number, lookup: boolean): never {
  if (status === 401 || status === 403) throw new Error("Your current account or workspace authority changed. Sign in again and reload Team.");
  if (status === 404) throw new Error(lookup ? "No confirmed original result was found. The earlier request may still finish; checking never resends it." : "The selected member is no longer available. Reload Team.");
  if (status === 409) throw new Error("The selected grant, impact or request conflicts. Check any original result, then reload Team for a fresh review.");
  throw new Error("No confirmed result was received. Check any original request before another removal action.");
}
export async function loadMemberRemovalPreview(scope: MemberRemovalScope, targetUserId: string, signal: AbortSignal, send: typeof fetch = fetch): Promise<MemberRemovalPreview> {
  const query = new URLSearchParams({ workspaceId: uuid.parse(scope.workspaceId), targetUserId: uuid.parse(targetUserId) }); uuid.parse(scope.userId);
  signal.throwIfAborted();
  const response = await send(`/api/v1/workspace-member-removals?${query}`, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal });
  const payload = await readMemberRemovalResponse(response); signal.throwIfAborted();
  if (!response.ok) failedResponse(response.status, false); if (response.status !== 200) throw new Error("Unrecognized member preview result.");
  return parseMemberRemovalPreview(z.strictObject({ data: preview }).parse(payload).data, scope, targetUserId);
}
export async function runMemberRemovalAttempt(attempt: MemberRemovalAttempt, scope: MemberRemovalScope, lookup: boolean, signal: AbortSignal, send: typeof fetch = fetch): Promise<MemberRemovalReceipt> {
  const exact = checkAttempt(attempt, scope); signal.throwIfAborted();
  const response = await send(lookup ? memberRemovalLookupPath(exact.request) : "/api/v1/workspace-member-removals", {
    method: lookup ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    ...(lookup ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(exact.request) }),
  });
  const payload = await readMemberRemovalResponse(response); signal.throwIfAborted();
  if (!response.ok) failedResponse(response.status, lookup);
  if (response.status !== 200 && (lookup || response.status !== 201)) throw new Error("Unrecognized original member-removal result.");
  return parseMemberRemovalReceipt(envelope.parse(payload).data, exact);
}
export function createMemberRemovalGate() {
  let active: { controller: AbortController; timer: ReturnType<typeof setTimeout> } | undefined;
  return {
    begin() {
      if (active) return undefined;
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), MEMBER_REMOVAL_BROWSER_LIMITS.timeoutMs), operation = { controller, timer };
      active = operation;
      return { signal: controller.signal, current: () => active === operation && !controller.signal.aborted,
        finish: () => { clearTimeout(timer); if (active === operation) active = undefined; } };
    },
    cancel() { if (active) { clearTimeout(active.timer); active.controller.abort(); active = undefined; } },
  };
}
