import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentPackageReviewError } from "@market-me/database";
const mocks = vi.hoisted(() => ({ access: vi.fn(), review: vi.fn(), approve: vi.fn(), get: vi.fn(), key: vi.fn(), history: vi.fn(), conflict: vi.fn(), evidence: vi.fn(), accessibility: vi.fn(), rights: vi.fn(), generate: vi.fn(), apiError: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireWorkspaceAccess: mocks.access }));
vi.mock("@/server/database", () => ({ getContentPackageReviewRepository: () => ({ getReview: mocks.review, approve: mocks.approve, getApproval: mocks.get, getApprovalByKey: mocks.key, listApprovalSummaries: mocks.history }),
  getRepository: () => ({ resolveEvidenceConflict: mocks.conflict, resolveUnresolvedEvidence: mocks.evidence, updateAssetAccessibility: mocks.accessibility, reviewAssetRights: mocks.rights }), getDraftRepository: () => ({ generate: mocks.generate }) }));
vi.mock("./api-response", () => ({ apiError: mocks.apiError }));
vi.mock("@/server/api-response", () => ({ apiError: mocks.apiError }));
vi.mock("@/server/content-package-review-api", () => import("./content-package-review-api"));
vi.mock("@/components/content-package-review-request", () => import("../components/content-package-review-request"));
vi.mock("@/server/campaign-preparation-api", () => import("./campaign-preparation-api"));
import { GET as REVIEW } from "../app/api/v1/content-packages/[id]/route";
import { POST as APPROVE, GET as LOOKUP } from "../app/api/v1/content-packages/[id]/approve/route";
import { POST as CONFLICT } from "../app/api/v1/content-packages/[id]/conflicts/[conflictId]/resolve/route";
import { POST as EVIDENCE } from "../app/api/v1/content-packages/[id]/evidence/[evidenceId]/resolve/route";
import { PATCH as ACCESSIBILITY, PUT as RIGHTS } from "../app/api/v1/content-packages/[id]/assets/[assetId]/route";
import { POST as GENERATE } from "../app/api/v1/drafts/route";

const uuid = (n: number) => `${n}${"a".repeat(7)}-aaaa-4aaa-8aaa-${"a".repeat(12)}`;
const workspaceId = uuid(1), packageId = uuid(2), userId = uuid(3), assetId = uuid(4), evidenceId = uuid(5), conflictId = uuid(6), idempotencyKey = uuid(7);
const precondition = { workspaceId, expectedVersion: 7, expectedReviewFingerprint: `mm-package-review-v1:sha256:${"b".repeat(64)}` };
const approval = { id: uuid(8), workspaceId, contentPackageId: packageId, contentPackageVersion: 7, reviewFingerprint: precondition.expectedReviewFingerprint };
const review = { snapshot: { package: { id: packageId, workspaceId, version: 7 } }, ...precondition };
const rights = { status: "cleared", owner: "Owner", sourceReference: "Owned source", proofReference: "Signed license", commercialUseAllowed: true,
  derivativeUseAllowed: true, worldwideUseAllowed: true, permittedChannels: ["mastodon_account"], permittedChannelConnectionIds: [uuid(9)], permittedCampaignIds: [], permittedBrandProfileIds: [], reviewNote: "Reviewed original proof",
  validFrom: "2026-01-01T00:00:00.123456Z", expiresAt: "2027-01-01T10:30:42.654321-05:00" };
