import { describe, expect, it } from "vitest";
import { WORKSPACE_MEMBER_LIFECYCLE_LIMITS, WorkspaceMemberLifecycleError, isWorkspaceMemberLifecycleError,
  normalizeWorkspaceMemberRemovalRequest, workspaceMemberLifecycleUuid, WORKSPACE_MEMBER_IMPACT_KEYS,
  workspaceMemberImpactFingerprint, type WorkspaceMemberImpact } from "./workspace-member-lifecycle-models";

const uuid = "e1a934e1-0d1a-4db4-88aa-d74627f57365";
const request = () => ({ workspaceId: uuid, targetUserId: "87f6f263-53d5-48b8-98e2-cfa2dcba52c0", requestId: "b802ba5e-eaf1-43ac-ad88-759da06fb0c6",
  expectedIncarnationId: "acfd778c-19fc-46bd-bf28-4f81d81cb78e", expectedRevision: 4, impactFingerprint: "a".repeat(64), reason: "Offboarding this collaboration" });

describe("workspace member lifecycle request contracts", () => {
  it("pins one normalized ordered immutable intent without role or actor authority", () => {
    const raw = { ...request(), workspaceId: uuid.toUpperCase(), reason: "  Cafe\u0301   team transition  " };
    const result = normalizeWorkspaceMemberRemovalRequest(raw);
    expect(result).toEqual({ ...request(), reason: "Café team transition" });
    expect(Object.keys(result)).toEqual(["workspaceId", "targetUserId", "requestId", "expectedIncarnationId", "expectedRevision", "impactFingerprint", "reason"]);
    expect(Object.isFrozen(result)).toBe(true); raw.reason = "Changed"; expect(result.reason).toBe("Café team transition");
  });
  it.each([null, [], Object.create(null), "request", 1])("rejects nonordinary request %s", input => {
    expect(() => normalizeWorkspaceMemberRemovalRequest(input)).toThrow(WorkspaceMemberLifecycleError);
  });
  it.each(["actorUserId", "role", "newRole", "restore", "canRemove", "tokenHash", "acknowledgedImpact"])("rejects extra authority %s", key => {
    expect(() => normalizeWorkspaceMemberRemovalRequest({ ...request(), [key]: true })).toThrow(WorkspaceMemberLifecycleError);
  });
  it.each(Object.keys(request()))("requires member %s", key => {
    const value: Record<string, unknown> = request(); delete value[key];
    expect(() => normalizeWorkspaceMemberRemovalRequest(value)).toThrow(WorkspaceMemberLifecycleError);
  });
  it("rejects getters before reading any value, including hidden and symbol fields", () => {
    let reads = 0;
    const accessor = Object.defineProperty(request(), "reason", { enumerable: true, get() { reads++; return "read"; } });
    expect(() => normalizeWorkspaceMemberRemovalRequest(accessor)).toThrow(WorkspaceMemberLifecycleError);
    expect(reads).toBe(0);
    expect(() => normalizeWorkspaceMemberRemovalRequest(Object.defineProperty(request(), "reason", { enumerable: false }))).toThrow(WorkspaceMemberLifecycleError);
    expect(() => normalizeWorkspaceMemberRemovalRequest({ ...request(), [Symbol("scope")]: uuid })).toThrow(WorkspaceMemberLifecycleError);
  });
  it.each([0, -1, 1.5, NaN, Infinity, "4", 2_147_483_647])("rejects invalid or exhausted revision %s", expectedRevision => {
    expect(() => normalizeWorkspaceMemberRemovalRequest({ ...request(), expectedRevision })).toThrow(WorkspaceMemberLifecycleError);
  });
  it.each(["", "  ", "x\nreason", "x\tbroken", "x\u0000", "x\u007f", "x\u0085", "x\u202e", "x\ud800", "x".repeat(501)])("rejects ambiguous/overlong reason %j", reason => {
    expect(() => normalizeWorkspaceMemberRemovalRequest({ ...request(), reason })).toThrow(WorkspaceMemberLifecycleError);
  });
  it("permits bounded non-Latin and emoji reasons without treating labels as authority", () => {
    expect(normalizeWorkspaceMemberRemovalRequest({ ...request(), reason: "チーム変更 — завершение 🌱" }).reason).toBe("チーム変更 — завершение 🌱");
    expect(normalizeWorkspaceMemberRemovalRequest({ ...request(), reason: "x".repeat(500) }).reason).toHaveLength(500);
  });
  it.each([" " + uuid, uuid + " ", uuid.replaceAll("-", ""), "not-a-uuid", null])("rejects noncanonical identifier %s", value => {
    expect(() => workspaceMemberLifecycleUuid(value)).toThrow(WorkspaceMemberLifecycleError);
  });
  it("keeps constants frozen and distinguishes branded errors from lookalike objects", () => {
    expect(Object.isFrozen(WORKSPACE_MEMBER_LIFECYCLE_LIMITS)).toBe(true);
    expect(isWorkspaceMemberLifecycleError(new WorkspaceMemberLifecycleError("access_denied", "Denied"))).toBe(true);
    expect(isWorkspaceMemberLifecycleError({ name: "WorkspaceMemberLifecycleError", code: "access_denied" })).toBe(false);
    expect(isWorkspaceMemberLifecycleError(new Error("Denied"))).toBe(false);
  });
  it.each(["", "a".repeat(63), "A".repeat(64), "g".repeat(64), null])("rejects malformed preview fingerprint %s", impactFingerprint => {
    expect(() => normalizeWorkspaceMemberRemovalRequest({ ...request(), impactFingerprint })).toThrow(WorkspaceMemberLifecycleError);
  });
});

