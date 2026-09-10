import { describe, expect, it } from "vitest";
import { canPrepareCampaign, createPreparationAttempt, preparationRequest, preparationResultPath, preparationStorageKey, restorePreparationAttempt, type PreparationFormInput } from "./campaign-preparation-request";

const uuid = (digit: number) => `${digit.toString().repeat(8)}-${digit.toString().repeat(4)}-4${digit.toString().repeat(3)}-8${digit.toString().repeat(3)}-${digit.toString().repeat(12)}`;
const scope = { userId: uuid(1), workspaceId: uuid(2) };
const input: PreparationFormInput = { workspaceId: scope.workspaceId, contentPackageId: uuid(3), expectedPackageVersion: 4,
  templateKey: "general_announcement", templateVersion: 1, name: "Café 🚀 launch", description: "Unicode and\nline breaks preserved",
  audienceProfileVersionIds: [uuid(6), uuid(5)], informationDepth: "contextual", promotionalStrength: "informational", timezone: "America/Chicago" };

describe("saved preparation attempts", () => {
  it("restores the byte-identical request body and key after reload without adopting changed package state", () => {
    const attempt = createPreparationAttempt(scope, input, uuid(4));
    const before = preparationRequest(attempt);
    const restored = restorePreparationAttempt(JSON.stringify(attempt), scope)!;
    expect(preparationRequest(restored)).toBe(before);
    expect(restored.input.expectedPackageVersion).toBe(4); expect(restored.idempotencyKey).toBe(uuid(4));
    expect(restored.input.audienceProfileVersionIds).toEqual([uuid(6), uuid(5)]);
    expect(JSON.parse(before)).toEqual({ input, idempotencyKey: uuid(4) });
  });
  it("takes an independent copy so editing a form value cannot mutate a saved request", () => {
    const values = structuredClone(input);
    const attempt = createPreparationAttempt(scope, values, uuid(4));
    values.name = "Changed"; values.expectedPackageVersion = 5; values.audienceProfileVersionIds.reverse();
    expect(attempt.input).toEqual(input);
  });
  it("preserves unset optional brand and destination instead of inventing defaults", () => {
    const body = JSON.parse(preparationRequest(createPreparationAttempt(scope, input, uuid(4))));
    expect(body.input).not.toHaveProperty("brandProfileVersionId"); expect(body.input).not.toHaveProperty("destinationId");
    expect(body.input).not.toHaveProperty("steps"); expect(body.input).not.toHaveProperty("autonomyMode");
  });
  it("separates both users and workspaces and rejects cross-scope storage", () => {
    const otherUser = { ...scope, userId: uuid(7) }, otherWorkspace = { ...scope, workspaceId: uuid(8) };
    const serialized = JSON.stringify(createPreparationAttempt(scope, input, uuid(4)));
    expect(new Set([scope, otherUser, otherWorkspace].map(preparationStorageKey)).size).toBe(3);
    expect(() => restorePreparationAttempt(serialized, otherUser)).toThrow();
    expect(() => restorePreparationAttempt(serialized, otherWorkspace)).toThrow();
    expect(() => createPreparationAttempt(otherWorkspace, input, uuid(4))).toThrow();
  });
  it.each(["{", "null", "[]", '{"version":2}', ""])("does not silently discard unreadable stored history %s", (serialized) => {
    expect(() => restorePreparationAttempt(serialized, scope)).toThrow();
  });
  it("distinguishes a genuinely absent attempt from malformed stored data", () => {
    expect(restorePreparationAttempt(null, scope)).toBeUndefined();
  });
  it.each(["credentials", "actorUserId", "context", "steps"])("rejects unexpected stored authority %s", (field) => {
    const attempt = createPreparationAttempt(scope, input, uuid(4));
    expect(() => restorePreparationAttempt(JSON.stringify({ ...attempt, input: { ...input, [field]: "untrusted" } }), scope)).toThrow();
  });
  it("makes a separate attempt only when the caller explicitly supplies a new key", () => {
    const first = createPreparationAttempt(scope, input, uuid(4));
    const second = createPreparationAttempt(scope, { ...input, expectedPackageVersion: 5 }, uuid(7));
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    expect(first.input.expectedPackageVersion).toBe(4);
  });
  it("validates both navigation identifiers instead of treating a response ID as a URL", () => {
    expect(preparationResultPath(uuid(4), scope.workspaceId)).toBe(`/campaigns/preparations/${uuid(4)}?workspaceId=${scope.workspaceId}`);
    expect(() => preparationResultPath("https://evil.test", scope.workspaceId)).toThrow();
    expect(() => preparationResultPath(uuid(4), "../foreign")).toThrow();
  });
  it.each(["owner", "admin", "editor"])("permits preparation for an approved package and %s role only", (role) => {
    expect(canPrepareCampaign(role)).toBe(true);
    for (const status of ["needs_review", "ready", "rejected", "archived"]) expect(canPrepareCampaign(role, status)).toBe(false);
  });
  it.each(["viewer", "approver", "", "EDITOR"])("does not offer preparation to %s", (role) => {
    expect(canPrepareCampaign(role)).toBe(false);
  });
});
