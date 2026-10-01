import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, AuthorizationError } from "./auth";
const mocks = vi.hoisted(() => ({ access: vi.fn(), list: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./auth", async importOriginal => ({ ...await importOriginal<typeof import("./auth")>(), requireWorkspaceAccess: mocks.access }));
vi.mock("./database", () => ({ getPreparationPresetRepository: () => mocks }));
vi.mock("@/server/auth", () => import("./auth"));
vi.mock("@/server/database", () => import("./database"));
vi.mock("@/server/preparation-preset-api", () => import("./preparation-preset-api"));
import { GET } from "../app/api/v1/preparation-presets/choices/route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const presetId = "33333333-3333-4333-8333-333333333333";
const request = (query = `workspaceId=${workspaceId}`) => new Request(`https://app.example.test/api/v1/preparation-presets/choices?${query}`);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ user: { id: actor }, workspace: { workspaceId } });
  mocks.list.mockResolvedValue({ more: true, items: [{ workspaceId, id: presetId, revision: 5, latestVersionNumber: 3,
    title: "Weekly", archived: true, notes: "Private notes omitted", updatedAt: "2026-10-01T00:00:00.000Z", canonicalRequest: "never return" }] });
});
afterEach(() => vi.restoreAllMocks());

describe("readonly bounded source preset chooser", () => {
  it("projects only current library selection identity/labels and requires current writer access", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.access).toHaveBeenCalledWith(workspaceId, "write");
    expect(mocks.list).toHaveBeenCalledWith(workspaceId, actor, 1);
    expect(await response.json()).toEqual({ data: { workspaceId, page: 1, more: true,
      items: [{ id: presetId, revision: 5, versionNumber: 3, title: "Weekly", archived: true }] } });
  });
  it("retains exact page scope and supports a bounded empty observation", async () => {
    mocks.list.mockResolvedValue({ items: [], more: false });
    expect(await (await GET(request(`workspaceId=${workspaceId}&page=2000`))).json())
      .toEqual({ data: { workspaceId, page: 2000, items: [], more: false } });
    expect(mocks.list).toHaveBeenCalledWith(workspaceId, actor, 2000);
  });
  it.each(["", "workspaceId=bad", `workspaceId=${workspaceId}&workspaceId=${workspaceId}`,
    `workspaceId=${workspaceId}&page=1&page=2`, `workspaceId=${workspaceId}&page=0`,
    `workspaceId=${workspaceId}&page=2001`, `workspaceId=${workspaceId}&page=1e2`,
    `workspaceId=${workspaceId}&page=01`, `workspaceId=${workspaceId}&requestId=${actor}`])
  ("rejects ambiguous or unbounded query %s before data access", async query => {
    const response = await GET(request(query));
    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("denies unauthenticated and nonwriter access before querying labels", async () => {
    mocks.access.mockRejectedValue(new AuthenticationError());
    expect((await GET(request())).status).toBe(401);
    mocks.access.mockRejectedValue(new AuthorizationError());
    expect((await GET(request())).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("does not disclose persistence details in unavailable responses", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.list.mockRejectedValue(new Error("private query details"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private query details");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private query details");
  });
});
