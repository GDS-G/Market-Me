import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignPreparationError, CampaignValidationError } from "@market-me/database";

const mocks = vi.hoisted(() => ({ access: vi.fn(), prepare: vi.fn(), lookup: vi.fn(), apiError: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireWorkspaceAccess: mocks.access }));
vi.mock("@/server/database", () => ({ getCampaignPreparationRepository: () => ({ prepare: mocks.prepare, getByKey: mocks.lookup }) }));
vi.mock("./api-response", () => ({ apiError: mocks.apiError }));
vi.mock("@/server/campaign-preparation-api", () => import("./campaign-preparation-api"));
import { GET, POST } from "../app/api/v1/campaign-preparations/route";
import { preparationOriginAllowed } from "./campaign-preparation-api";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const contentPackageId = "22222222-2222-4222-8222-222222222222";
const idempotencyKey = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const id = "55555555-5555-4555-8555-555555555555";
const input = { workspaceId, contentPackageId, expectedPackageVersion: 7, name: "Café 🚀 launch" };
const receipt = { id, workspaceId, createdBy: userId };
function post(body: unknown = { input, idempotencyKey }, origin: string | null = "http://localhost:3119") {
  return new Request("http://localhost:3119/api/v1/campaign-preparations", { method: "POST",
    headers: { "content-type": "application/json", ...(origin === null ? {} : { origin }) }, body: JSON.stringify(body) });
}
const lookup = (query = `workspaceId=${workspaceId}&idempotencyKey=${idempotencyKey}`) => new Request(`http://localhost:3119/api/v1/campaign-preparations?${query}`);
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("APP_BASE_URL", "http://localhost:3119");
  mocks.access.mockResolvedValue({ user: { id: userId }, workspace: { workspaceId } });
  mocks.prepare.mockResolvedValue({ preparation: receipt, replayed: false }); mocks.lookup.mockResolvedValue(receipt);
  mocks.apiError.mockImplementation((error) => Response.json({ error: { code: "fallback" } }, { status: error instanceof CampaignValidationError ? 422 : 403 }));
});
afterEach(() => vi.unstubAllEnvs());

describe("preparation mutation authority", () => {
  it.each([null, "", "null", "https://evil.example", "http://localhost:3119/path", "http://localhost:3119/", "http://user@localhost:3119"])("denies invalid or foreign Origin %s before any authority or storage lookup", async (origin) => {
    expect((await POST(post(undefined, origin))).status).toBe(403);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("requires explicit valid APP_BASE_URL and does not trust request Host", async () => {
    vi.stubEnv("APP_BASE_URL", undefined);
    expect((await POST(post())).status).toBe(403);
    expect((await POST(post(undefined, "http://localhost:3000"))).status).toBe(403);
    for (const base of ["invalid", "https://host.test/path", "ftp://localhost:3119", "http://user:secret@localhost:3119"]) {
      vi.stubEnv("APP_BASE_URL", base); expect((await POST(post())).status).toBe(403);
    }
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
    expect(preparationOriginAllowed("https://example.test", "https://example.test/")).toBe(true);
  });
  it("rejects malformed JSON with 422 before accessing the workspace", async () => {
    const request = new Request("http://localhost:3119/api", { method: "POST", headers: { origin: "http://localhost:3119" }, body: "{" });
    expect((await POST(request)).status).toBe(422); expect(mocks.access).not.toHaveBeenCalled();
  });
  it.each([
    { input }, { input, idempotencyKey: "bad" }, { input, idempotencyKey, actorUserId: userId },
    { input: { ...input, workspaceId: "bad" }, idempotencyKey },
    { input: { ...input, autonomyMode: "autonomous" }, idempotencyKey },
    { input: { ...input, context: {} }, idempotencyKey },
    { input: { ...input, expectedPackageVersion: "7" }, idempotencyKey },
  ])("rejects malformed or authority-bearing input before the database", async (body) => {
    expect((await POST(post(body))).status).toBe(422); expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it.each(["viewer", "approver", "revoked", "unauthenticated"])("does not prepare for rejected %s authority", async () => {
    mocks.access.mockRejectedValue(new Error("Permission denied"));
    expect((await POST(post())).status).toBe(403);
    expect(mocks.access).toHaveBeenCalledWith(workspaceId, "write"); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("passes normalized compiler input, one exact key, and the authenticated actor", async () => {
    const response = await POST(post({ input: { ...input, name: "  Café   🚀 launch  " }, idempotencyKey }));
    expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: receipt, meta: { replayed: false } });
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ...input, name: "Café 🚀 launch", templateKey: "general_announcement", templateVersion: 1, audienceProfileVersionIds: [] }), idempotencyKey, userId);
  });
  it("returns the same completed receipt with 200 on explicit retry", async () => {
    mocks.prepare.mockResolvedValue({ preparation: receipt, replayed: true });
    const response = await POST(post()); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: receipt, meta: { replayed: true } });
  });
  it.each([
    ["access_denied", 403], ["invalid_idempotency_key", 422], ["package_unavailable", 404],
    ["package_not_approved", 409], ["package_version_mismatch", 409], ["brand_unavailable", 409],
    ["audience_unavailable", 409], ["destination_unavailable", 409], ["planning_version_conflict", 409],
  ] as const)("maps atomic %s failure without retrying", async (code, status) => {
    mocks.prepare.mockRejectedValue(new CampaignPreparationError(code, "Review the current choice."));
    const response = await POST(post()); expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } }); expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });
  it("provides a conflicted key's existing receipt for explicit review", async () => {
    mocks.prepare.mockRejectedValue(new CampaignPreparationError("idempotency_conflict", "Different settings", id));
    const response = await POST(post()); expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { existingPreparationId: id } });
  });
  it("retains existing policy-validation handling", async () => {
    mocks.prepare.mockRejectedValue(new CampaignValidationError([{ code: "communication_policy", message: "Profile ceiling exceeded" }]));
    expect((await POST(post())).status).toBe(422); expect(mocks.apiError).toHaveBeenCalledOnce();
  });
});

describe("manual preparation lookup", () => {
  it("uses explicit current read membership, exact key, and no mutation", async () => {
    const response = await GET(lookup()); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.access).toHaveBeenCalledWith(workspaceId);
    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith(workspaceId, idempotencyKey, userId);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it.each(["", `workspaceId=bad&idempotencyKey=${idempotencyKey}`, `workspaceId=${workspaceId}&idempotencyKey=bad`, `workspaceId=${workspaceId}&workspaceId=${workspaceId}&idempotencyKey=${idempotencyKey}`, `workspaceId=${workspaceId}&idempotencyKey=${idempotencyKey}&actorUserId=${userId}`])("rejects ambiguous or invalid query %s before DB access", async (query) => {
    expect((await GET(lookup(query))).status).toBe(422); expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("returns an uncached 404 without implying the original POST cannot still finish", async () => {
    mocks.lookup.mockResolvedValue(undefined);
    const response = await GET(lookup()); expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("rechecks membership and denies a revoked lookup", async () => {
    mocks.access.mockRejectedValue(new Error("Revoked"));
    expect((await GET(lookup())).status).toBe(403); expect(mocks.lookup).not.toHaveBeenCalled();
  });
});
