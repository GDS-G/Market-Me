import { describe, expect, it } from "vitest";
import {
  WORKSPACE_EXECUTION_CONTROL_LIMITS, WORKSPACE_EXECUTION_STATES,
  WorkspaceExecutionControlError, isWorkspaceExecutionControlError,
  normalizeWorkspaceExecutionControlRequest as normalize, workspaceExecutionControlUuid,
} from "./workspace-execution-control-models";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actorGrant = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const request = () => ({ workspaceId, requestId, expectedActorIncarnationId: actorGrant,
  expectedRevision: 1, state: "paused", reason: "Investigate unexpected outbound work" });

describe("workspace execution hold intent", () => {
  it("defines immutable states without equating open with authorized execution", () => {
    expect(WORKSPACE_EXECUTION_STATES).toEqual(["open", "paused"]);
    expect(Object.isFrozen(WORKSPACE_EXECUTION_STATES)).toBe(true);
    expect(Object.isFrozen(WORKSPACE_EXECUTION_CONTROL_LIMITS)).toBe(true);
    expect(WORKSPACE_EXECUTION_CONTROL_LIMITS).toEqual({ reason: 500, requestBytes: 4096, revision: 2147483647 });
  });
  it.each(["open", "paused"])("normalizes an explicit %s intent without mutating input", state => {
    const input = { ...request(), state, requestId: requestId.toUpperCase(), reason: "  Cafe\u0301   review  " };
    const result = normalize(input);
    expect(result).toEqual({ ...request(), state, reason: "Café review" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(input.requestId).toBe(requestId.toUpperCase());
    expect(input.reason).toBe("  Cafe\u0301   review  ");
  });
  it("fixes key order regardless of caller property order", () => {
    const reversed = Object.fromEntries(Object.entries(request()).reverse());
    expect(JSON.stringify(normalize(reversed))).toBe(JSON.stringify(request()));
  });
  it.each([null, undefined, true, 1, "paused", [], new Date(), Object.create(null)])("rejects nonordinary payload %s", input => {
    expect(() => normalize(input)).toThrow(WorkspaceExecutionControlError);
  });
  it.each(Object.keys(request()))("requires %s", key => {
    const input = { ...request() } as Record<string, unknown>;
    delete input[key];
    expect(() => normalize(input)).toThrow(WorkspaceExecutionControlError);
  });
  it.each(["actorUserId", "role", "canManage", "allWorkspaces", "resumeCampaigns", "__proto__"])("rejects injected %s", key => {
    const input = Object.defineProperty(request(), key, { value: true, enumerable: true });
    expect(() => normalize(input)).toThrow(WorkspaceExecutionControlError);
  });
  it("checks every descriptor before reading any getter", () => {
    let read = false;
    const input = Object.defineProperty(request(), "state", { get() { read = true; return "open"; }, enumerable: true });
    expect(() => normalize(input)).toThrow(WorkspaceExecutionControlError);
    expect(read).toBe(false);
  });
  it("rejects hidden or symbol members and inherited authority", () => {
    const hidden = Object.defineProperty(request(), "state", { value: "open", enumerable: false });
    const symbol = Object.assign(request(), { [Symbol("permission")]: true });
    const inherited = Object.assign(Object.create({ role: "owner" }), request());
    for (const input of [hidden, symbol, inherited]) expect(() => normalize(input)).toThrow(WorkspaceExecutionControlError);
  });
  it.each([0, -1, 1.5, NaN, Infinity, "1", 2147483647, 2147483648])("rejects invalid or exhausted revision %s", expectedRevision => {
    expect(() => normalize({ ...request(), expectedRevision })).toThrow(WorkspaceExecutionControlError);
  });
  it("accepts the last revision with room for one transition", () => {
    expect(normalize({ ...request(), expectedRevision: 2147483646 }).expectedRevision).toBe(2147483646);
  });
  it.each(["enabled", "running", "resume", "PAUSED", " paused", false, null])("rejects ambiguous state %s", state => {
    expect(() => normalize({ ...request(), state })).toThrow(WorkspaceExecutionControlError);
  });
  it.each(["", " ", "x".repeat(501), "A\nB", "A\tB", "A\u0000B", "A\u202eB", "A\ud800B", null, 5])("rejects invalid reason %#", reason => {
    expect(() => normalize({ ...request(), reason })).toThrow(WorkspaceExecutionControlError);
  });
  it("counts UTF-16 units consistently and permits ordinary Unicode", () => {
    expect(normalize({ ...request(), reason: "界".repeat(500) }).reason.length).toBe(500);
    expect(normalize({ ...request(), reason: "🔒".repeat(250) }).reason.length).toBe(500);
    expect(() => normalize({ ...request(), reason: "🔒".repeat(251) })).toThrow(WorkspaceExecutionControlError);
  });
  it.each(["workspaceId", "requestId", "expectedActorIncarnationId"])("validates %s independently", key => {
    for (const value of [" "+workspaceId, workspaceId+" ", "not-a-uuid", "00000000-0000-0000-0000-000000000000", null, 1]) {
      expect(() => normalize({ ...request(), [key]: value })).toThrow(WorkspaceExecutionControlError);
    }
  });
  it("normalizes uppercase UUIDs without accepting whitespace or invalid variants", () => {
    expect(workspaceExecutionControlUuid(actorGrant.toUpperCase())).toBe(actorGrant);
    expect(() => workspaceExecutionControlUuid("bbbbbbbb-bbbb-4bbb-0bbb-bbbbbbbbbbbb")).toThrow(WorkspaceExecutionControlError);
  });
  it("distinguishes the branded error from a similarly named object", () => {
    const error = new WorkspaceExecutionControlError("execution_paused", "New outbound work is paused.");
    expect(isWorkspaceExecutionControlError(error)).toBe(true);
    expect(isWorkspaceExecutionControlError(new Error("execution_paused"))).toBe(false);
    expect(isWorkspaceExecutionControlError({ name: error.name, code: error.code })).toBe(false);
    expect(isWorkspaceExecutionControlError(null)).toBe(false);
  });
});
