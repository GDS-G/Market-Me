import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignFinalizationError, CampaignValidationError, ExactPreviewReadError } from "@market-me/database";

const mocks = vi.hoisted(() => ({ access: vi.fn(), finalize: vi.fn(), lookup: vi.fn(), selection: vi.fn(), publish: vi.fn(), activate: vi.fn(), apiError: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireWorkspaceAccess: mocks.access }));
vi.mock("@/server/database", () => ({ getCampaignFinalizationRepository: () => ({ finalize: mocks.finalize, getByKey: mocks.lookup, getPreviewSelection: mocks.selection }),
  getCampaignRepository: () => ({ publishCampaign: mocks.publish, activateCampaign: mocks.activate }) }));
vi.mock("./api-response", () => ({ apiError: mocks.apiError }));
vi.mock("@/server/campaign-finalization-api", () => import("./campaign-finalization-api"));
vi.mock("@/server/campaign-preparation-api", () => import("./campaign-preparation-api"));
vi.mock("@/server/campaign-version-action-api", () => import("./campaign-version-action-api"));
import { GET, POST } from "../app/api/v1/campaign-finalizations/route";
import { GET as SELECT } from "../app/api/v1/campaign-preparations/[id]/preview-selection/route";
import { POST as PUBLISH } from "../app/api/v1/campaigns/[id]/publish/route";
import { POST as ACTIVATE } from "../app/api/v1/campaigns/[id]/activate/route";

const uuid = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const workspaceId = uuid(1), userId = uuid(2), idempotencyKey = uuid(3), id = uuid(4), preparationId = uuid(5), campaignId = uuid(6);
const input = { workspaceId, preparationId, expectedPlanningVersionId: uuid(7), draftId: uuid(8), expectedDraftVersionId: uuid(9), previewId: uuid(4),
  expectedPreviewFingerprint: `mm-preview-v1:sha256:${"a".repeat(64)}`, timing: { type: "exact_time", scheduledAt: "2026-10-01T10:30:42.125-05:00" } };
const receipt = { id, workspaceId, preparationId, campaignId };
const post = (body: unknown = { input, idempotencyKey }, origin: string | null = "http://localhost:3119") => new Request("http://localhost:3119/api", {
  method: "POST", headers: { "content-type": "application/json", ...(origin === null ? {} : { origin }) }, body: JSON.stringify(body),
});
const get = (query = `workspaceId=${workspaceId}&idempotencyKey=${idempotencyKey}`) => new Request(`http://localhost:3119/api?${query}`);
const context = (value = id) => ({ params: Promise.resolve({ id: value }) });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("APP_BASE_URL", "http://localhost:3119");
  mocks.access.mockResolvedValue({ user: { id: userId }, workspace: { workspaceId } });
  mocks.finalize.mockResolvedValue({ finalization: receipt, replayed: false }); mocks.lookup.mockResolvedValue(receipt);
  mocks.selection.mockResolvedValue({ token: input.expectedPreviewFingerprint, canonicalSnapshot: "exact raw snapshot", snapshot: { preview: { renderedContent: "Café 🚀" } } });
  mocks.publish.mockResolvedValue({ id: campaignId }); mocks.activate.mockResolvedValue({ id });
  mocks.apiError.mockImplementation(() => Response.json({ error: { code: "forbidden" } }, { status: 403 }));
});
afterEach(() => vi.unstubAllEnvs());

