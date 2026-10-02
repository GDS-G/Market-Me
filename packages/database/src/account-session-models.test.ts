import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_SESSION_LIMITS, AccountSessionError, decodeAccountSessionCursor, encodeAccountSessionCursor,
  isAccountSessionError, normalizeAccountSessionRequest } from "./account-session-models";

const request = () => ({ accountId: randomUUID(), requestId: randomUUID(), targetSessionId: randomUUID() });
describe("own-account session contracts", () => {
  it("freezes a minimal fixed-order intent and normalizes UUID case", () => {
    const input = request(); const result = normalizeAccountSessionRequest({ targetSessionId: input.targetSessionId.toUpperCase(), requestId: input.requestId, accountId: input.accountId });
    expect(result).toEqual(input); expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result)).toEqual(["accountId", "requestId", "targetSessionId"]); expect(Object.isFrozen(ACCOUNT_SESSION_LIMITS)).toBe(true);
  });
  it.each([null, [], {}, 1, "request", { ...request(), tokenHash: "secret" }, { ...request(), actorUserId: randomUUID() }, { ...request(), current: true },
    { ...request(), targetSessionId: "../session" }, { ...request(), requestId: ` ${randomUUID()}` }, { ...request(), accountId: undefined }])("rejects malformed/extra identity input %#", value => {
    expect(() => normalizeAccountSessionRequest(value)).toThrow(AccountSessionError);
  });
  it("rejects descriptors, symbols and inherited prototypes without invoking getters", () => {
    const read = vi.fn(); const accessor = Object.defineProperty(request(), "accountId", { enumerable: true, get: read });
    for (const input of [accessor, Object.defineProperty(request(), "hidden", { value: 1 }), { ...request(), [Symbol()]: 1 }, Object.assign(Object.create({}), request())]) {
      expect(() => normalizeAccountSessionRequest(input)).toThrow(AccountSessionError);
    }
    expect(read).not.toHaveBeenCalled();
  });
  it("does not brand arbitrary name/code objects as trusted errors", () => {
    expect(isAccountSessionError({ name: "AccountSessionError", code: "access_denied" })).toBe(false);
    expect(isAccountSessionError(new Error("AccountSessionError"))).toBe(false);
    expect(isAccountSessionError(new AccountSessionError("not_found", "missing"))).toBe(true);
  });
  it("preserves exact microseconds and scopes cursors to account and current session", () => {
    const account = randomUUID(), current = randomUUID(), value = { at: "2026-01-01T00:00:00.000001Z", id: randomUUID() };
    const encoded = encodeAccountSessionCursor(account, current, value);
    expect(decodeAccountSessionCursor(account, current, encoded)).toEqual(value);
    expect(() => decodeAccountSessionCursor(randomUUID(), current, encoded)).toThrow(AccountSessionError);
    expect(() => decodeAccountSessionCursor(account, randomUUID(), encoded)).toThrow(AccountSessionError);
    expect(decodeAccountSessionCursor(account, current)).toBeUndefined();
  });
  it.each(["", "!", "a".repeat(513), "e30=", "e30", "_w"])("rejects invalid cursor encoding %s", cursor => {
    expect(() => decodeAccountSessionCursor(randomUUID(), randomUUID(), cursor)).toThrow(AccountSessionError);
  });
  it.each(["2026-02-30T00:00:00.000001Z", "2026-01-01T25:00:00.000001Z", "2026-01-01T00:00:00.001Z", "2026-01-01T00:00:00.000001+00:00"])("rejects inexact/invalid cursor dates %s", at => {
    expect(() => encodeAccountSessionCursor(randomUUID(), randomUUID(), { at, id: randomUUID() })).toThrow();
  });
});
