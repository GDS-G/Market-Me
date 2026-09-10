import { describe, expect, it, vi } from "vitest";
import type { ExactTextPreviewSelection, StoredCampaignPreviewOption } from "@market-me/database";
import { createFinalizationAttempt, finalizationFormPath, finalizationPreviewChoices, finalizationRequest, finalizationResultPath,
  finalizationStorageKey, restoreFinalizationAttempt, selectedFinalizationInput, sendFinalizationAttempt, utcFormInstant, type FinalizationFormInput } from "./campaign-finalization-request";

const uuid = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const scope = { userId: uuid(1), workspaceId: uuid(2), preparationId: uuid(3) };
const input: FinalizationFormInput = { workspaceId: scope.workspaceId, preparationId: scope.preparationId, expectedPlanningVersionId: uuid(4),
  draftId: uuid(5), expectedDraftVersionId: uuid(6), previewId: uuid(7), expectedPreviewFingerprint: `mm-preview-v1:sha256:${"a".repeat(64)}`,
  timing: { type: "preferred_window", start: "2026-10-01T10:30:42.125Z", end: "2026-10-01T12:01:02.999Z" }, templateVersion: 1 };
const selection = { token: input.expectedPreviewFingerprint, snapshot: { lineage: { workspaceId: scope.workspaceId,
  sourceCampaignVersionId: uuid(4), generationId: uuid(9), previewId: uuid(7), contentDraftId: uuid(5), contentDraftVersionId: uuid(6) } } } as ExactTextPreviewSelection;
const choice = { id: uuid(7), draftId: uuid(5), label: "Café 🚀 · explicit account" };

