import { beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignValidationError } from "@market-me/database";

const mocks = vi.hoisted(() => ({ access: vi.fn(), instance: vi.fn(), queue: vi.fn(), apiError: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireWorkspaceAccess: mocks.access }));
vi.mock("@/server/database", () => ({ getCampaignRepository: () => ({ getCampaignInstance: mocks.instance, queueInstanceCommand: mocks.queue }) }));
vi.mock("@/server/api-response", () => ({ apiError: mocks.apiError }));
vi.mock("@/components/campaign-instance-controls", () => import("../components/campaign-instance-controls"));

import { POST as command } from "../app/api/v1/campaign-instances/[id]/commands/route";
import { POST as complete } from "../app/api/v1/campaign-instances/[id]/steps/[stepKey]/complete/route";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const instance = { id: "run-1", workspaceId, status: "paused", stepRuns: [{ id: "step-run-1", campaignInstanceId: "run-1", stepKey: "publish", status: "manual_resolution" }] };
const context = { params: Promise.resolve({ id: "run-1", stepKey: "publish" }) };
const request = (body: Record<string, unknown>) => new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, ...body }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ user: { id: "member-1" }, workspace: { workspaceId } });
  mocks.instance.mockResolvedValue(instance);
  mocks.queue.mockResolvedValue(true);
  mocks.apiError.mockReturnValue(Response.json({ error: { code: "forbidden" } }, { status: 403 }));
});

describe("campaign instance control API guards", () => {
  it("rejects blocked resume and manual completion after an exact workspace read", async () => {
    mocks.instance.mockResolvedValue({ ...instance, stepRuns: [{ ...instance.stepRuns[0], status: "schedule_blocked" }] });
    for (const response of [await command(request({ command: "resume" }), context), await complete(request({ output: {} }), context)]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "schedule_blocked" } });
    }
    expect(mocks.access).toHaveBeenCalledWith(workspaceId, "write");
    expect(mocks.instance).toHaveBeenCalledWith(workspaceId, "run-1");
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it("keeps cancellation available for a blocked run", async () => {
    mocks.instance.mockResolvedValue({ ...instance, stepRuns: [{ ...instance.stepRuns[0], status: "schedule_blocked" }] });
    expect((await command(request({ command: "cancel" }), context)).status).toBe(202);
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, instanceId: "run-1", commandType: "cancel", actorUserId: "member-1" }));
  });
  it.each(["active", "paused"])("allows only current manual-resolution work in a %s instance", async (status) => {
    mocks.instance.mockResolvedValue({ ...instance, status });
    expect((await complete(request({ output: { receipt: "reviewed" } }), context)).status).toBe(202);
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ commandType: "manual_step_completed", payload: { stepKey: "publish", output: { receipt: "reviewed" } } }));
  });
  it.each(["waiting", "running", "succeeded", "canceled"])("rejects a %s step and terminal instances without enqueueing", async (status) => {
    mocks.instance.mockResolvedValue({ ...instance, stepRuns: [{ ...instance.stepRuns[0], status }] });
    expect((await complete(request({ output: {} }), context)).status).toBe(409);
    mocks.instance.mockResolvedValue({ ...instance, status: "completed" });
    expect((await complete(request({ output: {} }), context)).status).toBe(409);
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it("does not complete an unrelated manual step to bypass a sibling schedule block", async () => {
    mocks.instance.mockResolvedValue({ ...instance, stepRuns: [...instance.stepRuns, { id: "blocked", campaignInstanceId: "run-1", stepKey: "later", status: "schedule_blocked" }] });
    expect((await complete(request({ output: {} }), context)).status).toBe(409);
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it("maps a concurrent DB schedule block to conflict after the initial page state was eligible", async () => {
    mocks.queue.mockRejectedValue(new CampaignValidationError([{ code: "schedule_blocked", message: "Window closed" }]));
    expect((await command(request({ command: "resume" }), context)).status).toBe(409);
    expect((await complete(request({ output: {} }), context)).status).toBe(409);
    expect(mocks.apiError).not.toHaveBeenCalled();
  });
  it("maps loss of the manual state at the database enqueue boundary to conflict", async () => {
    mocks.queue.mockRejectedValue(new CampaignValidationError([{ code: "manual_completion_unavailable", message: "State changed" }]));
    expect((await complete(request({ output: {} }), context)).status).toBe(409);
  });
  it.each([undefined, { ...instance, workspaceId: "foreign" }, { ...instance, id: "foreign" }])("returns not found for unavailable or mismatched instance scope", async (stored) => {
    mocks.instance.mockResolvedValue(stored);
    expect((await command(request({ command: "resume" }), context)).status).toBe(404);
    expect((await complete(request({ output: {} }), context)).status).toBe(404);
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it("rejects a foreign-instance step or missing key even when the instance itself exists", async () => {
    mocks.instance.mockResolvedValue({ ...instance, stepRuns: [{ ...instance.stepRuns[0], campaignInstanceId: "foreign" }] });
    expect((await complete(request({ output: {} }), context)).status).toBe(404);
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it("requires write authorization before inspecting current run state", async () => {
    mocks.access.mockRejectedValue(new Error("revoked access"));
    expect((await command(request({ command: "resume" }), context)).status).toBe(403);
    expect((await complete(request({ output: {} }), context)).status).toBe(403);
    expect(mocks.instance).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it("rejects non-object completion output before authority lookup", async () => {
    expect((await complete(request({ output: [] }), context)).status).toBe(422);
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });
});
