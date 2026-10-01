import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { makeWorkspaceAttempt, normalizeWorkspaceName, parseWorkspaceReceipt, persistWorkspaceAttempt, readWorkspaceResponse,
  restoreWorkspaceAttempt, runWorkspaceAttempt, workspaceLookupPath, workspaceStorageKey, type WorkspaceScope } from "./workspace-management-contract";
import { WorkspaceManagementBoundary, WorkspaceManagementForm } from "./workspace-management-form";
const userId = "11111111-1111-4111-8111-111111111111", organizationId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333", requestId = "44444444-4444-4444-8444-444444444444";
const scope: WorkspaceScope = { operation: "create", userId, organizationId };
const renameScope: WorkspaceScope = { operation: "rename", userId, organizationId, workspaceId };
const request = { operation: "create" as const, organizationId, requestId, name: "Café team" };
const attempt = makeWorkspaceAttempt(scope, request);
const receipt = { organizationId, workspaceId, requestId, operation: "create", name: request.name, revision: 1, createdAt: "2026-10-01T00:00:00.000Z" };
function storage() {
  const values = new Map<string, string>(); return {
    getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
}
describe("workspace exact browser recovery and scoped response contract", () => {
  it("normalizes Unicode/spaces in the same way as the server", () => {
    expect(normalizeWorkspaceName("  Cafe\u0301\u00a0 team ")).toBe("Café team");
    for (const bad of ["", " ", "x".repeat(121), "Name\n", "Name\t", "Name\u007f", "Name\0"]) expect(() => normalizeWorkspaceName(bad)).toThrow();
    expect(normalizeWorkspaceName("😀".repeat(60))).toHaveLength(120);
    expect(() => normalizeWorkspaceName("😀".repeat(61))).toThrow();
  });
  it("round-trips a closed versioned exact request and keeps scopes separate", () => {
    expect(restoreWorkspaceAttempt(JSON.stringify(attempt), scope)).toEqual(attempt); expect(restoreWorkspaceAttempt(null, scope)).toBeUndefined();
    const keys = [scope, { ...scope, userId: workspaceId }, { ...scope, organizationId: workspaceId }, renameScope, { ...renameScope, workspaceId: requestId }].map(workspaceStorageKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const invalidScope of [{ ...scope, userId: workspaceId }, { ...scope, organizationId: workspaceId }, renameScope]) {
      expect(() => restoreWorkspaceAttempt(JSON.stringify(attempt), invalidScope)).toThrow();
    }
  });
  it.each([{ version: 2 }, { actorUserId: userId }, { request: { ...request, role: "owner" } }, { request: { ...request, name: " Not normalized " } },
    { request: { ...request, requestId: "not-a-uuid" } }, { request: { operation: "delete", workspaceId, requestId } }])("refuses stale or injected recovery %j", patch => {
    expect(() => restoreWorkspaceAttempt(JSON.stringify({ ...attempt, ...patch }), scope)).toThrow();
  });
  it("bounds local recovery before parsing", () => {
    expect(() => restoreWorkspaceAttempt(" ".repeat(8193), scope)).toThrow();
    expect(() => restoreWorkspaceAttempt("{" + "😀".repeat(2048), scope)).toThrow();
    expect(() => restoreWorkspaceAttempt("{", scope)).toThrow();
  });
  it("persists the exact request before any network call and keeps it after success", async () => {
    const local = storage(), send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(local.getItem(workspaceStorageKey(scope))).toBe(JSON.stringify(attempt));
      expect(JSON.parse(init!.body as string)).toEqual(request); return Response.json({ data: receipt, meta: { replayed: false } }, { status: 201 });
    });
    expect(await runWorkspaceAttempt(local, scope, attempt, false, send)).toEqual(receipt);
    expect(local.removeItem).not.toHaveBeenCalled(); expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not send anything when storage throws, silently fails or contains a different request", async () => {
    const send = vi.fn();
    const throws = storage(); throws.setItem.mockImplementation(() => { throw new Error("Quota"); });
    const silent = storage(); silent.setItem.mockImplementation(() => undefined);
    const changed = storage(); persistWorkspaceAttempt(changed, scope, makeWorkspaceAttempt(scope, { ...request, requestId: workspaceId }));
    const malformed = storage(); malformed.setItem(workspaceStorageKey(scope), "{");
    for (const local of [throws, silent, changed, malformed]) await expect(runWorkspaceAttempt(local, scope, attempt, false, send)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it("reuses identical bytes and key after a dropped response, and performs a read-only result check", async () => {
    const local = storage(), send = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce(Response.json({ data: receipt, meta: { replayed: true } }))
      .mockResolvedValueOnce(Response.json({ data: receipt }));
    await expect(runWorkspaceAttempt(local, scope, attempt, false, send)).rejects.toThrow("Connection lost");
    const restored = restoreWorkspaceAttempt(local.getItem(workspaceStorageKey(scope)), scope)!;
    expect(await runWorkspaceAttempt(local, scope, restored, false, send)).toEqual(receipt);
    expect(send.mock.calls[0]![1]).toEqual(send.mock.calls[1]![1]);
    expect(await runWorkspaceAttempt(local, scope, restored, true, send)).toEqual(receipt);
    expect(send.mock.calls[2]).toEqual([workspaceLookupPath(attempt), { method: "GET", cache: "no-store" }]);
    expect(local.removeItem).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 409, 422, 503])("retains exact recovery even after HTTP %s", async status => {
    const local = storage(), send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: "not_found", message: "Earlier request may still finish." } }, { status }));
    await expect(runWorkspaceAttempt(local, scope, attempt, true, send)).rejects.toThrow("may still finish");
    expect(restoreWorkspaceAttempt(local.getItem(workspaceStorageKey(scope)), scope)).toEqual(attempt); expect(local.removeItem).not.toHaveBeenCalled();
  });
  it.each([{ organizationId: workspaceId }, { requestId: workspaceId }, { operation: "rename" }, { name: "Wrong" }, { revision: 2 },
    { workspaceId: "javascript:bad" }, { canonicalRequest: "private" }, { createdAt: "invalid" }])("rejects mismatched create receipts %j", patch => {
    expect(() => parseWorkspaceReceipt({ ...receipt, ...patch }, attempt)).toThrow();
  });
  it("matches rename scope and expected resulting revision, without treating an old receipt as live state", () => {
    const rename = makeWorkspaceAttempt(renameScope, { operation: "rename", workspaceId, requestId, expectedRevision: 4, name: request.name });
    const result = { ...receipt, operation: "rename", revision: 5 };
    expect(parseWorkspaceReceipt(result, rename)).toEqual(result);
    for (const patch of [{ workspaceId: userId }, { revision: 4 }, { revision: 6 }]) expect(() => parseWorkspaceReceipt({ ...result, ...patch }, rename)).toThrow();
    expect(workspaceLookupPath(rename)).toContain(`workspaceId=${workspaceId}`); expect(workspaceLookupPath(rename)).not.toContain("organizationId=");
  });
  it("bounds response bytes and requires valid JSON media, UTF-8, envelope and receipt", async () => {
    expect(await readWorkspaceResponse(Response.json({ data: receipt }))).toEqual({ data: receipt });
    for (const response of [new Response("{}"), new Response(null, { headers: { "content-type": "application/json" } }),
      Response.json({}, { headers: { "content-length": "8193" } }), new Response(" ".repeat(8193), { headers: { "content-type": "application/json" } }),
      new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } })]) await expect(readWorkspaceResponse(response)).rejects.toThrow();
    for (const data of [{ data: receipt, actors: [userId] }, { data: { ...receipt, name: "Wrong" } }, { data: receipt, meta: { replayed: "true" } }]) {
      await expect(runWorkspaceAttempt(storage(), scope, attempt, true, vi.fn<typeof fetch>().mockResolvedValue(Response.json(data)))).rejects.toThrow();
    }
  });
  it("renders honest creation/rename boundaries and keeps forms locked until browser recovery is read", () => {
    const create = renderToStaticMarkup(createElement(WorkspaceManagementBoundary, { operation: "create", organizationName: "QA organization" }));
    expect(create).toContain("only workspace owner"); expect(create).toContain("no other members"); expect(create).toContain("does not switch");
    const rename = renderToStaticMarkup(createElement(WorkspaceManagementBoundary, { operation: "rename", organizationName: "QA", revision: 4 }));
    expect(rename).toContain("revision: 4"); expect(rename).toContain("Brand/Profile names"); expect(rename).toContain("stay unchanged");
    const server = renderToStaticMarkup(createElement(WorkspaceManagementForm, { ...scope, organizationName: "QA" }));
    expect(server).toContain("Loading saved workspace requests"); expect(server).not.toContain("<form");
  });
});
