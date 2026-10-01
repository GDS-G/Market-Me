/** Names and request keys only: no identity, billing or inherited workspace authority. */
export const WORKSPACE_MANAGEMENT_LIMITS = Object.freeze({ name: 120, requestBytes: 4_096 });
const ERROR_BRAND = Symbol.for("@market-me/database/WorkspaceManagementError/v1");
export class WorkspaceManagementError extends Error {
  readonly [ERROR_BRAND] = true;
  constructor(readonly code: "invalid_input" | "access_denied" | "not_found" | "request_conflict" | "revision_conflict", message: string) {
    super(message); this.name = "WorkspaceManagementError";
  }
}
export function isWorkspaceManagementError(error: unknown): error is WorkspaceManagementError {
  return error instanceof Error && Reflect.get(error, ERROR_BRAND) === true;
}

export type WorkspaceManagementRequest =
  | { operation: "create"; organizationId: string; requestId: string; name: string }
  | { operation: "rename"; workspaceId: string; requestId: string; expectedRevision: number; name: string };

/** Immutable original outcome, not a statement about current name or access. */
export interface WorkspaceManagementReceipt {
  organizationId: string;
  workspaceId: string;
  requestId: string;
  operation: WorkspaceManagementRequest["operation"];
  name: string;
  revision: number;
  createdAt: string;
}

export interface ManagedWorkspaceSettings {
  workspaceId: string;
  organizationId: string;
  organizationName: string;
  name: string;
  revision: number;
  canRename: boolean;
  canCreateWorkspace: boolean;
}

export function workspaceManagementUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())) {
    throw new WorkspaceManagementError("invalid_input", "Provide a valid organization, workspace or request identifier.");
  }
  return value.trim().toLowerCase();
}

/** Reject hidden/inherited/accessor authority before reading any user-supplied fields. */
export function normalizeWorkspaceManagementRequest(input: unknown): WorkspaceManagementRequest {
  const invalid = (message: string): never => { throw new WorkspaceManagementError("invalid_input", message); };
  if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) invalid("Provide ordinary JSON workspace settings.");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) {
    invalid("Workspace requests cannot contain hidden fields or accessors.");
  }
  const raw = input as Record<string, unknown>;
  if (raw.operation !== "create" && raw.operation !== "rename") invalid("Choose workspace creation or renaming.");
  const operation = raw.operation as WorkspaceManagementRequest["operation"];
  const allowed = new Set(["operation", "requestId", "name", ...(operation === "create" ? ["organizationId"] : ["workspaceId", "expectedRevision"])]);
  if (Object.keys(raw).some(key => !allowed.has(key))) invalid("Workspace requests cannot contain extra fields or permissions.");
  if (typeof raw.name !== "string" || /[\u0000-\u001f\u007f]/u.test(raw.name)) invalid("Provide a workspace name without control characters.");
  const name = (raw.name as string).normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!name || name.length > WORKSPACE_MANAGEMENT_LIMITS.name) invalid(`Use a workspace name of 1–${WORKSPACE_MANAGEMENT_LIMITS.name} characters.`);
  const requestId = workspaceManagementUuid(raw.requestId);
  let request: WorkspaceManagementRequest;
  if (operation === "create") {
    request = { operation, organizationId: workspaceManagementUuid(raw.organizationId), requestId, name };
  } else {
    if (typeof raw.expectedRevision !== "number" || !Number.isInteger(raw.expectedRevision) || raw.expectedRevision < 1 || raw.expectedRevision > 2_147_483_647) {
      invalid("Provide the positive saved workspace revision.");
    }
    request = { operation, workspaceId: workspaceManagementUuid(raw.workspaceId), requestId, expectedRevision: raw.expectedRevision as number, name };
  }
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > WORKSPACE_MANAGEMENT_LIMITS.requestBytes) invalid("Workspace settings exceed the request limit.");
  return Object.freeze(request);
}
