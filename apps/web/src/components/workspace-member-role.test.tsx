import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { clearMemberRoleAttempt, makeMemberRoleAttempt, MEMBER_ROLE_CHOICES, MEMBER_ROLE_DESCRIPTIONS, memberRoleLookupPath,
  memberRoleStorageKey, normalizeMemberRoleReason, parseMemberRoleReceipt, persistMemberRoleAttempt,
  readMemberRoleResponse, restoreMemberRoleAttempt, runMemberRoleAttempt } from "./workspace-member-role-contract";
import { MemberRoleBoundary, WorkspaceMemberRoleForm } from "./workspace-member-role-form";
const userId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222";
const targetUserId = "33333333-3333-4333-8333-333333333333", requestId = "44444444-4444-4444-8444-444444444444";
const scope = { userId, workspaceId }, request = { workspaceId, targetUserId, requestId, expectedRevision: 3, newRole: "viewer" as const, reason: "Reviewed access" };
const attempt = makeMemberRoleAttempt(scope, "editor", request);
const receipt = { workspaceId, targetUserId, requestId, previousRole: "editor", newRole: "viewer", revision: 4, reason: request.reason, createdAt: "2026-10-01T00:00:00.000Z" };
function storage() {
  const values = new Map<string, string>(); return {
    getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
}
describe("member role review and exact browser recovery", () => {
  it("normalizes reasons identically to the server and bounds UTF-16 units", () => {
    expect(normalizeMemberRoleReason("  Cafe\u0301\u00a0 access ")).toBe("Café access");
    for (const bad of ["", " ", "x".repeat(501), "Reason\n", "Reason\t", "Reason\u007f", "Reason\0"]) expect(() => normalizeMemberRoleReason(bad)).toThrow();
    expect(normalizeMemberRoleReason("😀".repeat(250))).toHaveLength(500); expect(() => normalizeMemberRoleReason("😀".repeat(251))).toThrow();
  });
  it("uses a frozen closed request and exactly one key for the account/workspace", () => {
    expect(Object.isFrozen(attempt)).toBe(true); expect(Object.isFrozen(attempt.request)).toBe(true);
    expect(restoreMemberRoleAttempt(JSON.stringify(attempt), scope)).toEqual(attempt); expect(restoreMemberRoleAttempt(null, scope)).toBeUndefined();
    expect(new Set([scope, { ...scope, userId: targetUserId }, { ...scope, workspaceId: targetUserId }].map(memberRoleStorageKey)).size).toBe(3);
    for (const wrong of [{ ...scope, userId: targetUserId }, { ...scope, workspaceId: targetUserId }]) expect(() => restoreMemberRoleAttempt(JSON.stringify(attempt), wrong)).toThrow();
  });
  it.each([{ version: 2 }, { userId: targetUserId }, { actorUserId: userId }, { previousRole: "owner" }, { previousRole: "viewer" },
    { request: { ...request, newRole: "owner" } }, { request: { ...request, reason: " Not normalized " } }, { request: { ...request, targetUserId: userId } },
    { request: { ...request, organizationId: workspaceId } }, { request: { ...request, expectedRevision: 0 } }, { request: { ...request, requestId: "bad" } }])
    ("rejects stale, injected or protected recovery %j", patch => { expect(() => restoreMemberRoleAttempt(JSON.stringify({ ...attempt, ...patch }), scope)).toThrow(); });
  it("bounds recovery before parsing", () => {
    for (const bad of [" ".repeat(8193), "{" + "😀".repeat(2048), "{"]) expect(() => restoreMemberRoleAttempt(bad, scope)).toThrow();
  });
  it("persists exact intent before network and retains it after success", async () => {
    const local = storage(), send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(local.getItem(memberRoleStorageKey(scope))).toBe(JSON.stringify(attempt)); expect(JSON.parse(init!.body as string)).toEqual(request);
      return Response.json({ data: receipt, meta: { replayed: false } }, { status: 201 });
    });
    expect(await runMemberRoleAttempt(local, scope, attempt, false, send)).toEqual(receipt);
    expect(local.removeItem).not.toHaveBeenCalled(); expect(send).toHaveBeenCalledTimes(1);
  });
  it("cannot replace another member's request, bypass failed storage or dispatch malformed recovery", async () => {
    const send = vi.fn(), throws = storage(), silent = storage(), changed = storage(), malformed = storage();
    throws.setItem.mockImplementation(() => { throw new Error("Quota"); }); silent.setItem.mockImplementation(() => undefined);
    persistMemberRoleAttempt(changed, scope, makeMemberRoleAttempt(scope, "editor", { ...request, targetUserId: requestId, requestId: targetUserId }));
    malformed.setItem(memberRoleStorageKey(scope), "{");
    for (const local of [throws, silent, changed, malformed]) await expect(runMemberRoleAttempt(local, scope, attempt, false, send)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it("retries byte-identical intent after response loss and separates read-only lookup", async () => {
    const local = storage(), send = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce(Response.json({ data: receipt, meta: { replayed: true } })).mockResolvedValueOnce(Response.json({ data: receipt }));
    await expect(runMemberRoleAttempt(local, scope, attempt, false, send)).rejects.toThrow("Connection lost");
    const restored = restoreMemberRoleAttempt(local.getItem(memberRoleStorageKey(scope)), scope)!;
    expect(await runMemberRoleAttempt(local, scope, restored, false, send)).toEqual(receipt);
    expect(send.mock.calls[0]![1]).toEqual(send.mock.calls[1]![1]);
    expect(await runMemberRoleAttempt(local, scope, restored, true, send)).toEqual(receipt);
    expect(send.mock.calls[2]).toEqual([memberRoleLookupPath(attempt), { method: "GET", cache: "no-store" }]);
    expect(local.removeItem).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 409, 422, 503])("retains exact recovery even after HTTP %s", async status => {
    const local = storage(), send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: "not_found", message: "Earlier request may still finish." } }, { status }));
    await expect(runMemberRoleAttempt(local, scope, attempt, true, send)).rejects.toThrow("may still finish");
    expect(restoreMemberRoleAttempt(local.getItem(memberRoleStorageKey(scope)), scope)).toEqual(attempt); expect(local.removeItem).not.toHaveBeenCalled();
  });
  it.each([{ workspaceId: targetUserId }, { targetUserId: workspaceId }, { requestId: workspaceId }, { previousRole: "analyst" }, { newRole: "admin" },
    { newRole: "owner" }, { revision: 3 }, { revision: 5 }, { reason: "Wrong" }, { canonicalRequest: "private" }, { createdAt: "invalid" }])
    ("rejects mismatched or over-broad receipt %j", patch => { expect(() => parseMemberRoleReceipt({ ...receipt, ...patch }, attempt)).toThrow(); });
  it("bounds response media/bytes/UTF-8 and requires an exact closed envelope", async () => {
    expect(await readMemberRoleResponse(Response.json({ data: receipt }))).toEqual({ data: receipt });
    for (const response of [new Response("{}"), new Response(null, { headers: { "content-type": "application/json" } }),
      Response.json({}, { headers: { "content-length": "8193" } }), new Response(" ".repeat(8193), { headers: { "content-type": "application/json" } }),
      new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } })]) await expect(readMemberRoleResponse(response)).rejects.toThrow();
    for (const data of [{ data: receipt, actors: [userId] }, { data: { ...receipt, reason: "Wrong" } }, { data: receipt, meta: { replayed: "true" } }]) {
      await expect(runMemberRoleAttempt(storage(), scope, attempt, true, vi.fn<typeof fetch>().mockResolvedValue(Response.json(data)))).rejects.toThrow();
    }
  });
  it("clears only the exact retained local value and verifies removal", () => {
    const local = storage(); persistMemberRoleAttempt(local, scope, attempt); const raw = local.getItem(memberRoleStorageKey(scope));
    expect(() => clearMemberRoleAttempt(local, scope, undefined)).toThrow(); expect(() => clearMemberRoleAttempt(local, scope, "different")).toThrow();
    expect(local.removeItem).not.toHaveBeenCalled(); local.removeItem.mockImplementationOnce(() => undefined);
    expect(() => clearMemberRoleAttempt(local, scope, raw)).toThrow(); clearMemberRoleAttempt(local, scope, raw);
    expect(local.getItem(memberRoleStorageKey(scope))).toBeNull();
  });
  it("describes current authority honestly and withholds interactive SSR until recovery is read", () => {
    expect(MEMBER_ROLE_CHOICES).not.toContain("owner"); expect(Object.keys(MEMBER_ROLE_DESCRIPTIONS)).toEqual([...MEMBER_ROLE_CHOICES]);
    const boundary = renderToStaticMarkup(createElement(MemberRoleBoundary));
    expect(boundary).toContain("non-owner"); expect(boundary).toContain("membership creation/removal are excluded"); expect(boundary).toContain("already completed or admitted work");
    const server = renderToStaticMarkup(createElement(WorkspaceMemberRoleForm, { ...scope, members: [] }));
    expect(server).toContain("Loading saved member-role requests"); expect(server).not.toContain("<form");
  });
});