describe("exact finalization recovery", () => {
  it("preserves the byte-identical key, millisecond timing and fingerprint across response loss and reload", async () => {
    const values = new Map<string, string>();
    const storage = { setItem: (key: string, value: string) => { values.set(key, value); } };
    const send = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("Response lost")).mockResolvedValueOnce(Response.json({ data: { id: uuid(9) } }));
    const attempt = createFinalizationAttempt(scope, input, uuid(8));
    await expect(sendFinalizationAttempt(attempt, scope, storage, send)).rejects.toThrow("Response lost");
    const restored = restoreFinalizationAttempt(values.get(finalizationStorageKey(scope))!, scope)!;
    await sendFinalizationAttempt(restored, scope, storage, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
    expect(JSON.parse(String(send.mock.calls[0][1]!.body))).toEqual({ input, idempotencyKey: uuid(8) });
    expect(finalizationRequest(restored)).toBe(finalizationRequest(attempt));
  });
  it("sends zero POST requests if browser storage fails", async () => {
    const send = vi.fn<typeof fetch>();
    await expect(sendFinalizationAttempt(createFinalizationAttempt(scope, input, uuid(8)), scope,
      { setItem: () => { throw new Error("Storage unavailable"); } }, send)).rejects.toThrow("Storage unavailable");
    expect(send).not.toHaveBeenCalled();
  });
  it("takes an independent input copy rather than following subsequent form edits", () => {
    const edited = structuredClone(input), saved = createFinalizationAttempt(scope, edited, uuid(8));
    edited.expectedPreviewFingerprint = `mm-preview-v1:sha256:${"b".repeat(64)}`; edited.timing = { type: "immediate" };
    expect(saved.input).toEqual(input);
  });
  it.each(["userId", "workspaceId", "preparationId"] as const)("separates saved attempts by %s and rejects cross-scope replay", async (field) => {
    const other = { ...scope, [field]: uuid(9) }, attempt = createFinalizationAttempt(scope, input, uuid(8));
    expect(finalizationStorageKey(other)).not.toBe(finalizationStorageKey(scope));
    expect(() => restoreFinalizationAttempt(JSON.stringify(attempt), other)).toThrow();
    const storage = { setItem: vi.fn() }, send = vi.fn<typeof fetch>();
    await expect(sendFinalizationAttempt(attempt, other, storage, send)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it.each(["{", "null", "[]", '{"version":2}', ""])("does not silently discard malformed saved data %s", (raw) => {
    expect(() => restoreFinalizationAttempt(raw, scope)).toThrow();
  });
  it("distinguishes an absent recovery copy from corrupted storage", () => { expect(restoreFinalizationAttempt(null, scope)).toBeUndefined(); });
  it.each(["credentials", "snapshot", "actorUserId", "steps", "autonomyMode"])("rejects unexpected saved authority %s", (field) => {
    const saved = createFinalizationAttempt(scope, input, uuid(8));
    expect(() => restoreFinalizationAttempt(JSON.stringify({ ...saved, input: { ...input, [field]: {} } }), scope)).toThrow();
  });
  it("rejects unselected or reversed timing fields", () => {
    for (const timing of [{ type: "immediate", start: "2026-10-01T00:00:00Z" }, { type: "preferred_window", start: "2026-10-02T00:00:00Z", end: "2026-10-01T00:00:00Z" }]) {
      expect(() => createFinalizationAttempt(scope, { ...input, timing } as FinalizationFormInput, uuid(8))).toThrow();
    }
  });
  it("derives expected IDs and token only from the selected coherent response", () => {
    expect(selectedFinalizationInput(scope, uuid(4), uuid(9), choice, selection, input.timing)).toEqual(input);
  });
  it.each(["workspaceId", "sourceCampaignVersionId", "generationId", "previewId", "contentDraftId"])("rejects a selection with mismatched %s", (field) => {
    const wrong = { ...selection, snapshot: { ...selection.snapshot, lineage: { ...selection.snapshot.lineage, [field]: uuid(8) } } };
    expect(() => selectedFinalizationInput(scope, uuid(4), uuid(9), choice, wrong, input.timing)).toThrow();
  });
  it("does not use a label or stale summary as an exact token", () => {
    expect(() => selectedFinalizationInput(scope, uuid(4), uuid(9), choice, { ...selection, token: "preview-id-only" }, input.timing)).toThrow();
  });
  it("renders no implicit choice while filtering unsupported, stale, attached, and unrelated summary options", () => {
    const option = { id: uuid(7), contentDraftId: uuid(5), sourceCampaignVersionId: uuid(4), isCurrentApprovedVersion: true,
      status: "ready", isStale: false, assets: [], provider: "discord_webhook", channelConnectionName: "Café account" } as unknown as StoredCampaignPreviewOption;
    const invalid = [{ provider: "mailchimp" }, { isStale: true }, { status: "blocked" }, { assets: [{}] }, { isCurrentApprovedVersion: false }, { contentDraftId: uuid(8) }, { sourceCampaignVersionId: uuid(9) }];
    expect(finalizationPreviewChoices([option, ...invalid.map((change) => ({ ...option, ...change } as StoredCampaignPreviewOption))], uuid(4), [uuid(5)]))
      .toEqual([{ id: uuid(7), draftId: uuid(5), label: "General audience · Café account · discord webhook" }]);
    expect(finalizationPreviewChoices([], uuid(4), [uuid(5)])).toEqual([]);
  });
  it("converts explicit UTC picker values without adopting the machine timezone or dropping milliseconds", () => {
    expect(utcFormInstant("2026-10-01T10:30:42.125")).toBe("2026-10-01T10:30:42.125Z");
    expect(utcFormInstant("2026-10-01T10:30")).toBe("2026-10-01T10:30:00.000Z");
    expect(() => utcFormInstant("2026-02-30T10:30")).toThrow();
  });
  it("only creates internal navigation paths from valid UUIDs", () => {
    expect(finalizationResultPath(uuid(8), scope.workspaceId)).toBe(`/campaigns/finalizations/${uuid(8)}?workspaceId=${scope.workspaceId}`);
    expect(finalizationFormPath(scope.preparationId, scope.workspaceId)).toContain(`/preparations/${scope.preparationId}/finalize?`);
    expect(() => finalizationResultPath("https://evil.test", scope.workspaceId)).toThrow();
    expect(() => finalizationFormPath(scope.preparationId, "../foreign")).toThrow();
  });
});