describe("finalization request authority", () => {
  it.each([null, "", "null", "https://evil.test", "http://localhost:3119/", "http://localhost:3119/path", "http://user@localhost:3119"])("rejects Origin %s before database/auth work", async (origin) => {
    expect((await POST(post(undefined, origin))).status).toBe(403); expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.finalize).not.toHaveBeenCalled();
  });
  it("requires explicit valid APP_BASE_URL without request-host fallback", async () => {
    for (const value of [undefined, "", "not-a-url", "http://localhost:3119/path", "http://user:pass@localhost:3119"]) {
      vi.stubEnv("APP_BASE_URL", value); expect((await POST(post())).status).toBe(403);
    }
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it("maps malformed JSON to 422 without authorization lookup", async () => {
    expect((await POST(new Request("http://localhost:3119/api", { method: "POST", headers: { origin: "http://localhost:3119" }, body: "{" }))).status).toBe(422);
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it.each([{ input }, { input, idempotencyKey: "bad" }, { input, idempotencyKey, actorUserId: userId },
    { input: { ...input, snapshot: {} }, idempotencyKey }, { input: { ...input, workspaceId: "bad" }, idempotencyKey },
    { input: { ...input, expectedPreviewFingerprint: "id-only" }, idempotencyKey },
    { input: { ...input, timing: { type: "immediate", end: "2026-10-01T00:00:00Z" } }, idempotencyKey }])("rejects invalid or authority-bearing input", async (body) => {
    expect((await POST(post(body))).status).toBe(422); expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.finalize).not.toHaveBeenCalled();
  });
  it("normalizes explicit timing but preserves exact fingerprint and authenticated actor", async () => {
    const response = await POST(post()); expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(workspaceId, "write");
    expect(mocks.finalize).toHaveBeenCalledExactlyOnceWith({ ...input, templateVersion: 1, timing: { type: "exact_time", scheduledAt: "2026-10-01T15:30:42.125Z" } }, idempotencyKey, userId);
    expect(await response.json()).toEqual({ data: receipt, meta: { replayed: false } });
  });
  it("returns the original receipt on explicit replay without looping", async () => {
    mocks.finalize.mockResolvedValue({ finalization: receipt, replayed: true });
    const response = await POST(post()); expect(response.status).toBe(200); expect(mocks.finalize).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({ data: receipt, meta: { replayed: true } });
  });
  it.each(["viewer", "approver", "revoked", "unauthenticated"])("does not finalize with rejected %s authority", async () => {
    mocks.access.mockRejectedValue(new Error("Rejected")); expect((await POST(post())).status).toBe(403); expect(mocks.finalize).not.toHaveBeenCalled();
  });
  it.each([["access_denied", 403], ["invalid_idempotency_key", 422], ["preparation_unavailable", 404], ["package_unavailable", 404],
    ["preview_changed", 409], ["window_expired", 409], ["campaign_changed", 409], ["package_version_mismatch", 409], ["already_finalized", 409], ["idempotency_conflict", 409]] as const)("reports %s as %s without automatic retry", async (code, status) => {
    mocks.finalize.mockRejectedValue(new CampaignFinalizationError(code, "Review the exact current plan.", id));
    const response = await POST(post()); expect(response.status).toBe(status); expect(mocks.finalize).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({ error: { code, existingFinalizationId: id } });
  });
});

describe("read-only finalization and exact preview lookups", () => {
  it("checks current read membership for exact saved-key recovery", async () => {
    const response = await GET(get()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(workspaceId); expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith(workspaceId, idempotencyKey, userId);
    expect(mocks.finalize).not.toHaveBeenCalled();
  });
  it.each(["", `workspaceId=bad&idempotencyKey=${idempotencyKey}`, `workspaceId=${workspaceId}&idempotencyKey=bad`,
    `workspaceId=${workspaceId}&workspaceId=${workspaceId}&idempotencyKey=${idempotencyKey}`, `workspaceId=${workspaceId}&idempotencyKey=${idempotencyKey}&actorUserId=${userId}`])("rejects malformed lookup %s before DB", async (query) => {
    expect((await GET(get(query))).status).toBe(422); expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it("reports no completed result without claiming a pending request cannot finish", async () => {
    mocks.lookup.mockResolvedValue(undefined); const response = await GET(get()); expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("returns displayed preview and token from one scoped repository call", async () => {
    const response = await SELECT(get(`workspaceId=${workspaceId}&previewId=${id}`), context(preparationId));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: await mocks.selection.mock.results[0].value });
    expect(mocks.selection).toHaveBeenCalledExactlyOnceWith(workspaceId, preparationId, id, userId); expect(mocks.access).toHaveBeenCalledWith(workspaceId);
    expect(mocks.finalize).not.toHaveBeenCalled();
  });
  it.each(["", `workspaceId=${workspaceId}&previewId=bad`, `workspaceId=${workspaceId}&previewId=${id}&previewId=${id}`, `workspaceId=${workspaceId}&previewId=${id}&token=untrusted`])("rejects ambiguous exact selection query %s", async (query) => {
    expect((await SELECT(get(query), context(preparationId))).status).toBe(422); expect(mocks.access).not.toHaveBeenCalled();
  });
  it("validates preparation ID before read membership or database lookup", async () => {
    expect((await SELECT(get(`workspaceId=${workspaceId}&previewId=${id}`), context("bad"))).status).toBe(422); expect(mocks.selection).not.toHaveBeenCalled();
  });
  it("maps stale preview to a review-again conflict without issuing a token", async () => {
    mocks.selection.mockRejectedValue(new ExactPreviewReadError("render_changed", "Changed"));
    const response = await SELECT(get(`workspaceId=${workspaceId}&previewId=${id}`), context(preparationId));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: { code: "render_changed" } });
  });
  it("denies a revoked selection before loading any preview", async () => {
    mocks.access.mockRejectedValue(new Error("Revoked")); expect((await SELECT(get(`workspaceId=${workspaceId}&previewId=${id}`), context(preparationId))).status).toBe(403); expect(mocks.selection).not.toHaveBeenCalled();
  });
});

describe.each([["publish", PUBLISH], ["activate", ACTIVATE]] as const)("pinned %s action", (_name, action) => {
  it("forwards one expected version and never saves a campaign draft first", async () => {
    const response = await action(post({ workspaceId, expectedVersionId: id }), context(campaignId));
    expect(response.status).toBe(action === PUBLISH ? 200 : 202);
    if (action === PUBLISH) expect(mocks.publish).toHaveBeenCalledExactlyOnceWith(workspaceId, campaignId, { expectedVersionId: id });
    else expect(mocks.activate).toHaveBeenCalledExactlyOnceWith({ workspaceId, campaignId, actorUserId: userId, expectedVersionId: id });
  });
  it("requires configured same-origin requests", async () => {
    expect((await action(post({ workspaceId, expectedVersionId: id }, null), context(campaignId))).status).toBe(403); expect(mocks.access).not.toHaveBeenCalled();
  });
  it("rejects invalid expected versions and unknown fields before database access", async () => {
    for (const body of [{ workspaceId, expectedVersionId: "bad" }, { workspaceId, expectedVersionId: id, snapshot: {} }, {}]) {
      expect((await action(post(body), context(campaignId))).status).toBe(422);
    }
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it("maps an atomic changed-version conflict to 409", async () => {
    mocks.publish.mockRejectedValue(new CampaignValidationError([{ code: "campaign_version_changed", message: "The version changed." }]));
    mocks.activate.mockRejectedValue(new CampaignValidationError([{ code: "campaign_version_changed", message: "The version changed." }]));
    expect((await action(post({ workspaceId, expectedVersionId: id }), context(campaignId))).status).toBe(409);
  });
});
