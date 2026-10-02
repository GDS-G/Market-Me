/** Open means this extra hold is absent, not that any work is approved or due. */
export const WORKSPACE_EXECUTION_STATES = Object.freeze(["open", "paused"] as const);
export type WorkspaceExecutionState = (typeof WORKSPACE_EXECUTION_STATES)[number];
export const WORKSPACE_EXECUTION_CONTROL_LIMITS = Object.freeze({
  reason: 500,
  requestBytes: 4_096,
  revision: 2_147_483_647,
});

const ERROR_BRAND = Symbol.for("@market-me/database/WorkspaceExecutionControlError/v1");
export class WorkspaceExecutionControlError extends Error {
  readonly [ERROR_BRAND] = true;
  constructor(
    readonly code: "invalid_input" | "access_denied" | "not_found" | "revision_conflict"
      | "request_conflict" | "state_conflict" | "execution_paused" | "control_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceExecutionControlError";
  }
}
export function isWorkspaceExecutionControlError(value: unknown): value is WorkspaceExecutionControlError {
  return value instanceof Error && Reflect.get(value, ERROR_BRAND) === true;
}

/** Expected actor grant is a stale-review fence, never a client identity/role. */
export interface WorkspaceExecutionControlRequest {
  readonly workspaceId: string;
  readonly requestId: string;
  readonly expectedActorIncarnationId: string;
  readonly expectedRevision: number;
  readonly state: WorkspaceExecutionState;
  readonly reason: string;
}

/** Historical original transition; replay cannot re-open a newer paused state. */
export interface WorkspaceExecutionControlReceipt extends WorkspaceExecutionControlRequest {
  readonly previousState: WorkspaceExecutionState;
  readonly revision: number;
  readonly changedAt: string;
}

/** Minimized current-member read. Only current administrators receive review data. */
export type WorkspaceExecutionControlSnapshot = Readonly<{
  workspaceId: string;
  state: WorkspaceExecutionState;
  revision: number;
  changedAt: string;
}> & (Readonly<{ canManage: false }> | Readonly<{
  canManage: true;
  actorIncarnationId: string;
  reason: string;
}>);

export function workspaceExecutionControlUuid(value: unknown): string {
  if (typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new WorkspaceExecutionControlError("invalid_input", "Provide exact workspace, grant and request identifiers.");
  }
  return value.toLowerCase();
}

/** Fixed-order canonical bytes bind one exact pause/resume review to its receipt. */
export function normalizeWorkspaceExecutionControlRequest(input: unknown): WorkspaceExecutionControlRequest {
  const invalid = (): never => {
    throw new WorkspaceExecutionControlError("invalid_input", "Review the current workspace execution state and provide a brief reason.");
  };
  if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const allowed = new Set(["workspaceId", "requestId", "expectedActorIncarnationId", "expectedRevision", "state", "reason"]);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== allowed.size || keys.some(key => typeof key !== "string" || !allowed.has(key)
    || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) invalid();
  const raw = input as Record<string, unknown>;
  if (raw.state !== "open" && raw.state !== "paused") invalid();
  if (typeof raw.expectedRevision !== "number" || !Number.isInteger(raw.expectedRevision)
    || raw.expectedRevision < 1 || raw.expectedRevision >= WORKSPACE_EXECUTION_CONTROL_LIMITS.revision) invalid();
  if (typeof raw.reason !== "string" || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(raw.reason)) invalid();
  const reason = (raw.reason as string).normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!reason || reason.length > WORKSPACE_EXECUTION_CONTROL_LIMITS.reason) invalid();
  const request: WorkspaceExecutionControlRequest = {
    workspaceId: workspaceExecutionControlUuid(raw.workspaceId),
    requestId: workspaceExecutionControlUuid(raw.requestId),
    expectedActorIncarnationId: workspaceExecutionControlUuid(raw.expectedActorIncarnationId),
    expectedRevision: raw.expectedRevision as number,
    state: raw.state as WorkspaceExecutionState,
    reason,
  };
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > WORKSPACE_EXECUTION_CONTROL_LIMITS.requestBytes) invalid();
  return Object.freeze(request);
}
