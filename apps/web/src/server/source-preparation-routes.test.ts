import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourcePreparationError } from "@market-me/database";
import { SOURCE_PREPARATION_BODY_LIMIT_BYTES } from "./source-preparation-api";

const mocks = vi.hoisted(() => ({ access: vi.fn(), save: vi.fn(), getForSource: vi.fn(), apiError: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireWorkspaceAccess: mocks.access }));
vi.mock("@/server/database", () => ({ getSourcePreparationRepository: () => ({
  saveSourcePreparationBinding: mocks.save,
  getSourcePreparationBindingForSource: mocks.getForSource,
}) }));
vi.mock("./api-response", () => ({ apiError: mocks.apiError }));
vi.mock("@/server/source-preparation-api", () => import("./source-preparation-api"));
vi.mock("@/server/source-preparation-schema", () => import("./source-preparation-schema"));
vi.mock("@/server/source-preparation-view", () => import("./source-preparation-view"));
import { GET, PUT } from "../app/api/v1/smart-sources/[id]/preparation-binding/route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const bindingId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const audienceA = "55555555-5555-4555-8555-555555555555";
const audienceB = "66666666-6666-4666-8666-666666666666";
const body = {
  workspaceId,
  enabled: true,
  templateKey: "general_announcement",
  templateVersion: 1,
  name: "General announcement",
  description: "",
  audienceProfileVersionIds: [audienceB, audienceA],
  informationDepth: "contextual",
  promotionalStrength: "informational",
  timezone: "UTC",
};
const binding = { ...body, id: bindingId, smartSourceId: sourceId, revision: 1, writerUserId: userId,
  createdBy: userId, updatedBy: userId, createdAt: "2026-09-15T12:00:00Z", updatedAt: "2026-09-15T12:00:00Z" };

function put(value: unknown = body, origin: string | null = "http://localhost:3119", query = `workspaceId=${workspaceId}`, contentType = "application/json") {
  return new Request(`http://localhost:3119/api/v1/smart-sources/${sourceId}/preparation-binding?${query}`, {
    method: "PUT",
    headers: { ...(origin === null ? {} : { origin }), ...(contentType ? { "content-type": contentType } : {}) },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}
function get(query = `workspaceId=${workspaceId}`) {
  return new Request(`http://localhost:3119/api/v1/smart-sources/${sourceId}/preparation-binding?${query}`);
}
const context = (id = sourceId) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_BASE_URL", "http://localhost:3119");
  mocks.access.mockResolvedValue({ user: { id: userId }, workspace: { workspaceId } });
  mocks.save.mockResolvedValue(binding);
  mocks.getForSource.mockResolvedValue(binding);
  mocks.apiError.mockImplementation(() => Response.json({ error: { code: "forbidden" } }, { status: 403 }));
});
afterEach(() => vi.unstubAllEnvs());

describe("Smart Source preparation binding route", () => {
  it.each([null, "", "null", "https://evil.example", "http://localhost:3119/path", "http://localhost:3119/", "http://user@localhost:3119"])("rejects invalid mutation Origin %s before parsing or authority lookup", async (origin) => {
    const response = await PUT(put(body, origin), context("not-a-uuid"));
    expect(response.status).toBe(403);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it("requires an explicit configured application origin and does not trust request Host", async () => {
    vi.stubEnv("APP_BASE_URL", undefined);
    expect((await PUT(put(), context())).status).toBe(403);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([
    { ...body, actorUserId: userId },
    { ...body, writerUserId: userId },
    { ...body, smartSourceId: sourceId },
    { ...body, expectedRevision: 0 },
    { ...body, expectedRevision: "1" },
    { ...body, audienceProfileVersionIds: [audienceA, audienceA] },
    { ...body, templateVersion: 2 },
    { ...body, timezone: "Not/A_Timezone" },
  ])("rejects malformed or authority-bearing input before workspace access", async (value) => {
    expect((await PUT(put(value), context())).status).toBe(422);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it("bounds and validates the transport before workspace access", async () => {
    expect((await PUT(put(body, "http://localhost:3119", `workspaceId=${workspaceId}`, "text/plain"), context())).status).toBe(415);
    expect((await PUT(put("{", "http://localhost:3119"), context())).status).toBe(422);
    expect((await PUT(put(JSON.stringify({ ...body, description: "x".repeat(SOURCE_PREPARATION_BODY_LIMIT_BYTES) })), context())).status).toBe(413);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([
    ["bad", `workspaceId=${workspaceId}`],
    [sourceId, ""],
    [sourceId, `workspaceId=bad`],
    [sourceId, `workspaceId=${workspaceId}&workspaceId=${workspaceId}`],
    [sourceId, `workspaceId=${workspaceId}&actorUserId=${userId}`],
    [sourceId, `workspaceId=${bindingId}`],
  ])("rejects malformed or ambiguous path/query scope before storage (%s)", async (id, query) => {
    expect((await PUT(put(body, "http://localhost:3119", query), context(id))).status).toBe(422);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it("passes normalized settings, authored audience order, and only the authenticated writer", async () => {
    const response = await PUT(put({ ...body, name: "  General   announcement  ", description: " Notes\r\n" }), context());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(workspaceId, "write");
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ ...body, smartSourceId: sourceId, name: "General announcement", description: "Notes" }, userId);
    expect(mocks.save.mock.calls[0]?.[0].audienceProfileVersionIds).toEqual([audienceB, audienceA]);
    expect(mocks.save.mock.calls[0]?.[0]).not.toHaveProperty("writerUserId");
    expect(mocks.save.mock.calls[0]?.[0]).not.toHaveProperty("actorUserId");
  });

  it("uses current read membership for GET and returns an uncached scoped binding", async () => {
    const response = await GET(get(), context());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(workspaceId);
    expect(mocks.getForSource).toHaveBeenCalledExactlyOnceWith(workspaceId, sourceId, userId);
    const payload = await response.json();
    expect(payload.data).toMatchObject({ id: bindingId, workspaceId, smartSourceId: sourceId, revision: 1 });
    expect(payload.data).not.toHaveProperty("writerUserId"); expect(payload.data).not.toHaveProperty("createdBy");
  });

  it.each(["", `workspaceId=bad`, `workspaceId=${workspaceId}&workspaceId=${workspaceId}`, `workspaceId=${workspaceId}&writerUserId=${userId}`])("rejects malformed GET scope %s before authority lookup", async (query) => {
    expect((await GET(get(query), context())).status).toBe(422);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.getForSource).not.toHaveBeenCalled();
  });

  it("returns an uncached 404 for an unconfigured source", async () => {
    mocks.getForSource.mockResolvedValue(undefined);
    const response = await GET(get(), context());
    expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ error: { code: "binding_unavailable" } });
  });

  it.each([
    ["access_denied", 403], ["invalid_input", 422], ["source_unavailable", 404], ["binding_unavailable", 404],
    ["writer_unavailable", 409], ["brand_unavailable", 409], ["audience_unavailable", 409], ["destination_unavailable", 409],
    ["binding_changed", 409],
  ] as const)("maps %s repository failures without retrying", async (code, status) => {
    mocks.save.mockRejectedValue(new SourcePreparationError(code, "Review current settings."));
    const response = await PUT(put(), context());
    expect(response.status).toBe(status); expect((await response.json())).toMatchObject({ error: { code } });
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
});
