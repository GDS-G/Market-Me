import { z } from "zod";

// Browser-only contract. The repository independently validates and authorizes every operation.
export const WORKSPACE_BROWSER_LIMITS = Object.freeze({ name: 120, requestBytes: 4_096, recoveryBytes: 8_192, responseBytes: 8_192 });
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const revision = z.number().int().min(1).max(2_147_483_647);
export function normalizeWorkspaceName(value: string) {
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error("Use a workspace name without control characters.");
  const name = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!name || name.length > WORKSPACE_BROWSER_LIMITS.name) throw new Error("Use a workspace name of 1–120 characters.");
  return name;
}
const name = z.string().min(1).max(WORKSPACE_BROWSER_LIMITS.name).refine(value => {
  try { return normalizeWorkspaceName(value) === value; } catch { return false; }
});
const requestSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("create"), organizationId: uuid, requestId: uuid, name }),
  z.strictObject({ operation: z.literal("rename"), workspaceId: uuid, requestId: uuid, expectedRevision: revision, name }),
]);
const attemptSchema = z.strictObject({ version: z.literal(1), userId: uuid, organizationId: uuid, request: requestSchema });
export const workspaceReceiptSchema = z.strictObject({ organizationId: uuid, workspaceId: uuid, requestId: uuid,
  operation: z.enum(["create", "rename"]), name, revision, createdAt: z.iso.datetime() });
export type WorkspaceRequest = z.infer<typeof requestSchema>;
export type WorkspaceAttempt = z.infer<typeof attemptSchema>;
export type WorkspaceReceipt = z.infer<typeof workspaceReceiptSchema>;
export type WorkspaceScope = { userId: string; organizationId: string } & ({ operation: "create" } | { operation: "rename"; workspaceId: string });
type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const size = (value: string) => new TextEncoder().encode(value).byteLength;
export function workspaceStorageKey(scope: WorkspaceScope) {
  return `market-me:workspace-management:v1:${uuid.parse(scope.userId)}:${uuid.parse(scope.organizationId)}:${scope.operation}:${scope.operation === "create" ? "new" : uuid.parse(scope.workspaceId)}`;
}
function checkScope(attempt: WorkspaceAttempt, scope: WorkspaceScope) {
  if (attempt.userId !== scope.userId || attempt.organizationId !== scope.organizationId || attempt.request.operation !== scope.operation
    || (attempt.request.operation === "create" && attempt.request.organizationId !== scope.organizationId)
    || (attempt.request.operation === "rename" && (scope.operation !== "rename" || attempt.request.workspaceId !== scope.workspaceId))) {
    throw new Error("Saved request belongs to another account, organization, workspace or operation.");
  }
  if (size(JSON.stringify(attempt.request)) > WORKSPACE_BROWSER_LIMITS.requestBytes) throw new Error("Workspace request is too large.");
  return attempt;
}
export function makeWorkspaceAttempt(scope: WorkspaceScope, request: WorkspaceRequest): WorkspaceAttempt {
  return checkScope(attemptSchema.parse({ version: 1, userId: scope.userId, organizationId: scope.organizationId, request }), scope);
}
export function restoreWorkspaceAttempt(serialized: string | null, scope: WorkspaceScope): WorkspaceAttempt | undefined {
  if (serialized === null) return undefined;
  if (size(serialized) > WORKSPACE_BROWSER_LIMITS.recoveryBytes) throw new Error("Saved workspace request is too large.");
  return checkScope(attemptSchema.parse(JSON.parse(serialized)), scope);
}
/** Never replace a different local attempt, even when another mounted form wrote it. */
export function persistWorkspaceAttempt(storage: RecoveryStorage, scope: WorkspaceScope, attempt: WorkspaceAttempt) {
  const valid = makeWorkspaceAttempt(scope, attempt.request);
  if (attempt.userId !== valid.userId || attempt.organizationId !== valid.organizationId) throw new Error("Invalid saved account scope.");
  const key = workspaceStorageKey(scope), prior = restoreWorkspaceAttempt(storage.getItem(key), scope), serialized = JSON.stringify(valid);
  if (prior && JSON.stringify(prior) !== serialized) throw new Error("Another request is saved. Reload to recover it before starting a new request.");
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error("Recovery storage did not retain the exact request. Nothing was sent.");
}
export function workspaceLookupPath(attempt: WorkspaceAttempt) {
  const request = attempt.request;
  return `/api/v1/workspace-management?${new URLSearchParams({ operation: request.operation, requestId: request.requestId,
    ...(request.operation === "create" ? { organizationId: request.organizationId } : { workspaceId: request.workspaceId }) })}`;
}
export function parseWorkspaceReceipt(value: unknown, attempt: WorkspaceAttempt): WorkspaceReceipt {
  const receipt = workspaceReceiptSchema.parse(value), request = attempt.request;
  if (receipt.organizationId !== attempt.organizationId || receipt.requestId !== request.requestId || receipt.operation !== request.operation
    || receipt.name !== request.name || receipt.revision !== (request.operation === "create" ? 1 : request.expectedRevision + 1)
    || (request.operation === "rename" && receipt.workspaceId !== request.workspaceId)) throw new Error("Result does not match the exact saved workspace request.");
  return receipt;
}
export async function readWorkspaceResponse(response: Response): Promise<unknown> {
  const maximum = WORKSPACE_BROWSER_LIMITS.responseBytes;
  if (response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
    || Number(response.headers.get("content-length")) > maximum || !response.body) throw new Error("Invalid workspace response.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new Error("Workspace response is too large."); } chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { reader.releaseLock(); }
}
const resultSchema = z.strictObject({ data: workspaceReceiptSchema, meta: z.strictObject({ replayed: z.boolean() }).optional() });
const errorSchema = z.strictObject({ error: z.strictObject({ code: z.string().min(1).max(80), message: z.string().min(1).max(1_000) }) });
/** Persist before the first await/network call; callers keep the same attempt after every outcome. */
export async function runWorkspaceAttempt(storage: RecoveryStorage, scope: WorkspaceScope, attempt: WorkspaceAttempt,
  lookup: boolean, send: typeof fetch = fetch): Promise<WorkspaceReceipt> {
  persistWorkspaceAttempt(storage, scope, attempt);
  const response = await send(lookup ? workspaceLookupPath(attempt) : "/api/v1/workspace-management", lookup
    ? { method: "GET", cache: "no-store" }
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(attempt.request), cache: "no-store" });
  const payload = await readWorkspaceResponse(response);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(payload);
    throw new Error(parsed.success ? parsed.data.error.message : "No confirmed result. Check or retry the saved request; do not assume it failed.");
  }
  if (response.status !== 200 && response.status !== 201) throw new Error("Unrecognized workspace result. Recover the saved request.");
  return parseWorkspaceReceipt(resultSchema.parse(payload).data, attempt);
}
