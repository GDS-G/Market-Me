import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignPreparationError } from "@market-me/database";
import { AuthenticationError } from "./auth";
const mocks = vi.hoisted(() => ({ user: vi.fn(), preview: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./auth", async original => ({ ...await original<typeof import("./auth")>(), requireAuthenticatedUser: mocks.user }));
vi.mock("./database", () => ({ getCampaignPreparationRepository: () => mocks }));
vi.mock("@/server/campaign-preparation-preview-api", () => import("./campaign-preparation-preview-api"));
import { POST } from "../app/api/v1/campaign-preparations/preview/route";
const base = "http://127.0.0.1:3119", endpoint = `${base}/api/v1/campaign-preparations/preview`;
const body = { input: { workspaceId: "22222222-2222-4222-8222-222222222222" }, expectedReviewFingerprint: `mm-package-review-v1:sha256:${"a".repeat(64)}` };
const request = (value: unknown = body, headers: Record<string, string> = {}) => new Request(endpoint, { method: "POST", headers: { origin: base, "content-type": "application/json", ...headers }, body: typeof value === "string" ? value : JSON.stringify(value) });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("APP_BASE_URL", base); mocks.user.mockResolvedValue({ id: "actor" }); mocks.preview.mockResolvedValue({ effects: { persisted: false } }); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("read-only campaign preparation preview transport", () => {
  it("uses the authenticated actor and binds response to exact request bytes without a persistence key", async () => {
    const result = await POST(request()); expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
    expect(mocks.preview).toHaveBeenCalledWith(body.input, "actor", { expectedReviewFingerprint: body.expectedReviewFingerprint });
    expect(await result.json()).toEqual({ data: { effects: { persisted: false } }, meta: { requestDigest: createHash("sha256").update(JSON.stringify(body)).digest("hex") } });
  });
  it.each([undefined, "null", "https://outside.invalid", `${base}/`, `${base}/path`])("rejects origin %s before authentication", async origin => {
    const req = request(); if (origin === undefined) req.headers.delete("origin"); else req.headers.set("origin", origin);
    const result = await POST(req); expect(result.status).toBe(403); expect(result.headers.get("cache-control")).toBe("no-store"); expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
  });
  it.each([{ actorUserId: "other" }, { idempotencyKey: "ignored" }, { expectedApprovalId: "other" }, { expectedReviewFingerprint: "invalid" }, { expectedReviewFingerprint: null }])("rejects expanded or malformed envelope %j", async patch => {
    expect((await POST(request({ ...body, ...patch }))).status).toBe(422); expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("authenticates before reading private input", async () => {
    mocks.user.mockRejectedValue(new AuthenticationError()); expect((await POST(request())).status).toBe(401); expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("bounds advertised and streamed bytes, invalid JSON/UTF-8 and disallows query authority", async () => {
    expect((await POST(request(body, { "content-length": "32769" }))).status).toBe(413);
    expect((await POST(request("x".repeat(32769)))).status).toBe(413);
    expect((await POST(request(body, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(request("{"))).status).toBe(422);
    const headers = { origin: base, "content-type": "application/json" };
    expect((await POST(new Request(endpoint, { method: "POST", headers, body: new Uint8Array([0xc3, 0x28]) }))).status).toBe(422);
    expect((await POST(new Request(endpoint, { method: "POST", headers }))).status).toBe(422);
    expect((await POST(new Request(`${endpoint}?actor=other`, { method: "POST", headers, body: JSON.stringify(body) }))).status).toBe(422);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it.each([["access_denied", 403], ["package_unavailable", 404], ["review_changed", 409], ["preview_too_large", 422], ["preview_generation_failed", 422]] as const)("maps safe %s failures", async (code, status) => {
    mocks.preview.mockRejectedValue(new CampaignPreparationError(code, "Safe explanation")); const result = await POST(request());
    expect(result.status).toBe(status); expect(await result.json()).toEqual({ error: { code, message: "Safe explanation" } });
  });
  it("does not truncate an oversized exact preview into success", async () => {
    mocks.preview.mockResolvedValue({ body: "x".repeat(1_048_576) }); const result = await POST(request()); expect(result.status).toBe(422); expect(await result.text()).toContain("preview_too_large");
  });
  it("keeps private failures out of responses and logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined); mocks.preview.mockRejectedValue(new Error("private SQL and copied facts"));
    const result = await POST(request()); expect(result.status).toBe(503); expect(await result.text()).not.toContain("private SQL"); expect(JSON.stringify(log.mock.calls)).not.toContain("copied facts");
  });
});
