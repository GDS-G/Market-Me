import { createHash } from "node:crypto";

export const ACCOUNT_SESSION_LIMITS = Object.freeze({ pageSize: 30, requestBytes: 2_048, cursorLength: 512 });
const ERROR_BRAND = Symbol.for("@market-me/database/AccountSessionError/v1");
export class AccountSessionError extends Error {
  readonly [ERROR_BRAND] = true;
  constructor(readonly code: "invalid_input" | "access_denied" | "authentication_required" | "not_found" | "request_conflict" | "current_session", message: string) {
    super(message); this.name = "AccountSessionError";
  }
}
export function isAccountSessionError(value: unknown): value is AccountSessionError {
  return value instanceof Error && Reflect.get(value, ERROR_BRAND) === true;
}
export interface AccountSessionView { sessionId: string; createdAt: string; lastSeenAt: string; expiresAt: string }
export interface AccountSessionSnapshot {
  accountId: string; observedAt: string; current: AccountSessionView;
  others: readonly AccountSessionView[]; totalOthers: string; nextCursor: string | null;
}
export interface AccountSessionRequest { accountId: string; requestId: string; targetSessionId: string }
export interface AccountSessionReceipt extends AccountSessionRequest { revokedAt: string }
/** Server-only cookie-derived context. Never serialize or log tokenHash. */
export interface AccountSessionActor { accountId: string; tokenHash: string }
export interface AccountSessionCursor { at: string; id: string }

export function accountSessionUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new AccountSessionError("invalid_input", "Use a valid session selection.");
  return value.toLowerCase();
}
export function normalizeAccountSessionRequest(input: unknown): Readonly<AccountSessionRequest> {
  const invalid = (): never => { throw new AccountSessionError("invalid_input", "Provide one exact session request."); };
  if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !["accountId", "requestId", "targetSessionId"].includes(key)
    || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) invalid();
  const raw = input as Record<string, unknown>;
  return Object.freeze({ accountId: accountSessionUuid(raw.accountId), requestId: accountSessionUuid(raw.requestId), targetSessionId: accountSessionUuid(raw.targetSessionId) });
}
function cursorTime(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/.test(value)) throw new Error("Invalid time.");
  const date = new Date(value); if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error("Invalid date.");
  return value;
}
function cursorContext(accountId: string, currentId: string): string {
  return createHash("sha256").update(JSON.stringify(["account-sessions-v1", accountSessionUuid(accountId), accountSessionUuid(currentId)])).digest("hex");
}
export function encodeAccountSessionCursor(accountId: string, currentId: string, value: AccountSessionCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, at: cursorTime(value.at), id: accountSessionUuid(value.id), context: cursorContext(accountId, currentId) }), "utf8").toString("base64url");
}
export function decodeAccountSessionCursor(accountId: string, currentId: string, value?: string): AccountSessionCursor | undefined {
  if (value === undefined) return undefined;
  try {
    if (typeof value !== "string" || !value || value.length > ACCOUNT_SESSION_LIMITS.cursorLength || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const bytes = Buffer.from(value, "base64url"); if (bytes.toString("base64url") !== value) throw new Error();
    const decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!decoded || Object.getPrototypeOf(decoded) !== Object.prototype || Object.keys(decoded).sort().join(",") !== "at,context,id,v"
      || decoded.v !== 1 || decoded.context !== cursorContext(accountId, currentId)) throw new Error();
    return { at: cursorTime(decoded.at), id: accountSessionUuid(decoded.id) };
  } catch { throw new AccountSessionError("invalid_input", "Reload the session list after changing accounts or sessions."); }
}
