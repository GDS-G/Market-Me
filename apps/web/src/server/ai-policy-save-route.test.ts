import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError } from "./auth";
import { AiPolicySaveError } from "@market-me/database";
const mocks = vi.hoisted(() => ({ user: vi.fn(), savePolicyExactly: vi.fn(), getPolicySaveReceipt: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./auth", async original => ({ ...await original<typeof import("./auth")>(), requireAuthenticatedUser: mocks.user }));
vi.mock("./database", () => ({ getAiRepository: () => mocks }));
vi.mock("@/server/auth", () => import("./auth"));
vi.mock("@/server/database", () => import("./database"));
vi.mock("@/server/ai-schema", () => import("./ai-schema"));
vi.mock("@/server/api-response", () => import("./api-response"));
vi.mock("@/server/ai-policy-save-api", () => import("./ai-policy-save-api"));
import { GET, POST } from "../app/api/v1/ai-policy/saves/route";
import { PUT } from "../app/api/v1/ai-policy/route";
const workspaceId = "22222222-2222-4222-8222-222222222222", requestId = "33333333-3333-4333-8333-333333333333", actor = "44444444-4444-4444-8444-444444444444";
const base = "http://127.0.0.1:3119", endpoint = `${base}/api/v1/ai-policy/saves`;
const policy = { workspaceId, mode: "recommended", maximumPrivacyClass: "cloud", failoverMode: "ask_before_switching", capBehavior: "require_approval", currency: "USD", alertThresholdPercentages: [50,80,100] };
const input = { ...policy, requestId, expectedRevision: 0 }, receipt = { workspaceId, requestId, revision: 1, policy, createdAt: "2026-10-01T00:00:00.000Z" };
const request = (body: unknown = input, headers: Record<string,string> = {}) => new Request(endpoint, { method: "POST",
  headers: { origin: base, "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const lookup = `${endpoint}?workspaceId=${workspaceId}&requestId=${requestId}`;
describe("exact AI policy save transport", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("APP_BASE_URL", base); mocks.user.mockResolvedValue({id: actor});
    mocks.savePolicyExactly.mockResolvedValue({receipt,replayed:false}); mocks.getPolicySaveReceipt.mockResolvedValue(receipt); });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it("uses the authenticated actor and returns only the original receipt with no-store", async () => {
    const response = await POST(request()); expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("set-cookie")).toBe(false); expect(mocks.savePolicyExactly).toHaveBeenCalledWith(input, actor);
    expect(await response.json()).toEqual({data:receipt,meta:{replayed:false}});
    mocks.savePolicyExactly.mockResolvedValue({receipt,replayed:true}); expect((await POST(request())).status).toBe(200);
  });
  it("requires the same exact-request guard on the legacy PUT endpoint", async () => {
    expect((await PUT(request(policy))).status).toBe(422); expect(mocks.savePolicyExactly).not.toHaveBeenCalled();
    expect((await PUT(request())).status).toBe(201); expect(mocks.savePolicyExactly).toHaveBeenCalledOnce();
  });
  it.each([undefined, "https://outside.invalid", `${base}/path`, `${base}/`, "null"])("denies Origin %s before authentication or persistence", async origin => {
    const req = request(); if (origin === undefined) req.headers.delete("origin"); else req.headers.set("origin", origin);
    expect((await POST(req)).status).toBe(403); expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.savePolicyExactly).not.toHaveBeenCalled();
  });
  it.each([{actorUserId:actor},{executionAllowed:true},{requestId:"bad"},{expectedRevision:-1},{expectedRevision:"0"},{currency:"usd"},
    {monthlyBudgetMinor:null},{monthlyBudgetMinor:0},{alertThresholdPercentages:[80,50]},{mode:"invented"}])("rejects invalid or expanded settings %j", async patch => {
    expect((await POST(request({...input,...patch}))).status).toBe(422); expect(mocks.savePolicyExactly).not.toHaveBeenCalled();
  });
  it("bounds advertised/streamed bytes, requires JSON and rejects invalid UTF-8 or query authority", async () => {
    expect((await POST(request(input,{"content-type":"text/plain"}))).status).toBe(415);
    expect((await POST(request(input,{"content-length":"4097"}))).status).toBe(413);
    expect((await POST(request("x".repeat(4097)))).status).toBe(413); expect((await POST(request("{"))).status).toBe(422);
    const headers = {origin:base,"content-type":"application/json"};
    expect((await POST(new Request(endpoint,{method:"POST",headers,body:new Uint8Array([0xc3,0x28])}))).status).toBe(422);
    expect((await POST(new Request(endpoint,{method:"POST",headers}))).status).toBe(422);
    expect((await POST(new Request(lookup,{method:"POST",headers,body:JSON.stringify(input)}))).status).toBe(422);
    expect(mocks.savePolicyExactly).not.toHaveBeenCalled();
  });
  it("looks up an exact key with current actor authority; absence is not cancellation", async () => {
    const response=await GET(new Request(lookup)); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({data:receipt}); expect(mocks.getPolicySaveReceipt).toHaveBeenCalledWith(workspaceId,requestId,actor);
    mocks.getPolicySaveReceipt.mockResolvedValue(undefined); const missing=await GET(new Request(lookup));
    expect(missing.status).toBe(404); expect(await missing.text()).toContain("may still finish"); expect(mocks.savePolicyExactly).not.toHaveBeenCalled();
  });
  it.each(["", "?workspaceId=x", `?workspaceId=${workspaceId}`, `?workspaceId=${workspaceId}&requestId=bad`,
    `?workspaceId=${workspaceId}&requestId=${requestId}&requestId=${requestId}`, `?workspaceId=${workspaceId}&requestId=${requestId}&actorUserId=${actor}`])("rejects ambiguous recovery %s", async query => {
    expect((await GET(new Request(endpoint+query))).status).toBe(422); expect(mocks.getPolicySaveReceipt).not.toHaveBeenCalled();
  });
  it.each([["invalid_input",422],["access_denied",403],["not_found",404],["request_conflict",409],["revision_conflict",409]] as const)("maps branded %s errors across bundled class identity", async (code,status) => {
    const error=new AiPolicySaveError(code,"Safe explanation");Object.setPrototypeOf(error,Error.prototype);mocks.savePolicyExactly.mockRejectedValue(error);
    const response=await POST(request());expect(response.status).toBe(status);expect(await response.json()).toEqual({error:{code,message:"Safe explanation"}});
  });
  it("authenticates both operations and does not trust a client actor", async () => {
    mocks.user.mockRejectedValue(new AuthenticationError());expect((await POST(request())).status).toBe(401);expect((await GET(new Request(lookup))).status).toBe(401);
    expect(mocks.savePolicyExactly).not.toHaveBeenCalled();expect(mocks.getPolicySaveReceipt).not.toHaveBeenCalled();
  });
  it("keeps private persistence failures out of the response and logs", async () => {
    const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);
    mocks.savePolicyExactly.mockRejectedValue(Object.assign(new Error("private SQL"),{name:"AiPolicySaveError",code:"revision_conflict"}));
    const response=await POST(request());expect(response.status).toBe(503);expect(await response.text()).not.toContain("private SQL");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private SQL");
  });
});
