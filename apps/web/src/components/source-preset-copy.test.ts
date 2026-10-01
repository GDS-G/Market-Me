import { describe, expect, it } from "vitest";
import { copySourcePresetValues, parseSourcePresetChoices, parseSourcePresetVersion, sourcePresetSelectionKey } from "./source-preset-copy";
import { initialSourcePreparationBindingValues } from "./source-preparation-binding-request";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const presetId = "33333333-3333-4333-8333-333333333333";
const otherId = "44444444-4444-4444-8444-444444444444";
const settings = { templateKey: "general_announcement", templateVersion: 1, name: "Reusable announcement", description: "Shared values",
  audienceProfileVersionIds: [otherId, sourceId], informationDepth: "detailed", promotionalStrength: "light", timezone: "America/Chicago" };
const choice = { id: presetId, revision: 4, versionNumber: 2, title: "Community update", archived: false };

describe("source preset values-only copy", () => {
  it.each([false, true])("preserves existing enabled=%s and binding revision while replacing all reusable values", enabled => {
    const current = { ...initialSourcePreparationBindingValues(workspaceId), enabled, expectedRevision: 7,
      brandProfileVersionId: presetId, destinationId: otherId, audienceProfileVersionIds: [presetId] };
    const copied = copySourcePresetValues(current, settings);
    expect(copied).toEqual({ workspaceId, enabled, expectedRevision: 7, ...settings });
    expect(copied).not.toHaveProperty("brandProfileVersionId");
    expect(copied).not.toHaveProperty("destinationId");
    expect(current.brandProfileVersionId).toBe(presetId);
    expect(copied.audienceProfileVersionIds).not.toBe(settings.audienceProfileVersionIds);
  });
  it("retains an uncreated disabled binding and rejects authority-bearing preset configuration", () => {
    const current = initialSourcePreparationBindingValues(workspaceId);
    expect(copySourcePresetValues(current, settings)).not.toHaveProperty("expectedRevision");
    expect(copySourcePresetValues(current, settings).enabled).toBe(false);
    for (const extra of [{ enabled: true }, { expectedRevision: 1 }, { workspaceId: otherId }, { writerUserId: otherId }, { presetId }, { steps: [] }]) {
      expect(() => copySourcePresetValues(current, { ...settings, ...extra })).toThrow();
    }
  });
  it("invalidates consent when source, workspace, selected version, revision or archive state changes", () => {
    const scope = { workspaceId, smartSourceId: sourceId };
    const original = sourcePresetSelectionKey(scope, choice);
    for (const change of [{ id: otherId }, { revision: 5 }, { versionNumber: 1 }, { archived: true }]) {
      expect(sourcePresetSelectionKey(scope, { ...choice, ...change })).not.toBe(original);
    }
    expect(sourcePresetSelectionKey({ ...scope, smartSourceId: otherId }, choice)).not.toBe(original);
    expect(sourcePresetSelectionKey({ ...scope, workspaceId: otherId }, choice)).not.toBe(original);
  });
  it("requires a bounded minimized choices page for the exact request", () => {
    const page = { workspaceId, page: 1, more: true, items: [choice] };
    expect(parseSourcePresetChoices(page, workspaceId, 1)).toEqual(page);
    for (const patch of [{ workspaceId: otherId }, { page: 2 }, { items: [choice, choice] }, { items: [{ ...choice, notes: "private" }] }, { canonicalRequest: "private" }]) {
      expect(() => parseSourcePresetChoices({ ...page, ...patch }, workspaceId, 1)).toThrow();
    }
  });
  it("requires the exact selected immutable version and forbids archived copy results", () => {
    const version = { workspaceId, presetId, versionNumber: 2, title: choice.title, notes: "", configuration: settings,
      configurationHash: "a".repeat(64), createdAt: "2026-10-01T00:00:00.000Z", copiedFrom: null };
    expect(parseSourcePresetVersion(version, workspaceId, choice)).toEqual(version);
    for (const patch of [{ workspaceId: otherId }, { presetId: otherId }, { versionNumber: 1 }]) {
      expect(() => parseSourcePresetVersion({ ...version, ...patch }, workspaceId, choice)).toThrow();
    }
    expect(() => parseSourcePresetVersion(version, workspaceId, { ...choice, archived: true })).toThrow();
  });
  it("rejects response pages, identifiers, strings and revisions outside the bounded chooser contract", () => {
    const page = { workspaceId, page: 1, more: false, items: [choice] };
    const tooMany = Array.from({ length: 51 }, (_, index) => ({ ...choice,
      id: `${(index + 1).toString(16).padStart(8, "0")}-1111-4111-8111-111111111111` }));
    for (const patch of [{ page: 0 }, { page: 2_001 }, { items: tooMany },
      ...[{ id: "invalid" }, { title: "x".repeat(121) }, { revision: 0 }, { revision: 2_147_483_648 }, { versionNumber: 0 }]
        .map(item => ({ items: [{ ...choice, ...item }] }))]) {
      expect(() => parseSourcePresetChoices({ ...page, ...patch }, workspaceId, 1)).toThrow();
    }
    expect(parseSourcePresetChoices({ ...page, page: 2_000 }, workspaceId, 2_000).page).toBe(2_000);
  });
});