describe("workspace member impact snapshot identity", () => {
  const target = { userId: request().targetUserId, incarnationId: request().expectedIncarnationId, revision: 4 };
  const actorGrant = request().requestId;
  const impact = Object.fromEntries(WORKSPACE_MEMBER_IMPACT_KEYS.map(key => [key, "0"])) as WorkspaceMemberImpact;
  const fingerprint = () => workspaceMemberImpactFingerprint(uuid, actorGrant, target, impact);
  it("uses fixed key order, UUID case normalization and full exact decimal counts", () => {
    expect(workspaceMemberImpactFingerprint(uuid.toUpperCase(), actorGrant.toUpperCase(), target,
      Object.fromEntries(Object.entries(impact).reverse()) as WorkspaceMemberImpact)).toBe(fingerprint());
    expect(fingerprint()).toMatch(/^[0-9a-f]{64}$/);
    expect(workspaceMemberImpactFingerprint(uuid, actorGrant, target, { ...impact, assignedConversations: "9007199254740992" }))
      .not.toBe(workspaceMemberImpactFingerprint(uuid, actorGrant, target, { ...impact, assignedConversations: "9007199254740993" }));
  });
  it("binds workspace, current actor grant, target identity/incarnation/revision independently", () => {
    const other = "90d569d1-a1c9-43f1-9716-1e42d638e25b";
    for (const actual of [workspaceMemberImpactFingerprint(other, actorGrant, target, impact),
      workspaceMemberImpactFingerprint(uuid, other, target, impact),
      workspaceMemberImpactFingerprint(uuid, actorGrant, { ...target, userId: other }, impact),
      workspaceMemberImpactFingerprint(uuid, actorGrant, { ...target, incarnationId: other }, impact),
      workspaceMemberImpactFingerprint(uuid, actorGrant, { ...target, revision: 5 }, impact)]) expect(actual).not.toBe(fingerprint());
  });
  it.each(WORKSPACE_MEMBER_IMPACT_KEYS)("binds %s without requiring private work contents", key => {
    expect(workspaceMemberImpactFingerprint(uuid, actorGrant, target, { ...impact, [key]: "1" })).not.toBe(fingerprint());
  });
});
