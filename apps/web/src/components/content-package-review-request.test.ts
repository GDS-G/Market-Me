import { describe, expect, it, vi } from "vitest";
import { canApprovePackage, canEditPackageAssets, createPackageApprovalAttempt, packageApprovalRequest,
  packageApprovalResultPath, packageApprovalStorageKey, restorePackageApprovalAttempt, reviewRightsInstant,
  sendPackageApprovalAttempt } from "./content-package-review-request";

const userId = "11111111-1111-4111-8111-111111111111", workspaceId = "22222222-2222-4222-8222-222222222222";
const packageId = "33333333-3333-4333-8333-333333333333", idempotencyKey = "44444444-4444-4444-8444-444444444444";
const scope = { userId, workspaceId, packageId };
const input = { workspaceId, packageId, expectedVersion: 3, expectedReviewFingerprint: `mm-package-review-v1:sha256:${"a".repeat(64)}` };
const attempt = () => createPackageApprovalAttempt(scope, input, idempotencyKey);

describe("exact package approval recovery", () => {
  it("stores only exact scope, token, source revision, and attempt identity", () => {
    const saved = attempt();
    expect(restorePackageApprovalAttempt(JSON.stringify(saved), scope)).toEqual(saved);
    expect(JSON.parse(packageApprovalRequest(saved))).toEqual({ workspaceId, expectedVersion: 3, expectedReviewFingerprint: input.expectedReviewFingerprint, idempotencyKey });
    expect(packageApprovalStorageKey(scope)).toBe(`market-me:package-approval:v1:${userId}:${workspaceId}:${packageId}`);
  });
  it("persists before POST; uncertain response then reload sends byte-identical intent and key", async () => {
    let raw: string | null = null;
    const storage = { setItem: vi.fn((_key: string, value: string) => { raw = value; }) };
    const send = vi.fn<typeof fetch>().mockImplementation(async () => {
      expect(raw).not.toBeNull();
      throw new Error("Response lost after acceptance");
    });
    await expect(sendPackageApprovalAttempt(attempt(), scope, storage, send)).rejects.toThrow("Response lost");
    const restored = restorePackageApprovalAttempt(raw, scope)!;
    send.mockResolvedValue(new Response("{}", { status: 200 }));
    await sendPackageApprovalAttempt(restored, scope, storage, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });
  it("storage failure causes zero POSTs, even for retry", async () => {
    const send = vi.fn<typeof fetch>();
    const storage = { setItem: () => { throw new Error("Quota"); } };
    await expect(sendPackageApprovalAttempt(attempt(), scope, storage, send)).rejects.toThrow("Quota");
    expect(send).not.toHaveBeenCalled();
  });
  it.each(["userId", "workspaceId", "packageId"] as const)("refuses cross-%s recovery and sending", async (field) => {
    const other = { ...scope, [field]: idempotencyKey };
    expect(() => restorePackageApprovalAttempt(JSON.stringify(attempt()), other)).toThrow();
    const send = vi.fn<typeof fetch>(), storage = { setItem: vi.fn() };
    await expect(sendPackageApprovalAttempt(attempt(), other, storage, send)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it.each(["{", "null", "[]", JSON.stringify({ ...attempt(), credentials: "forbidden" }), JSON.stringify({ ...attempt(), version: 2 }),
    JSON.stringify({ ...attempt(), input: { ...input, expectedVersion: 0 } }), JSON.stringify({ ...attempt(), input: { ...input, expectedReviewFingerprint: "bare-approval" } })])("requires explicit reset for malformed saved state", (raw) => {
    expect(() => restorePackageApprovalAttempt(raw, scope)).toThrow();
  });
  it("no saved state is distinct from malformed state", () => expect(restorePackageApprovalAttempt(null, scope)).toBeUndefined());
  it("receipt link validates every scope identifier", () => {
    expect(packageApprovalResultPath(packageId, idempotencyKey, workspaceId)).toBe(`/content-packages/${packageId}/approvals/${idempotencyKey}?workspaceId=${workspaceId}`);
    expect(() => packageApprovalResultPath("javascript:alert(1)", idempotencyKey, workspaceId)).toThrow();
  });
});
describe("review role separation and precision", () => {
  it.each(["owner", "admin", "editor", "approver", "viewer", "unknown"])("shows only %s-authorized controls", (role) => {
    expect(canApprovePackage(role)).toBe(["owner", "admin", "approver"].includes(role));
    expect(canEditPackageAssets(role)).toBe(["owner", "admin", "editor"].includes(role));
  });
  it.each(["2026-10-01T15:30:42.654321Z", "2026-10-01T10:30:42.123456-05:00", "2026-10-01T15:30:42Z"])("preserves exact permission time %s", (value) => expect(reviewRightsInstant.parse(value)).toBe(value));
  it.each(["2026-02-30T00:00:00Z", "2026-10-01T15:30", "2026-10-01T15:30:42.1234567Z", "0000-01-01T00:00:00Z", "not a date"])("rejects invalid permission time %s", (value) => expect(reviewRightsInstant.safeParse(value).success).toBe(false));
});
