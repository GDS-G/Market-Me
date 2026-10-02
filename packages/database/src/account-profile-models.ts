/** Self-service display labels only; never identity, email or permission changes. */
export const ACCOUNT_PROFILE_LIMITS = Object.freeze({ displayName: 120, requestBytes: 4_096 });
const ERROR_BRAND = Symbol.for("@market-me/database/AccountProfileError/v1");
export class AccountProfileError extends Error {
  readonly [ERROR_BRAND] = true;
  constructor(readonly code: "invalid_input" | "access_denied" | "not_found" | "request_conflict" | "revision_conflict", message: string) {
    super(message); this.name = "AccountProfileError";
  }
}
export function isAccountProfileError(error: unknown): error is AccountProfileError {
  return error instanceof Error && Reflect.get(error, ERROR_BRAND) === true;
}
export interface AccountProfileSnapshot { accountId: string; displayName: string; revision: number }
export interface AccountProfileRequest { accountId: string; requestId: string; expectedRevision: number; displayName: string }
/** Original immutable outcome; not necessarily the current name or revision. */
export interface AccountProfileReceipt extends AccountProfileSnapshot { requestId: string; changed: boolean; createdAt: string }

export function accountProfileUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AccountProfileError("invalid_input", "Provide a valid account and request identifier.");
  }
  return value.toLowerCase();
}
/** Validate plain JSON descriptors before reading values, including self-scope hints. */
export function normalizeAccountProfileRequest(input: unknown): Readonly<AccountProfileRequest> {
  const invalid = (message: string): never => { throw new AccountProfileError("invalid_input", message); };
  if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) invalid("Provide ordinary JSON profile settings.");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) invalid("Profile settings cannot contain hidden fields or accessors.");
  const raw = input as Record<string, unknown>, allowed = new Set(["accountId", "requestId", "expectedRevision", "displayName"]);
  if (Object.keys(raw).some(key => !allowed.has(key))) invalid("Profile settings cannot change identity or permissions.");
  if (typeof raw.displayName !== "string" || raw.displayName.length > ACCOUNT_PROFILE_LIMITS.requestBytes || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(raw.displayName)) invalid("Provide a short display name without control characters or unpaired surrogates.");
  const displayName = (raw.displayName as string).normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!displayName || displayName.length > ACCOUNT_PROFILE_LIMITS.displayName) invalid("Use a display name of 1–120 characters.");
  if (typeof raw.expectedRevision !== "number" || !Number.isInteger(raw.expectedRevision) || raw.expectedRevision < 1 || raw.expectedRevision > 2_147_483_647) invalid("Provide the positive saved profile revision.");
  const request: AccountProfileRequest = { accountId: accountProfileUuid(raw.accountId), requestId: accountProfileUuid(raw.requestId), expectedRevision: raw.expectedRevision as number, displayName };
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > ACCOUNT_PROFILE_LIMITS.requestBytes) invalid("Profile settings exceed the request limit.");
  return Object.freeze(request);
}
