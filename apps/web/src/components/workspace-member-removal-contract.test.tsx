import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMBER_REMOVAL_BROWSER_LIMITS, MEMBER_REMOVAL_IMPACT_LABELS, createMemberRemovalGate, loadMemberRemovalPreview,
  makeMemberRemovalAttempt, memberRemovalLookupPath, normalizeMemberRemovalReason, parseMemberRemovalPreview, parseMemberRemovalReceipt,
  readMemberRemovalResponse, runMemberRemovalAttempt, type MemberRemovalPreview } from "./workspace-member-removal-contract";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./workspace-member-removal-panel.module.css", () => ({ default: {} }));
import { WorkspaceMemberRemovalPanel } from "./workspace-member-removal-panel";
const userId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222", target = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444", grant = "55555555-5555-4555-8555-555555555555", scope = { userId, workspaceId };
const impact = Object.fromEntries(Object.keys(MEMBER_REMOVAL_IMPACT_LABELS).map(key => [key, "0"])) as MemberRemovalPreview["impact"];
const snapshot: MemberRemovalPreview = { workspaceId, target: { userId: target, displayName: "Synthetic collaborator", role: "editor", incarnationId: grant, revision: 3 },
  observedAt: "2026-10-02T00:00:00.000Z", impact, impactFingerprint: "a".repeat(64), blocked: false };
