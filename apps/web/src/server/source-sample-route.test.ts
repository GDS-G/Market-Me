import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceSampleError } from "@market-me/database";
import { sampleActorId, sampleRequest, sampleView } from "../components/source-sample.test-fixture";
const mocks = vi.hoisted(() => ({ access: vi.fn(), run: vi.fn(), capture: vi.fn(), assertUnchanged: vi.fn(), ingestion: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/components/source-sample-contract", () => import("../components/source-sample-contract"));
vi.mock("@/server/auth", () => ({ requireWorkspaceAccess: mocks.access, AuthenticationError: class extends Error {}, AuthorizationError: class extends Error {} }));
vi.mock("@/server/database", () => ({ getSourceSampleRepository: () => ({ capture: mocks.capture, assertUnchanged: mocks.assertUnchanged }) }));
vi.mock("@/server/ingestion", () => ({ getIngestionService: mocks.ingestion }));
vi.mock("@/server/source-sample", () => ({ runSourceSample: mocks.run }));
vi.mock("@/server/campaign-preparation-api", () => import("./campaign-preparation-api"));
vi.mock("@/server/source-setup-api", () => import("./source-setup-api"));
vi.mock("./api-response", () => ({ apiError: () => new Response(null, { status: 500 }) }));
import { POST } from "../app/api/v1/smart-sources/[id]/sample/route";
import { AuthenticationError, AuthorizationError } from "@/server/auth";
const base = "http://localhost:3119";
const body = { workspaceId: sampleRequest.workspaceId, expectedSourceVersion: sampleRequest.expectedSourceVersion, locationIndex: 0 };
const context = { params: Promise.resolve({ id: sampleRequest.smartSourceId }) };
function request(value: unknown = body, headers: Record<string, string> = {}) {
  return new Request(`${base}/api/v1/smart-sources/${sampleRequest.smartSourceId}/sample`, { method: "POST", headers: { origin: base, "content-type": "application/json", ...headers },
    body: typeof value === "string" ? value : JSON.stringify(value) });
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("APP_BASE_URL", base); mocks.access.mockResolvedValue({ user: { id: sampleActorId } }); mocks.run.mockResolvedValue(sampleView); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("source dry-test API transport", () => {
  it("authenticates an explicit writer and returns only the no-store view", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: sampleView });
    expect(mocks.access).toHaveBeenCalledExactlyOnceWith(sampleRequest.workspaceId, "write");
    expect(mocks.run).toHaveBeenCalledWith(sampleRequest, sampleActorId, expect.objectContaining({ ingestion: mocks.ingestion }));
  });
  it.each(["", "null", "https://outside.invalid", `${base}/`, "http://localhost:3120"])("rejects invalid Origin %s before authentication or provider work", async (origin) => {
    const response = await POST(request(body, { origin }), context); expect(response.status).toBe(403); expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
  });
  it("fails closed with an unconfigured app origin", async () => {
    vi.stubEnv("APP_BASE_URL", ""); expect((await POST(request(), context)).status).toBe(403); expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each([null, [], "{", { ...body, actorUserId: sampleActorId }, { ...body, enabled: true }, { ...body, locationIndex: -1 },
    { ...body, expectedSourceVersion: 2.5 }, { ...body, locationId: "https://outside.invalid" }])("rejects malformed or authority-bearing settings", async (value) => {
    expect((await POST(request(value), context)).status).toBe(422); expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
  });
  it("rejects query scope and invalid path IDs before work", async () => {
    expect((await POST(new Request(`${base}/api/v1/smart-sources/x/sample?workspaceId=${body.workspaceId}`, { method: "POST", headers: { origin: base }, body: "{}" }), context)).status).toBe(422);
    expect((await POST(request(), { params: Promise.resolve({ id: "bad" }) })).status).toBe(422); expect(mocks.run).not.toHaveBeenCalled();
  });
  it("requires JSON and bounds both declared and streamed bodies", async () => {
    expect((await POST(request(body, { "content-type": "text/plain" }), context)).status).toBe(415);
    expect((await POST(request(body, { "content-length": "32769" }), context)).status).toBe(413);
    expect((await POST(request("x".repeat(32769)), context)).status).toBe(413); expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each([["source_changed", 409], ["reference_unavailable", 409], ["source_unavailable", 404], ["sample_unsupported", 422], ["access_denied", 403]] as const)("maps %s safely", async (code, status) => {
    mocks.run.mockRejectedValue(new SourceSampleError(code, "Safe explanation"));
    const response = await POST(request(), context); expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code, message: "Safe explanation" } });
  });
  it("returns authentication/access failures without calling the sampler", async () => {
    mocks.access.mockRejectedValue(new AuthenticationError()); expect((await POST(request(), context)).status).toBe(401);
    mocks.access.mockRejectedValue(new AuthorizationError()); expect((await POST(request(), context)).status).toBe(403); expect(mocks.run).not.toHaveBeenCalled();
  });
  it("does not reflect or log provider credential/SQL details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.run.mockRejectedValue(new Error("private-token sql secret filename"));
    const response = await POST(request(), context); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private-token");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-token");
  });
  it("recognizes retained hot-reload repository errors without trusting a provider's error name alone", async () => {
    const retained = new SourceSampleError("source_changed", "Reload and review the source.");
    Object.setPrototypeOf(retained, Error.prototype); // Simulate a retained instance from another module copy.
    mocks.run.mockRejectedValue(retained);
    expect((await POST(request(), context)).status).toBe(409);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const forged = Object.assign(new Error("private provider value"), { name: "SourceSampleError", code: "source_changed" });
    mocks.run.mockRejectedValue(forged);
    const response = await POST(request(), context);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private provider value");
    expect(log).toHaveBeenCalledOnce();
  });
});
