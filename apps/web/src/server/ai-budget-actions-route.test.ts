import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, AuthorizationError } from "./auth";
const mocks = vi.hoisted(() => ({ access: vi.fn(), acknowledgeBudgetAlert: vi.fn(), requestSpendException: vi.fn(), decideSpendException: vi.fn(), getBudgetActionState: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./auth", async original => ({ ...await original<typeof import("./auth")>(), requireWorkspaceAccess: mocks.access }));
vi.mock("./database", () => ({ getAiRepository: () => mocks }));
vi.mock("@/components/ai-budget-action-contract", () => import("../components/ai-budget-action-contract"));
vi.mock("@/server/ai-budget-actions-api", () => import("./ai-budget-actions-api"));
import { POST } from "../app/api/v1/ai-spend-exceptions/route";
import { PATCH as decide } from "../app/api/v1/ai-spend-exceptions/[id]/decision/route";
import { PATCH as acknowledge } from "../app/api/v1/ai-budget-alerts/[id]/acknowledge/route";
import { GET } from "../app/api/v1/ai-budget-actions/state/route";
const workspaceId = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333", actor = "44444444-4444-4444-8444-444444444444";
const base = "http://127.0.0.1:3119", timestamp = "2026-10-01T00:00:00.000Z";
const alert = { id, workspaceId, status: "acknowledged", acknowledgedBy: actor, acknowledgedAt: timestamp };
const exception = { id, workspaceId, deniedReservationId: id, status: "pending", requestedBy: actor, justification: "Reviewed synthetic exception", expiresAt: timestamp };
const context = { params: Promise.resolve({ id }) };
const request = (body: unknown, headers: Record<string, string> = {}, query = "") => new Request(`${base}/api/v1/synthetic${query}`, { method: "POST", headers: { origin: base, "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const lookup = (kind = "request_exception", query = "") => new Request(`${base}/api/v1/ai-budget-actions/state?workspaceId=${workspaceId}&kind=${kind}&targetId=${id}${query}`);
const input = { workspaceId, deniedReservationId: id, justification: exception.justification };
describe("budget action transport and read-only recovery", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("APP_BASE_URL", base); mocks.access.mockResolvedValue({ user: { id: actor } });
    mocks.acknowledgeBudgetAlert.mockResolvedValue(alert); mocks.requestSpendException.mockResolvedValue(exception);
    mocks.decideSpendException.mockResolvedValue({ ...exception, status: "approved", resolvedBy: actor, resolvedAt: timestamp }); mocks.getBudgetActionState.mockResolvedValue(exception); });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it("normalizes requests and uses only the authenticated actor", async () => {
    const response = await POST(request({ ...input, justification: `  ${input.justification}  ` }));
    expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.access).toHaveBeenCalledWith(workspaceId, "write"); expect(mocks.requestSpendException).toHaveBeenCalledWith(input, actor);
    expect(await response.json()).toEqual({ data: { kind: "exception", ...exception } });
  });
  it("guards alert and approval roles independently and returns bounded projections", async () => {
    expect((await acknowledge(request({ workspaceId }), context)).status).toBe(200);
    expect(mocks.access).toHaveBeenLastCalledWith(workspaceId, "write"); expect(mocks.acknowledgeBudgetAlert).toHaveBeenCalledWith(workspaceId, id, actor);
    const response = await decide(request({ workspaceId, decision: "approved", note: "  Exact estimate  " }), context);
    expect(response.status).toBe(200); expect(mocks.access).toHaveBeenLastCalledWith(workspaceId, "approve");
    expect(mocks.decideSpendException).toHaveBeenCalledWith(workspaceId, id, "approved", actor, "Exact estimate");
    expect(await response.json()).not.toHaveProperty("data.estimatedCostMinor");
  });
  it("returns expiry as expiry instead of inventing a successful approval", async () => {
    mocks.decideSpendException.mockResolvedValue({ ...exception, status: "expired", resolvedAt: timestamp });
    expect(await (await decide(request({ workspaceId, decision: "approved" }), context)).json()).toMatchObject({ data: { status: "expired" } });
  });
  it.each([undefined, "https://other.invalid", `${base}/`, "null"])("rejects Origin %s on all writes", async origin => {
    const inputs = [input, { workspaceId }, { workspaceId, decision: "approved" }];
    const handlers = [POST, (req: Request) => acknowledge(req, context), (req: Request) => decide(req, context)];
    for (const [i, handler] of handlers.entries()) { const req = request(inputs[i]); if (origin === undefined) req.headers.delete("origin"); else req.headers.set("origin", origin);
      expect((await handler!(req)).status).toBe(403); }
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it.each([{ actorUserId: actor }, { justification: " " }, { deniedReservationId: "bad" }, { justification: "x".repeat(1001) }, { force: true }])("rejects invalid request fields %j", async patch => {
    expect((await POST(request({ ...input, ...patch }))).status).toBe(422); expect(mocks.requestSpendException).not.toHaveBeenCalled();
  });
  it("cannot replace path identity with a body identifier or expand decision authority", async () => {
    expect((await acknowledge(request({ workspaceId, alertId: actor }), context)).status).toBe(422);
    expect((await decide(request({ workspaceId, requestId: actor, decision: "approved" }), context)).status).toBe(422);
    expect((await decide(request({ workspaceId, decision: "consumed" }), context)).status).toBe(422);
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it("bounds UTF-8 JSON, content type and query inputs before persistence", async () => {
    expect((await POST(request(input, { "content-length": "8193" }))).status).toBe(413);
    expect((await POST(request(input, { "content-type": "text/plain" }))).status).toBe(415);
    for (const body of ["x".repeat(8193), "{", "null", "[]"]) expect((await POST(request(body))).status).toBe(422);
    expect((await POST(request(input, {}, "?workspaceId=other"))).status).toBe(422);
    const raw = new Request(base, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: new Uint8Array([0xff]) });
    expect((await POST(raw)).status).toBe(422); expect(mocks.requestSpendException).not.toHaveBeenCalled();
  });
  it.each(["acknowledge_alert", "request_exception", "decide_exception"])("checks current %s authority for lookup and performs no mutation", async kind => {
    mocks.getBudgetActionState.mockResolvedValue(kind === "acknowledge_alert" ? alert : exception);
    const response = await GET(lookup(kind)); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.access).toHaveBeenCalledWith(workspaceId, kind === "decide_exception" ? "approve" : "write");
    expect(mocks.getBudgetActionState).toHaveBeenCalledWith(workspaceId, kind, id, actor);
    expect(mocks.requestSpendException).not.toHaveBeenCalled(); expect(mocks.decideSpendException).not.toHaveBeenCalled(); expect(mocks.acknowledgeBudgetAlert).not.toHaveBeenCalled();
  });
  it.each(["&kind=request_exception", "&actorUserId=x", "&targetId=x", "&force=true"])("rejects ambiguous recovery query %s", async suffix => {
    expect((await GET(lookup("request_exception", suffix))).status).toBe(422); expect(mocks.getBudgetActionState).not.toHaveBeenCalled();
  });
  it("rejects missing and unknown target kinds", async () => {
    expect((await GET(new Request(base))).status).toBe(422); expect((await GET(lookup("consume"))).status).toBe(422);
  });
  it("does not interpret missing recovery as a failed mutation", async () => {
    mocks.getBudgetActionState.mockResolvedValue(undefined); const response = await GET(lookup()); expect(response.status).toBe(404);
    expect(await response.text()).toContain("may still finish");
  });
  it.each([[new AuthenticationError(), 401], [new AuthorizationError(), 403]] as const)("enforces authentication and permission for writes and reads", async (error, status) => {
    mocks.access.mockRejectedValue(error); expect((await POST(request(input))).status).toBe(status); expect((await GET(lookup())).status).toBe(status);
    expect(mocks.requestSpendException).not.toHaveBeenCalled(); expect(mocks.getBudgetActionState).not.toHaveBeenCalled();
  });
  it("minimizes private repository errors and malformed persisted output", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.requestSpendException.mockRejectedValue(new Error("private SQL with explanation"));
    const response = await POST(request(input)); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private SQL");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private SQL");
    mocks.getBudgetActionState.mockResolvedValue({ ...exception, workspaceId: "malformed" }); expect((await GET(lookup())).status).toBe(503);
  });
});