const attempt = makeMemberRemovalAttempt(scope, snapshot, requestId, "Reviewed transition"), receipt = { ...attempt.request, previousRole: "editor", revision: 4, revokedAt: snapshot.observedAt, impact };
const response = (value: unknown = { data: receipt }, status = 200) => Response.json(value, { status });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("independent member removal browser contracts", () => {
  it("pins one exact deeply frozen reviewed intent without server authority or persistence", () => {
    expect(attempt.request).toEqual({ workspaceId, targetUserId: target, requestId, expectedIncarnationId: grant, expectedRevision: 3,
      impactFingerprint: "a".repeat(64), reason: "Reviewed transition" });
    for (const value of [attempt, attempt.request, attempt.preview, attempt.preview.target, attempt.preview.impact, MEMBER_REMOVAL_BROWSER_LIMITS, MEMBER_REMOVAL_IMPACT_LABELS]) expect(Object.isFrozen(value)).toBe(true);
    expect(memberRemovalLookupPath(attempt.request)).toBe(`/api/v1/workspace-member-removals?workspaceId=${workspaceId}&requestId=${requestId}`);
    expect(memberRemovalLookupPath(attempt.request)).not.toContain(target);
  });
  it.each([{ workspaceId: target }, { target: { ...snapshot.target, userId } }, { target: { ...snapshot.target, role: "owner" } }, { target: { ...snapshot.target, incarnationId: "bad" } },
    { target: { ...snapshot.target, email: "private" } }, { impactFingerprint: "A".repeat(64) }, { impact: { ...impact, privateBodies: "1" } },
    { impact: { ...impact, assignedConversations: 1 } }, { impact: { ...impact, assignedConversations: "01" } }, { impact: { ...impact, assignedConversations: "-1" } },
    { impact: { ...impact, assignedConversations: "1".repeat(20) } }, { impact: { ...impact, pendingIncomingInvitations: "1" } }, { blocked: true }, { observedAt: "bad" }, { email: "private" }])
    ("rejects malformed/protected/incoherent preview %j", patch => { expect(() => parseMemberRemovalPreview({ ...snapshot, ...patch }, scope, target)).toThrow(); });
  it("preserves exact large count strings and requires explicit resolution of invitation blockers", () => {
    const large = parseMemberRemovalPreview({ ...snapshot, impact: { ...impact, assignedConversations: "9007199254740993" } }, scope, target);
    expect(large.impact.assignedConversations).toBe("9007199254740993");
    const blocked = parseMemberRemovalPreview({ ...snapshot, impact: { ...impact, pendingIssuedInvitations: "2" }, blocked: true }, scope, target);
    expect(() => makeMemberRemovalAttempt(scope, blocked, requestId, "Reason")).toThrow();
    expect(() => makeMemberRemovalAttempt(scope, { ...snapshot, target: { ...snapshot.target, revision: 2147483647 } }, requestId, "Reason")).toThrow();
  });
  it.each(["", "  ", "x\nreason", "x\u0085", "x\u202e", "x\ud800", "x".repeat(501)])("rejects unsafe reason %j", reason => {
    expect(() => normalizeMemberRemovalReason(reason)).toThrow();
  });
  it("normalizes bounded multilingual review reasons", () => {
    expect(normalizeMemberRemovalReason("  Cafe\u0301   チーム変更 🌱  ")).toBe("Café チーム変更 🌱");
    expect(normalizeMemberRemovalReason("x".repeat(500))).toHaveLength(500);
  });
  it.each([{ workspaceId: target }, { targetUserId: userId }, { requestId: target }, { expectedIncarnationId: target }, { expectedRevision: 4 },
    { impactFingerprint: "b".repeat(64) }, { reason: "Other" }, { previousRole: "viewer" }, { revision: 5 }, { revokedAt: "bad" },
    { impact: { ...impact, activeCampaignRuns: "1" } }, { createdBy: userId }, { canonicalRequest: "private" }])("rejects mismatched or overbroad receipt %j", patch => {
    expect(() => parseMemberRemovalReceipt({ ...receipt, ...patch }, attempt)).toThrow();
  });
  it("performs preview GET, one explicit POST and a separate read-only recovery GET with strict options", async () => {
    const signal = new AbortController().signal;
    const send = vi.fn().mockResolvedValueOnce(response({ data: snapshot })).mockResolvedValueOnce(response({ data: receipt, meta: { replayed: false } }, 201)).mockResolvedValueOnce(response());
    expect(await loadMemberRemovalPreview(scope, target, signal, send)).toEqual(snapshot);
    expect(send).toHaveBeenNthCalledWith(1, `/api/v1/workspace-member-removals?workspaceId=${workspaceId}&targetUserId=${target}`,
      { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal });
    expect(await runMemberRemovalAttempt(attempt, scope, false, signal, send)).toEqual(receipt);
    expect(send).toHaveBeenNthCalledWith(2, "/api/v1/workspace-member-removals", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
      headers: { "content-type": "application/json" }, body: JSON.stringify(attempt.request) });
    expect(await runMemberRemovalAttempt(attempt, scope, true, signal, send)).toEqual(receipt);
    expect(send).toHaveBeenNthCalledWith(3, memberRemovalLookupPath(attempt.request), { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal });
  });
  it.each([{ ...scope, userId: requestId }, { ...scope, workspaceId: target }])("rejects changed scope before any transport %j", async changed => {
    const send = vi.fn(); await expect(runMemberRemovalAttempt(attempt, changed, false, new AbortController().signal, send)).rejects.toThrow(); expect(send).not.toHaveBeenCalled();
  });
  it("rejects altered request bytes or changed reviewed role before sending", async () => {
    const send = vi.fn();
    for (const changed of [{ ...attempt, request: { ...attempt.request, expectedRevision: 4 } }, { ...attempt, request: { ...attempt.request, targetUserId: requestId } },
      { ...attempt, request: { ...attempt.request, actorUserId: userId } }]) await expect(runMemberRemovalAttempt(changed, scope, false, new AbortController().signal, send)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 409, 422, 500, 503])("keeps status %s guidance private and never automatically resends", async status => {
    const send = vi.fn().mockResolvedValue(response({ error: { message: "PRIVATE SERVER DETAIL" } }, status)); let error: unknown;
    try { await runMemberRemovalAttempt(attempt, scope, true, new AbortController().signal, send); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain("PRIVATE"); expect(send).toHaveBeenCalledTimes(1);
    if (status === 404) expect(String(error)).toContain("may still finish");
  });
  it("never resends after response loss and rejects unexpected success/envelope fields", async () => {
    const lost = vi.fn().mockRejectedValue(new Error("Network loss"));
    await expect(runMemberRemovalAttempt(attempt, scope, false, new AbortController().signal, lost)).rejects.toThrow(); expect(lost).toHaveBeenCalledTimes(1);
    for (const payload of [response({}, 202), response({ data: receipt }, 201), response({ data: receipt, private: true }), response({ data: receipt, meta: { replayed: true, private: true } })]) {
      const send = vi.fn().mockResolvedValue(payload); await expect(runMemberRemovalAttempt(attempt, scope, true, new AbortController().signal, send)).rejects.toThrow(); expect(send).toHaveBeenCalledTimes(1);
    }
  });
  it("rejects response media/advertised size/streamed size/invalid UTF-8 or absent body", async () => {
    expect(await readMemberRemovalResponse(response({}))).toEqual({});
    for (const value of [new Response("{}"), new Response(null, { headers: { "content-type": "application/json" } }),
      Response.json({}, { headers: { "content-length": "16385" } }), new Response("x".repeat(16385), { headers: { "content-type": "application/json" } }),
      new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } })]) await expect(readMemberRemovalResponse(value)).rejects.toThrow();
  });
  it("checks cancellation before dispatch and after response resolution", async () => {
    const before = new AbortController(); before.abort(); const none = vi.fn();
    await expect(loadMemberRemovalPreview(scope, target, before.signal, none)).rejects.toThrow();
    await expect(runMemberRemovalAttempt(attempt, scope, false, before.signal, none)).rejects.toThrow(); expect(none).not.toHaveBeenCalled();
    const after = new AbortController(), send = vi.fn().mockImplementation(async () => { after.abort(); return response(); });
    await expect(runMemberRemovalAttempt(attempt, scope, false, after.signal, send)).rejects.toThrow(); expect(send).toHaveBeenCalledTimes(1);
  });
  it("blocks reentrant requests, expires at 15 seconds and does not let stale completion unlock a newer operation", () => {
    vi.useFakeTimers(); const gate = createMemberRemovalGate(), first = gate.begin()!; expect(gate.begin()).toBeUndefined();
    vi.advanceTimersByTime(15_000); expect(first.signal.aborted).toBe(true); expect(first.current()).toBe(false);
    expect(gate.begin()).toBeUndefined(); gate.cancel(); expect(vi.getTimerCount()).toBe(0);
    const second = gate.begin()!; first.finish(); expect(second.current()).toBe(true); expect(gate.begin()).toBeUndefined();
    second.finish(); expect(vi.getTimerCount()).toBe(0); gate.cancel();
  });
  it("renders only eligible review buttons, never an initial removal form or self/owner action", () => {
    const members = [{ userId: target, displayName: "Synthetic collaborator", role: "editor", canChangeRole: true },
      { userId, displayName: "Self", role: "admin", canChangeRole: true }, { userId: grant, displayName: "Owner", role: "owner", canChangeRole: true }];
    const html = renderToStaticMarkup(createElement(WorkspaceMemberRemovalPanel, { ...scope, members }));
    expect(html).toContain("Review access removal · Synthetic collaborator"); expect(html).not.toContain("Review access removal · Self"); expect(html).not.toContain("Review access removal · Owner");
    expect(html).not.toContain('type="submit"'); expect(html).not.toContain("<form"); expect(html).toContain("personal sign-in sessions");
    expect(html).not.toMatch(/tokenHash|canonicalRequest|localStorage|sessionStorage/);
    expect(renderToStaticMarkup(createElement(WorkspaceMemberRemovalPanel, { ...scope, members: [] }))).toContain("No removable collaborators");
  });
  it("uses minimum touch sizing and visible keyboard focus for review/confirmation", () => {
    const css = readFileSync(new URL("./workspace-member-removal-panel.module.css", import.meta.url), "utf8");
    expect(css).toContain("min-height: 44px"); expect(css).toContain("outline: 3px solid");
  });
});