const mutationCases = [
  { name: "approval", run: APPROVE, params: { id: packageId }, body: { ...precondition, idempotencyKey }, mock: mocks.approve, mode: "approve", method: "POST" },
  { name: "conflict", run: CONFLICT, params: { id: packageId, conflictId }, body: { ...precondition, evidenceId }, mock: mocks.conflict, mode: "approve", method: "POST" },
  { name: "correction", run: EVIDENCE, params: { id: packageId, evidenceId }, body: { ...precondition, correctedClaim: "Café 🚀 starts at noon." }, mock: mocks.evidence, mode: "approve", method: "POST" },
  { name: "accessibility", run: ACCESSIBILITY, params: { id: packageId, assetId }, body: { ...precondition, decorative: false, altText: "A blue dolphin." }, mock: mocks.accessibility, mode: "write", method: "PATCH" },
  { name: "rights", run: RIGHTS, params: { id: packageId, assetId }, body: { ...precondition, ...rights }, mock: mocks.rights, mode: "write", method: "PUT" },
];
function request(body: unknown, origin: string | null = "http://localhost:3119", method = "POST") { return new Request("http://localhost:3119/api", { method, headers: { "content-type": "application/json", ...(origin === null ? {} : { origin }) }, body: JSON.stringify(body) }); }
const context = (params: Record<string, string | undefined> = { id: packageId }) => ({ params: Promise.resolve(Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string"))) });
const get = (query = `workspaceId=${workspaceId}`) => new Request(`http://localhost:3119/api?${query}`);
// Each adapter fixes its own exact route params; callers cannot supply actor authority in JSON.
async function run(test: typeof mutationCases[number], req: Request, params = test.params) {
  return (test.run as (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>)(req, context(params));
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("APP_BASE_URL", "http://localhost:3119");
  mocks.access.mockResolvedValue({ user: { id: userId }, workspace: { workspaceId } });
  mocks.review.mockResolvedValue(review); mocks.approve.mockResolvedValue({ approval, replayed: false, review });
  mocks.get.mockResolvedValue(approval); mocks.key.mockResolvedValue(approval); mocks.history.mockResolvedValue([approval]);
  mocks.generate.mockResolvedValue([{ id: uuid(8) }]);
  for (const mock of [mocks.conflict, mocks.evidence, mocks.accessibility, mocks.rights]) mock.mockResolvedValue(review);
  mocks.apiError.mockImplementation(() => Response.json({ error: { code: "forbidden" } }, { status: 403 }));
});
afterEach(() => vi.unstubAllEnvs());

describe.each(mutationCases)("$name optimistic review boundary", (test) => {
  it.each([null, "null", "", "https://foreign.test", "http://localhost:3119/", "http://user@localhost:3119", "http://localhost:3119/path"])("denies origin %s before auth/database", async (origin) => {
    expect((await run(test, request(test.body, origin, test.method))).status).toBe(403); expect(mocks.access).not.toHaveBeenCalled(); expect(test.mock).not.toHaveBeenCalled();
  });
  it("requires explicit configured origin, not forwarded host", async () => {
    vi.stubEnv("APP_BASE_URL", ""); expect((await run(test, request(test.body))).status).toBe(403); expect(mocks.access).not.toHaveBeenCalled();
  });
  it.each(["workspaceId", "expectedVersion", "expectedReviewFingerprint"])("requires %s; no active-workspace fallback", async (field) => {
    const body = { ...test.body } as Record<string, unknown>; delete body[field];
    expect((await run(test, request(body))).status).toBe(422); expect(mocks.access).not.toHaveBeenCalled(); expect(test.mock).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON, oversized body, invalid route UUIDs, and actor-bearing extra keys", async () => {
    for (const body of ["{", " ".repeat(65_537) + "{}"])
      expect((await run(test, new Request("http://localhost:3119/api", { method: test.method, headers: { origin: "http://localhost:3119" }, body }))).status).toBe(422);
    expect((await run(test, request({ ...test.body, actorUserId: uuid(9) }))).status).toBe(422);
    expect((await run(test, request(test.body), { ...test.params, id: "bad" })).status).toBe(422);
    expect(mocks.access).not.toHaveBeenCalled(); expect(test.mock).not.toHaveBeenCalled();
  });
  it("uses current exact membership and returns the coherent transaction result", async () => {
    const response = await run(test, request(test.body)); expect(response.status).toBe(test.name === "approval" ? 201 : 200);
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(mocks.access).toHaveBeenCalledExactlyOnceWith(workspaceId, test.mode);
    expect(test.mock).toHaveBeenCalledOnce(); expect(test.mock.mock.calls[0]?.[0]).toMatchObject({ ...precondition, packageId });
    if (test.name === "rights") expect(test.mock.mock.calls[0]).toEqual([{ ...precondition, ...rights, packageId, assetId }, userId]);
    else expect(test.mock.mock.calls[0]?.[0]).toHaveProperty("actorUserId", userId);
    expect(await response.json()).toMatchObject(test.name === "approval" ? { data: approval, review, meta: { replayed: false } } : { data: review });
  });
  it("does not mutate after denied current membership", async () => {
    mocks.access.mockRejectedValue(new Error("Revoked")); expect((await run(test, request(test.body))).status).toBe(403); expect(test.mock).not.toHaveBeenCalled();
  });
  it.each(["review_changed", "package_version_mismatch", "review_blocked", "conflict_not_open", "idempotency_conflict"] as const)("maps %s to 409 without retry", async (code) => {
    test.mock.mockRejectedValue(new ContentPackageReviewError(code, "Reload the exact review."));
    const response = await run(test, request(test.body)); expect(response.status).toBe(409); expect(test.mock).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({ error: { code } });
  });
});
describe("coherent read and immutable approval recovery", () => {
  it("returns the exact current scoped review, not the old independently hydrated DTO", async () => {
    const response = await REVIEW(get(), { params: Promise.resolve({ id: packageId }) }); expect(response.status).toBe(200);
    expect(mocks.review).toHaveBeenCalledExactlyOnceWith(workspaceId, packageId, userId); expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each(["", "workspaceId=bad", `workspaceId=${workspaceId}&workspaceId=${workspaceId}`, `workspaceId=${workspaceId}&actorUserId=${userId}`])("rejects invalid review query %s before DB", async (query) => {
    expect((await REVIEW(get(query), { params: Promise.resolve({ id: packageId }) })).status).toBe(422); expect(mocks.review).not.toHaveBeenCalled(); expect(mocks.access).not.toHaveBeenCalled();
  });
  it("exact approval replay omits mutable review and returns200", async () => {
    mocks.approve.mockResolvedValue({ approval, replayed: true });
    const response = await APPROVE(request({ ...precondition, idempotencyKey }), { params: Promise.resolve({ id: packageId }) });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: approval, meta: { replayed: true } }); expect(mocks.review).not.toHaveBeenCalled();
  });
  it("checks original attempt key without approval mutation", async () => {
    const response = await LOOKUP(get(`workspaceId=${workspaceId}&idempotencyKey=${idempotencyKey}`), { params: Promise.resolve({ id: packageId }) });
    expect(response.status).toBe(200); expect(mocks.access).toHaveBeenCalledExactlyOnceWith(workspaceId); expect(mocks.key).toHaveBeenCalledExactlyOnceWith(workspaceId, idempotencyKey, userId); expect(mocks.approve).not.toHaveBeenCalled();
  });
  it("missing completed result is404 and not evidence of noncompletion", async () => {
    mocks.key.mockResolvedValue(undefined); const response = await LOOKUP(get(`workspaceId=${workspaceId}&idempotencyKey=${idempotencyKey}`), { params: Promise.resolve({ id: packageId }) });
    expect(response.status).toBe(404); expect(await response.text()).toContain("may still finish");
  });
  it("never leaks a receipt from a different package through its attempt key", async () => {
    mocks.key.mockResolvedValue({ ...approval, contentPackageId: uuid(9) });
    expect((await LOOKUP(get(`workspaceId=${workspaceId}&idempotencyKey=${idempotencyKey}`), { params: Promise.resolve({ id: packageId }) })).status).toBe(404);
  });
  it("supports membership-scoped history and exact receipt lookup", async () => {
    expect((await LOOKUP(get(), { params: Promise.resolve({ id: packageId }) })).status).toBe(200); expect(mocks.history).toHaveBeenCalledWith(workspaceId, packageId, userId);
    expect((await LOOKUP(get(`workspaceId=${workspaceId}&approvalId=${approval.id}`), { params: Promise.resolve({ id: packageId }) })).status).toBe(200); expect(mocks.get).toHaveBeenCalledWith(workspaceId, approval.id, userId);
  });
  it("rejects ambiguous key and receipt selection", async () => {
    expect((await LOOKUP(get(`workspaceId=${workspaceId}&approvalId=${approval.id}&idempotencyKey=${idempotencyKey}`), { params: Promise.resolve({ id: packageId }) })).status).toBe(422); expect(mocks.access).not.toHaveBeenCalled();
  });
});
describe("direct draft generation uses the exact displayed package review", () => {
  const body = { workspaceId, campaignId: uuid(9), contentPackageId: packageId, expectedPackageVersion: 7, expectedReviewFingerprint: precondition.expectedReviewFingerprint, draftFormat: "channel_neutral" };
  it.each([null, "https://foreign.test", "http://localhost:3119/"])("rejects foreign or missing origin %s", async (origin) => {
    expect((await GENERATE(request(body, origin))).status).toBe(403); expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it.each(["workspaceId", "expectedPackageVersion", "expectedReviewFingerprint"])("requires %s before DB", async (field) => {
    const invalid = { ...body } as Record<string, unknown>; delete invalid[field];
    expect((await GENERATE(request(invalid))).status).toBe(422); expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("rejects malformed and authority-bearing data", async () => {
    expect((await GENERATE(request({ ...body, actorUserId: userId }))).status).toBe(422);
    expect((await GENERATE(new Request("http://localhost:3119/api", { method: "POST", headers: { origin: "http://localhost:3119" }, body: "{" }))).status).toBe(422);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("forwards exact displayed version/token with the current writer", async () => {
    const response = await GENERATE(request(body)); expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(workspaceId, "write"); expect(mocks.generate).toHaveBeenCalledExactlyOnceWith(body, userId);
  });
});
