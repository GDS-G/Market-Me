import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceSetupReview } from "./source-setup-review";
import { createSourceSetupAttempt, isSourceSetupFolderPage, isSourceSetupReceipt, restoreSourceSetupAttempt, sourceSetupResultPath, sourceSetupStorageKey } from "./source-setup-request";
import { setupInput, setupReceipt, setupUserId } from "./source-setup.test-fixture";

const scope = { workspaceId: setupInput.workspaceId, userId: setupUserId };
describe("guided source setup review and recovery", () => {
  it("saves an exact canonical request and restores only its actor/workspace scope", () => {
    const attempt = createSourceSetupAttempt(scope, { ...setupInput, name: " Newsroom " });
    expect(attempt.input.name).toBe("Newsroom");
    expect(restoreSourceSetupAttempt(JSON.stringify(attempt), scope)).toEqual(attempt);
    expect(restoreSourceSetupAttempt(null, scope)).toBeUndefined();
    expect(sourceSetupStorageKey(scope)).toContain(`${scope.workspaceId}:${scope.userId}`);
    expect(() => restoreSourceSetupAttempt(JSON.stringify(attempt), { ...scope, userId: setupInput.requestId })).toThrow();
    expect(() => restoreSourceSetupAttempt(JSON.stringify(attempt), { ...scope, workspaceId: setupUserId })).toThrow();
  });
  it.each(["{", "null", "[]", '"value"', "x".repeat(40_001), JSON.stringify({ version: 2, input: setupInput, userId: setupUserId }),
    JSON.stringify({ version: 1, input: { ...setupInput, enabled: true }, userId: setupUserId }),
    JSON.stringify({ version: 1, input: setupInput, userId: setupUserId, token: "private" }),
  ])("refuses corrupted, incompatible or authority-bearing stored data", (raw) => {
    expect(() => restoreSourceSetupAttempt(raw, scope)).toThrow();
  });
  it("requires an exact minimized receipt and constructs only a local UUID-scoped path", () => {
    expect(isSourceSetupReceipt(setupReceipt, setupInput)).toBe(true);
    expect(sourceSetupResultPath(setupReceipt)).toBe(`/smart-sources/${setupReceipt.smartSourceId}/edit?workspaceId=${scope.workspaceId}`);
    for (const patch of [{ workspaceId: setupUserId }, { requestId: setupUserId }, { smartSourceId: "javascript:alert(1)" },
      { canonicalRequest: "private" }, { initialState: "active" }, { createdAt: "bad" }, { name: null }, { name: "Different source" }]) {
      expect(isSourceSetupReceipt({ ...setupReceipt, ...patch }, setupInput)).toBe(false);
    }
  });
  it("minimizes and bounds folder browser responses", () => {
    const page = { folders: [{ name: "News", providerLocationId: "news-folder" }], examinedCount: 2, incompleteSearch: false, nextCursor: "sealed" };
    expect(isSourceSetupFolderPage(page)).toBe(true);
    for (const patch of [{ accessToken: "secret" }, { examinedCount: 201 }, { examinedCount: 0 }, { incompleteSearch: "false" },
      { folders: [{ ...page.folders[0], token: "secret" }] }, { folders: [{ name: "News", providerLocationId: 42 }] }, { nextCursor: "" }]) {
      expect(isSourceSetupFolderPage({ ...page, ...patch })).toBe(false);
    }
  });
  it("explains paused scope and unsupported simulation/automation without exposing request identity", () => {
    const html = renderToStaticMarkup(createElement(SourceSetupReview, { input: setupInput, connectionName: "Storage account", contextNames: [] }));
    expect(html).toContain("My Drive / Newsroom"); expect(html).toContain("Paused");
    expect(html).toContain("not a scan"); expect(html).toContain("No automatic publishing");
    expect(html).toContain("Nothing is scanned or queued"); expect(html).not.toContain(setupInput.requestId);
    expect(html).not.toContain(setupInput.storageConnectionId!); expect(html).not.toContain("news-folder");
  });
  it.each(["related_files", "ready_marker"] as const)("explains %s using the compiled settings", (readinessMode) => {
    const html = renderToStaticMarkup(createElement(SourceSetupReview, { input: { ...setupInput, readinessMode, relatedFileMinimum: 3, readyMarker: "APPROVED" },
      connectionName: "Storage", contextNames: ["Brand guide · v2"] }));
    expect(html).toContain(readinessMode === "related_files" ? "3 related files" : "APPROVED");
    expect(html).toContain("Brand guide · v2");
  });
});
